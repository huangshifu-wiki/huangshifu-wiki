import { describe, beforeEach, afterEach, it, expect } from 'vitest'
import request from 'supertest'
import { app } from '../../server'
import { prisma, createTestUser, nextTestNumericSlug } from './setup'
import { applyAlbumTracksToRelations } from '../../src/server/utils/music'

describe('Music API - 音乐接口测试', () => {
  let adminUser: Awaited<ReturnType<typeof createTestUser>>

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

  beforeEach(async () => {
    await prisma.musicTrack.deleteMany({
      where: {
        OR: [
          { title: { startsWith: 'Markdown Description Test Song' } },
          { title: { startsWith: 'Optional Metadata Test Song' } },
          { title: { startsWith: 'Artist Partial Search Test Song' } },
          { title: { startsWith: 'Display Relation Song' } },
          { title: { startsWith: 'Paged Music Test Song' } },
          { title: { startsWith: '000 Paged Music Test Song' } },
          { title: { startsWith: 'Release Date Sort Test Song' } },
        ],
      },
    })
    await prisma.album.deleteMany({
      where: {
        OR: [
          { title: { startsWith: 'Display Relation Album' } },
          { title: { startsWith: 'Optional Album' } },
        ],
      },
    })
    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: 'test_music_desc_',
        },
      },
    })

    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    adminUser = await createTestUser({
      role: 'admin',
      email: `test_music_desc_admin_${suffix}@example.com`,
      displayName: `TestMusicDescAdmin_${suffix}`,
    })
  })

  afterEach(async () => {
    await prisma.musicTrack.deleteMany({
      where: {
        OR: [
          { title: { startsWith: 'Markdown Description Test Song' } },
          { title: { startsWith: 'Optional Metadata Test Song' } },
          { title: { startsWith: 'Artist Partial Search Test Song' } },
          { title: { startsWith: 'Display Relation Song' } },
          { title: { startsWith: 'Paged Music Test Song' } },
          { title: { startsWith: '000 Paged Music Test Song' } },
          { title: { startsWith: 'Release Date Sort Test Song' } },
        ],
      },
    })
    await prisma.album.deleteMany({
      where: {
        OR: [
          { title: { startsWith: 'Display Relation Album' } },
          { title: { startsWith: 'Optional Album' } },
        ],
      },
    })
    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: 'test_music_desc_',
        },
      },
    })
  })

  it('更新歌曲描述时应保留 Markdown 源文本首尾空白', async () => {
    const song = await prisma.musicTrack.create({
      data: {
        slug: nextTestNumericSlug(),
        title: 'Markdown Description Test Song',
        artists: ['Markdown Description Test Artist'],
        album: '',
      },
    })
    const markdownDescription = '\n\n    const value = 1\n\n正文\n'
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const response = await agent
      .patch(`/api/music/${song.docId}`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ description: markdownDescription })

    expect(response.status).toBe(200)
    expect(response.body.song.description).toBe(markdownDescription)

    const updatedSong = await prisma.musicTrack.findUnique({
      where: { docId: song.docId },
      select: { description: true },
    })
    expect(updatedSong?.description).toBe(markdownDescription)
  })

  it('创建歌曲时允许省略发行日期和时长', async () => {
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const response = await agent
      .post('/api/music')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        title: 'Optional Metadata Test Song',
        artists: ['Optional Metadata Test Artist'],
      })

    expect(response.status).toBe(201)
    expect(response.body.song.releaseDate).toBeNull()
    expect(response.body.song.durationMs).toBeNull()
  })

  it('创建歌曲时拒绝非法发行日期和时长', async () => {
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const invalidDateResponse = await agent
      .post('/api/music')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        title: 'Invalid Date Test Song',
        artists: ['Optional Metadata Test Artist'],
        releaseDate: '2026-02-31',
      })

    expect(invalidDateResponse.status).toBe(400)

    const invalidDurationResponse = await agent
      .post('/api/music')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        title: 'Invalid Duration Test Song',
        artists: ['Optional Metadata Test Artist'],
        durationMs: -1,
      })

    expect(invalidDurationResponse.status).toBe(400)
  })

  it('创建专辑时允许省略发行日期', async () => {
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const response = await agent.post('/api/albums').set('X-XSRF-TOKEN', xsrfToken).send({
      title: 'Optional Album Release Date',
      artist: 'Optional Album Artist',
      cover: '',
      description: 'Optional album description',
    })

    expect(response.status).toBe(201)
    expect(response.body.album.releaseDate).toBeNull()
  })

  it('创建专辑时拒绝非法发行日期', async () => {
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const response = await agent.post('/api/albums').set('X-XSRF-TOKEN', xsrfToken).send({
      title: 'Invalid Album Release Date',
      artist: 'Optional Album Artist',
      releaseDate: '2026-02-31',
    })

    expect(response.status).toBe(400)
  })

  it('重写专辑曲目关系时保留已有展示专辑选择', async () => {
    const [album, displaySong, normalSong] = await Promise.all([
      prisma.album.create({
        data: {
          slug: nextTestNumericSlug(),
          title: 'Display Relation Album',
          artist: 'Batch Artist',
        },
      }),
      prisma.musicTrack.create({
        data: {
          slug: nextTestNumericSlug(),
          title: 'Display Relation Song Display',
          artists: ['Batch Artist'],
        },
      }),
      prisma.musicTrack.create({
        data: {
          slug: nextTestNumericSlug(),
          title: 'Display Relation Song Normal',
          artists: ['Batch Artist'],
        },
      }),
    ])
    await Promise.all([
      prisma.songAlbumRelation.create({
        data: {
          songDocId: displaySong.docId,
          albumDocId: album.docId,
          discNumber: 1,
          trackOrder: 0,
          isDisplay: true,
        },
      }),
      prisma.songAlbumRelation.create({
        data: {
          songDocId: normalSong.docId,
          albumDocId: album.docId,
          discNumber: 1,
          trackOrder: 1,
          isDisplay: false,
        },
      }),
    ])

    await applyAlbumTracksToRelations(album.docId, [
      {
        disc: 1,
        name: '',
        songs: [
          { songDocId: normalSong.docId, trackOrder: 0 },
          { songDocId: displaySong.docId, trackOrder: 1 },
        ],
      },
    ])

    const relations = await prisma.songAlbumRelation.findMany({
      where: { albumDocId: album.docId },
      orderBy: { trackOrder: 'asc' },
    })
    const displayRelation = relations.find((relation) => relation.songDocId === displaySong.docId)
    const normalRelation = relations.find((relation) => relation.songDocId === normalSong.docId)
    expect(displayRelation?.isDisplay).toBe(true)
    expect(displayRelation?.trackOrder).toBe(1)
    expect(normalRelation?.isDisplay).toBe(false)
  })

  it('音乐搜索和搜索建议支持艺术家名称部分匹配', async () => {
    const song = await prisma.musicTrack.create({
      data: {
        slug: nextTestNumericSlug(),
        title: 'Artist Partial Search Test Song',
        artists: ['黄诗扶'],
        album: '',
      },
    })

    const searchResponse = await request(app).get('/api/search').query({ q: '诗扶', type: 'music' })

    expect(searchResponse.status).toBe(200)
    expect(
      searchResponse.body.music.some((item: { docId: string }) => item.docId === song.docId)
    ).toBe(true)

    const suggestResponse = await request(app).get('/api/search/suggest').query({ q: '诗扶' })

    expect(suggestResponse.status).toBe(200)
    expect(
      suggestResponse.body.suggestions.some(
        (item: { type: string; id?: string }) => item.type === 'music' && item.id === song.slug
      )
    ).toBe(true)
  })

  it('音乐列表分页返回总数并支持跨页排序', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const { agent } = await createAuthenticatedAgent(adminUser.user.email, adminUser.plainPassword)
    await Promise.all(
      [
        { title: '000 Paged Music Test Song C', artists: ['002 丙歌手'] },
        { title: '000 Paged Music Test Song A', artists: ['000 甲歌手'] },
        { title: '000 Paged Music Test Song B', artists: ['001 乙歌手'] },
      ].map((song) =>
        prisma.musicTrack.create({
          data: {
            slug: nextTestNumericSlug(),
            title: `${song.title} ${suffix}`,
            artists: song.artists,
            album: '',
          },
        })
      )
    )

    const collectSeededTitles = async (sortBy: 'title' | 'artist') => {
      const seededTitles: string[] = []
      let totalPages = 1

      for (let page = 1; page <= totalPages; page += 1) {
        const response = await agent
          .get('/api/music')
          .query({ limit: 2, page, sortBy, sortOrder: 'asc' })

        expect(response.status).toBe(200)
        expect(response.body.total).toBeGreaterThanOrEqual(3)
        expect(response.body.page).toBe(page)
        expect(response.body.limit).toBe(2)
        totalPages = Math.ceil(response.body.total / 2)

        seededTitles.push(
          ...response.body.songs
            .map((song: { title: string }) => song.title)
            .filter((title: string) => title.endsWith(suffix))
        )

        if (seededTitles.length === 3) break
      }

      return seededTitles
    }

    expect(await collectSeededTitles('title')).toEqual([
      `000 Paged Music Test Song A ${suffix}`,
      `000 Paged Music Test Song B ${suffix}`,
      `000 Paged Music Test Song C ${suffix}`,
    ])
    expect(await collectSeededTitles('artist')).toEqual([
      `000 Paged Music Test Song A ${suffix}`,
      `000 Paged Music Test Song B ${suffix}`,
      `000 Paged Music Test Song C ${suffix}`,
    ])
  })

  it('音乐列表按发行时间排序并将未知日期放最后', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const { agent } = await createAuthenticatedAgent(adminUser.user.email, adminUser.plainPassword)
    await Promise.all(
      [
        { title: 'Release Date Sort Test Song Unknown', releaseDate: null },
        { title: 'Release Date Sort Test Song New', releaseDate: new Date('2099-01-01') },
        { title: 'Release Date Sort Test Song Old', releaseDate: new Date('2097-01-01') },
        { title: 'Release Date Sort Test Song Middle', releaseDate: new Date('2098-01-01') },
      ].map((song) =>
        prisma.musicTrack.create({
          data: {
            slug: nextTestNumericSlug(),
            title: `${song.title} ${suffix}`,
            artists: ['发行时间排序测试'],
            album: '',
            releaseDate: song.releaseDate,
          },
        })
      )
    )

    const collectSeededTitles = async (query: Record<string, string | number> = {}) => {
      const seededTitles: string[] = []
      let totalPages = 1

      for (let page = 1; page <= totalPages; page += 1) {
        const response = await agent.get('/api/music').query({ limit: 100, page, ...query })

        expect(response.status).toBe(200)
        totalPages = Math.ceil(response.body.total / 100)

        seededTitles.push(
          ...response.body.songs
            .map((song: { title: string }) => song.title)
            .filter((title: string) => title.endsWith(suffix))
        )

        if (seededTitles.length === 4) break
      }

      return seededTitles
    }

    const descOrder = [
      `Release Date Sort Test Song New ${suffix}`,
      `Release Date Sort Test Song Middle ${suffix}`,
      `Release Date Sort Test Song Old ${suffix}`,
      `Release Date Sort Test Song Unknown ${suffix}`,
    ]
    expect(await collectSeededTitles()).toEqual(descOrder)
    expect(await collectSeededTitles({ sortBy: 'releaseDate', sortOrder: 'desc' })).toEqual(
      descOrder
    )
    expect(await collectSeededTitles({ sortBy: 'createdAt', sortOrder: 'desc' })).toEqual(descOrder)
    expect(await collectSeededTitles({ sortBy: 'releaseDate', sortOrder: 'asc' })).toEqual([
      `Release Date Sort Test Song Old ${suffix}`,
      `Release Date Sort Test Song Middle ${suffix}`,
      `Release Date Sort Test Song New ${suffix}`,
      `Release Date Sort Test Song Unknown ${suffix}`,
    ])
  })
})
