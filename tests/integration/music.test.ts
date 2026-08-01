import { describe, beforeEach, afterEach, it, expect } from 'vitest'
import request from 'supertest'
import { Prisma } from '@prisma/client'
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
          { title: { startsWith: 'Artist Partial Admin Search Test Song' } },
          { title: { startsWith: 'Display Relation Song' } },
          { title: { startsWith: 'Paged Music Test Song' } },
          { title: { startsWith: '000 Paged Music Test Song' } },
          { title: { startsWith: 'Release Date Sort Test Song' } },
          { title: { startsWith: 'Lyric Storage Test Song' } },
          { title: { startsWith: 'Display Sync Test Song' } },
          { title: { startsWith: 'Duplicate Relation Test Song' } },
          { title: { startsWith: 'Lyric Search Contract Song' } },
          { title: { startsWith: 'Admin List Fields Test Song' } },
          { title: { startsWith: 'Admin Search Desc Test Song' } },
          { title: { startsWith: 'Admin Search All Mode Test Song' } },
        ],
      },
    })
    await prisma.album.deleteMany({
      where: {
        OR: [
          { title: { startsWith: 'Display Relation Album' } },
          { title: { startsWith: 'Optional Album' } },
          { title: { startsWith: 'Display Sync Current Album' } },
          { title: { startsWith: 'Display Sync Other Album' } },
          { title: { startsWith: 'Duplicate Relation Test Album' } },
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
          { title: { startsWith: 'Artist Partial Admin Search Test Song' } },
          { title: { startsWith: 'Display Relation Song' } },
          { title: { startsWith: 'Paged Music Test Song' } },
          { title: { startsWith: '000 Paged Music Test Song' } },
          { title: { startsWith: 'Release Date Sort Test Song' } },
          { title: { startsWith: 'Lyric Storage Test Song' } },
          { title: { startsWith: 'Display Sync Test Song' } },
          { title: { startsWith: 'Duplicate Relation Test Song' } },
          { title: { startsWith: 'Lyric Search Contract Song' } },
          { title: { startsWith: 'Admin List Fields Test Song' } },
          { title: { startsWith: 'Admin Search Desc Test Song' } },
          { title: { startsWith: 'Admin Search All Mode Test Song' } },
        ],
      },
    })
    await prisma.album.deleteMany({
      where: {
        OR: [
          { title: { startsWith: 'Display Relation Album' } },
          { title: { startsWith: 'Optional Album' } },
          { title: { startsWith: 'Display Sync Current Album' } },
          { title: { startsWith: 'Display Sync Other Album' } },
          { title: { startsWith: 'Duplicate Relation Test Album' } },
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

  it('创建、更新和清空歌词时同步维护结构化字段', async () => {
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )
    const rawWordLyric = '[00:12.34]<0,200>你<200,300>好'

    const createResponse = await agent
      .post('/api/music')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        title: 'Lyric Storage Test Song',
        artists: ['Lyric Storage Test Artist'],
        lyric: rawWordLyric,
      })

    expect(createResponse.status).toBe(201)
    expect(createResponse.body.song).toMatchObject({
      lyric: rawWordLyric,
      lyricType: 'word',
      lyricPlain: '你好',
      lyricSource: null,
    })

    const songDocId = createResponse.body.song.docId as string
    await prisma.musicTrack.update({
      where: { docId: songDocId },
      data: { lyricSource: 'tencent' },
    })

    const updateResponse = await agent
      .patch(`/api/music/${songDocId}`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ lyric: '[00:01]新歌词' })

    expect(updateResponse.status).toBe(200)
    expect(updateResponse.body.song).toMatchObject({
      lyric: '[00:01]新歌词',
      lyricType: 'line',
      lyricPlain: '新歌词',
      lyricSource: null,
    })

    const clearResponse = await agent
      .patch(`/api/music/${songDocId}`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ lyric: null })

    expect(clearResponse.status).toBe(200)
    expect(clearResponse.body.song).toMatchObject({
      lyric: null,
      lyricType: null,
      lyricPlain: null,
      lyricSource: null,
    })
    await expect(
      prisma.musicTrack.findUnique({
        where: { docId: songDocId },
        select: { lyric: true, lyricType: true, lyricPlain: true, lyricSource: true },
      })
    ).resolves.toEqual({ lyric: null, lyricType: null, lyricPlain: null, lyricSource: null })
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

  it('音乐搜索不索引歌词，歌词搜索受搜索详情开关约束并按行返回', async () => {
    const song = await prisma.musicTrack.create({
      data: {
        slug: nextTestNumericSlug(),
        title: 'Lyric Search Contract Song',
        artists: ['黄诗扶'],
        album: '',
        lyric: '第一行歌词\n第二行独特歌词XYZ\n第三行歌词',
        lyricPlain: '第一行歌词\n第二行独特歌词XYZ\n第三行歌词',
        lyricType: 'plain',
      },
    })

    // 1. 普通音乐搜索不命中歌词
    const musicRes = await request(app)
      .get('/api/search')
      .query({ q: '独特歌词XYZ', type: 'music' })

    expect(musicRes.status).toBe(200)
    expect(musicRes.body.music.some((m: { docId: string }) => m.docId === song.docId)).toBe(false)

    // 1b. 未开启搜索详情时，歌词搜索返回空（歌词属于详情）
    const lyricNoDetailRes = await request(app)
      .get('/api/search')
      .query({ q: '独特歌词XYZ', type: 'lyrics' })

    expect(lyricNoDetailRes.status).toBe(200)
    expect(lyricNoDetailRes.body.lyrics).toHaveLength(0)

    // 2. 歌词类型搜索按行返回（歌词属于详情，需开启搜索详情开关）
    const lyricRes = await request(app)
      .get('/api/search')
      .query({ q: '独特歌词XYZ', type: 'lyrics', detail: '1' })

    expect(lyricRes.status).toBe(200)
    expect(lyricRes.body.lyrics).toHaveLength(1)
    expect(lyricRes.body.lyrics[0].matchedLines.map((l: { text: string }) => l.text)).toEqual([
      '第二行独特歌词XYZ',
    ])

    // 3. 同一首歌多行命中集中返回、保持原顺序
    const multiRes = await request(app)
      .get('/api/search')
      .query({ q: '歌词', type: 'lyrics', detail: '1' })

    expect(multiRes.status).toBe(200)
    const multiSong = multiRes.body.lyrics.find(
      (item: { docId: string }) => item.docId === song.docId
    )
    expect(multiSong).toBeTruthy()
    expect(multiSong.matchedLines.map((l: { text: string }) => l.text)).toEqual([
      '第一行歌词',
      '第二行独特歌词XYZ',
      '第三行歌词',
    ])

    // 4. 歌词响应不含整段歌词字段
    expect(multiSong.lyric).toBeUndefined()

    // 5. 默认全部类型搜索也返回歌词结果（歌词独立成区块，不污染音乐结果）
    const allRes = await request(app)
      .get('/api/search')
      .query({ q: '独特歌词XYZ', type: 'all', detail: '1' })

    expect(allRes.status).toBe(200)
    expect(allRes.body.music.some((m: { docId: string }) => m.docId === song.docId)).toBe(false)
    expect(allRes.body.lyrics).toHaveLength(1)
    expect(allRes.body.lyrics[0].matchedLines.map((l: { text: string }) => l.text)).toEqual([
      '第二行独特歌词XYZ',
    ])
  })

  it('音乐关键词搜索匹配歌曲描述（受搜索详情开关控制）', async () => {
    const song = await prisma.musicTrack.create({
      data: {
        slug: nextTestNumericSlug(),
        title: 'Admin Search Desc Test Song',
        artists: ['黄诗扶'],
        album: '',
        description: '独特描述词XYZ 背景介绍',
      },
    })

    // 默认关闭搜索详情：描述命中不返回
    const plain = await request(app).get('/api/search').query({ q: '独特描述词XYZ', type: 'music' })
    expect(plain.status).toBe(200)
    expect(plain.body.music.some((item: { docId: string }) => item.docId === song.docId)).toBe(
      false
    )

    // 开启搜索详情：描述命中返回
    const withDetail = await request(app)
      .get('/api/search')
      .query({ q: '独特描述词XYZ', type: 'music', detail: '1' })
    expect(withDetail.status).toBe(200)
    expect(withDetail.body.music.some((item: { docId: string }) => item.docId === song.docId)).toBe(
      true
    )
  })

  it('搜索详情开关约束全部类型搜索与混合模式', async () => {
    const song = await prisma.musicTrack.create({
      data: {
        slug: nextTestNumericSlug(),
        title: 'Admin Search All Mode Test Song',
        artists: ['黄诗扶'],
        album: '',
        description: '独特描述词XYZ 背景介绍',
      },
    })

    // 1. type=all 关闭详情：描述与歌词均不命中
    const plainAll = await request(app)
      .get('/api/search')
      .query({ q: '独特描述词XYZ', type: 'all' })
    expect(plainAll.status).toBe(200)
    expect(plainAll.body.music.some((item: { docId: string }) => item.docId === song.docId)).toBe(
      false
    )
    expect(plainAll.body.lyrics).toHaveLength(0)

    // 2. type=all 开启详情：描述命中（同 q 两次结果不同，验证 detail 维度进入缓存键）
    const detailAll = await request(app)
      .get('/api/search')
      .query({ q: '独特描述词XYZ', type: 'all', detail: '1' })
    expect(detailAll.status).toBe(200)
    expect(detailAll.body.music.some((item: { docId: string }) => item.docId === song.docId)).toBe(
      true
    )

    // 3. 混合模式关闭详情：退化为 keyword 形状响应，描述不命中
    const plainHybrid = await request(app)
      .get('/api/search')
      .query({ q: '独特描述词XYZ', type: 'music', mode: 'hybrid' })
    expect(plainHybrid.status).toBe(200)
    expect(plainHybrid.body.searchMeta.mode).toBe('keyword')
    expect(plainHybrid.body.searchMeta.vectorResultCount).toBe(0)
    expect(
      plainHybrid.body.music.some((item: { docId: string }) => item.docId === song.docId)
    ).toBe(false)

    // 4. 混合模式开启详情：关键词部分命中描述
    const detailHybrid = await request(app)
      .get('/api/search')
      .query({ q: '独特描述词XYZ', type: 'music', mode: 'hybrid', detail: '1' })
    expect(detailHybrid.status).toBe(200)
    expect(
      detailHybrid.body.music.some((item: { docId: string }) => item.docId === song.docId)
    ).toBe(true)
  })

  it('后台音乐列表支持艺术家名称部分匹配', async () => {
    const song = await prisma.musicTrack.create({
      data: {
        slug: nextTestNumericSlug(),
        title: 'Artist Partial Admin Search Test Song',
        artists: ['黄诗扶'],
        album: '',
      },
    })
    const { agent } = await createAuthenticatedAgent(adminUser.user.email, adminUser.plainPassword)

    const response = await agent.get('/api/admin/music').query({ q: '诗扶', limit: 20 })

    expect(response.status).toBe(200)
    expect(response.body.data.some((item: { docId: string }) => item.docId === song.docId)).toBe(
      true
    )
  })

  it('后台音乐列表返回歌曲描述与自定义平台链接', async () => {
    const song = await prisma.musicTrack.create({
      data: {
        slug: nextTestNumericSlug(),
        title: 'Admin List Fields Test Song',
        artists: ['黄诗扶'],
        album: '',
        description: '后台列表应返回的歌曲描述',
        customPlatformLinks: [
          { label: '个人主页', url: 'https://example.com/huangshifu' },
        ] as unknown as Prisma.InputJsonValue,
      },
    })
    const { agent } = await createAuthenticatedAgent(adminUser.user.email, adminUser.plainPassword)
    const response = await agent.get('/api/admin/music').query({ limit: 100 })
    const row = response.body.data.find((item: { docId: string }) => item.docId === song.docId)
    expect(row).toBeTruthy()
    expect(row.description).toBe('后台列表应返回的歌曲描述')
    expect(row.customPlatformLinks).toEqual([
      { label: '个人主页', url: 'https://example.com/huangshifu' },
    ])
  })

  it('同步展示专辑时清除目标歌曲的其他展示关系', async () => {
    const [currentAlbum, otherAlbum, song] = await Promise.all([
      prisma.album.create({
        data: {
          slug: nextTestNumericSlug(),
          title: 'Display Sync Current Album',
          artist: 'Test Artist',
        },
      }),
      prisma.album.create({
        data: {
          slug: nextTestNumericSlug(),
          title: 'Display Sync Other Album',
          artist: 'Test Artist',
        },
      }),
      prisma.musicTrack.create({
        data: {
          slug: nextTestNumericSlug(),
          title: 'Display Sync Test Song',
          artists: ['Test Artist'],
        },
      }),
    ])
    await prisma.songAlbumRelation.createMany({
      data: [
        { songDocId: song.docId, albumDocId: currentAlbum.docId, isDisplay: false },
        { songDocId: song.docId, albumDocId: otherAlbum.docId, isDisplay: true },
      ],
    })
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const response = await agent
      .post(`/api/albums/${currentAlbum.docId}/sync-display-to-songs`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ songDocIds: [song.docId] })

    expect(response.status).toBe(200)
    const relations = await prisma.songAlbumRelation.findMany({ where: { songDocId: song.docId } })
    expect(
      relations.find((relation) => relation.albumDocId === currentAlbum.docId)?.isDisplay
    ).toBe(true)
    expect(relations.find((relation) => relation.albumDocId === otherAlbum.docId)?.isDisplay).toBe(
      false
    )
  })

  it('并发创建相同歌曲专辑关系时只成功一次', async () => {
    const [album, song] = await Promise.all([
      prisma.album.create({
        data: {
          slug: nextTestNumericSlug(),
          title: 'Duplicate Relation Test Album',
          artist: 'Test Artist',
        },
      }),
      prisma.musicTrack.create({
        data: {
          slug: nextTestNumericSlug(),
          title: 'Duplicate Relation Test Song',
          artists: ['Test Artist'],
        },
      }),
    ])
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )
    const responses = await Promise.all(
      [0, 1].map(() =>
        agent
          .post(`/api/music/${song.docId}/albums`)
          .set('X-XSRF-TOKEN', xsrfToken)
          .send({ albumDocId: album.docId, discNumber: 1, trackOrder: 0 })
      )
    )

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409])
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
