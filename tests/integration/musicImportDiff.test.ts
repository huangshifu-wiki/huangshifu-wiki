import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest'
import request from 'supertest'
import type * as MetingServiceModule from '../../src/server/music/metingService'
import { app } from '../../server'
import { prisma, createTestUser, nextTestNumericSlug } from './setup'
import type { TestUserCreated } from './setup'

const TEST_SOURCE_ID = 'test_diff_src_1001'
const TEST_SONG_TITLE = `Test Diff Song ${TEST_SOURCE_ID}`

vi.mock('../../src/server/music/metingService', async () => {
  const actual = await vi.importActual<typeof MetingServiceModule>(
    '../../src/server/music/metingService'
  )
  return {
    ...actual,
    getMusicResourcePreview: vi.fn().mockImplementation(async (platform, type, id) => {
      return {
        platform,
        type,
        id,
        title: 'Mock 资源标题',
        artist: '黄诗扶',
        cover: 'https://example.com/mock-cover.jpg',
        description: 'Mock 描述',
        platformUrl: `https://music.163.com/#/song?id=${id}`,
        songs: [
          {
            sourceId: id,
            title: `Test Diff Song ${id}`,
            artists: ['黄诗扶'],
            album: '平台原始专辑',
            picId: 'pic1',
            urlId: 'url1',
            lyricId: 'lyric1',
            cover: 'https://example.com/mock-cover.jpg',
            sourceUrl: `https://music.163.com/#/song?id=${id}`,
          },
        ],
      }
    }),
  }
})

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

describe('Music Import Diff API - 歌曲导入预检与Diff比对集成测试', () => {
  let adminUser: TestUserCreated

  beforeEach(async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    adminUser = await createTestUser({
      email: `test_import_diff_${suffix}@example.com`,
      role: 'admin',
    })
  })

  afterEach(async () => {
    // 正常单曲导入不建专辑；此处兜底防止回归时脏专辑跨用例残留
    await prisma.album.deleteMany({
      where: { externalSources: { some: { sourceId: TEST_SOURCE_ID } } },
    })
    await prisma.musicExternalSource.deleteMany({
      where: { sourceId: TEST_SOURCE_ID },
    })
    await prisma.musicTrack.deleteMany({
      where: { title: TEST_SONG_TITLE },
    })
    if (adminUser?.user?.uid) {
      await prisma.user.deleteMany({
        where: { uid: adminUser.user.uid },
      })
    }
  })

  it('verifies parse-url returns match diffs and import applies fill duplicate strategy safely', async () => {
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    // 创建一首已有人工精修歌曲
    const existingSong = await prisma.musicTrack.create({
      data: {
        slug: nextTestNumericSlug(),
        title: TEST_SONG_TITLE,
        artists: ['黄诗扶'],
        album: '精修专辑',
        externalSources: {
          create: {
            resourceType: 'song',
            platform: 'netease',
            sourceId: TEST_SOURCE_ID,
            isPrimary: true,
          },
        },
      },
    })

    // 测试 /parse-url 端点
    const parseRes = await agent
      .post('/api/music/parse-url')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        url: `https://music.163.com/#/song?id=${TEST_SOURCE_ID}`,
      })

    expect(parseRes.status).toBe(200)
    expect(parseRes.body.resource).toBeDefined()
    expect(parseRes.body.resource.songs).toBeDefined()
    expect(parseRes.body.resource.matchSummary).toBeDefined()

    const firstSong = parseRes.body.resource.songs[0]
    expect(firstSong).toBeDefined()
    expect(firstSong.match).toBeDefined()
    expect(firstSong.match.matchType).toBe('source')
    expect(firstSong.match.existingSong?.docId).toBe(existingSong.docId)
    expect(Array.isArray(firstSong.match.diffs)).toBe(true)

    // 测试 /import 端点，使用 fill 策略（不破坏原有已修标题和专辑）
    const importRes = await agent
      .post('/api/music/import')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        url: `https://music.163.com/#/song?id=${TEST_SOURCE_ID}`,
        duplicateStrategy: 'fill',
        selectedSongIds: [TEST_SOURCE_ID],
      })

    expect(importRes.status).toBe(200)
    expect(importRes.body.summary).toBeDefined()
    expect(importRes.body.summary.imported).toBe(0) // 已经存在，imported 为 0
    expect(importRes.body.summary.skipped).toBe(1) // 计入 skipped/updated

    // 验证库中原有的标题和精修专辑依然被安全保留
    const updated = await prisma.musicTrack.findUnique({
      where: { docId: existingSong.docId },
    })
    expect(updated?.title).toBe(TEST_SONG_TITLE)
    expect(updated?.album).toBe('精修专辑')
  })

  it('imports a single song url without creating an album entity', async () => {
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const importRes = await agent
      .post('/api/music/import')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        url: `https://music.163.com/#/song?id=${TEST_SOURCE_ID}`,
        duplicateStrategy: 'fill',
        selectedSongIds: [TEST_SOURCE_ID],
      })

    expect(importRes.status).toBe(200)
    expect(importRes.body.summary.imported).toBe(1)
    expect(importRes.body.collection).toBeNull()

    const albumSource = await prisma.musicExternalSource.findFirst({
      where: { resourceType: 'album', sourceId: TEST_SOURCE_ID },
    })
    expect(albumSource).toBeNull()

    const importedSong = await prisma.musicTrack.findFirst({
      where: { title: TEST_SONG_TITLE },
    })
    expect(importedSong?.album).toBe('平台原始专辑')
  })
})
