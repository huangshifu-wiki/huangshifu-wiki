import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addAlbumCoverFromUrl,
  addSongCoverFromUrl,
  createOrUpdateImportedSong,
} from '../../src/server/utils/music'

const mockLocalizeImageUrlAsMediaAsset = vi.hoisted(() => vi.fn())
const mockEnqueue = vi.hoisted(() => vi.fn())
const mockGetMusicTrackMetadata = vi.hoisted(() => vi.fn())
const mockResolveAudioUrl = vi.hoisted(() => vi.fn())
const mockResolveLyric = vi.hoisted(() => vi.fn())

const mockPrisma = vi.hoisted(() => ({
  mediaAsset: {
    findUnique: vi.fn(),
  },
  musicExternalSource: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  songCover: {
    count: vi.fn(),
  },
  albumCover: {
    count: vi.fn(),
  },
  album: {
    update: vi.fn(),
  },
  musicTrack: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}))

// vi.hoisted 在 import 之前执行，factory 内不能引用顶层 import，只能自行 require
const TEST_UPLOADS_DIR = vi.hoisted(() => {
  const nodePath = require('path') as typeof import('path')
  const nodeOs = require('os') as typeof import('os')
  return nodePath.join(nodeOs.tmpdir(), 'huangshifu-music-cover-test-uploads')
})

vi.mock('../../src/server/utils/config', () => ({
  prisma: mockPrisma,
  DEFAULT_MUSIC_PLATFORMS: ['netease', 'tencent', 'kugou', 'baidu', 'kuwo'],
  uploadsDir: TEST_UPLOADS_DIR,
}))

vi.mock('../../src/server/utils/remoteImageAsset', () => ({
  localizeImageUrlAsMediaAsset: mockLocalizeImageUrlAsMediaAsset,
}))

vi.mock('../../src/server/prisma', () => ({ prisma: mockPrisma }))
vi.mock('../../src/server/services/variantGenerator', () => ({
  variantGenerator: {
    enqueue: mockEnqueue,
  },
}))

vi.mock('../../src/server/music/metingService', () => ({
  getMusicResourcePreview: vi.fn(),
  getMusicTrackMetadata: mockGetMusicTrackMetadata,
  resolveAudioUrl: mockResolveAudioUrl,
  resolveLyric: mockResolveLyric,
  resolveCoverUrl: vi.fn(() => 'https://example.com/resolved-cover.jpg'),
}))

describe('music cover localization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnqueue.mockResolvedValue(undefined)
    mockLocalizeImageUrlAsMediaAsset.mockResolvedValue({ assetId: 'asset-1' })
    mockGetMusicTrackMetadata.mockResolvedValue({ releaseDate: null, durationMs: null })
    mockResolveAudioUrl.mockResolvedValue('')
    mockResolveLyric.mockResolvedValue('')
    mockPrisma.mediaAsset.findUnique.mockResolvedValue({
      id: 'asset-1',
      ownerUid: 'music-test-owner',
      storageKey: 'music-covers/songs/cover.jpg',
      publicUrl: '/uploads/music-covers/songs/cover.jpg',
      status: 'ready',
      imageMap: {
        id: 'map-1',
        md5: '0123456789abcdef0123456789abcdef',
        localUrl: '/uploads/music-covers/songs/cover.jpg',
        s3Url: null,
        externalUrl: null,
        deletedAt: null,
      },
    })
    mockPrisma.songCover.count.mockResolvedValue(0)
    mockPrisma.albumCover.count.mockResolvedValue(0)
    mockPrisma.musicExternalSource.findMany.mockResolvedValue([])
    mockPrisma.musicExternalSource.create.mockResolvedValue({})
    mockPrisma.musicTrack.findFirst.mockResolvedValue(null)
    mockPrisma.musicTrack.create.mockResolvedValue({
      docId: 'song-1',
      title: 'Song',
      artists: ['Artist'],
    })
    mockPrisma.musicTrack.update.mockResolvedValue({
      docId: 'song-1',
      title: 'Song',
      artists: ['Artist'],
    })
    mockPrisma.$transaction.mockImplementation(async (callback) => {
      const tx = {
        $executeRaw: vi.fn(),
        mediaAsset: {
          findUnique: vi.fn().mockImplementation((args) => mockPrisma.mediaAsset.findUnique(args)),
        },
        songCover: {
          count: vi.fn().mockResolvedValue(0),
          create: vi
            .fn()
            .mockResolvedValue({ id: 'cover-1', storageKey: 'music-covers/songs/cover.jpg' }),
          updateMany: vi.fn(),
        },
        albumCover: {
          create: vi.fn().mockResolvedValue({
            id: 'album-cover-1',
            storageKey: 'music-covers/albums/album.jpg',
          }),
          updateMany: vi.fn(),
        },
        musicTrack: {
          update: vi.fn(),
        },
        album: {
          update: vi.fn(),
        },
      }
      return callback(tx)
    })
  })

  it('localizes remote song covers before creating cover records', async () => {
    await addSongCoverFromUrl('song-1', 'https://example.com/cover.jpg', true)

    expect(mockLocalizeImageUrlAsMediaAsset).toHaveBeenCalledWith('https://example.com/cover.jpg', {
      namespace: 'music-covers/songs',
      fallbackName: 'song-1.jpg',
    })
    expect(mockPrisma.mediaAsset.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'asset-1' } })
    )
  })

  it('creates song covers without thumbnailUrl and enqueues async generation', async () => {
    const tx = {
      $executeRaw: vi.fn(),
      mediaAsset: {
        findUnique: vi.fn().mockImplementation((args) => mockPrisma.mediaAsset.findUnique(args)),
      },
      songCover: {
        count: vi.fn().mockResolvedValue(0),
        create: vi
          .fn()
          .mockResolvedValue({ id: 'cover-1', storageKey: 'music-covers/songs/cover.jpg' }),
        updateMany: vi.fn(),
      },
      musicTrack: {
        update: vi.fn(),
      },
    }
    mockPrisma.$transaction.mockImplementationOnce(async (callback) => callback(tx))

    await addSongCoverFromUrl('song-1', 'https://example.com/cover.jpg', true)

    const createCall = tx.songCover.create.mock.calls[0][0]
    expect(createCall.data).toMatchObject({
      songDocId: 'song-1',
      storageKey: 'music-covers/songs/cover.jpg',
    })
    expect(createCall.data).not.toHaveProperty('thumbnailUrl')

    expect(mockEnqueue).toHaveBeenCalledWith({
      targetType: 'songCover',
      targetId: 'cover-1',
      localFilePath: expect.stringContaining('music-covers/songs/cover.jpg'),
      priority: 'normal',
    })
  })

  it('localizes remote album covers and enqueues albumCover thumbnail generation', async () => {
    mockPrisma.mediaAsset.findUnique.mockResolvedValue({
      id: 'asset-1',
      ownerUid: 'music-test-owner',
      storageKey: 'music-covers/albums/album.jpg',
      publicUrl: '/uploads/music-covers/albums/album.jpg',
      status: 'ready',
      imageMap: {
        id: 'map-album-1',
        md5: 'fedcba9876543210fedcba9876543210',
        localUrl: '/uploads/music-covers/albums/album.jpg',
        s3Url: null,
        externalUrl: null,
        deletedAt: null,
      },
    })
    const tx = {
      $executeRaw: vi.fn(),
      mediaAsset: {
        findUnique: vi.fn().mockImplementation((args) => mockPrisma.mediaAsset.findUnique(args)),
      },
      albumCover: {
        count: vi.fn().mockResolvedValue(0),
        create: vi
          .fn()
          .mockResolvedValue({ id: 'album-cover-1', storageKey: 'music-covers/albums/album.jpg' }),
        updateMany: vi.fn(),
      },
      album: {
        update: vi.fn(),
      },
    }
    mockPrisma.$transaction.mockImplementationOnce(async (callback) => callback(tx))

    await addAlbumCoverFromUrl('album-1', 'https://example.com/album.jpg', true)

    expect(mockLocalizeImageUrlAsMediaAsset).toHaveBeenCalledWith('https://example.com/album.jpg', {
      namespace: 'music-covers/albums',
      fallbackName: 'album-1.jpg',
    })

    const createCall = tx.albumCover.create.mock.calls[0][0]
    expect(createCall.data).toMatchObject({
      albumDocId: 'album-1',
      storageKey: 'music-covers/albums/album.jpg',
    })
    expect(createCall.data).not.toHaveProperty('thumbnailUrl')

    expect(mockEnqueue).toHaveBeenCalledWith({
      targetType: 'albumCover',
      targetId: 'album-cover-1',
      localFilePath: expect.stringContaining('music-covers/albums/album.jpg'),
      priority: 'normal',
    })
  })

  it('导入命中软删除歌曲时新建，而非把删除的歌曲当作占用者', async () => {
    mockPrisma.musicExternalSource.findMany.mockResolvedValue([
      {
        platform: 'netease',
        sourceId: 'song-1',
        song: { docId: 'deleted-song', title: '已删除歌曲', deletedAt: new Date() },
      },
    ])

    await createOrUpdateImportedSong({
      platform: 'netease',
      track: {
        sourceId: 'song-1',
        title: 'Song',
        artists: ['Artist'],
        album: 'Album',
        picId: 'pic-1',
        urlId: 'url-1',
        lyricId: 'lyric-1',
        cover: '',
        sourceUrl: 'https://music.163.com/#/song?id=song-1',
      },
    })

    expect(mockPrisma.musicTrack.create).toHaveBeenCalled()
    expect(mockPrisma.musicTrack.update).not.toHaveBeenCalled()
  })

  it('导入命中多个活占用者时新建，避免覆写任意一首共享歌曲', async () => {
    mockPrisma.musicExternalSource.findMany.mockResolvedValue([
      {
        platform: 'netease',
        sourceId: 'song-1',
        song: { docId: 'song-a', title: 'A', artists: ['A'], deletedAt: null },
      },
      {
        platform: 'netease',
        sourceId: 'song-1',
        song: { docId: 'song-b', title: 'B', artists: ['B'], deletedAt: null },
      },
    ])

    await createOrUpdateImportedSong({
      platform: 'netease',
      track: {
        sourceId: 'song-1',
        title: 'Song',
        artists: ['Artist'],
        album: 'Album',
        picId: 'pic-1',
        urlId: 'url-1',
        lyricId: 'lyric-1',
        cover: '',
        sourceUrl: 'https://music.163.com/#/song?id=song-1',
      },
    })

    expect(mockPrisma.musicTrack.create).toHaveBeenCalled()
    expect(mockPrisma.musicTrack.update).not.toHaveBeenCalled()
  })

  it('导入命中唯一活占用者时合并更新该歌曲', async () => {
    mockPrisma.musicExternalSource.findMany.mockResolvedValue([
      {
        platform: 'netease',
        sourceId: 'song-1',
        song: { docId: 'song-a', title: 'A', artists: ['A'], deletedAt: null },
      },
    ])

    await createOrUpdateImportedSong({
      platform: 'netease',
      track: {
        sourceId: 'song-1',
        title: 'Song',
        artists: ['Artist'],
        album: 'Album',
        picId: 'pic-1',
        urlId: 'url-1',
        lyricId: 'lyric-1',
        cover: '',
        sourceUrl: 'https://music.163.com/#/song?id=song-1',
      },
    })

    expect(mockPrisma.musicTrack.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { docId: 'song-a' } })
    )
    expect(mockPrisma.musicTrack.create).not.toHaveBeenCalled()
  })

  it('does not fail automatic song import when cover localization fails', async () => {
    mockLocalizeImageUrlAsMediaAsset.mockRejectedValueOnce(new Error('cover unavailable'))

    await expect(
      createOrUpdateImportedSong({
        platform: 'netease',
        track: {
          sourceId: 'song-1',
          title: 'Song',
          artists: ['Artist'],
          album: 'Album',
          picId: 'pic-1',
          urlId: 'url-1',
          lyricId: 'lyric-1',
          cover: '',
          sourceUrl: 'https://music.163.com/#/song?id=song-1',
        },
      })
    ).resolves.toMatchObject({
      created: true,
      song: {
        docId: 'song-1',
      },
    })
  })
  it('新建歌曲时写入平台日期、时长和歌词署名', async () => {
    mockResolveLyric.mockResolvedValue(`[00:00.000] 作词 : 梨衿
[00:01.000] 作曲 : Soda纯白
[00:02.000] 编曲 : Soda纯白
[00:03.000] 演唱 : 李常超 (Lao乾妈)
[00:25.991]光 是谁燃烛照亮`)
    mockGetMusicTrackMetadata.mockResolvedValue({
      releaseDate: '2018-07-31',
      durationMs: 277350,
    })

    await createOrUpdateImportedSong({
      platform: 'netease',
      track: {
        sourceId: '1297802566',
        title: '盗墓笔记·十年人间',
        artists: ['李常超 (Lao乾妈)'],
        album: '盗墓笔记·十年人间',
        picId: '109951163434990771',
        urlId: '1297802566',
        lyricId: '1297802566',
        cover: '',
        sourceUrl: 'https://music.163.com/#/song?id=1297802566',
      },
    })

    expect(mockPrisma.musicTrack.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lyricists: ['梨衿'],
          composers: ['Soda纯白'],
          arrangers: ['Soda纯白'],
          vocals: ['李常超 (Lao乾妈)'],
          releaseDate: new Date('2018-07-31T00:00:00.000Z'),
          durationMs: 277350,
        }),
      })
    )
  })

  it('无演唱署名时为非纯音乐回退使用艺术家', async () => {
    mockResolveLyric.mockResolvedValue('[00:00]作词: 梨衿\n[00:20]正文歌词')

    await createOrUpdateImportedSong({
      platform: 'netease',
      track: {
        sourceId: 'song-vocal-fallback',
        title: '歌曲',
        artists: ['李常超 (Lao乾妈)'],
        album: '专辑',
        picId: 'pic-1',
        urlId: 'url-1',
        lyricId: 'lyric-1',
        cover: '',
        sourceUrl: 'https://music.163.com/#/song?id=song-vocal-fallback',
      },
    })

    expect(mockPrisma.musicTrack.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ vocals: ['李常超 (Lao乾妈)'] }),
      })
    )
  })

  it('重复导入时保护已有署名、日期和时长，并补齐空字段', async () => {
    mockResolveLyric.mockResolvedValue(`[00:00]作词: 新作词
[00:01]作曲: 新作曲
[00:02]编曲: 新编曲
[00:03]演唱: 新演唱`)
    mockGetMusicTrackMetadata.mockResolvedValue({
      releaseDate: '2018-07-31',
      durationMs: 277350,
    })
    mockPrisma.musicExternalSource.findMany.mockResolvedValueOnce([
      {
        platform: 'netease',
        sourceId: 'song-1',
        song: {
          docId: 'existing-song',
          title: '旧歌曲',
          artists: ['旧歌手'],
          lyricists: ['已有作词'],
          composers: ['已有作曲'],
          arrangers: ['已有编曲'],
          vocals: ['已有演唱'],
          releaseDate: new Date('2017-01-01T00:00:00.000Z'),
          durationMs: 1000,
          deletedAt: null,
          description: null,
          coverId: null,
          coverAlbumDocId: null,
        },
      },
    ])

    await createOrUpdateImportedSong({
      platform: 'netease',
      track: {
        sourceId: 'song-1',
        title: '歌曲',
        artists: ['歌手'],
        album: '专辑',
        picId: 'pic-1',
        urlId: 'url-1',
        lyricId: 'lyric-1',
        cover: '',
        sourceUrl: 'https://music.163.com/#/song?id=song-1',
      },
    })

    expect(mockPrisma.musicTrack.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          lyricists: expect.anything(),
          composers: expect.anything(),
          arrangers: expect.anything(),
          vocals: expect.anything(),
          releaseDate: expect.anything(),
          durationMs: expect.anything(),
        }),
      })
    )

    mockPrisma.musicExternalSource.findMany.mockResolvedValueOnce([
      {
        platform: 'netease',
        sourceId: 'song-2',
        song: {
          docId: 'empty-song',
          title: '空歌曲',
          artists: ['歌手'],
          lyricists: [],
          composers: [],
          arrangers: [],
          vocals: [],
          releaseDate: null,
          durationMs: null,
          deletedAt: null,
          description: null,
          coverId: null,
          coverAlbumDocId: null,
        },
      },
    ])

    await createOrUpdateImportedSong({
      platform: 'netease',
      track: {
        sourceId: 'song-2',
        title: '歌曲',
        artists: ['歌手'],
        album: '专辑',
        picId: 'pic-2',
        urlId: 'url-2',
        lyricId: 'lyric-2',
        cover: '',
        sourceUrl: 'https://music.163.com/#/song?id=song-2',
      },
    })

    expect(mockPrisma.musicTrack.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lyricists: ['新作词'],
          composers: ['新作曲'],
          arrangers: ['新编曲'],
          vocals: ['新演唱'],
          releaseDate: new Date('2018-07-31T00:00:00.000Z'),
          durationMs: 277350,
        }),
      })
    )
  })
})
