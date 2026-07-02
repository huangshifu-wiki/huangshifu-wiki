import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  album: {
    findUnique: vi.fn(),
  },
  songAlbumRelation: {
    findMany: vi.fn(),
  },
  musicTrack: {
    updateMany: vi.fn(),
  },
}))

vi.mock('../../src/server/middleware/auth', () => ({
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}))

vi.mock('../../src/server/schemas', () => ({
  adminBatchAlbumCoversSchema: {},
  validateBody: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}))

vi.mock('../../src/server/services/mediaAssetCleanupService', () => ({
  cleanupUnusedMediaAssetById: vi.fn(),
}))

vi.mock('../../src/server/utils', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/server/utils')>('../../src/server/utils')

  return {
    ...actual,
    prisma: mockPrisma,
    enhancedCache: {
      get: vi.fn(),
      set: vi.fn(),
      invalidateByPrefix: vi.fn(),
    },
    ensureTextLimit: vi.fn(() => true),
  }
})

async function createApp() {
  const { registerAlbumsRoutes } = await import('../../src/server/routes/albums.routes')
  const app = express()
  app.use(express.json())
  registerAlbumsRoutes(app as unknown as express.Router)
  return app
}

describe('album cover sync route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.album.findUnique.mockResolvedValue({
      docId: 'album-doc-1',
      coverId: 'album-cover-1',
      covers: [
        {
          id: 'album-cover-1',
          publicUrl: '/uploads/album-cover-1.jpg',
          isDefault: true,
        },
      ],
    })
    mockPrisma.songAlbumRelation.findMany.mockResolvedValue([
      { songDocId: 'song-doc-1' },
      { songDocId: 'song-doc-2' },
    ])
    mockPrisma.musicTrack.updateMany.mockResolvedValue({ count: 2 })
  })

  it('makes album songs inherit the album cover without returning a concrete cover id', async () => {
    const app = await createApp()
    const response = await request(app).post('/api/albums/album-doc-1/sync-covers-to-songs')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      success: true,
      syncedCount: 2,
    })
    expect(mockPrisma.musicTrack.updateMany).toHaveBeenCalledWith({
      where: {
        docId: { in: ['song-doc-1', 'song-doc-2'] },
      },
      data: {
        coverId: null,
        coverAlbumDocId: 'album-doc-1',
      },
    })
  })

  it('rejects sync when the album has no displayable cover', async () => {
    mockPrisma.album.findUnique.mockResolvedValue({
      docId: 'album-doc-1',
      coverId: null,
      covers: [],
    })

    const app = await createApp()
    const response = await request(app).post('/api/albums/album-doc-1/sync-covers-to-songs')

    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: '专辑没有可同步的封面' })
    expect(mockPrisma.musicTrack.updateMany).not.toHaveBeenCalled()
  })
})
