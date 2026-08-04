import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'path'
import os from 'os'
import {
  addAlbumCoverFromUrl,
  addSongCoverFromUrl,
  createOrUpdateImportedSong,
} from '../../src/server/utils/music'

const mockLocalizeImageUrlAsMediaAsset = vi.hoisted(() => vi.fn())
const mockEnqueue = vi.hoisted(() => vi.fn())

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

vi.mock('../../src/server/services/variantGenerator', () => ({
  variantGenerator: {
    enqueue: mockEnqueue,
  },
}))

vi.mock('../../src/server/music/metingService', () => ({
  getMusicResourcePreview: vi.fn(),
  resolveAudioUrl: vi.fn(),
  resolveLyric: vi.fn(),
  resolveCoverUrl: vi.fn(() => 'https://example.com/resolved-cover.jpg'),
}))

describe('music cover localization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLocalizeImageUrlAsMediaAsset.mockResolvedValue({ assetId: 'asset-1' })
    mockEnqueue.mockResolvedValue(undefined)
    mockPrisma.mediaAsset.findUnique.mockResolvedValue({
      id: 'asset-1',
      storageKey: 'music-covers/songs/cover.jpg',
      publicUrl: '/uploads/music-covers/songs/cover.jpg',
      status: 'ready',
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
        songCover: {
          create: vi.fn().mockResolvedValue({ id: 'cover-1' }),
          updateMany: vi.fn(),
        },
        albumCover: {
          create: vi.fn().mockResolvedValue({ id: 'album-cover-1' }),
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
      songCover: {
        create: vi.fn().mockResolvedValue({ id: 'cover-1' }),
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
      storageKey: 'music-covers/albums/album.jpg',
      publicUrl: '/uploads/music-covers/albums/album.jpg',
      status: 'ready',
    })
    const tx = {
      albumCover: {
        create: vi.fn().mockResolvedValue({ id: 'album-cover-1' }),
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
})
