import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const mocks = vi.hoisted(() => ({
  imageMapFindUnique: vi.fn(),
  imageMapUpsert: vi.fn(),
  imageMapUpdate: vi.fn(),
  mediaAssetCreate: vi.fn(),
  mediaAssetFindUnique: vi.fn(),
  mediaAssetFindFirst: vi.fn(),
  executeRaw: vi.fn(),
  siteConfigFindUnique: vi.fn(),
}))

vi.mock('../../../src/server/prisma', () => ({
  prisma: {
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaMock),
    $executeRaw: mocks.executeRaw,
    siteConfig: { findUnique: mocks.siteConfigFindUnique },
    imageMap: {
      findUnique: mocks.imageMapFindUnique,
      upsert: mocks.imageMapUpsert,
      update: mocks.imageMapUpdate,
    },
    mediaAsset: {
      create: mocks.mediaAssetCreate,
      findUnique: mocks.mediaAssetFindUnique,
      findFirst: mocks.mediaAssetFindFirst,
    },
  },
}))

vi.mock('../../../src/server/services/secretsConfig.service', () => ({
  secretsConfigService: { getSecrets: () => ({}) },
}))

const prismaMock = {
  $executeRaw: mocks.executeRaw,
  siteConfig: { findUnique: mocks.siteConfigFindUnique },
  imageMap: {
    findUnique: mocks.imageMapFindUnique,
    upsert: mocks.imageMapUpsert,
    update: mocks.imageMapUpdate,
  },
  mediaAsset: {
    create: mocks.mediaAssetCreate,
    findFirst: mocks.mediaAssetFindFirst,
  },
}

let uploadDir: string
let tempFilePath: string

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-asset-service-'))
  tempFilePath = path.join(uploadDir, 'upload.jpg')
  await fs.writeFile(tempFilePath, 'same-image-bytes')
  process.env.UPLOADS_PATH = uploadDir
  mocks.executeRaw.mockResolvedValue(0)
  mocks.siteConfigFindUnique.mockResolvedValue(null)
  mocks.imageMapUpdate.mockImplementation(
    async ({ data, where }: { data: Record<string, unknown>; where: { id: string } }) => ({
      id: where.id,
      md5: 'placeholder',
      localUrl: '/uploads/upload.jpg',
      externalUrl: null,
      s3Url: null,
      s3Key: null,
      storageType: data.storageType || 'local',
      thumbnailUrl: null,
      blurhash: null,
      thumbhash: null,
      variantStatus: 'pending',
      cloudSyncStatus: 'pending',
      deletedAt: null,
      retiredAt: null,
    })
  )
})

afterEach(async () => {
  await fs.rm(uploadDir, { recursive: true, force: true })
})

describe('mediaAssetService', () => {
  it('在内容锁内创建 ImageMap 和 uploaded claim，并返回 md5', async () => {
    const md5 = crypto.createHash('md5').update('same-image-bytes').digest('hex')
    const imageMap = {
      id: 'map-1',
      md5,
      localUrl: '/uploads/upload.jpg',
      externalUrl: null,
      s3Url: null,
      s3Key: null,
      storageType: 'local',
      thumbnailUrl: null,
      blurhash: null,
      thumbhash: null,
      variantStatus: 'pending',
      cloudSyncStatus: 'pending',
      deletedAt: null,
      retiredAt: null,
    }
    mocks.imageMapFindUnique.mockResolvedValueOnce(null).mockResolvedValue(imageMap)
    mocks.imageMapUpsert.mockResolvedValue(imageMap)
    mocks.mediaAssetCreate.mockResolvedValue({
      id: 'asset-1',
      imageMapId: 'map-1',
      publicUrl: '/uploads/upload.jpg',
      storageKey: 'upload.jpg',
      fileName: 'upload.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 16,
      status: 'uploaded',
    })
    mocks.mediaAssetFindUnique.mockResolvedValue({
      id: 'asset-1',
      imageMapId: 'map-1',
      publicUrl: '/uploads/upload.jpg',
      storageKey: 'upload.jpg',
      fileName: 'upload.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 16,
      status: 'uploaded',
    })

    const { createOrReuseUploadedAsset } =
      await import('../../../src/server/services/mediaAssetService')
    const result = await createOrReuseUploadedAsset({
      ownerUid: 'user-1',
      tempFilePath,
      originalFileName: 'upload.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 16,
      sessionId: undefined,
      storageStrategy: 'local',
    })

    expect(mocks.executeRaw).toHaveBeenCalled()
    expect(mocks.imageMapUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { md5 } }))
    expect(result).toMatchObject({
      assetId: 'asset-1',
      imageMapId: 'map-1',
      md5,
      reused: false,
      status: 'uploaded',
    })
  })

  it('同一 MD5 复用规范映射但创建新的逻辑 claim并清理临时文件', async () => {
    const md5 = crypto.createHash('md5').update('same-image-bytes').digest('hex')
    const imageMap = {
      id: 'map-existing',
      md5,
      localUrl: '/uploads/canonical.jpg',
      externalUrl: null,
      s3Url: null,
      s3Key: null,
      storageType: 'local',
      thumbnailUrl: null,
      blurhash: null,
      thumbhash: null,
      variantStatus: 'completed',
      cloudSyncStatus: 'completed',
      deletedAt: null,
      retiredAt: null,
    }
    mocks.imageMapFindUnique.mockResolvedValue(imageMap)
    mocks.imageMapUpsert.mockResolvedValue(imageMap)
    mocks.mediaAssetCreate.mockResolvedValue({
      id: 'asset-2',
      imageMapId: imageMap.id,
      publicUrl: imageMap.localUrl,
      storageKey: 'canonical.jpg',
      fileName: 'duplicate.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 16,
      status: 'ready',
    })
    mocks.mediaAssetFindUnique.mockResolvedValue({
      id: 'asset-2',
      imageMapId: imageMap.id,
      publicUrl: imageMap.localUrl,
      storageKey: 'canonical.jpg',
      fileName: 'duplicate.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 16,
      status: 'ready',
    })

    const { createOrReuseUploadedAsset } =
      await import('../../../src/server/services/mediaAssetService')
    const result = await createOrReuseUploadedAsset({
      ownerUid: 'user-2',
      tempFilePath,
      originalFileName: 'duplicate.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 16,
      storageStrategy: 'local',
    })

    expect(result).toMatchObject({ imageMapId: 'map-existing', reused: true })
    await expect(fs.access(tempFilePath)).rejects.toThrow()
    expect(mocks.mediaAssetCreate).toHaveBeenCalledTimes(1)
  })
})
