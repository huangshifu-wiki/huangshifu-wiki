import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  imageMap: {
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
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
  isAdminRole: (role?: string) => role === 'admin' || role === 'super_admin',
  requireActiveUser: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}))

vi.mock('../../src/server/utils', () => ({
  prisma: mockPrisma,
  uploadsDir: '/tmp/uploads',
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  softDeleteData: (deletedBy: string) => ({ deletedAt: new Date(), deletedBy }),
  resolveUploadPathByUrl: vi.fn(() => null),
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
    mockPrisma.imageMap.findUnique.mockResolvedValue({ id: 'img-1', deletedAt: null })
    mockPrisma.imageMap.update.mockResolvedValue({ id: 'img-1' })
    mockPrisma.imageMap.create.mockResolvedValue({
      id: 'img-1',
      md5: 'md5-1',
      localUrl: '/uploads/test.jpg',
      externalUrl: null,
      s3Url: null,
      thumbnailUrl: null,
      storageType: 'local',
      blurhash: null,
      thumbhash: null,
      deletedAt: null,
      deletedBy: null,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    })
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

  async function createApp(role: 'user' | 'admin' | 'super_admin' = 'admin') {
    const { registerImageMapsRoutes } = await import('../../src/server/routes/image-maps.routes')

    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
      ;(req as express.Request & { authUser?: { uid: string; role: string } }).authUser = {
        uid: `${role}-1`,
        role,
      }
      next()
    })
    registerImageMapsRoutes(app as unknown as express.Router)

    return app
  }

  it('soft deletes the image map', async () => {
    const app = await createApp()

    const response = await request(app).delete('/api/image-maps/img-1')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ success: true })
    expect(mockPrisma.imageMap.findUnique).toHaveBeenCalledWith({
      where: { id: 'img-1' },
      select: { id: true, deletedAt: true },
    })
    expect(mockCleanupByImageMapId).not.toHaveBeenCalled()
    expect(mockPrisma.imageMap.update).toHaveBeenCalledWith({
      where: { id: 'img-1' },
      data: { deletedAt: expect.any(Date), deletedBy: 'admin-1' },
    })
  })

  it('returns 404 when the image map does not exist', async () => {
    mockPrisma.imageMap.findUnique.mockResolvedValueOnce(null)

    const app = await createApp()
    const response = await request(app).delete('/api/image-maps/missing')

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: '图片映射不存在' })
    expect(mockCleanupByImageMapId).not.toHaveBeenCalled()
    expect(mockPrisma.imageMap.update).not.toHaveBeenCalled()
  })

  it('creates a new image map for a normal user', async () => {
    mockPrisma.imageMap.findUnique.mockResolvedValueOnce(null)
    mockPrisma.imageMap.create.mockResolvedValueOnce({
      id: 'img-new',
      md5: 'md5-new',
      localUrl: '/uploads/new.jpg',
      externalUrl: null,
      s3Url: null,
      thumbnailUrl: null,
      storageType: 'local',
      blurhash: null,
      thumbhash: null,
      deletedAt: null,
      deletedBy: null,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    })

    const app = await createApp('user')
    const response = await request(app).post('/api/image-maps').send({
      id: 'img-new',
      md5: 'md5-new',
      localUrl: '/uploads/new.jpg',
      storageType: 'local',
    })

    expect(response.status).toBe(201)
    expect(response.body.item).toMatchObject({
      id: 'img-new',
      md5: 'md5-new',
      localUrl: '/uploads/new.jpg',
      storageType: 'local',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    expect(mockPrisma.imageMap.create).toHaveBeenCalledWith({
      data: {
        id: 'img-new',
        md5: 'md5-new',
        localUrl: '/uploads/new.jpg',
        storageType: 'local',
      },
    })
    expect(mockPrisma.imageMap.update).not.toHaveBeenCalled()
  })

  it('rejects updating an existing image map for a normal user', async () => {
    mockPrisma.imageMap.findUnique.mockResolvedValueOnce({
      id: 'img-1',
      md5: 'md5-1',
      localUrl: '/uploads/original.jpg',
      s3Url: null,
      externalUrl: null,
      storageType: 'local',
    })

    const app = await createApp('user')
    const response = await request(app).post('/api/image-maps').send({
      id: 'img-1',
      md5: 'md5-1',
      s3Url: 'https://cdn.example.com/image.jpg',
      storageType: 's3',
    })

    expect(response.status).toBe(403)
    expect(response.body).toEqual({ error: '需要管理员权限' })
    expect(mockPrisma.imageMap.update).not.toHaveBeenCalled()
    expect(mockPrisma.imageMap.create).not.toHaveBeenCalled()
  })

  it('updates an existing image map as admin when id and md5 match', async () => {
    mockPrisma.imageMap.findUnique.mockResolvedValueOnce({
      id: 'img-1',
      md5: 'md5-1',
      localUrl: '/uploads/original.jpg',
      s3Url: null,
      externalUrl: null,
      storageType: 'local',
    })
    mockPrisma.imageMap.update.mockResolvedValueOnce({
      id: 'img-1',
      md5: 'md5-1',
      localUrl: '/uploads/original.jpg',
      externalUrl: null,
      s3Url: 'https://cdn.example.com/image.jpg',
      thumbnailUrl: null,
      storageType: 's3',
      blurhash: null,
      thumbhash: null,
      deletedAt: null,
      deletedBy: null,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    })

    const app = await createApp()
    const response = await request(app).post('/api/image-maps').send({
      id: 'img-1',
      md5: 'md5-1',
      s3Url: 'https://cdn.example.com/image.jpg',
      storageType: 's3',
    })

    expect(response.status).toBe(200)
    expect(response.body.item).toMatchObject({
      id: 'img-1',
      md5: 'md5-1',
      s3Url: 'https://cdn.example.com/image.jpg',
      storageType: 's3',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    expect(mockPrisma.imageMap.update).toHaveBeenCalledWith({
      where: { id: 'img-1' },
      data: {
        s3Url: 'https://cdn.example.com/image.jpg',
        storageType: 's3',
      },
    })
    expect(mockPrisma.imageMap.create).not.toHaveBeenCalled()
  })

  it('rejects updating an existing image map when md5 does not match', async () => {
    mockPrisma.imageMap.findUnique.mockResolvedValueOnce({
      id: 'img-1',
      md5: 'md5-1',
      localUrl: '/uploads/original.jpg',
      s3Url: null,
      externalUrl: null,
      storageType: 'local',
    })

    const app = await createApp()
    const response = await request(app).post('/api/image-maps').send({
      id: 'img-1',
      md5: 'md5-2',
      s3Url: 'https://cdn.example.com/image.jpg',
      storageType: 's3',
    })

    expect(response.status).toBe(409)
    expect(response.body).toEqual({ error: '图片映射已存在且与当前图片不匹配' })
    expect(mockPrisma.imageMap.update).not.toHaveBeenCalled()
    expect(mockPrisma.imageMap.create).not.toHaveBeenCalled()
  })
})
