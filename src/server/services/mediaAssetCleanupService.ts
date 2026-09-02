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

export async function cleanupUnusedMediaAssetById(
  assetId: string
): Promise<MediaAssetCleanupResult> {
  const asset = await prisma.mediaAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      imageMapId: true,
      publicUrl: true,
      storageKey: true,
      status: true,
      imageMap: { select: { localUrl: true, externalUrl: true, s3Url: true, variantStatus: true } },
    },
  })
  if (!asset) {
    return {
      assetId,
      localUrls: [],
      deletedImageMapIds: [],
      deletedOriginalFile: false,
      markedAssetDeleted: false,
      skippedReason: 'asset_not_found',
    }
  }

  try {
    const release = await releaseMediaAsset(asset.id)
    if (!release.released) {
      return {
        assetId,
        localUrls: [asset.publicUrl, asset.imageMap?.localUrl].filter((value): value is string =>
          Boolean(value)
        ),
        deletedImageMapIds: [],
        deletedOriginalFile: false,
        markedAssetDeleted: false,
        skippedReason:
          release.reason === 'still_referenced' ? 'still_referenced' : 'asset_not_found',
      }
    }
    return {
      assetId,
      localUrls: [asset.publicUrl, asset.imageMap?.localUrl].filter((value): value is string =>
        Boolean(value)
      ),
      deletedImageMapIds: [],
      deletedOriginalFile: false,
      markedAssetDeleted: asset.status !== 'deleted',
    }
  } catch (error) {
    logger.error({ err: error, assetId }, 'Failed to release media asset')
    throw error
  }
}

export async function cleanupUntrackedUploadImageByUrl(
  url: string
): Promise<MediaAssetCleanupResult> {
  const asset = await prisma.mediaAsset.findFirst({
    where: { OR: [{ publicUrl: url }, { storageKey: url }], status: { not: 'deleted' } },
    select: { id: true },
  })
  if (asset) return cleanupUnusedMediaAssetById(asset.id)

  const imageMap = await prisma.imageMap.findFirst({
    where: { OR: [{ localUrl: url }, { s3Url: url }, { externalUrl: url }] },
    select: {
      id: true,
      md5: true,
      localUrl: true,
      s3Url: true,
      externalUrl: true,
      variantStatus: true,
    },
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
    const locked = await tx.imageMap.findUnique({ where: { id: imageMap.id } })
    if (!locked) return { skippedReason: 'asset_not_found' as const }
    const [activeClaims, references] = await Promise.all([
      tx.mediaAsset.count({
        where: { imageMapId: locked.id, status: { in: ['uploaded', 'ready'] } },
      }),
      collectMediaReferences(),
    ])
    if (locked.variantStatus === 'processing') return { skippedReason: 'processing' as const }
    if (
      activeClaims > 0 ||
      isMediaReferenced(references, {
        urls: [locked.localUrl, locked.s3Url, locked.externalUrl],
      })
    ) {
      return {
        skippedReason:
          activeClaims > 0 ? ('shared_image_map' as const) : ('still_referenced' as const),
      }
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
