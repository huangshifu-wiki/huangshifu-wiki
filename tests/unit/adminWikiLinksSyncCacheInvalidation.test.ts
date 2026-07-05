import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  imageMap: {
    findMany: vi.fn(),
  },
}))

const mockBatchUpdateWikiLinks = vi.hoisted(() => vi.fn())
const mockInvalidateByPrefix = vi.hoisted(() => vi.fn())
const mockDelete = vi.hoisted(() => vi.fn())
const mockClearWikiRelationCache = vi.hoisted(() => vi.fn())

vi.mock('../../src/server/middleware/auth', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!(req as express.Request & { authUser?: unknown }).authUser) {
      res.status(401).json({ error: '请先登录' })
      return
    }
    next()
  },
  requireActiveUser: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
  requireSuperAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
  isAdminRole: vi.fn(() => true),
  clearUserCache: vi.fn(),
}))

vi.mock('../../src/server/middleware/asyncHandler', () => ({
  asyncHandler:
    (handler: express.RequestHandler) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) =>
      Promise.resolve(handler(req, res, next)).catch(next),
}))

vi.mock('../../src/server/schemas', () => ({
  validateBody: vi.fn(
    () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next()
  ),
  backupCreateSchema: {},
  backupNoteSchema: {},
  backupRestoreSchema: {},
  adminBatchEditLocksSchema: {},
  adminBatchMusicDisplaySchema: {},
}))

vi.mock('../../src/server/wiki/markdownLinkUpdater', () => ({
  scanAllWikiLinks: vi.fn(),
  getWikiPageLinks: vi.fn(),
  previewLinkUpdate: vi.fn(),
  batchUpdateWikiLinks: mockBatchUpdateWikiLinks,
  switchWikiStorage: vi.fn(),
}))

vi.mock('../../src/server/services/mediaAssetCleanupService', () => ({
  cleanupUnusedMediaAssetById: vi.fn(),
  cleanupUntrackedUploadImageByUrl: vi.fn(),
}))

vi.mock('../../src/server/services/variantCleanup.service', () => ({
  CleanupTrigger: {
    ON_DELETE: 'on_delete',
    ON_FAILURE: 'on_failure',
    MANUAL: 'manual',
    SCHEDULED: 'scheduled',
  },
  variantCleanup: {
    cleanupByImageMapId: vi.fn(),
  },
}))

vi.mock('../../src/server/vector/qdrantService', () => ({
  deleteImageEmbeddingPointsBySource: vi.fn(),
  deleteTextEmbeddingPointsBySource: vi.fn(),
}))

vi.mock('../../src/server/utils', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/server/utils')>('../../src/server/utils')

  return {
    ...actual,
    prisma: mockPrisma,
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    enhancedCache: {
      invalidateByPrefix: mockInvalidateByPrefix,
      delete: mockDelete,
    },
    clearWikiRelationCache: mockClearWikiRelationCache,
    CACHE_KEYS: {
      WIKI_PAGE: 'wiki_page',
      WIKI_LIST: 'wiki_list',
      WIKI_RECOMMENDED: 'wiki_recommended',
    },
  }
})

describe('admin wiki links sync cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function createApp() {
    const { registerAdminRoutes } = await import('../../src/server/routes/admin.routes')

    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
      ;(req as express.Request & { authUser?: { uid: string; role: string } }).authUser = {
        uid: 'admin-1',
        role: 'admin',
      }
      next()
    })
    registerAdminRoutes(app as unknown as express.Router)

    return app
  }

  it('invalidates wiki caches after imagemap sync writes changes', async () => {
    mockPrisma.imageMap.findMany.mockResolvedValue([
      {
        id: 'img-1',
        localUrl: '/uploads/local.jpg',
        externalUrl: 'https://cdn.example.com/remote.jpg',
      },
    ])
    mockBatchUpdateWikiLinks.mockResolvedValue({ successCount: 2, updatedPages: ['wiki-1'] })

    const app = await createApp()
    const response = await request(app).post('/api/admin/wiki-links/sync-with-imagemap').send({})

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      message: '同步完成',
      result: { successCount: 2, updatedPages: ['wiki-1'] },
    })
    expect(mockBatchUpdateWikiLinks).toHaveBeenCalledWith(
      [
        {
          oldUrl: '/uploads/local.jpg',
          newUrl: 'https://cdn.example.com/remote.jpg',
          useRegex: false,
        },
      ],
      { dryRun: undefined }
    )
    expect(mockInvalidateByPrefix).toHaveBeenCalledTimes(3)
    expect(mockInvalidateByPrefix).toHaveBeenNthCalledWith(1, 'wiki_page:')
    expect(mockInvalidateByPrefix).toHaveBeenNthCalledWith(2, 'wiki_list:')
    expect(mockInvalidateByPrefix).toHaveBeenNthCalledWith(3, 'wiki_recommended:')
    expect(mockClearWikiRelationCache).toHaveBeenCalledOnce()
  })

  it('does not invalidate caches during dry run', async () => {
    mockPrisma.imageMap.findMany.mockResolvedValue([
      {
        id: 'img-1',
        localUrl: '/uploads/local.jpg',
        externalUrl: 'https://cdn.example.com/remote.jpg',
      },
    ])
    mockBatchUpdateWikiLinks.mockResolvedValue({ successCount: 2, updatedPages: ['wiki-1'] })

    const app = await createApp()
    const response = await request(app)
      .post('/api/admin/wiki-links/sync-with-imagemap')
      .send({ dryRun: true })

    expect(response.status).toBe(200)
    expect(response.body.message).toBe('预览同步完成')
    expect(mockInvalidateByPrefix).not.toHaveBeenCalled()
    expect(mockClearWikiRelationCache).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('does not invalidate caches when there are no syncable mappings', async () => {
    mockPrisma.imageMap.findMany.mockResolvedValue([
      {
        id: 'img-1',
        localUrl: '/uploads/local.jpg',
        externalUrl: '/uploads/local.jpg',
      },
    ])

    const app = await createApp()
    const response = await request(app).post('/api/admin/wiki-links/sync-with-imagemap').send({})

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ message: '没有需要同步的链接', result: null })
    expect(mockBatchUpdateWikiLinks).not.toHaveBeenCalled()
    expect(mockInvalidateByPrefix).not.toHaveBeenCalled()
    expect(mockClearWikiRelationCache).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
  })
})
