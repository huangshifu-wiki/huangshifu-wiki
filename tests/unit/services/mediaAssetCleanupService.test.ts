import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockMediaAssetFindUnique = vi.fn()
const mockMediaAssetFindMany = vi.fn()
const mockMediaAssetUpdate = vi.fn()
const mockGalleryImageFindFirst = vi.fn()
const mockEventFindFirst = vi.fn()
const mockEventPosterFindFirst = vi.fn()
const mockSongCoverFindFirst = vi.fn()
const mockAlbumCoverFindFirst = vi.fn()
const mockImageMapFindMany = vi.fn()
const mockImageMapUpdate = vi.fn()
const mockSafeDeleteUploadFileByStorageKey = vi.fn()
const mockSafeDeleteUploadFileByUrl = vi.fn()
const mockVariantCleanupByImageMapId = vi.fn()

vi.mock('../../../src/server/prisma', () => ({
  prisma: {
    mediaAsset: {
      findUnique: mockMediaAssetFindUnique,
      findMany: mockMediaAssetFindMany,
      update: mockMediaAssetUpdate,
    },
    galleryImage: {
      findFirst: mockGalleryImageFindFirst,
    },
    event: {
      findFirst: mockEventFindFirst,
    },
    eventPoster: {
      findFirst: mockEventPosterFindFirst,
    },
    songCover: {
      findFirst: mockSongCoverFindFirst,
    },
    albumCover: {
      findFirst: mockAlbumCoverFindFirst,
    },
    imageMap: {
      findMany: mockImageMapFindMany,
      update: mockImageMapUpdate,
    },
  },
}))

vi.mock('../../../src/server/utils', () => ({
  buildUploadPublicUrl: (storageKey: string) => `/uploads/${storageKey}`,
  safeDeleteUploadFileByStorageKey: mockSafeDeleteUploadFileByStorageKey,
  safeDeleteUploadFileByUrl: mockSafeDeleteUploadFileByUrl,
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../src/server/services/variantCleanup.service', () => ({
  CleanupTrigger: {
    ON_DELETE: 'on_delete',
  },
  variantCleanup: {
    cleanupByImageMapId: mockVariantCleanupByImageMapId,
  },
}))

beforeEach(() => {
  vi.clearAllMocks()

  mockMediaAssetFindUnique.mockResolvedValue({
    id: 'asset-1',
    storageKey: 'galleries/test.jpg',
    publicUrl: '/uploads/galleries/test.jpg',
  })
  mockGalleryImageFindFirst.mockResolvedValue(null)
  mockEventFindFirst.mockResolvedValue(null)
  mockEventPosterFindFirst.mockResolvedValue(null)
  mockSongCoverFindFirst.mockResolvedValue(null)
  mockAlbumCoverFindFirst.mockResolvedValue(null)
  mockMediaAssetFindMany.mockResolvedValue([])
  mockImageMapFindMany.mockResolvedValue([
    { id: 'image-map-1', localUrl: '/uploads/galleries/test.jpg' },
  ])
  mockImageMapUpdate.mockResolvedValue({ id: 'image-map-1' })
  mockMediaAssetUpdate.mockResolvedValue({ id: 'asset-1', status: 'deleted' })
  mockSafeDeleteUploadFileByStorageKey.mockResolvedValue(undefined)
  mockSafeDeleteUploadFileByUrl.mockResolvedValue(undefined)
  mockVariantCleanupByImageMapId.mockResolvedValue({ success: true })
})

describe('mediaAssetCleanupService', () => {
  it('资产仍被业务引用时不删除原图和变体', async () => {
    mockGalleryImageFindFirst.mockResolvedValue({ id: 'gallery-image-1' })

    const { cleanupUnusedMediaAssetById } =
      await import('../../../src/server/services/mediaAssetCleanupService')

    const result = await cleanupUnusedMediaAssetById('asset-1')

    expect(result.skippedReason).toBe('still_referenced')
    expect(mockSafeDeleteUploadFileByStorageKey).not.toHaveBeenCalled()
    expect(mockVariantCleanupByImageMapId).not.toHaveBeenCalled()
    expect(mockMediaAssetUpdate).not.toHaveBeenCalled()
  })

  it('资产被活动封面或海报引用时不删除', async () => {
    mockEventFindFirst.mockResolvedValue({ id: 'event-1' })
    mockEventPosterFindFirst.mockResolvedValue({ id: 'event-poster-1' })

    const { cleanupUnusedMediaAssetById } =
      await import('../../../src/server/services/mediaAssetCleanupService')

    const result = await cleanupUnusedMediaAssetById('asset-1')

    expect(result.skippedReason).toBe('still_referenced')
    expect(mockSafeDeleteUploadFileByStorageKey).not.toHaveBeenCalled()
    expect(mockMediaAssetUpdate).not.toHaveBeenCalled()
  })

  it('资产无人引用时删除本地原图和变体，并软删除 ImageMap、标记资产已删除', async () => {
    const { cleanupUnusedMediaAssetById } =
      await import('../../../src/server/services/mediaAssetCleanupService')

    const result = await cleanupUnusedMediaAssetById('asset-1')

    expect(result.deletedImageMapIds).toEqual(['image-map-1'])
    expect(result.markedAssetDeleted).toBe(true)
    expect(mockSafeDeleteUploadFileByStorageKey).toHaveBeenCalledWith('galleries/test.jpg')
    expect(mockVariantCleanupByImageMapId).toHaveBeenCalledWith('image-map-1', 'on_delete')
    expect(mockImageMapUpdate).toHaveBeenCalledWith({
      where: { id: 'image-map-1' },
      data: { deletedAt: expect.any(Date), deletedBy: null },
    })
    expect(mockMediaAssetUpdate).toHaveBeenCalledWith({
      where: { id: 'asset-1' },
      data: { status: 'deleted' },
    })
  })

  it('变体正在生成时保留 ImageMap，等待后续清理', async () => {
    mockVariantCleanupByImageMapId.mockResolvedValue({
      success: false,
      skipped: true,
      skippedReason: 'processing',
    })

    const { cleanupUnusedMediaAssetById } =
      await import('../../../src/server/services/mediaAssetCleanupService')

    const result = await cleanupUnusedMediaAssetById('asset-1')

    expect(result.skippedReason).toBe('processing')
    expect(mockSafeDeleteUploadFileByStorageKey).toHaveBeenCalledWith('galleries/test.jpg')
    expect(mockVariantCleanupByImageMapId).toHaveBeenCalledWith('image-map-1', 'on_delete')
    expect(mockImageMapUpdate).not.toHaveBeenCalled()
    expect(mockMediaAssetUpdate).toHaveBeenCalledWith({
      where: { id: 'asset-1' },
      data: { status: 'deleted' },
    })
  })
})
