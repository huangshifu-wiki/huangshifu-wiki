import type { DedupOptions } from '../utils/requestDedup'
import type { GalleryImageItem, GalleryItem } from '../types/entities'

export const THUMBNAIL_POLL_INTERVAL_MS = 2000
export const THUMBNAIL_POLL_MAX_ATTEMPTS = 300
export const THUMBNAIL_POLL_DEDUP_OPTIONS: DedupOptions = {
  staleTime: 0,
  swr: false,
  swrCooldown: 0,
}

export function getFirstGalleryImage(gallery: Pick<GalleryItem, 'images'>) {
  return Array.isArray(gallery.images) ? gallery.images[0] : undefined
}

export function isPendingThumbnailStatus(status: GalleryImageItem['thumbnailStatus']) {
  return status === 'pending' || status === 'processing'
}

export function shouldWaitForGalleryThumbnail(gallery: Pick<GalleryItem, 'images'>) {
  const image = getFirstGalleryImage(gallery)
  return Boolean(image && !image.thumbnailUrl && isPendingThumbnailStatus(image.thumbnailStatus))
}

export function shouldWaitForImageThumbnail(
  image: Pick<GalleryImageItem, 'thumbnailUrl' | 'thumbnailStatus'>
) {
  return !image.thumbnailUrl && isPendingThumbnailStatus(image.thumbnailStatus)
}

export function shouldWaitForAnyGalleryThumbnail(
  gallery: Pick<GalleryItem, 'images'> | null | undefined
) {
  return Boolean(gallery?.images?.some(shouldWaitForImageThumbnail))
}

export function getGalleryThumbnailPlaceholderLabel(image: GalleryImageItem | undefined) {
  if (!image) return '无图片'
  if (image.thumbnailStatus === 'failed') return '缩略图生成失败'
  if (isPendingThumbnailStatus(image.thumbnailStatus)) return '生成中...'
  return '缩略图未生成'
}
