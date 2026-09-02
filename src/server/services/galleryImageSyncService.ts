import { prisma } from '../prisma'
import { resolveUploadPathByUrl } from '../utils/upload'
import { resolveUploadPathByStorageKey } from '../uploadPath'
import { uploadsDir } from '../utils/config'
import { syncAssetToImageMap } from './mediaAssetService'
import { variantGenerator } from './variantGenerator'

/**
 * 历史 URL 同步入口。新上传不经过这里；没有 MediaAsset 的历史记录交由 reconcile 脚本处理。
 */
export async function syncGalleryImageToImageMap(publicUrl: string, storageKey: string) {
  const existing = await prisma.imageMap.findFirst({ where: { localUrl: publicUrl } })
  if (existing) return existing.id

  const asset = await prisma.mediaAsset.findFirst({
    where: {
      status: 'ready',
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

  const imageMap = await prisma.imageMap.findUnique({
    where: { id: imageMapId },
    select: { id: true, localUrl: true, thumbnailUrl: true, variantStatus: true },
  })
  if (!imageMap || imageMap.thumbnailUrl || imageMap.variantStatus === 'completed')
    return imageMapId
  const filePath =
    resolveUploadPathByUrl(imageMap.localUrl) ||
    resolveUploadPathByStorageKey(storageKey, uploadsDir)
  if (!filePath) return imageMapId
  await variantGenerator.enqueue({
    targetType: 'imageMap',
    targetId: imageMap.id,
    localFilePath: filePath,
    priority: 'normal',
  })
  return imageMapId
}

export async function batchSyncGalleryImagesToImageMap(
  images: Array<{ publicUrl: string; storageKey: string }>
) {
  let successCount = 0
  for (const image of images) {
    if (await syncGalleryImageToImageMap(image.publicUrl, image.storageKey)) successCount++
  }
  return successCount
}

export async function syncMediaAssetToImageMap(assetId: string) {
  try {
    return await syncAssetToImageMap(assetId)
  } catch (error) {
    console.error('[GalleryImageSync] 同步 MediaAsset 失败:', error)
    return null
  }
}

export async function syncAllMediaAssetsToImageMap() {
  const assets = await prisma.mediaAsset.findMany({
    where: { status: 'ready', imageMapId: null },
    select: { id: true },
  })
  const result = { total: assets.length, success: 0, failed: 0, errors: [] as string[] }
  for (const asset of assets) {
    try {
      if (await syncMediaAssetToImageMap(asset.id)) result.success++
      else {
        result.failed++
        result.errors.push(`同步失败: ${asset.id}`)
      }
    } catch (error) {
      result.failed++
      result.errors.push(
        `同步失败 ${asset.id}: ${error instanceof Error ? error.message : '未知错误'}`
      )
    }
  }
  return result
}
