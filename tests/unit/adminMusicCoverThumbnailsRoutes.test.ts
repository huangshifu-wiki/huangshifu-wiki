import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRequireAdmin = vi.hoisted(() => vi.fn())
const mockGenerateMusicCoverThumbnail = vi.hoisted(() => vi.fn())
const mockPrisma = vi.hoisted(() => ({
  songCover: {
    count: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  albumCover: {
    count: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('../../src/server/prisma', () => ({
  prisma: mockPrisma,
}))

vi.mock('../../src/server/middleware/auth', () => ({
  requireAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) =>
    mockRequireAdmin(req, res, next),
}))

vi.mock('../../src/server/services/musicCoverThumbnail.service', () => ({
  generateMusicCoverThumbnail: mockGenerateMusicCoverThumbnail,
}))

async function createApp() {
  const { registerAdminMusicCoverThumbnailsRoutes } =
    await import('../../src/server/routes/admin.music-cover-thumbnails.routes')
  const app = express()
  app.use(express.json())
  registerAdminMusicCoverThumbnailsRoutes(app as unknown as express.Router)
  return app
}

describe('admin music cover thumbnail routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAdmin.mockImplementation(
      (_req: express.Request, _res: express.Response, next: express.NextFunction) => next()
    )
    mockGenerateMusicCoverThumbnail.mockResolvedValue('/uploads/music-covers/thumbnails/cover.webp')
    mockPrisma.songCover.update.mockResolvedValue({})
    mockPrisma.albumCover.update.mockResolvedValue({})
  })

  it('统计缺失缩略图的歌曲封面和专辑封面', async () => {
    mockPrisma.songCover.count.mockResolvedValueOnce(10).mockResolvedValueOnce(3)
    mockPrisma.albumCover.count.mockResolvedValueOnce(8).mockResolvedValueOnce(2)
    const app = await createApp()

    const response = await request(app).get('/api/admin/music-cover-thumbnails/stats')

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({
      song: { total: 10, missing: 3 },
      album: { total: 8, missing: 2 },
      total: { total: 18, missing: 5 },
    })
    expect(mockPrisma.songCover.count).toHaveBeenCalledWith({ where: { thumbnailUrl: null } })
    expect(mockPrisma.albumCover.count).toHaveBeenCalledWith({ where: { thumbnailUrl: null } })
  })

  it('按批次补齐缩略图且单条失败不阻断整批', async () => {
    mockPrisma.songCover.findMany.mockResolvedValue([
      { id: 'song-cover-1', songDocId: 'song-1', storageKey: 'covers/song-1.jpg' },
      { id: 'song-cover-2', songDocId: 'song-2', storageKey: 'covers/song-2.jpg' },
    ])
    mockGenerateMusicCoverThumbnail
      .mockResolvedValueOnce('/uploads/music-covers/thumbnails/song-1.webp')
      .mockRejectedValueOnce(new Error('source missing'))
    mockPrisma.songCover.count.mockResolvedValueOnce(1)
    const app = await createApp()

    const response = await request(app)
      .post('/api/admin/music-cover-thumbnails/backfill')
      .send({ type: 'song', batchSize: 2 })

    expect(response.status).toBe(200)
    expect(response.body.data.processed).toBe(2)
    expect(response.body.data.succeeded).toBe(1)
    expect(response.body.data.failed).toBe(1)
    expect(response.body.data.remaining).toBe(1)
    expect(response.body.data.errors[0]).toMatchObject({
      type: 'song',
      coverId: 'song-cover-2',
      resourceId: 'song-2',
      message: 'source missing',
    })
    expect(mockPrisma.songCover.update).toHaveBeenCalledWith({
      where: { id: 'song-cover-1' },
      data: { thumbnailUrl: '/uploads/music-covers/thumbnails/song-1.webp' },
    })
  })

  it('非管理员不能访问接口', async () => {
    mockRequireAdmin.mockImplementation((_req: express.Request, res: express.Response) => {
      res.status(403).json({ error: '需要管理员权限' })
    })
    const app = await createApp()

    const response = await request(app).get('/api/admin/music-cover-thumbnails/stats')

    expect(response.status).toBe(403)
    expect(response.body.error).toBe('需要管理员权限')
    expect(mockPrisma.songCover.count).not.toHaveBeenCalled()
  })
})
