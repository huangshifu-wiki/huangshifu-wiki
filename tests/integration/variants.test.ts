import { describe, beforeEach, afterEach, it, expect } from 'vitest'
import request from 'supertest'
import { app } from '../../server'
import { prisma, createTestUser, nextTestNumericSlug } from './setup'

function findCookieValue(setCookieHeader: string | string[] | undefined, cookieName: string) {
  const cookies = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : []
  const targetCookie = cookies.find((cookie) => cookie?.startsWith(`${cookieName}=`))
  return targetCookie?.split(';')[0].split('=')[1]
}

async function createAuthenticatedAgent(email: string, password: string) {
  const agent = request.agent(app)
  const loginResponse = await agent.post('/api/auth/login').send({ email, password })

  expect(loginResponse.status).toBe(200)
  const xsrfToken = findCookieValue(loginResponse.headers['set-cookie'], 'XSRF-TOKEN')
  expect(xsrfToken).toBeTruthy()

  return {
    agent,
    xsrfToken: xsrfToken!,
  }
}

describe('Admin variant engine API', () => {
  let adminUser: Awaited<ReturnType<typeof createTestUser>>

  beforeEach(async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    adminUser = await createTestUser({
      role: 'admin',
      email: `test_variant_admin_${suffix}@example.com`,
      displayName: `TestVariantAdmin_${suffix}`,
    })
  })

  afterEach(async () => {
    await prisma.songCover.deleteMany({
      where: { storageKey: { startsWith: 'test-variants/' } },
    })
    await prisma.albumCover.deleteMany({
      where: { storageKey: { startsWith: 'test-variants/' } },
    })
    await prisma.musicTrack.deleteMany({
      where: { title: { startsWith: 'Variant Engine' } },
    })
    await prisma.album.deleteMany({
      where: { title: { startsWith: 'Variant Engine' } },
    })
    await prisma.imageMap.deleteMany({
      where: { md5: { startsWith: 'test-variants-' } },
    })
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'test_variant_admin_' } },
    })
  })

  it('rebuilds missing song covers via type=songCover and reports byType stats', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const song = await prisma.musicTrack.create({
      data: {
        slug: nextTestNumericSlug(),
        title: 'Variant Engine Song',
        artists: ['Variant Artist'],
        album: 'Variant Album',
      },
    })
    await prisma.songCover.create({
      data: {
        songDocId: song.docId,
        storageKey: `test-variants/song-cover-${suffix}.jpg`,
        publicUrl: `/uploads/test-variants-song-cover-${suffix}.jpg`,
        variantStatus: 'pending',
        sortOrder: 0,
      },
    })

    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const beforeQueueLength = (await agent.get('/api/admin/variants/stats')).body.data.queueLength

    const rebuildResponse = await agent
      .post('/api/admin/rebuild-all-variants')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ type: 'songCover', scope: 'missing', dryRun: true })

    expect(rebuildResponse.status).toBe(200)
    expect(rebuildResponse.body.success).toBe(true)
    expect(rebuildResponse.body.summary.totalScanned).toBeGreaterThanOrEqual(1)
    expect(rebuildResponse.body.summary.queuedForRebuild).toBe(
      rebuildResponse.body.summary.totalScanned
    )

    // dryRun 不得把任务放进变体队列
    const queueLength = (await agent.get('/api/admin/variants/stats')).body.data.queueLength
    expect(queueLength).toBe(beforeQueueLength)

    const statsResponse = await agent.get('/api/admin/variants/stats')

    expect(statsResponse.status).toBe(200)
    expect(statsResponse.body.data).toMatchObject({
      queueLength: expect.any(Number),
      processingCount: expect.any(Number),
      completedToday: expect.any(Number),
      failedToday: expect.any(Number),
    })
    expect(statsResponse.body.data.byType).toBeDefined()
    expect(statsResponse.body.data.byType.imageMap).toMatchObject({
      total: expect.any(Number),
      completed: expect.any(Number),
      failed: expect.any(Number),
      pending: expect.any(Number),
    })
    expect(statsResponse.body.data.byType.songCover.total).toBeGreaterThanOrEqual(1)
    expect(statsResponse.body.data.byType.albumCover).toMatchObject({
      total: expect.any(Number),
      completed: expect.any(Number),
      failed: expect.any(Number),
      pending: expect.any(Number),
    })
  })

  it('rejects an invalid rebuild type', async () => {
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const response = await agent
      .post('/api/admin/rebuild-all-variants')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ type: 'bogus' })

    expect(response.status).toBe(400)
    expect(response.body.success).toBe(false)
  })

  it('defaults rebuild type to imageMap for backward compatibility', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    await prisma.imageMap.create({
      data: {
        id: `test-variants-image-${suffix}`,
        md5: `test-variants-${suffix}`,
        localUrl: `/uploads/test-variants/default-${suffix}.png`,
      },
    })

    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const response = await agent
      .post('/api/admin/rebuild-all-variants')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ scope: 'missing', dryRun: true })

    expect(response.status).toBe(200)
    // 省略 type 时应只扫描 imageMap（不含歌曲/专辑封面），且包含本次创建的行
    const imageMapMissingCount = await prisma.imageMap.count({
      where: { deletedAt: null, OR: [{ thumbnailUrl: null }, { variantStatus: 'pending' }] },
    })
    expect(imageMapMissingCount).toBeGreaterThanOrEqual(1)
    expect(response.body.summary.totalScanned).toBe(imageMapMissingCount)
  })
})
