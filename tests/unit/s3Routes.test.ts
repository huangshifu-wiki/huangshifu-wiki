import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUserPresignedUploadUrl = vi.hoisted(() => vi.fn())
const mockGetPresignedDownloadUrl = vi.hoisted(() => vi.fn())
const mockGetPresignedDeleteUrl = vi.hoisted(() => vi.fn())
const mockGetPublicConfig = vi.hoisted(() => vi.fn())

vi.mock('../../src/server/middleware/auth', () => ({
  requireAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  requireActiveUser: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}))

vi.mock('../../src/server/s3/s3Service', () => ({
  getUserPresignedUploadUrl: mockGetUserPresignedUploadUrl,
  getPresignedDownloadUrl: mockGetPresignedDownloadUrl,
  getPresignedDeleteUrl: mockGetPresignedDeleteUrl,
  getPublicConfig: mockGetPublicConfig,
}))

describe('s3 routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPublicConfig.mockReturnValue({ enabled: true })
    mockGetPresignedDownloadUrl.mockResolvedValue('https://example.com/download')
    mockGetPresignedDeleteUrl.mockResolvedValue('https://example.com/delete')
  })

  it('joins wildcard path segments for presigned download', async () => {
    const { registerS3Routes } = await import('../../src/server/routes/s3.routes')

    const app = express()
    registerS3Routes(app as unknown as express.Router)

    const response = await request(app).get('/api/s3/presign-download/a/b/c.png')

    expect(response.status).toBe(200)
    expect(mockGetPresignedDownloadUrl).toHaveBeenCalledWith('a/b/c.png')
    expect(response.body.downloadUrl).toBe('https://example.com/download')
  })

  it('joins wildcard path segments for presigned delete', async () => {
    const { registerS3Routes } = await import('../../src/server/routes/s3.routes')

    const app = express()
    registerS3Routes(app as unknown as express.Router)

    const response = await request(app).get('/api/s3/presign-delete/folder/nested/file.png')

    expect(response.status).toBe(200)
    expect(mockGetPresignedDeleteUrl).toHaveBeenCalledWith('folder/nested/file.png')
    expect(response.body.deleteUrl).toBe('https://example.com/delete')
  })
})
