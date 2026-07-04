import path from 'path'
import fs from 'fs/promises'
import sharp from 'sharp'

import {
  buildUploadPublicUrl,
  createUploadStorageInfo,
  extractStorageKeyFromUploadUrl,
  resolveUploadPathByStorageKey,
} from '../uploadPath'
import { uploadsDir } from '../utils/config'

export const MUSIC_COVER_THUMBNAIL_SIZE = 320
export const MUSIC_COVER_THUMBNAIL_QUALITY = 80
const MUSIC_COVER_THUMBNAIL_NAMESPACE = 'music-covers/thumbnails'

export async function generateMusicCoverThumbnail(storageKey: string): Promise<string | null> {
  const inputPath = resolveUploadPathByStorageKey(storageKey, uploadsDir)
  if (!inputPath) return null

  const sourceBaseName = path.basename(storageKey, path.extname(storageKey)) || 'cover'
  const storageInfo = createUploadStorageInfo(
    uploadsDir,
    MUSIC_COVER_THUMBNAIL_NAMESPACE,
    `${sourceBaseName}.webp`
  )
  const outputPath = path.join(storageInfo.absoluteDir, storageInfo.fileName)

  await sharp(inputPath)
    .resize(MUSIC_COVER_THUMBNAIL_SIZE, MUSIC_COVER_THUMBNAIL_SIZE, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: MUSIC_COVER_THUMBNAIL_QUALITY })
    .toFile(outputPath)

  return buildUploadPublicUrl(storageInfo.storageKey)
}

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
