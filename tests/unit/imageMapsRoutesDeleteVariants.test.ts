import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  imageMap: {
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockCleanupByImageMapId = vi.hoisted(() => vi.fn())

vi.mock('../../src/server/middleware/auth', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!(req as express.Request & { authUser?: unknown }).authUser) {
      res.status(401).json({ error: '请先登录' })
      return
    }
    next()
  },
  requireActiveUser: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}))

vi.mock('../../src/server/utils', () => ({
  prisma: mockPrisma,
  uploadsDir: '/tmp/uploads',
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../src/server/services/variantCleanup.service', () => ({
  CleanupTrigger: {
    ON_DELETE: 'on_delete',
    ON_FAILURE: 'on_failure',
    MANUAL: 'manual',
    SCHEDULED: 'scheduled',
  },
  variantCleanup: {
    cleanupByImageMapId: mockCleanupByImageMapId,
  },
}))

vi.mock('../../src/server/blurhashService', () => ({
  isBlurhashEnabled: vi.fn(() => false),
  shouldAutoGenerate: vi.fn(() => false),
  generateBlurhashFromFile: vi.fn(),
}))

vi.mock('../../src/server/s3/s3Service', () => ({
  getS3BaseUrl: vi.fn(() => ''),
  getPublicConfig: vi.fn(() => ({})),
}))

describe('image maps delete route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.imageMap.findUnique.mockResolvedValue({ id: 'img-1' })
    mockPrisma.imageMap.delete.mockResolvedValue({ id: 'img-1' })
    mockCleanupByImageMapId.mockResolvedValue({
      success: true,
      trigger: 'on_delete',
      deletedFiles: [],
      errors: [],
      totalFreedBytes: 0,
      totalFreedFormatted: '0 B',
      executionTimeMs: 0,
      timestamp: new Date(),
    })
  })

  async function createApp() {
    const { registerImageMapsRoutes } = await import('../../src/server/routes/image-maps.routes')

    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
      ;(req as express.Request & { authUser?: { uid: string; role: string } }).authUser = {
        uid: 'admin-1',
        role: 'admin',
      }
      next()
    })
    registerImageMapsRoutes(app as unknown as express.Router)

    return app
  }

  it('deletes variants before removing the image map', async () => {
    const app = await createApp()

    const response = await request(app).delete('/api/image-maps/img-1')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ success: true })
    expect(mockPrisma.imageMap.findUnique).toHaveBeenCalledWith({
      where: { id: 'img-1' },
      select: { id: true },
    })
    expect(mockCleanupByImageMapId).toHaveBeenCalledWith('img-1', 'on_delete')
    expect(mockPrisma.imageMap.delete).toHaveBeenCalledWith({
      where: { id: 'img-1' },
    })
  })

  it('returns 404 when the image map does not exist', async () => {
    mockPrisma.imageMap.findUnique.mockResolvedValueOnce(null)

    const app = await createApp()
    const response = await request(app).delete('/api/image-maps/missing')

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: '图片映射不存在' })
    expect(mockCleanupByImageMapId).not.toHaveBeenCalled()
    expect(mockPrisma.imageMap.delete).not.toHaveBeenCalled()
  })
})
