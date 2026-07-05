import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  musicExternalSource: {
    findUnique: vi.fn(),
  },
  album: {
    create: vi.fn(),
    update: vi.fn(),
  },
}))

const mockCreateOrUpdateImportedSong = vi.hoisted(() => vi.fn())
const mockGetMusicResourcePreview = vi.hoisted(() => vi.fn())
const mockAddAlbumCoverFromUrl = vi.hoisted(() => vi.fn())
const mockApplyAlbumTracksToRelations = vi.hoisted(() => vi.fn())
const mockInvalidateByPrefix = vi.hoisted(() => vi.fn())

vi.mock('../../src/server/middleware/auth', () => ({
  requireAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
  requireActiveUser: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}))

vi.mock('../../src/server/middleware/asyncHandler', () => ({
  asyncHandler:
    (handler: express.RequestHandler) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) =>
      Promise.resolve(handler(req, res, next)).catch(next),
}))

vi.mock('../../src/server/schemas', () => ({
  adminBatchSongCoversSchema: {},
  validateBody: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}))

vi.mock('../../src/server/services/mediaAssetCleanupService', () => ({
  cleanupUnusedMediaAssetById: vi.fn(),
}))

vi.mock('../../src/server/music/metingService', () => ({
  getMusicResourcePreview: mockGetMusicResourcePreview,
  searchMusicResources: vi.fn(),
}))

vi.mock('../../src/server/utils', () => ({
  prisma: mockPrisma,
  enhancedCache: {
    invalidateByPrefix: mockInvalidateByPrefix,
  },
  normalizeMusicImportTracks: (input: unknown) => (Array.isArray(input) ? input : []),
  createOrUpdateImportedSong: mockCreateOrUpdateImportedSong,
  addAlbumCoverFromUrl: mockAddAlbumCoverFromUrl,
  applyAlbumTracksToRelations: mockApplyAlbumTracksToRelations,
  withNumericSlugTransaction: vi.fn(async (prismaLike, _table, callback) =>
    callback(prismaLike, '1')
  ),
  ensureTextLimit: vi.fn(() => true),
  parseInteger: vi.fn((_value, fallback) => fallback),
  parseBoolean: vi.fn((_value, fallback) => fallback),
  parseMusicPlatform: vi.fn(() => null),
  parseDisplayAlbumMode: vi.fn(() => 'linked'),
  parsePostSort: vi.fn(() => ({ createdAt: 'desc' })),
  parseOptionalDateOnly: vi.fn(),
  normalizeOptionalDateOnly: vi.fn(() => null),
  normalizeOptionalDurationMs: vi.fn(() => null),
  normalizeMusicExternalSourceInputs: vi.fn(() => []),
  normalizeSongCustomPlatformLinks: vi.fn(() => null),
  normalizeTrackDiscPayload: vi.fn((tracks) => (Array.isArray(tracks) ? tracks : [])),
  toSongResponse: vi.fn((song) => song),
  toPostResponse: vi.fn((post) => post),
  fetchSongsWithRelations: vi.fn(),
  fetchSongWithRelationsByDocId: vi.fn(),
  resolveMusicPlayUrl: vi.fn(),
  addSongCoverFromAsset: vi.fn(),
  addAlbumCoverFromAsset: vi.fn(),
  resolveSongCoverUrl: vi.fn(),
  resolveAlbumCoverUrl: vi.fn(),
  buildAlbumTracksPayload: vi.fn(() => []),
  ensureDisplayRelation: vi.fn(),
  buildPostVisibilityWhere: vi.fn(() => ({})),
  canViewPost: vi.fn(() => true),
  deletedAtFilter: vi.fn(() => null),
  softDeleteData: vi.fn(() => ({ deletedAt: new Date() })),
}))

async function createApp() {
  const { registerMusicRoutes } = await import('../../src/server/routes/music.routes')
  const app = express()
  app.use(express.json())
  registerMusicRoutes(app as unknown as express.Router)
  return app
}

function mockPreview(songIds: string[], cover = '') {
  mockGetMusicResourcePreview.mockResolvedValue({
    id: 'album-1',
    platform: 'netease',
    type: 'album',
    title: 'Imported Album',
    artist: 'Imported Artist',
    description: '',
    cover,
    platformUrl: 'https://music.163.com/#/album?id=album-1',
    songs: songIds.map((sourceId) => ({
      sourceId,
      title: `Song ${sourceId}`,
      artists: ['Imported Artist'],
      album: 'Imported Album',
      picId: sourceId,
      urlId: sourceId,
      lyricId: sourceId,
      cover: '',
      sourceUrl: `https://music.163.com/#/song?id=${sourceId}`,
    })),
  })
}

describe('music import album cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApplyAlbumTracksToRelations.mockResolvedValue(undefined)
    mockAddAlbumCoverFromUrl.mockResolvedValue(undefined)
  })

  it('invalidates public album list cache after creating an imported album', async () => {
    mockPreview(['song-1'])
    mockCreateOrUpdateImportedSong.mockResolvedValue({
      song: {
        docId: 'song-doc-1',
        title: 'Song song-1',
        artists: ['Imported Artist'],
      },
      created: true,
      linked: false,
    })
    mockPrisma.musicExternalSource.findUnique.mockResolvedValue(null)
    mockPrisma.album.create.mockResolvedValue({
      docId: 'album-doc-1',
      title: 'Imported Album',
    })

    const app = await createApp()
    const response = await request(app)
      .post('/api/music/import')
      .send({ url: 'https://music.163.com/#/album?id=album-1' })

    expect(response.status).toBe(200)
    expect(mockInvalidateByPrefix).toHaveBeenCalledWith('album_list:')
  })

  it('invalidates public album list cache after appending imported tracks to an existing album', async () => {
    mockPreview(['song-2'])
    mockCreateOrUpdateImportedSong.mockResolvedValue({
      song: {
        docId: 'song-doc-2',
        title: 'Song song-2',
        artists: ['Imported Artist'],
      },
      created: true,
      linked: false,
    })
    mockPrisma.musicExternalSource.findUnique.mockResolvedValue({
      album: {
        docId: 'album-doc-1',
        title: 'Imported Album',
        artist: 'Imported Artist',
        description: null,
        coverId: null,
        tracks: [
          {
            disc: 1,
            name: 'Disc 1',
            songs: [{ songDocId: 'song-doc-1', trackOrder: 0 }],
          },
        ],
      },
    })
    mockPrisma.album.update.mockResolvedValue({
      docId: 'album-doc-1',
      title: 'Imported Album',
    })

    const app = await createApp()
    const response = await request(app)
      .post('/api/music/import')
      .send({ url: 'https://music.163.com/#/album?id=album-1' })

    expect(response.status).toBe(200)
    expect(mockPrisma.album.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { docId: 'album-doc-1' },
        data: expect.objectContaining({
          tracks: expect.any(Array),
        }),
      })
    )
    expect(mockInvalidateByPrefix).toHaveBeenCalledWith('album_list:')
  })

  it('does not fail album import when automatic album cover localization fails', async () => {
    mockPreview(['song-1'], 'https://example.com/album-cover.jpg')
    mockAddAlbumCoverFromUrl.mockRejectedValueOnce(new Error('cover unavailable'))
    mockCreateOrUpdateImportedSong.mockResolvedValue({
      song: {
        docId: 'song-doc-1',
        title: 'Song song-1',
        artists: ['Imported Artist'],
      },
      created: true,
      linked: false,
    })
    mockPrisma.musicExternalSource.findUnique.mockResolvedValue(null)
    mockPrisma.album.create.mockResolvedValue({
      docId: 'album-doc-1',
      title: 'Imported Album',
    })

    const app = await createApp()
    const response = await request(app)
      .post('/api/music/import')
      .send({ url: 'https://music.163.com/#/album?id=album-1' })

    expect(response.status).toBe(200)
    expect(mockAddAlbumCoverFromUrl).toHaveBeenCalledWith(
      'album-doc-1',
      'https://example.com/album-cover.jpg',
      true
    )
    expect(mockApplyAlbumTracksToRelations).toHaveBeenCalledWith('album-doc-1', expect.any(Array))
  })
})
