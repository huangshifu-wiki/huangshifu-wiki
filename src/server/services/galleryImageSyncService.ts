import fs from 'node:fs/promises'
import type { PrismaClient } from '@prisma/client'

import { prisma } from '../prisma'
import {
  buildUploadPublicUrl,
  extractStorageKeyFromUploadUrl,
  resolveUploadPathByStorageKey,
} from '../uploadPath'
import { uploadsDir } from '../utils/config'
import { lockImageContent, lockImageMap, syncAssetToImageMap } from './mediaAssetService'
import { variantGenerator } from './variantGenerator'

export type ImageMapThumbnailRepairResult = {
  imageMapId: string
  status:
    | 'queued'
    | 'already-queued'
    | 'already-complete'
    | 'missing-source'
    | 'not-found'
    | 'deleted'
    | 'failed'
  sourcePath?: string
  reason?: string
}

type ThumbnailRepairOptions = {
  fallbackStorageKeys?: string[]
  mode?: 'dry-run' | 'apply'
  client?: PrismaClient
  uploadDir?: string
}

type ThumbnailSnapshot =
  | { status: 'not-found' | 'deleted'; imageMapId: string; reason: string }
  | {
      status: 'candidate'
      imageMapId: string
      md5: string
      localUrl: string
      thumbnailUrl: string | null
      variantStatus: string
      claimStorageKeys: string[]
      claimPublicUrls: string[]
    }

type ClaimedVariantTask = {
  targetType: 'imageMap'
  targetId: string
  localFilePath: string
  priority: 'high' | 'normal' | 'low'
}

async function enqueueClaimedImageMapTask(task: ClaimedVariantTask) {
  const generator = variantGenerator as typeof variantGenerator & {
    enqueueClaimed?: (value: ClaimedVariantTask) => Promise<boolean>
  }
  // Older test doubles and embedders only expose enqueue. Production uses the
  // database-claimed entry point so a second process cannot claim the row.
  return generator.enqueueClaimed ? generator.enqueueClaimed(task) : generator.enqueue(task)
}
function resolveSourcePaths(url: string | null, uploadRoot: string) {
  if (!url) return [] as Array<string | null>
  const storageKey = extractStorageKeyFromUploadUrl(url)
  return storageKey ? [resolveUploadPathByStorageKey(storageKey, uploadRoot)] : []
}

async function findReadableSource(candidates: Array<string | null>) {
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const stat = await fs.stat(candidate)
      if (stat.isFile()) return candidate
    } catch {
      // Continue through the canonical URL and claim fallbacks.
    }
  }
  return null
}

function uniqueValues(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}
const thumbnailRepairFlights = new Map<string, Promise<ImageMapThumbnailRepairResult>>()

async function readThumbnailSnapshot(
  imageMapId: string,
  client: PrismaClient
): Promise<ThumbnailSnapshot> {
  return client.$transaction(async (tx) => {
    let imageMap = await tx.imageMap.findUnique({
      where: { id: imageMapId },
      select: {
        id: true,
        md5: true,
        localUrl: true,
        thumbnailUrl: true,
        variantStatus: true,
        deletedAt: true,
      },
    })
    if (!imageMap) {
      return { status: 'not-found', imageMapId, reason: 'ImageMap 不存在' }
    }
    if (imageMap.deletedAt) {
      return { status: 'deleted', imageMapId, reason: 'ImageMap 已删除' }
    }

    await lockImageContent(tx, imageMap.md5)
    await lockImageMap(tx, imageMap.id)
    imageMap = await tx.imageMap.findUnique({
      where: { id: imageMapId },
      select: {
        id: true,
        md5: true,
        localUrl: true,
        thumbnailUrl: true,
        variantStatus: true,
        deletedAt: true,
      },
    })
    if (!imageMap) {
      return { status: 'not-found', imageMapId, reason: 'ImageMap 不存在' }
    }
    if (imageMap.deletedAt) {
      return { status: 'deleted', imageMapId, reason: 'ImageMap 已删除' }
    }

    const claims = await tx.mediaAsset.findMany({
      where: {
        imageMapId,
        status: { in: ['uploaded', 'ready'] },
      },
      select: { storageKey: true, publicUrl: true },
      orderBy: { id: 'asc' },
    })
    return {
      status: 'candidate',
      imageMapId: imageMap.id,
      md5: imageMap.md5,
      localUrl: imageMap.localUrl,
      thumbnailUrl: imageMap.thumbnailUrl,
      variantStatus: imageMap.variantStatus,
      claimStorageKeys: claims.map((claim) => claim.storageKey),
      claimPublicUrls: claims.map((claim) => claim.publicUrl),
    }
  })
}

async function repairMissingImageMapThumbnail(
  imageMapId: string,
  options: Required<Pick<ThumbnailRepairOptions, 'mode'>> & Omit<ThumbnailRepairOptions, 'mode'>
): Promise<ImageMapThumbnailRepairResult> {
  const client = options.client || prisma
  const snapshot = await readThumbnailSnapshot(imageMapId, client)
  if (snapshot.status !== 'candidate') return snapshot
  if (snapshot.thumbnailUrl) {
    return { imageMapId, status: 'already-complete', reason: '已有缩略图' }
  }
  if (snapshot.variantStatus === 'processing' || variantGenerator.hasTask('imageMap', imageMapId)) {
    return { imageMapId, status: 'already-queued', reason: '任务已入队或正在处理' }
  }

  const uploadRoot = options.uploadDir || uploadsDir
  const sourcePaths = uniqueValues([
    ...resolveSourcePaths(snapshot.localUrl, uploadRoot),
    ...(options.fallbackStorageKeys || []).flatMap((key) =>
      key ? resolveSourcePaths(buildUploadPublicUrl(key), uploadRoot) : []
    ),
    ...snapshot.claimStorageKeys.flatMap((key) =>
      key ? resolveSourcePaths(buildUploadPublicUrl(key), uploadRoot) : []
    ),
    ...snapshot.claimPublicUrls.flatMap((url) => resolveSourcePaths(url, uploadRoot)),
  ])
  const sourcePath = await findReadableSource(sourcePaths)
  if (!sourcePath) {
    return { imageMapId, status: 'missing-source', reason: '没有可读的本地原图' }
  }
  if (options.mode === 'dry-run') {
    return { imageMapId, status: 'queued', sourcePath, reason: 'dry-run 候选' }
  }

  // The processing state is the cross-process claim. Keep the row lock only
  // for this short transition; file I/O and queue processing happen after it.
  const claimed = await client.$transaction(async (tx) => {
    await lockImageContent(tx, snapshot.md5)
    await lockImageMap(tx, imageMapId)
    const updated = await tx.imageMap.updateMany({
      where: {
        id: imageMapId,
        deletedAt: null,
        thumbnailUrl: null,
        variantStatus: { in: ['pending', 'failed', 'completed'] },
      },
      data: { variantStatus: 'processing' },
    })
    return updated.count === 1
  })
  if (!claimed) {
    const current = await client.imageMap.findUnique({
      where: { id: imageMapId },
      select: { thumbnailUrl: true, variantStatus: true, deletedAt: true },
    })
    if (!current || current.deletedAt) {
      return { imageMapId, status: 'deleted', reason: 'ImageMap 已被删除' }
    }
    if (current.thumbnailUrl) {
      return { imageMapId, status: 'already-complete', reason: '已有缩略图' }
    }
    if (
      current.variantStatus === 'processing' ||
      variantGenerator.hasTask('imageMap', imageMapId)
    ) {
      return { imageMapId, status: 'already-queued', reason: '任务已入队或正在处理' }
    }
    return { imageMapId, status: 'failed', reason: '状态已被并发操作修改' }
  }

  try {
    const accepted = await enqueueClaimedImageMapTask({
      targetType: 'imageMap',
      targetId: imageMapId,
      localFilePath: sourcePath,
      priority: 'low',
    })
    if (!accepted) {
      return { imageMapId, status: 'already-queued', sourcePath, reason: '任务已入队' }
    }
    return { imageMapId, status: 'queued', sourcePath }
  } catch (error) {
    await client.imageMap
      .updateMany({
        where: { id: imageMapId, deletedAt: null, thumbnailUrl: null, variantStatus: 'processing' },
        data: { variantStatus: 'failed' },
      })
      .catch(() => undefined)
    return {
      imageMapId,
      status: 'failed',
      sourcePath,
      reason: error instanceof Error ? error.message : '缩略图任务入队失败',
    }
  }
}

export function enqueueMissingImageMapThumbnail(
  imageMapId: string,
  options: ThumbnailRepairOptions = {}
): Promise<ImageMapThumbnailRepairResult> {
  const mode = options.mode || 'apply'
  const fallbackStorageKeys = [...(options.fallbackStorageKeys || [])].sort()
  const flightKey = `${mode}:${imageMapId}:${options.uploadDir || uploadsDir}:${fallbackStorageKeys.join('|')}`
  const existing = thumbnailRepairFlights.get(flightKey)
  if (existing) return existing

  const promise = repairMissingImageMapThumbnail(imageMapId, {
    ...options,
    mode,
    fallbackStorageKeys,
  })
  thumbnailRepairFlights.set(flightKey, promise)
  void promise
    .finally(() => {
      if (thumbnailRepairFlights.get(flightKey) === promise) {
        thumbnailRepairFlights.delete(flightKey)
      }
    })
    .catch(() => undefined)
  return promise
}

export async function syncGalleryImageToImageMap(publicUrl: string, storageKey: string) {
  const existing = await prisma.imageMap.findFirst({
    where: { localUrl: publicUrl, deletedAt: null },
    select: { id: true },
  })
  if (existing) return existing.id

  const asset = await prisma.mediaAsset.findFirst({
    where: {
      status: { in: ['uploaded', 'ready'] },
      OR: [{ publicUrl }, { storageKey }],
    },
    select: { id: true },
  })
  return asset ? syncAssetToImageMap(asset.id) : null
}

export async function syncGalleryImageToImageMapWithVariant(
  publicUrl: string,
  storageKey: string
): Promise<string | null> {
  const imageMapId = await syncGalleryImageToImageMap(publicUrl, storageKey)
  if (!imageMapId) return null
  await enqueueMissingImageMapThumbnail(imageMapId, {
    fallbackStorageKeys: [storageKey],
  })
  return imageMapId
}

export async function batchSyncGalleryImagesToImageMap(
  images: Array<{ publicUrl: string; storageKey: string }>
) {
  let successCount = 0
  for (const image of images) {
    if (await syncGalleryImageToImageMapWithVariant(image.publicUrl, image.storageKey)) {
      successCount++
    }
  }
  return successCount
}

export type SyncMediaAssetsBatchResult = {
  total: number
  success: number
  failed: number
  errors: string[]
  nextCursor: string | null
  hasMore: boolean
  details: Array<{ id: string; status: 'processed' | 'skipped' | 'failed'; reason?: string }>
}

export async function syncAllMediaAssetsToImageMap(
  options: {
    cursor?: string
    batchSize?: number
    mode?: 'dry-run' | 'apply'
    client?: PrismaClient
    uploadDir?: string
  } = {}
): Promise<SyncMediaAssetsBatchResult> {
  const client = options.client || prisma
  const uploadRoot = options.uploadDir || uploadsDir
  const limit = Math.max(1, Math.min(Math.floor(options.batchSize || 100), 100))
  const mode = options.mode || 'apply'
  const assets = await client.mediaAsset.findMany({
    where: {
      status: { not: 'deleted' },
      imageMapId: null,
      ...(options.cursor ? { id: { gt: options.cursor } } : {}),
    },
    select: { id: true, storageKey: true },
    orderBy: { id: 'asc' },
    take: limit + 1,
  })
  const page = assets.slice(0, limit)
  const details: SyncMediaAssetsBatchResult['details'] = []
  let success = 0
  let failed = 0

  for (const asset of page) {
    if (mode === 'dry-run') {
      details.push({ id: asset.id, status: 'processed', reason: '待绑定和缩略图修复' })
      success++
      continue
    }
    try {
      const imageMapId = await syncAssetToImageMap(asset.id, client)
      if (!imageMapId) {
        details.push({ id: asset.id, status: 'skipped', reason: '无法绑定 ImageMap' })
        continue
      }
      const repair = await enqueueMissingImageMapThumbnail(imageMapId, {
        client,
        uploadDir: uploadRoot,
        mode,
        fallbackStorageKeys: asset.storageKey ? [asset.storageKey] : [],
      })
      if (repair.status === 'failed' || repair.status === 'missing-source') {
        failed++
        details.push({ id: asset.id, status: 'failed', reason: repair.reason })
      } else {
        success++
        details.push({ id: asset.id, status: 'processed', reason: repair.status })
      }
    } catch (error) {
      failed++
      details.push({
        id: asset.id,
        status: 'failed',
        reason: error instanceof Error ? error.message : '同步失败',
      })
    }
  }

  return {
    total: page.length,
    success,
    failed,
    errors: details
      .filter((detail) => detail.status === 'failed')
      .map((detail) => `${detail.id}: ${detail.reason || '同步失败'}`),
    nextCursor: page.length ? page[page.length - 1].id : options.cursor || null,
    hasMore: assets.length > limit,
    details,
  }
}
