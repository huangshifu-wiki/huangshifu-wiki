import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  cleanupMediaHealthRecords,
  scanMediaHealth,
} from '../../../src/server/services/mediaHealth.service'

const mockSafeDeleteUploadFileByStorageKey = vi.hoisted(() => vi.fn())
const mockVariantCleanupByImageMapId = vi.hoisted(() => vi.fn())

vi.mock('../../../src/server/utils/upload', () => ({
  isUploadSessionExpired: (expiresAt: Date) => expiresAt.getTime() <= Date.now(),
  safeDeleteUploadFileByStorageKey: mockSafeDeleteUploadFileByStorageKey,
}))

vi.mock('../../../src/server/services/variantCleanup.service', () => ({
  CleanupTrigger: {
    ON_DELETE: 'on_delete',
  },
  variantCleanup: {
    cleanupByImageMapId: mockVariantCleanupByImageMapId,
  },
}))

function findMany(name: string, data: Record<string, unknown[]>) {
  return vi.fn().mockImplementation((args?: { skip?: number; take?: number }) => {
    const rows = data[name] || []
    if (typeof args?.skip === 'number' || typeof args?.take === 'number') {
      const skip = args?.skip || 0
      const take = args?.take || rows.length
      return Promise.resolve(rows.slice(skip, skip + take))
    }
    return Promise.resolve(rows)
  })
}

function createPrismaMock(data: Record<string, unknown[]> = {}) {
  return {
    mediaAsset: {
      findMany: findMany('mediaAsset', data),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    imageMap: {
      findMany: findMany('imageMap', data),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: { findMany: findMany('user', data) },
    galleryImage: { findMany: findMany('galleryImage', data) },
    event: { findMany: findMany('event', data) },
    eventPoster: { findMany: findMany('eventPoster', data) },
    songCover: { findMany: findMany('songCover', data) },
    albumCover: { findMany: findMany('albumCover', data) },
    wikiImageEmbedding: { findMany: findMany('wikiImageEmbedding', data) },
    postImageEmbedding: { findMany: findMany('postImageEmbedding', data) },
    wikiPage: { findMany: findMany('wikiPage', data) },
    wikiRevision: { findMany: findMany('wikiRevision', data) },
    post: { findMany: findMany('post', data) },
    postComment: { findMany: findMany('postComment', data) },
    wikiPullRequestComment: { findMany: findMany('wikiPullRequestComment', data) },
    wikiPullRequest: { findMany: findMany('wikiPullRequest', data) },
    announcement: { findMany: findMany('announcement', data) },
  }
}

const tempDirs: string[] = []

function createUploadDir() {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-health-'))
  tempDirs.push(uploadDir)
  return uploadDir
}

function createMediaAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asset-1',
    storageKey: 'gallery/missing.jpg',
    publicUrl: '/uploads/gallery/missing.jpg',
    fileName: 'missing.jpg',
    status: 'ready',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function createImageMap(overrides: Record<string, unknown> = {}) {
  return {
    id: 'map-1',
    localUrl: '/uploads/gallery/missing.jpg',
    externalUrl: null,
    s3Url: null,
    thumbnailUrl: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSafeDeleteUploadFileByStorageKey.mockResolvedValue(undefined)
  mockVariantCleanupByImageMapId.mockResolvedValue({ success: true })
})

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('mediaHealth.service', () => {
  it('reports missing media assets as unused when no external reference exists', async () => {
    const uploadDir = createUploadDir()
    const prisma = createPrismaMock({
      mediaAsset: [createMediaAsset()],
    })

    const result = await scanMediaHealth(prisma as never, { uploadDir, mode: 'strict' })

    expect(result.summary.missingLocalFiles).toBe(1)
    expect(result.summary.unusedMediaAssets).toBe(1)
    expect(result.missingLocalFiles[0]).toMatchObject({
      recordType: 'mediaAsset',
      id: 'asset-1',
      canCleanup: true,
    })
    expect(result.unusedMediaRecords[0]).toMatchObject({
      recordType: 'mediaAsset',
      id: 'asset-1',
      canCleanup: true,
    })
  })

  it('blocks cleanup candidates in strict mode when historical text still references the file', async () => {
    const uploadDir = createUploadDir()
    const prisma = createPrismaMock({
      mediaAsset: [createMediaAsset()],
      wikiRevision: [{ id: 'rev-1', content: '![x](/uploads/gallery/missing.jpg)' }],
    })

    const result = await scanMediaHealth(prisma as never, { uploadDir, mode: 'strict' })

    expect(result.summary.unusedMediaAssets).toBe(0)
    expect(result.missingLocalFiles[0]).toMatchObject({
      id: 'asset-1',
      canCleanup: false,
      blockedReasons: ['referenced'],
    })
  })

  it('does not report media assets referenced by structured asset id as unused', async () => {
    const uploadDir = createUploadDir()
    const prisma = createPrismaMock({
      mediaAsset: [createMediaAsset()],
      galleryImage: [{ id: 'gallery-1', url: null, assetId: 'asset-1' }],
    })

    const result = await scanMediaHealth(prisma as never, { uploadDir, mode: 'business' })

    expect(result.summary.unusedMediaAssets).toBe(0)
    expect(result.missingLocalFiles[0]).toMatchObject({
      id: 'asset-1',
      canCleanup: false,
      blockedReasons: ['referenced'],
    })
  })

  it('blocks active upload session assets from cleanup', async () => {
    const uploadDir = createUploadDir()
    const prisma = createPrismaMock({
      mediaAsset: [
        createMediaAsset({
          session: {
            status: 'open',
            expiresAt: new Date(Date.now() + 60_000),
          },
        }),
      ],
    })
    prisma.mediaAsset.findUnique.mockResolvedValue(
      createMediaAsset({
        session: {
          status: 'open',
          expiresAt: new Date(Date.now() + 60_000),
        },
      })
    )

    const scan = await scanMediaHealth(prisma as never, { uploadDir, mode: 'business' })
    const cleanup = await cleanupMediaHealthRecords(prisma as never, {
      mode: 'business',
      deletedBy: 'admin-1',
      targets: [{ recordType: 'mediaAsset', id: 'asset-1' }],
    })

    expect(scan.unusedMediaRecords[0]).toMatchObject({
      id: 'asset-1',
      canCleanup: false,
      blockedReasons: ['active_upload_session'],
    })
    expect(cleanup[0]).toMatchObject({
      success: false,
      skipped: true,
      blockedReasons: ['active_upload_session'],
    })
    expect(mockSafeDeleteUploadFileByStorageKey).not.toHaveBeenCalled()
    expect(prisma.mediaAsset.update).not.toHaveBeenCalled()
  })

  it('does not report image maps referenced by external or s3 url as unused', async () => {
    const uploadDir = createUploadDir()
    const prisma = createPrismaMock({
      imageMap: [
        createImageMap({
          externalUrl: 'https://img.example.com/gallery/missing.jpg',
          s3Url: 'https://cdn.example.com/gallery/missing.jpg',
        }),
      ],
      wikiPage: [
        {
          id: 'page-1',
          content:
            '![x](https://img.example.com/gallery/missing.jpg) ![y](https://cdn.example.com/gallery/missing.jpg)',
        },
      ],
    })
    prisma.imageMap.findUnique.mockResolvedValue(
      createImageMap({
        externalUrl: 'https://img.example.com/gallery/missing.jpg',
        s3Url: 'https://cdn.example.com/gallery/missing.jpg',
      })
    )

    const scan = await scanMediaHealth(prisma as never, { uploadDir, mode: 'business' })
    const cleanup = await cleanupMediaHealthRecords(prisma as never, {
      mode: 'business',
      deletedBy: 'admin-1',
      targets: [{ recordType: 'imageMap', id: 'map-1' }],
    })

    expect(scan.summary.unusedImageMaps).toBe(0)
    expect(scan.missingLocalFiles[0]).toMatchObject({
      recordType: 'imageMap',
      id: 'map-1',
      canCleanup: false,
      blockedReasons: ['referenced'],
    })
    expect(scan.missingLocalFiles[0].references).toEqual([
      expect.objectContaining({
        field: 'content',
        value: 'https://img.example.com/gallery/missing.jpg',
      }),
      expect.objectContaining({
        field: 'content',
        value: 'https://cdn.example.com/gallery/missing.jpg',
      }),
    ])
    expect(cleanup[0]).toMatchObject({
      success: false,
      skipped: true,
      blockedReasons: ['referenced'],
    })
    expect(mockVariantCleanupByImageMapId).not.toHaveBeenCalled()
    expect(prisma.imageMap.update).not.toHaveBeenCalled()
  })

  it('cleans only targets that still pass a fresh scan', async () => {
    const uploadDir = createUploadDir()
    const prisma = createPrismaMock({
      mediaAsset: [createMediaAsset()],
    })
    prisma.mediaAsset.findUnique.mockResolvedValue({
      id: 'asset-1',
      storageKey: 'gallery/missing.jpg',
      status: 'ready',
    })
    prisma.mediaAsset.update.mockResolvedValue({ id: 'asset-1', status: 'deleted' })

    const result = await cleanupMediaHealthRecords(prisma as never, {
      mode: 'strict',
      deletedBy: 'admin-1',
      targets: [{ recordType: 'mediaAsset', id: 'asset-1' }],
    })

    expect(result).toEqual([
      expect.objectContaining({ recordType: 'mediaAsset', id: 'asset-1', success: true }),
    ])
    expect(mockSafeDeleteUploadFileByStorageKey).toHaveBeenCalledWith('gallery/missing.jpg')
    expect(prisma.mediaAsset.update).toHaveBeenCalledWith({
      where: { id: 'asset-1' },
      data: { status: 'deleted' },
    })
  })

  it('limits returned details without changing summary counts', async () => {
    const uploadDir = createUploadDir()
    const prisma = createPrismaMock({
      mediaAsset: [
        createMediaAsset({
          id: 'asset-1',
          storageKey: 'gallery/a.jpg',
          publicUrl: '/uploads/gallery/a.jpg',
          fileName: 'a.jpg',
        }),
        createMediaAsset({
          id: 'asset-2',
          storageKey: 'gallery/b.jpg',
          publicUrl: '/uploads/gallery/b.jpg',
          fileName: 'b.jpg',
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
        }),
      ],
    })

    const result = await scanMediaHealth(prisma as never, {
      uploadDir,
      mode: 'strict',
      limit: 1,
    })

    expect(result.summary.missingLocalFiles).toBe(2)
    expect(result.missingLocalFiles).toHaveLength(1)
  })
})
