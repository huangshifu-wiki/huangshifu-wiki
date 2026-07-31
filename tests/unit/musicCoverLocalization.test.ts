import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'path'
import os from 'os'

const mockLocalizeImageUrlAsMediaAsset = vi.hoisted(() => vi.fn())
const mockEnqueue = vi.hoisted(() => vi.fn())

const mockPrisma = vi.hoisted(() => ({
  mediaAsset: {
    findUnique: vi.fn(),
  },
  musicExternalSource: {
    findUnique: vi.fn(),
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

const TEST_UPLOADS_DIR = path.join(os.tmpdir(), 'huangshifu-music-cover-test-uploads')

vi.mock('../../src/server/utils/config', () => ({
  prisma: mockPrisma,
  PLAY_URL_CACHE_TTL_MS: 600000,
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
    mockPrisma.musicExternalSource.findUnique.mockResolvedValue(null)
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
    const { addSongCoverFromUrl } = await import('../../src/server/utils/music')

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

    const { addSongCoverFromUrl } = await import('../../src/server/utils/music')

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
    const { addAlbumCoverFromUrl } = await import('../../src/server/utils/music')

    await addAlbumCoverFromUrl('album-1', 'https://example.com/album.jpg', true)

    expect(mockLocalizeImageUrlAsMediaAsset).toHaveBeenCalledWith('https://example.com/album.jpg', {
      namespace: 'music-covers/albums',
      fallbackName: 'album-1.jpg',
    })
    expect(mockEnqueue).toHaveBeenCalledWith({
      targetType: 'albumCover',
      targetId: 'album-cover-1',
      localFilePath: expect.stringContaining('music-covers/songs/cover.jpg'),
      priority: 'normal',
    })
  })

  it('does not fail automatic song import when cover localization fails', async () => {
    mockLocalizeImageUrlAsMediaAsset.mockRejectedValueOnce(new Error('cover unavailable'))
    const { createOrUpdateImportedSong } = await import('../../src/server/utils/music')

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
