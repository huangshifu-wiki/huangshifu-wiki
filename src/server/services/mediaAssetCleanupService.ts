import { prisma } from '../prisma';
import {
  buildUploadPublicUrl,
  logger,
  safeDeleteUploadFileByStorageKey,
  safeDeleteUploadFileByUrl,
} from '../utils';
import { CleanupTrigger, variantCleanup } from './variantCleanup.service';

export interface MediaAssetCleanupResult {
  assetId?: string;
  localUrls: string[];
  deletedImageMapIds: string[];
  deletedOriginalFile: boolean;
  markedAssetDeleted: boolean;
  skippedReason?: 'asset_not_found' | 'still_referenced' | 'shared_image_map' | 'processing';
}

type MediaAssetRecord = {
  id: string;
  storageKey: string;
  publicUrl: string;
};

function uniqueValues(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function getAssetLocalUrls(asset: Pick<MediaAssetRecord, 'storageKey' | 'publicUrl'>) {
  return uniqueValues([
    asset.publicUrl,
    buildUploadPublicUrl(asset.storageKey),
  ]);
}

async function countStructuredMediaAssetReferences(assetId: string) {
  const [galleryImages, songCovers, albumCovers] = await Promise.all([
    prisma.galleryImage.count({ where: { assetId } }),
    prisma.songCover.count({ where: { assetId } }),
    prisma.albumCover.count({ where: { assetId } }),
  ]);

  return galleryImages + songCovers + albumCovers;
}

async function cleanupImageMapsByLocalUrls(localUrls: string[], assetId?: string) {
  if (localUrls.length === 0) {
    return { deletedImageMapIds: [], skippedShared: false, skippedProcessing: false };
  }

  const imageMaps = await prisma.imageMap.findMany({
    where: { localUrl: { in: localUrls } },
    select: { id: true, localUrl: true },
  });

  const deletedImageMapIds: string[] = [];
  let skippedShared = false;
  let skippedProcessing = false;

  for (const imageMap of imageMaps) {
    const otherAssetCount = await prisma.mediaAsset.count({
      where: {
        publicUrl: imageMap.localUrl,
        status: { not: 'deleted' },
        ...(assetId ? { id: { not: assetId } } : {}),
      },
    });

    if (otherAssetCount > 0) {
      skippedShared = true;
      continue;
    }

    try {
      const cleanupResult = await variantCleanup.cleanupByImageMapId(
        imageMap.id,
        CleanupTrigger.ON_DELETE
      );

      if (cleanupResult.skipped) {
        skippedProcessing = cleanupResult.skippedReason === 'processing';
        continue;
      }

      await prisma.imageMap.delete({ where: { id: imageMap.id } });
      deletedImageMapIds.push(imageMap.id);
    } catch (error) {
      logger.error({ err: error, imageMapId: imageMap.id }, 'ImageMap cleanup failed');
    }
  }

  return { deletedImageMapIds, skippedShared, skippedProcessing };
}

export async function cleanupUnusedMediaAssetById(
  assetId: string
): Promise<MediaAssetCleanupResult> {
  const asset = await prisma.mediaAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      storageKey: true,
      publicUrl: true,
    },
  });

  if (!asset) {
    return {
      assetId,
      localUrls: [],
      deletedImageMapIds: [],
      deletedOriginalFile: false,
      markedAssetDeleted: false,
      skippedReason: 'asset_not_found',
    };
  }

  const referenceCount = await countStructuredMediaAssetReferences(asset.id);
  const localUrls = getAssetLocalUrls(asset);

  if (referenceCount > 0) {
    return {
      assetId: asset.id,
      localUrls,
      deletedImageMapIds: [],
      deletedOriginalFile: false,
      markedAssetDeleted: false,
      skippedReason: 'still_referenced',
    };
  }

  await safeDeleteUploadFileByStorageKey(asset.storageKey);

  const imageMapCleanup = await cleanupImageMapsByLocalUrls(localUrls, asset.id);

  await prisma.mediaAsset.update({
    where: { id: asset.id },
    data: { status: 'deleted' },
  });

  return {
    assetId: asset.id,
    localUrls,
    deletedImageMapIds: imageMapCleanup.deletedImageMapIds,
    deletedOriginalFile: true,
    markedAssetDeleted: true,
    skippedReason: imageMapCleanup.skippedProcessing
      ? 'processing'
      : imageMapCleanup.skippedShared
        ? 'shared_image_map'
        : undefined,
  };
}

export async function cleanupUntrackedUploadImageByUrl(
  url: string
): Promise<MediaAssetCleanupResult> {
  await safeDeleteUploadFileByUrl(url);

  const imageMapCleanup = await cleanupImageMapsByLocalUrls([url]);

  return {
    localUrls: [url],
    deletedImageMapIds: imageMapCleanup.deletedImageMapIds,
    deletedOriginalFile: true,
    markedAssetDeleted: false,
    skippedReason: imageMapCleanup.skippedProcessing
      ? 'processing'
      : imageMapCleanup.skippedShared
        ? 'shared_image_map'
        : undefined,
  };
}
