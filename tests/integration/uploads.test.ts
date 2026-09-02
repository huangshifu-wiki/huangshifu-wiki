import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../../server'
import { prisma, createTestUser } from './setup'

const UPLOAD_TEST_PREFIX = 'media-upload-integrity-'
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

function pickCookie(setCookieHeader: string[] | string | undefined, cookieName: string) {
  const cookies = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : []
  return cookies
    .find((cookie) => cookie.startsWith(`${cookieName}=`))
    ?.split(';')[0]
    .split('=')[1]
}
describe('Media upload integrity', () => {
  let ownerUid: string
  let agent: ReturnType<typeof request.agent>
  let xsrfToken: string

  beforeEach(async () => {
    const created = await createTestUser({
      email: `${UPLOAD_TEST_PREFIX}${Date.now()}@example.com`,
      displayName: 'MediaUploadTestUser',
    })
    ownerUid = created.user.uid
    agent = request.agent(app)
    const login = await agent.post('/api/auth/login').send({
      email: created.user.email,
      password: created.plainPassword,
    })
    expect(login.status).toBe(200)
    xsrfToken = pickCookie(login.headers['set-cookie'], 'XSRF-TOKEN')!
  })

  afterEach(async () => {
    const assets = await prisma.mediaAsset.findMany({
      where: { ownerUid },
      select: { id: true, imageMapId: true },
    })
    const mapIds = [...new Set(assets.map((asset) => asset.imageMapId).filter(Boolean))] as string[]
    await prisma.mediaAsset.updateMany({ where: { ownerUid }, data: { imageMapId: null } })
    await prisma.mediaAsset.deleteMany({ where: { ownerUid } })
    if (mapIds.length) await prisma.imageMap.deleteMany({ where: { id: { in: mapIds } } })
    await prisma.user.deleteMany({ where: { uid: ownerUid } })
  })

  it('连续上传相同字节只创建一个 ImageMap 和两个逻辑 claim', async () => {
    const sessionResponse = await agent
      .post('/api/uploads/sessions')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ maxFiles: 2 })
    expect(sessionResponse.status).toBe(201)
    const sessionId = sessionResponse.body.session.id

    expect(sessionResponse.body.session.maxFiles).toBe(2)
    const sessionGet = await agent.get(`/api/uploads/sessions/${sessionId}`)
    expect(sessionGet.status).toBe(200)
    expect(sessionGet.body.session.maxFiles).toBe(2)

    const upload = () =>
      agent
        .post(`/api/uploads/sessions/${sessionId}/files`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .attach('file', ONE_PIXEL_PNG, 'same.png')
    const first = await upload()
    const second = await upload()

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(first.body.asset).toMatchObject({ status: 'uploaded', md5: expect.any(String) })
    expect(second.body.asset).toMatchObject({
      imageMapId: first.body.asset.imageMapId,
      reused: true,
      md5: first.body.asset.md5,
    })

    const finalized = await agent
      .post(`/api/uploads/sessions/${sessionId}/finalize`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send()
    expect(finalized.status).toBe(200)

    const maps = await prisma.imageMap.findMany({ where: { md5: first.body.asset.md5 } })
    const claims = await prisma.mediaAsset.findMany({ where: { ownerUid, status: 'ready' } })
    expect(maps).toHaveLength(1)
    expect(claims).toHaveLength(2)
    expect(claims.every((claim) => claim.imageMapId === maps[0].id)).toBe(true)

    const secondFinalize = await agent
      .post(`/api/uploads/sessions/${sessionId}/finalize`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send()
    expect(secondFinalize.status).toBe(200)

    const release = await agent
      .delete(`/api/uploads/assets/${claims[0].id}`)
      .set('X-XSRF-TOKEN', xsrfToken)
    expect(release.status).toBe(200)
    expect(
      await prisma.mediaAsset.count({ where: { imageMapId: maps[0].id, status: 'ready' } })
    ).toBe(1)
    expect(await prisma.imageMap.count({ where: { id: maps[0].id } })).toBe(1)
  })
  it('并发上传相同字节在 advisory lock 下只创建一个 ImageMap', async () => {
    const sessionResponse = await agent
      .post('/api/uploads/sessions')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ maxFiles: 2 })
    const sessionId = sessionResponse.body.session.id
    const upload = () =>
      agent
        .post(`/api/uploads/sessions/${sessionId}/files`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .attach('file', ONE_PIXEL_PNG, 'concurrent.png')

    const responses = await Promise.all([upload(), upload()])
    expect(responses.map((response) => response.status)).toEqual([201, 201])
    const md5 = responses[0].body.asset.md5
    expect(responses[1].body.asset.md5).toBe(md5)
    expect(await prisma.imageMap.count({ where: { md5 } })).toBe(1)
    expect(
      await prisma.mediaAsset.count({
        where: { ownerUid, imageMapId: responses[0].body.asset.imageMapId },
      })
    ).toBe(2)
  })
})
