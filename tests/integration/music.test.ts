import { describe, beforeEach, afterEach, it, expect } from 'vitest'
import request from 'supertest'
import { Prisma } from '@prisma/client'
import { app } from '../../server'
import { prisma, createTestPost, createTestUser, nextTestNumericSlug } from './setup'
import { applyAlbumTracksToRelations } from '../../src/server/utils/music'

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

const MUSIC_TEST_TITLE_PREFIXES = [
  'Markdown Description Test Song',
  'Optional Metadata Test Song',
  'Artist Partial Search Test Song',
  'Artist Partial Admin Search Test Song',
  'Admin Search Desc Test Song',
  'Admin Search All Mode Test Song',
  'Display Relation Song',
  'Paged Music Test Song',
  '000 Paged Music Test Song',
  'Release Date Sort Test Song',
  'Lyric Storage Test Song',
  'Display Sync Test Song',
  'Duplicate Relation Test Song',
  'Lyric Search Contract Song',
  'Admin List Fields Test Song',
  'Shared Source Test Song',
  'Album Admin Bugfix',
] as const

const ALBUM_TEST_TITLE_PREFIXES = [
  'Display Relation Album',
  'Optional Album',
  'Display Sync Current Album',
  'Display Sync Other Album',
  'Album Admin Bugfix',
  'Duplicate Relation Test Album',
] as const

const startsWithAny = (prefixes: readonly string[]) =>
  prefixes.map((title) => ({ title: { startsWith: title } }))

async function cleanupMusicFixtures() {
  await prisma.musicTrack.deleteMany({
    where: { OR: startsWithAny(MUSIC_TEST_TITLE_PREFIXES) },
  })
  await prisma.post.deleteMany({
    where: { title: { startsWith: 'Album Admin Bugfix Post' } },
  })
  await prisma.album.deleteMany({
    where: { OR: startsWithAny(ALBUM_TEST_TITLE_PREFIXES) },
  })
  await prisma.user.deleteMany({
    where: { email: { startsWith: 'test_music_desc_' } },
  })
}

describe('Music API - 音乐接口测试', () => {
  let adminUser: Awaited<ReturnType<typeof createTestUser>>

  beforeEach(async () => {
    await cleanupMusicFixtures()
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    adminUser = await createTestUser({
      role: 'admin',
      email: `test_music_desc_admin_${suffix}@example.com`,
      displayName: `TestMusicDescAdmin_${suffix}`,
    })
  })

  afterEach(async () => {
    await cleanupMusicFixtures()
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

  it('同一平台ID可被多首歌共享，重复时返回提醒但不拒绝', async () => {
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )
    const sharedSourceId = `shared_${Date.now()}`

    const firstResponse = await agent
      .post('/api/music')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        title: 'Shared Source Test Song A',
        artists: ['Shared Source Test Artist'],
        sources: [{ platform: 'netease', sourceId: sharedSourceId, isPrimary: true }],
      })
    expect(firstResponse.status).toBe(201)
    expect(firstResponse.body.duplicates).toEqual([])

    const secondResponse = await agent
      .post('/api/music')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        title: 'Shared Source Test Song B',
        artists: ['Shared Source Test Artist'],
        sources: [{ platform: 'netease', sourceId: sharedSourceId, isPrimary: true }],
      })
    expect(secondResponse.status).toBe(201)
    expect(secondResponse.body.duplicates).toHaveLength(1)
    expect(secondResponse.body.duplicates[0]).toMatchObject({
      platform: 'netease',
      sourceId: sharedSourceId,
      song: { title: 'Shared Source Test Song A' },
    })

    const sources = await prisma.musicExternalSource.findMany({
      where: { resourceType: 'song', platform: 'netease', sourceId: sharedSourceId },
    })
    expect(sources).toHaveLength(2)
  })

  it('更新歌曲共享来源时排除自身，不把自己当作重复', async () => {
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )
    const sharedSourceId = `shared_update_${Date.now()}`

    const createResponse = await agent
      .post('/api/music')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        title: 'Shared Source Test Song C',
        artists: ['Shared Source Test Artist'],
        sources: [{ platform: 'netease', sourceId: sharedSourceId, isPrimary: true }],
      })
    expect(createResponse.status).toBe(201)

    const docId = createResponse.body.song.docId
    const updateResponse = await agent
      .patch(`/api/music/${docId}`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        sources: [{ platform: 'netease', sourceId: sharedSourceId, isPrimary: true }],
      })
    expect(updateResponse.status).toBe(200)
    expect(updateResponse.body.duplicates).toEqual([])

    const sourcesAfter = await prisma.musicExternalSource.findMany({
      where: {
        resourceType: 'song',
        songDocId: docId,
        platform: 'netease',
        sourceId: sharedSourceId,
      },
    })
    expect(sourcesAfter).toHaveLength(1)
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

  it('专辑重排与关系增删保留其它 Disc 和自定义名称', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const [album, songOne, songTwo, songThree] = await Promise.all([
      prisma.album.create({
        data: {
          slug: nextTestNumericSlug(),
          title: `Album Admin Bugfix ${suffix}`,
          artist: '测试艺人',
          tracks: [
            {
              disc: 1,
              name: '主碟',
              songs: [{ songDocId: 'pending-one', trackOrder: 0 }],
            },
            {
              disc: 2,
              name: '附碟',
              songs: [{ songDocId: 'pending-two', trackOrder: 0 }],
            },
          ],
        },
      }),
      prisma.musicTrack.create({
        data: {
          slug: nextTestNumericSlug(),
          title: `Album Admin Bugfix Song One ${suffix}`,
          artists: ['测试艺人'],
        },
      }),
      prisma.musicTrack.create({
        data: {
          slug: nextTestNumericSlug(),
          title: `Album Admin Bugfix Song Two ${suffix}`,
          artists: ['测试艺人'],
        },
      }),
      prisma.musicTrack.create({
        data: {
          slug: nextTestNumericSlug(),
          title: `Album Admin Bugfix Song Three ${suffix}`,
          artists: ['测试艺人'],
        },
      }),
    ])
    await prisma.album.update({
      where: { docId: album.docId },
      data: {
        tracks: [
          {
            disc: 1,
            name: '主碟',
            songs: [{ songDocId: songOne.docId, trackOrder: 0 }],
          },
          {
            disc: 2,
            name: '附碟',
            songs: [{ songDocId: songTwo.docId, trackOrder: 0 }],
          },
        ],
      },
    })
    await prisma.songAlbumRelation.createMany({
      data: [
        {
          songDocId: songOne.docId,
          albumDocId: album.docId,
          discNumber: 1,
          trackOrder: 0,
          isDisplay: true,
        },
        {
          songDocId: songTwo.docId,
          albumDocId: album.docId,
          discNumber: 2,
          trackOrder: 0,
          isDisplay: false,
        },
      ],
    })

    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )
    const incomplete = await agent
      .patch(`/api/albums/${album.docId}/tracks/reorder`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        tracks: [{ disc: 1, name: '主碟', songs: [{ songDocId: songOne.docId, trackOrder: 1 }] }],
      })
    expect(incomplete.status).toBe(400)

    const reorder = await agent
      .patch(`/api/albums/${album.docId}/tracks/reorder`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        tracks: [
          { disc: 1, name: '主碟', songs: [{ songDocId: songOne.docId, trackOrder: 1 }] },
          { disc: 2, name: '附碟', songs: [{ songDocId: songTwo.docId, trackOrder: 0 }] },
        ],
      })
    expect(reorder.status).toBe(200)

    const afterReorder = await prisma.album.findUnique({ where: { docId: album.docId } })
    expect(afterReorder?.tracks).toMatchObject([
      { disc: 1, name: '主碟' },
      { disc: 2, name: '附碟' },
    ])
    await expect(
      prisma.songAlbumRelation.findMany({
        where: { albumDocId: album.docId },
        orderBy: [{ discNumber: 'asc' }, { trackOrder: 'asc' }],
      })
    ).resolves.toMatchObject([
      { songDocId: songOne.docId, discNumber: 1, trackOrder: 1, isDisplay: true },
      { songDocId: songTwo.docId, discNumber: 2, trackOrder: 0, isDisplay: false },
    ])

    const add = await agent
      .post(`/api/music/${songThree.docId}/albums`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ albumDocId: album.docId, discNumber: 2, trackOrder: 1 })
    expect(add.status).toBe(201)

    const afterAdd = await request(app).get(`/api/albums/${album.slug}`)
    expect(afterAdd.status).toBe(200)
    expect(afterAdd.body.album.discs).toMatchObject([
      { disc: 1, name: '主碟' },
      { disc: 2, name: '附碟' },
    ])

    const remove = await agent
      .delete(`/api/music/${songThree.docId}/albums/${album.docId}`)
      .set('X-XSRF-TOKEN', xsrfToken)
    expect(remove.status).toBe(200)
    const afterRemove = await request(app).get(`/api/albums/${album.slug}`)
    expect(afterRemove.body.album.discs).toMatchObject([
      { disc: 1, name: '主碟' },
      { disc: 2, name: '附碟' },
    ])
  })
  it('软删除歌曲后专辑计数过滤且拒绝空白标题更新', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const [album, song] = await Promise.all([
      prisma.album.create({
        data: {
          slug: nextTestNumericSlug(),
          title: `Album Admin Bugfix Count ${suffix}`,
          artist: '测试艺人',
        },
      }),
      prisma.musicTrack.create({
        data: {
          slug: nextTestNumericSlug(),
          title: `Album Admin Bugfix Count Song ${suffix}`,
          artists: ['测试艺人'],
        },
      }),
    ])
    await prisma.songAlbumRelation.create({
      data: {
        songDocId: song.docId,
        albumDocId: album.docId,
        discNumber: 1,
        trackOrder: 0,
      },
    })
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const before = await agent.get('/api/albums').query({ limit: 100 })
    expect(before.status).toBe(200)
    expect(
      before.body.albums.find((item: { docId: string }) => item.docId === album.docId)
    ).toMatchObject({
      trackCount: 1,
    })

    await prisma.musicTrack.update({
      where: { docId: song.docId },
      data: { deletedAt: new Date() },
    })
    const after = await agent.get('/api/albums').query({ limit: 100 })
    expect(
      after.body.albums.find((item: { docId: string }) => item.docId === album.docId)
    ).toMatchObject({
      trackCount: 0,
    })

    const blankUpdate = await agent
      .patch(`/api/albums/${album.docId}`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ title: '   ' })
    expect(blankUpdate.status).toBe(400)
    await expect(prisma.album.findUnique({ where: { docId: album.docId } })).resolves.toMatchObject(
      {
        title: `Album Admin Bugfix Count ${suffix}`,
      }
    )
  })
  it('已删除专辑不再提供关联帖子', async () => {
    const album = await prisma.album.create({
      data: {
        slug: nextTestNumericSlug(),
        title: `Album Admin Bugfix Posts ${Date.now()}`,
        artist: '测试艺人',
      },
    })
    const post = await createTestPost({
      title: `Album Admin Bugfix Post ${Date.now()}`,
      authorUid: adminUser.user.uid,
    })
    await prisma.post.update({ where: { id: post.id }, data: { albumDocId: album.docId } })
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const visible = await agent.get(`/api/albums/${album.docId}/posts`)
    expect(visible.status).toBe(200)
    expect(visible.body.posts).toHaveLength(1)

    await prisma.album.update({
      where: { docId: album.docId },
      data: { deletedAt: new Date(), deletedBy: adminUser.user.uid },
    })
    const hidden = await agent
      .get(`/api/albums/${album.docId}/posts`)
      .set('X-XSRF-TOKEN', xsrfToken)
    expect(hidden.status).toBe(404)
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

  it('音乐搜索不索引歌词，歌词分类独立于搜索详情并按行返回', async () => {
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

    // 歌词分类不依赖搜索详情开关
    const lyricNoDetailRes = await request(app)
      .get('/api/search')
      .query({ q: '独特歌词XYZ', type: 'lyrics' })

    expect(lyricNoDetailRes.status).toBe(200)
    expect(lyricNoDetailRes.body.lyrics).toHaveLength(1)
    expect(
      lyricNoDetailRes.body.lyrics[0].matchedLines.map((l: { text: string }) => l.text)
    ).toEqual(['第二行独特歌词XYZ'])

    // 开启详情后结果保持一致，歌词仍按行返回
    const lyricRes = await request(app)
      .get('/api/search')
      .query({ q: '独特歌词XYZ', type: 'lyrics', detail: '1' })

    expect(lyricRes.status).toBe(200)
    expect(lyricRes.body.lyrics).toHaveLength(1)
    expect(lyricRes.body.lyrics[0].matchedLines.map((l: { text: string }) => l.text)).toEqual([
      '第二行独特歌词XYZ',
    ])

    // 3. 同一首歌多行命中集中返回、保持原顺序
    const multiRes = await request(app).get('/api/search').query({ q: '歌词', type: 'lyrics' })

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

    // 全部类型搜索也返回歌词结果，不污染音乐结果
    const allRes = await request(app).get('/api/search').query({ q: '独特歌词XYZ', type: 'all' })
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

describe('Music API - 歌曲标签', () => {
  let adminUser: Awaited<ReturnType<typeof createTestUser>>

  async function cleanupTaggedSongs() {
    await prisma.musicTrack.deleteMany({
      where: { title: { startsWith: 'Tagged Music Test Song' } },
    })
  }

  beforeEach(async () => {
    await cleanupTaggedSongs()
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    adminUser = await createTestUser({
      role: 'admin',
      email: `test_music_tags_admin_${suffix}@example.com`,
      displayName: `TestMusicTagsAdmin_${suffix}`,
    })
  })

  afterEach(async () => {
    await cleanupTaggedSongs()
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'test_music_tags_admin_' } },
    })
  })

  it('创建歌曲时标签应 trim、去重、去空后落库', async () => {
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )
    const response = await agent
      .post('/api/music')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        title: 'Tagged Music Test Song Normalize',
        artists: ['Tagged Test Artist'],
        tags: [' 古风  ', '古风 ', '', '仙侠'],
      })

    expect(response.status).toBe(201)
    const stored = await prisma.musicTrack.findUnique({
      where: { docId: response.body.song.docId },
      select: { tags: true },
    })
    expect(stored?.tags).toEqual(['古风', '仙侠'])
  })

  it('更新歌曲标签覆盖旧值', async () => {
    const song = await prisma.musicTrack.create({
      data: {
        slug: nextTestNumericSlug(),
        title: 'Tagged Music Test Song Update',
        artists: ['Tagged Test Artist'],
        tags: ['旧标签'],
      },
    })
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )
    const response = await agent
      .patch(`/api/music/${song.docId}`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ tags: ['剑', '剑'] })

    expect(response.status).toBe(200)
    const stored = await prisma.musicTrack.findUnique({
      where: { docId: song.docId },
      select: { tags: true },
    })
    expect(stored?.tags).toEqual(['剑'])
  })

  it('标签数量与单项长度超限时返回 400', async () => {
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )
    const tooMany = await agent
      .post('/api/music')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        title: 'Tagged Music Test Song Too Many',
        artists: ['Tagged Test Artist'],
        tags: Array.from({ length: 31 }, (_, index) => `t${index}`),
      })
    expect(tooMany.status).toBe(400)
    expect(JSON.stringify(tooMany.body)).toContain('标签最多')

    const tooLong = await agent
      .post('/api/music')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        title: 'Tagged Music Test Song Too Long',
        artists: ['Tagged Test Artist'],
        tags: ['x'.repeat(51)],
      })
    expect(tooLong.status).toBe(400)
    expect(JSON.stringify(tooLong.body)).toContain('标签单项长度')
  })

  it('公开列表支持按 tag 筛选，且返回歌曲带 tags', async () => {
    await prisma.musicTrack.createMany({
      data: [
        {
          slug: nextTestNumericSlug(),
          title: 'Tagged Music Test Song Filtered',
          artists: ['Tagged Test Artist'],
          tags: ['筛选甲'],
        },
        {
          slug: nextTestNumericSlug(),
          title: 'Tagged Music Test Song Untagged',
          artists: ['Tagged Test Artist'],
          tags: ['筛选乙'],
        },
      ],
    })
    const response = await request(app).get('/api/music').query({
      tag: '筛选甲',
      limit: 100,
      sortBy: 'releaseDate',
    })

    expect(response.status).toBe(200)
    const titles = response.body.songs.map((song: { title: string }) => song.title)
    expect(titles).toContain('Tagged Music Test Song Filtered')
    expect(titles).not.toContain('Tagged Music Test Song Untagged')
    const filtered = response.body.songs.find(
      (song: { title: string }) => song.title === 'Tagged Music Test Song Filtered'
    )
    expect(filtered.tags).toEqual(['筛选甲'])
  })

  it('标签汇总端点返回去重后的全部标签', async () => {
    await prisma.musicTrack.createMany({
      data: [
        {
          slug: nextTestNumericSlug(),
          title: 'Tagged Music Test Song Summary A',
          artists: ['Tagged Test Artist'],
          tags: ['汇总甲', '汇总乙'],
        },
        {
          slug: nextTestNumericSlug(),
          title: 'Tagged Music Test Song Summary B',
          artists: ['Tagged Test Artist'],
          tags: ['汇总甲'],
        },
      ],
    })
    const response = await request(app).get('/api/music/tags')

    expect(response.status).toBe(200)
    expect(response.body.tags).toContain('汇总甲')
    expect(response.body.tags).toContain('汇总乙')
  })
})
