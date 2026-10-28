import { prisma } from '../prisma'
import { Prisma } from '@prisma/client'
import {
  collectMediaReferences,
  getMediaRetiredAt,
  isMediaReferenced,
  releaseMediaAsset,
} from './mediaAssetService'
import { logger } from '../utils/logger'

export interface MediaAssetCleanupResult {
  assetId?: string
  localUrls: string[]
  deletedImageMapIds: string[]
  deletedOriginalFile: boolean
  markedAssetDeleted: boolean
  skippedReason?: 'asset_not_found' | 'still_referenced' | 'shared_image_map' | 'processing'
}
const CLEANUP_ASSET_SELECT = { id: true } as const
type CleanupAsset = Prisma.MediaAssetGetPayload<{ select: typeof CLEANUP_ASSET_SELECT }>

async function releaseLoadedMediaAsset(asset: CleanupAsset): Promise<MediaAssetCleanupResult> {
  try {
    const release = await releaseMediaAsset(asset.id)
    const localUrls = release.localUrls
    if (!release.released) {
      return {
        assetId: asset.id,
        localUrls,
        deletedImageMapIds: [],
        deletedOriginalFile: false,
        markedAssetDeleted: false,
        skippedReason:
          release.reason === 'still_referenced' ? 'still_referenced' : 'asset_not_found',
      }
    }
    return {
      assetId: asset.id,
      localUrls,
      deletedImageMapIds: [],
      deletedOriginalFile: false,
      markedAssetDeleted: release.markedAssetDeleted,
    }
  } catch (error) {
    logger.error({ err: error, assetId: asset.id }, 'Failed to release media asset')
    throw error
  }
}

export async function cleanupUnusedMediaAssetById(
  assetId: string
): Promise<MediaAssetCleanupResult> {
  return releaseLoadedMediaAsset({ id: assetId })
}
export async function cleanupUntrackedUploadImageByUrl(
  url: string
): Promise<MediaAssetCleanupResult> {
  const asset = await prisma.mediaAsset.findFirst({
    where: { OR: [{ publicUrl: url }, { storageKey: url }], status: { not: 'deleted' } },
    select: CLEANUP_ASSET_SELECT,
  })
  if (asset) return releaseLoadedMediaAsset(asset)

  const imageMap = await prisma.imageMap.findFirst({
    where: { OR: [{ localUrl: url }, { s3Url: url }, { externalUrl: url }] },
    select: { id: true, md5: true },
  })
  if (!imageMap) {
    return {
      localUrls: [url],
      deletedImageMapIds: [],
      deletedOriginalFile: false,
      markedAssetDeleted: false,
      skippedReason: 'asset_not_found',
    }
  }

  const cleanup = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${imageMap.md5}, 0))`
    )
    const locked = await tx.imageMap.findUnique({
      where: { id: imageMap.id },
      select: {
        id: true,
        localUrl: true,
        s3Url: true,
        externalUrl: true,
        variantStatus: true,
      },
    })
    if (!locked) return { skippedReason: 'asset_not_found' as const }
    if (locked.variantStatus === 'processing') return { skippedReason: 'processing' as const }
    const activeClaims = await tx.mediaAsset.count({
      where: { imageMapId: locked.id, status: { in: ['uploaded', 'ready'] } },
    })
    if (activeClaims > 0) return { skippedReason: 'shared_image_map' as const }

    const references = await collectMediaReferences()
    if (
      isMediaReferenced(references, {
        imageMapId: locked.id,
        urls: [locked.localUrl, locked.s3Url, locked.externalUrl],
      })
    ) {
      return { skippedReason: 'still_referenced' as const }
    }
    await tx.imageMap.updateMany({
      where: { id: locked.id, retiredAt: null },
      data: { retiredAt: getMediaRetiredAt() },
    })
    return { skippedReason: undefined }
  })
  if (cleanup.skippedReason) {
    return {
      localUrls: [url],
      deletedImageMapIds: [],
      deletedOriginalFile: false,
      markedAssetDeleted: false,
      skippedReason: cleanup.skippedReason,
    }
  }
  return {
    localUrls: [url],
    deletedImageMapIds: [],
    deletedOriginalFile: false,
    markedAssetDeleted: false,
  }
}
