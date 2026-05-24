import express from 'express'
import request from 'supertest'
import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  imageEmbedding: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  wikiImageEmbedding: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  postImageEmbedding: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  textEmbeddingChunk: {
    count: vi.fn(),
  },
}))

vi.mock('../../src/server/middleware/auth', () => ({
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}))

vi.mock('../../src/server/prisma', () => ({
  prisma: mockPrisma,
}))

vi.mock('../../src/server/vector/clipEmbedding', () => ({
  getEmbeddingModelName: vi.fn(() => 'OFA-Sys/chinese-clip-vit-base-patch16'),
  getEmbeddingVectorSize: vi.fn(() => 512),
  getModelCacheDir: vi.fn(() => '/tmp/models'),
  isImageModelLoaded: vi.fn(() => false),
  isTextModelLoaded: vi.fn(() => false),
  isTokenizerLoaded: vi.fn(() => false),
  getModelLoadError: vi.fn(() => ({ image: null, text: null, tokenizer: null })),
  isModelScopeActive: vi.fn(() => false),
  getActualDtype: vi.fn(() => 'q8'),
}))

vi.mock('../../src/server/vector/qdrantService', () => ({
  getQdrantCollectionName: vi.fn(() => 'hsf_image_embeddings'),
  getTextCollectionName: vi.fn(() => 'hsf_text_embeddings'),
}))

vi.mock('../../src/server/vector/embeddingSync', () => ({
  enqueueMissingImageEmbeddings: vi.fn(),
  syncImageEmbeddingBatch: vi.fn(),
}))

vi.mock('../../src/server/vector/wikiPostEmbedding', () => ({
  enqueueMissingWikiImageEmbeddings: vi.fn(),
  enqueueMissingPostImageEmbeddings: vi.fn(),
  enqueueWikiImageEmbeddings: vi.fn(),
  enqueuePostImageEmbeddings: vi.fn(),
  syncWikiImageEmbeddingBatch: vi.fn(),
  syncPostImageEmbeddingBatch: vi.fn(),
}))

vi.mock('../../src/server/vector/textEmbeddingSync', () => ({
  enqueueMissingTextEmbeddings: vi.fn(),
  enqueueWikiTextEmbeddings: vi.fn(),
  enqueuePostTextEmbeddings: vi.fn(),
  enqueueMusicTextEmbeddings: vi.fn(),
  enqueueAlbumTextEmbeddings: vi.fn(),
  syncTextEmbeddingBatch: vi.fn(),
  retryFailedTextEmbeddings: vi.fn(),
  rebuildAllTextEmbeddings: vi.fn(),
}))

function createMissingTableError(modelName: string, table: string) {
  return new Prisma.PrismaClientKnownRequestError(
    `The table \`${table}\` does not exist in the current database.`,
    {
      code: 'P2021',
      clientVersion: '6.19.3',
      meta: {
        modelName,
        table,
      },
    }
  )
}

describe('embeddings routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$queryRaw.mockResolvedValue([{ exists: true }])
    mockPrisma.imageEmbedding.count.mockResolvedValue(1)
    mockPrisma.wikiImageEmbedding.count.mockResolvedValue(2)
    mockPrisma.postImageEmbedding.count.mockResolvedValue(3)
    mockPrisma.imageEmbedding.findMany.mockResolvedValue([])
    mockPrisma.wikiImageEmbedding.findMany.mockResolvedValue([])
    mockPrisma.postImageEmbedding.findMany.mockResolvedValue([])
    mockPrisma.textEmbeddingChunk.count.mockResolvedValue(4)
  })

  it('returns image status and warning when text embedding table is missing', async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([{ exists: false }])

    const { registerEmbeddingsRoutes } = await import('../../src/server/routes/embeddings.routes')

    const app = express()
    registerEmbeddingsRoutes(app as unknown as express.Router)

    const response = await request(app).get('/api/embeddings/status')

    expect(response.status).toBe(200)
    expect(response.body.summary).toEqual({
      gallery: { pending: 1, processing: 1, ready: 1, failed: 1, total: 4 },
      wiki: { pending: 2, processing: 2, ready: 2, failed: 2, total: 8 },
      post: { pending: 3, processing: 3, ready: 3, failed: 3, total: 12 },
    })
    expect(response.body.imageSourceAvailability).toEqual({
      gallery: true,
      wiki: true,
      post: true,
    })
    expect(response.body.textSummary).toEqual({
      wiki: { pending: 0, processing: 0, ready: 0, failed: 0, total: 0 },
      post: { pending: 0, processing: 0, ready: 0, failed: 0, total: 0 },
      music: { pending: 0, processing: 0, ready: 0, failed: 0, total: 0 },
      album: { pending: 0, processing: 0, ready: 0, failed: 0, total: 0 },
    })
    expect(response.body.textEmbeddingReady).toBe(false)
    expect(response.body.textEmbeddingTableMissing).toBe(true)
    expect(response.body.textEmbeddingWarning).toContain('TextEmbeddingChunk')
    expect(mockPrisma.textEmbeddingChunk.count).not.toHaveBeenCalled()
  })

  it('returns degraded image status when wiki and post embedding tables are missing', async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([{ exists: false }])
      .mockResolvedValueOnce([{ exists: false }])
      .mockResolvedValueOnce([{ exists: true }])

    const { registerEmbeddingsRoutes } = await import('../../src/server/routes/embeddings.routes')

    const app = express()
    registerEmbeddingsRoutes(app as unknown as express.Router)

    const response = await request(app).get('/api/embeddings/status')

    expect(response.status).toBe(200)
    expect(response.body.summary).toEqual({
      gallery: { pending: 1, processing: 1, ready: 1, failed: 1, total: 4 },
      wiki: { pending: 0, processing: 0, ready: 0, failed: 0, total: 0 },
      post: { pending: 0, processing: 0, ready: 0, failed: 0, total: 0 },
    })
    expect(response.body.imageSourceAvailability).toEqual({
      gallery: true,
      wiki: false,
      post: false,
    })
    expect(response.body.imageEmbeddingReady).toBe(false)
    expect(response.body.imageEmbeddingTableMissing).toBe(true)
    expect(response.body.imageEmbeddingWarning).toContain('WikiImageEmbedding')
    expect(response.body.imageEmbeddingWarning).toContain('PostImageEmbedding')
  })

  it('returns text status warning when text embedding table is missing', async () => {
    mockPrisma.textEmbeddingChunk.count.mockRejectedValue(
      createMissingTableError('TextEmbeddingChunk', 'public.TextEmbeddingChunk')
    )

    const { registerEmbeddingsRoutes } = await import('../../src/server/routes/embeddings.routes')

    const app = express()
    registerEmbeddingsRoutes(app as unknown as express.Router)

    const response = await request(app).get('/api/embeddings/text/status')

    expect(response.status).toBe(200)
    expect(response.body.summary.wiki.total).toBe(0)
    expect(response.body.textEmbeddingReady).toBe(false)
    expect(response.body.textEmbeddingTableMissing).toBe(true)
  })

  it('skips unavailable image sources when fetching errors', async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([{ exists: false }])
      .mockResolvedValueOnce([{ exists: false }])

    const { registerEmbeddingsRoutes } = await import('../../src/server/routes/embeddings.routes')

    const app = express()
    registerEmbeddingsRoutes(app as unknown as express.Router)

    const response = await request(app).get('/api/embeddings/errors?type=all&limit=50')

    expect(response.status).toBe(200)
    expect(response.body.errors).toEqual([])
    expect(response.body.imageSourceAvailability).toEqual({
      gallery: true,
      wiki: false,
      post: false,
    })
    expect(response.body.warnings[0]).toContain('WikiImageEmbedding')
    expect(response.body.warnings[0]).toContain('PostImageEmbedding')
    expect(mockPrisma.wikiImageEmbedding.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.postImageEmbedding.findMany).not.toHaveBeenCalled()
  })
})
