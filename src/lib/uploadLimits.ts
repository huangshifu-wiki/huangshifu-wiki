export const UPLOAD_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024
export const UPLOAD_MAX_FILE_SIZE_MB = 20

export function formatUploadLimit(maxSizeBytes: number = UPLOAD_MAX_FILE_SIZE_BYTES): string {
  return `${(maxSizeBytes / (1024 * 1024)).toFixed(0)}MB`
}

export function formatUploadLimitWithSize(
  maxSizeBytes: number = UPLOAD_MAX_FILE_SIZE_BYTES
): string {
  return `最大 ${formatUploadLimit(maxSizeBytes)}`
}

export const COVER_ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
] as const

export const COVER_ALLOWED_IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
] as const

export const COVER_IMAGE_ACCEPT = COVER_ALLOWED_IMAGE_MIME_TYPES.join(',')

export function isAllowedCoverImage(file: { type: string; name: string }): boolean {
  const mime = file.type.toLowerCase()
  const name = file.name.toLowerCase()
  const extension = name.slice(name.lastIndexOf('.'))
  return (
    COVER_ALLOWED_IMAGE_MIME_TYPES.includes(
      mime as (typeof COVER_ALLOWED_IMAGE_MIME_TYPES)[number]
    ) &&
    COVER_ALLOWED_IMAGE_EXTENSIONS.includes(
      extension as (typeof COVER_ALLOWED_IMAGE_EXTENSIONS)[number]
    )
  )
}
