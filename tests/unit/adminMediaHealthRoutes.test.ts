import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockScanMediaHealth = vi.hoisted(() => vi.fn())
const mockCleanupMediaHealthRecords = vi.hoisted(() => vi.fn())

vi.mock('../../src/server/prisma', () => ({
  prisma: { mocked: true },
}))

vi.mock('../../src/server/utils', () => ({
  uploadsDir: '/tmp/uploads',
}))

vi.mock('../../src/server/middleware/auth', () => ({
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}))

vi.mock('../../src/server/services/mediaHealth.service', () => ({
  scanMediaHealth: mockScanMediaHealth,
  cleanupMediaHealthRecords: mockCleanupMediaHealthRecords,
}))

const cleanupTarget = { recordType: 'mediaAsset', id: 'asset-1' }

function createScanResult() {
  return {
    generatedAt: '2026-07-03T00:00:00.000Z',
    mode: 'strict',
    summary: {
      missingLocalFiles: 1,
      unusedMediaAssets: 1,
      unusedImageMaps: 0,
      cleanupCandidates: 1,
      blockedRecords: 0,
    },
    missingLocalFiles: [],
    unusedMediaRecords: [],
  }
}

async function createApp() {
  const { registerAdminMediaHealthRoutes } =
    await import('../../src/server/routes/admin.media-health.routes')
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    ;(req as express.Request & { authUser?: { uid: string } }).authUser = { uid: 'admin-1' }
    next()
  })
  registerAdminMediaHealthRoutes(app as unknown as express.Router)
  return app
}

describe('admin media health routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockScanMediaHealth.mockResolvedValue(createScanResult())
    mockCleanupMediaHealthRecords.mockResolvedValue([
      {
        recordType: 'mediaAsset',
        id: 'asset-1',
        success: true,
        skipped: false,
        blockedReasons: [],
        message: '已清理',
      },
    ])
  })

  it('scans media health with parsed mode and limit', async () => {
    const app = await createApp()

    const response = await request(app).get('/api/admin/media-health/scan?mode=business&limit=50')

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(mockScanMediaHealth).toHaveBeenCalledWith(
      { mocked: true },
      { uploadDir: '/tmp/uploads', mode: 'business', limit: 50 }
    )
  })

  it('cleans selected media records', async () => {
    const app = await createApp()

    const response = await request(app)
      .post('/api/admin/media-health/cleanup')
      .send({ mode: 'strict', targets: [cleanupTarget] })

    expect(response.status).toBe(200)
    expect(response.body.data.cleaned).toBe(1)
    expect(mockCleanupMediaHealthRecords).toHaveBeenCalledWith(
      { mocked: true },
      {
        mode: 'strict',
        targets: [cleanupTarget],
        deletedBy: 'admin-1',
      }
    )
  })

  it('rejects cleanup without valid targets', async () => {
    const app = await createApp()

    const response = await request(app)
      .post('/api/admin/media-health/cleanup')
      .send({ targets: [] })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('请选择要清理的媒体记录')
    expect(mockCleanupMediaHealthRecords).not.toHaveBeenCalled()
  })
})
