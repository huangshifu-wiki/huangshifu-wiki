export const UPLOAD_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024
export const UPLOAD_MAX_FILE_SIZE_MB = 20

export function formatUploadLimit(maxSizeBytes: number = UPLOAD_MAX_FILE_SIZE_BYTES): string {
  return `${(maxSizeBytes / (1024 * 1024)).toFixed(0)}MB`
}

export function formatUploadLimitWithSize(maxSizeBytes: number = UPLOAD_MAX_FILE_SIZE_BYTES): string {
  return `最大 ${formatUploadLimit(maxSizeBytes)}`
}
