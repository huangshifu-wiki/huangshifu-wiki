import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMediaAssetFindUnique = vi.fn();
const mockMediaAssetCount = vi.fn();
const mockMediaAssetUpdate = vi.fn();
const mockGalleryImageCount = vi.fn();
const mockSongCoverCount = vi.fn();
const mockAlbumCoverCount = vi.fn();
const mockImageMapFindMany = vi.fn();
const mockImageMapDelete = vi.fn();
const mockSafeDeleteUploadFileByStorageKey = vi.fn();
const mockSafeDeleteUploadFileByUrl = vi.fn();
const mockVariantCleanupByImageMapId = vi.fn();

vi.mock('../../../src/server/prisma', () => ({
  prisma: {
    mediaAsset: {
      findUnique: mockMediaAssetFindUnique,
      count: mockMediaAssetCount,
      update: mockMediaAssetUpdate,
    },
    galleryImage: {
      count: mockGalleryImageCount,
    },
    songCover: {
      count: mockSongCoverCount,
    },
    albumCover: {
      count: mockAlbumCoverCount,
    },
    imageMap: {
      findMany: mockImageMapFindMany,
      delete: mockImageMapDelete,
    },
  },
}));

vi.mock('../../../src/server/utils', () => ({
  buildUploadPublicUrl: (storageKey: string) => `/uploads/${storageKey}`,
  safeDeleteUploadFileByStorageKey: mockSafeDeleteUploadFileByStorageKey,
  safeDeleteUploadFileByUrl: mockSafeDeleteUploadFileByUrl,
}));

vi.mock('../../../src/server/services/variantCleanup.service', () => ({
  CleanupTrigger: {
    ON_DELETE: 'on_delete',
  },
  variantCleanup: {
    cleanupByImageMapId: mockVariantCleanupByImageMapId,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();

  mockMediaAssetFindUnique.mockResolvedValue({
    id: 'asset-1',
    storageKey: 'galleries/test.jpg',
    publicUrl: '/uploads/galleries/test.jpg',
  });
  mockGalleryImageCount.mockResolvedValue(0);
  mockSongCoverCount.mockResolvedValue(0);
  mockAlbumCoverCount.mockResolvedValue(0);
  mockMediaAssetCount.mockResolvedValue(0);
  mockImageMapFindMany.mockResolvedValue([{ id: 'image-map-1', localUrl: '/uploads/galleries/test.jpg' }]);
  mockImageMapDelete.mockResolvedValue({ id: 'image-map-1' });
  mockMediaAssetUpdate.mockResolvedValue({ id: 'asset-1', status: 'deleted' });
  mockSafeDeleteUploadFileByStorageKey.mockResolvedValue(undefined);
  mockSafeDeleteUploadFileByUrl.mockResolvedValue(undefined);
  mockVariantCleanupByImageMapId.mockResolvedValue({ success: true });
});

describe('mediaAssetCleanupService', () => {
  it('资产仍被业务引用时不删除原图和变体', async () => {
    mockGalleryImageCount.mockResolvedValue(1);

    const { cleanupUnusedMediaAssetById } = await import(
      '../../../src/server/services/mediaAssetCleanupService'
    );

    const result = await cleanupUnusedMediaAssetById('asset-1');

    expect(result.skippedReason).toBe('still_referenced');
    expect(mockSafeDeleteUploadFileByStorageKey).not.toHaveBeenCalled();
    expect(mockVariantCleanupByImageMapId).not.toHaveBeenCalled();
    expect(mockImageMapDelete).not.toHaveBeenCalled();
    expect(mockMediaAssetUpdate).not.toHaveBeenCalled();
  });

  it('资产无人引用时删除本地原图、变体、ImageMap，并标记资产已删除', async () => {
    const { cleanupUnusedMediaAssetById } = await import(
      '../../../src/server/services/mediaAssetCleanupService'
    );

    const result = await cleanupUnusedMediaAssetById('asset-1');

    expect(result.deletedImageMapIds).toEqual(['image-map-1']);
    expect(result.markedAssetDeleted).toBe(true);
    expect(mockSafeDeleteUploadFileByStorageKey).toHaveBeenCalledWith('galleries/test.jpg');
    expect(mockVariantCleanupByImageMapId).toHaveBeenCalledWith('image-map-1', 'on_delete');
    expect(mockImageMapDelete).toHaveBeenCalledWith({ where: { id: 'image-map-1' } });
    expect(mockMediaAssetUpdate).toHaveBeenCalledWith({
      where: { id: 'asset-1' },
      data: { status: 'deleted' },
    });
  });

  it('变体正在生成时保留 ImageMap，等待后续清理', async () => {
    mockVariantCleanupByImageMapId.mockResolvedValue({
      success: false,
      skipped: true,
      skippedReason: 'processing',
    });

    const { cleanupUnusedMediaAssetById } = await import(
      '../../../src/server/services/mediaAssetCleanupService'
    );

    const result = await cleanupUnusedMediaAssetById('asset-1');

    expect(result.skippedReason).toBe('processing');
    expect(mockSafeDeleteUploadFileByStorageKey).toHaveBeenCalledWith('galleries/test.jpg');
    expect(mockVariantCleanupByImageMapId).toHaveBeenCalledWith('image-map-1', 'on_delete');
    expect(mockImageMapDelete).not.toHaveBeenCalled();
    expect(mockMediaAssetUpdate).toHaveBeenCalledWith({
      where: { id: 'asset-1' },
      data: { status: 'deleted' },
    });
  });
});
