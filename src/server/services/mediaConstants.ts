export const MEDIA_RETIRE_GRACE_MS = 60 * 60 * 1000

export function getMediaRetiredAt(from = new Date()) {
  return new Date(from.getTime() + MEDIA_RETIRE_GRACE_MS)
}
