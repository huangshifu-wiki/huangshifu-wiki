import path from 'path'
import fs from 'fs/promises'

import { extractStorageKeyFromUploadUrl, resolveUploadPathByStorageKey } from '../uploadPath'
import { uploadsDir } from '../utils/config'

export const MUSIC_COVER_THUMBNAIL_SIZE = 320
export const MUSIC_COVER_THUMBNAIL_QUALITY = 80

export async function deleteMusicCoverThumbnail(thumbnailUrl: string | null | undefined) {
  if (!thumbnailUrl) return

  const storageKey = extractStorageKeyFromUploadUrl(thumbnailUrl)
  if (!storageKey) return

  const filePath = resolveUploadPathByStorageKey(storageKey, uploadsDir)
  if (!filePath) return

  await fs.unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      console.warn(`Delete music cover thumbnail failed for ${thumbnailUrl}:`, error)
    }
  })
}
