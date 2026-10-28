import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockReleaseMediaAsset = vi.hoisted(() => vi.fn())
const mockCollectMediaReferences = vi.hoisted(() => vi.fn())
const mockIsMediaReferenced = vi.hoisted(() => vi.fn())
const mockMediaAssetFindUnique = vi.hoisted(() => vi.fn())
const mockMediaAssetFindFirst = vi.hoisted(() => vi.fn())
const mockImageMapFindFirst = vi.hoisted(() => vi.fn())
const mockImageMapFindUnique = vi.hoisted(() => vi.fn())
const mockImageMapUpdateMany = vi.hoisted(() => vi.fn())
const mockMediaAssetCount = vi.hoisted(() => vi.fn())
const mockExecuteRaw = vi.hoisted(() => vi.fn())
const mockTransaction = vi.hoisted(() => vi.fn())
const mockGetMediaRetiredAt = vi.hoisted(() => vi.fn(() => new Date()))

vi.mock('../../../src/server/services/mediaAssetService', () => ({
  releaseMediaAsset: mockReleaseMediaAsset,
  collectMediaReferences: mockCollectMediaReferences,
  isMediaReferenced: mockIsMediaReferenced,
  getMediaRetiredAt: mockGetMediaRetiredAt,
}))

const mockPrisma = {
  mediaAsset: {
    findUnique: mockMediaAssetFindUnique,
    findFirst: mockMediaAssetFindFirst,
    count: mockMediaAssetCount,
  },
  imageMap: {
    findFirst: mockImageMapFindFirst,
    findUnique: mockImageMapFindUnique,
    updateMany: mockImageMapUpdateMany,
  },
  $executeRaw: mockExecuteRaw,
  $transaction: mockTransaction,
}

vi.mock('../../../src/server/prisma', () => ({ prisma: mockPrisma }))

beforeEach(() => {
  vi.clearAllMocks()
  mockReleaseMediaAsset.mockResolvedValue({
    released: true,
    imageMapId: 'map-1',
    localUrls: ['/uploads/gallery/test.jpg'],
    markedAssetDeleted: true,
  })
  mockCollectMediaReferences.mockResolvedValue({
    assetIds: new Set(),
    imageMapIds: new Set(),
    urls: new Set(),
    storageKeys: new Set(),
  })
  mockIsMediaReferenced.mockReturnValue(false)
  mockMediaAssetFindUnique.mockResolvedValue({
    id: 'asset-1',
    imageMapId: 'map-1',
    storageKey: 'gallery/test.jpg',
    publicUrl: '/uploads/gallery/test.jpg',
    status: 'ready',
    imageMap: {
      localUrl: '/uploads/gallery/test.jpg',
      s3Url: null,
      externalUrl: null,
      variantStatus: 'completed',
    },
  })
  mockMediaAssetFindFirst.mockResolvedValue(null)
  mockImageMapFindFirst.mockResolvedValue(null)
  mockImageMapFindUnique.mockResolvedValue({
    id: 'map-1',
    md5: '0123456789abcdef0123456789abcdef',
    localUrl: '/uploads/legacy.jpg',
    s3Url: null,
    externalUrl: null,
    variantStatus: 'completed',
  })
  mockMediaAssetCount.mockResolvedValue(0)
  mockImageMapUpdateMany.mockResolvedValue({ count: 1 })
  mockTransaction.mockImplementation(async (callback) =>
    callback({
      $executeRaw: mockExecuteRaw,
      mediaAsset: { count: mockMediaAssetCount },
      imageMap: {
        findUnique: mockImageMapFindUnique,
        updateMany: mockImageMapUpdateMany,
      },
    })
  )
})

describe('mediaAssetCleanupService', () => {
  it('只释放逻辑 claim，不立即删除共享物理媒体', async () => {
    const { cleanupUnusedMediaAssetById } =
      await import('../../../src/server/services/mediaAssetCleanupService')

    const result = await cleanupUnusedMediaAssetById('asset-1')

    expect(mockReleaseMediaAsset).toHaveBeenCalledWith('asset-1')
    expect(result).toMatchObject({
      assetId: 'asset-1',
      markedAssetDeleted: true,
      deletedOriginalFile: false,
      deletedImageMapIds: [],
    })
  })

  it('找不到 claim 时不登记物理删除', async () => {
    mockReleaseMediaAsset.mockResolvedValueOnce({
      released: false,
      reason: 'asset_not_found',
      localUrls: [],
      markedAssetDeleted: false,
    })
    const { cleanupUnusedMediaAssetById } =
      await import('../../../src/server/services/mediaAssetCleanupService')

    const result = await cleanupUnusedMediaAssetById('missing')

    expect(result.skippedReason).toBe('asset_not_found')
    expect(mockReleaseMediaAsset).toHaveBeenCalledWith('missing')
  })

  it('重复释放已删除 claim 保持幂等', async () => {
    mockReleaseMediaAsset.mockResolvedValueOnce({
      released: true,
      imageMapId: 'map-1',
      localUrls: [],
      markedAssetDeleted: false,
    })
    const { cleanupUnusedMediaAssetById } =
      await import('../../../src/server/services/mediaAssetCleanupService')

    const result = await cleanupUnusedMediaAssetById('asset-1')

    expect(mockReleaseMediaAsset).toHaveBeenCalledWith('asset-1')
    expect(result.markedAssetDeleted).toBe(false)
  })

  it('无 claim 的历史 URL 仅登记延迟回收', async () => {
    mockImageMapFindFirst.mockResolvedValue({
      id: 'map-1',
      localUrl: '/uploads/legacy.jpg',
      s3Url: null,
      externalUrl: null,
      variantStatus: 'completed',
    })
    const { cleanupUntrackedUploadImageByUrl } =
      await import('../../../src/server/services/mediaAssetCleanupService')

    const result = await cleanupUntrackedUploadImageByUrl('/uploads/legacy.jpg')

    expect(result).toMatchObject({ deletedOriginalFile: false, deletedImageMapIds: [] })
    expect(mockImageMapUpdateMany).toHaveBeenCalledWith({
      where: { id: 'map-1', retiredAt: null },
      data: { retiredAt: expect.any(Date) },
    })
  })
})
