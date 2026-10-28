import fs from 'fs'
import { encode } from 'blurhash'
import sharp from 'sharp'
import { runtimeConfigService } from './services/runtimeConfig.service'
import { EnhancedCache } from './utils/cache'
import { getSharpInputPixelLimit } from './utils/sharpSafe'

export interface BlurhashConfig {
  enabled: boolean
  autoGenerate: boolean
  componentsX: number
  componentsY: number
}

export interface BlurhashResult {
  blurhash?: string
  thumbhash?: string
}

function getBlurhashConfig(): BlurhashConfig {
  const config = runtimeConfigService.getConfig()
  return {
    enabled: config.blurhashEnabled,
    autoGenerate: config.blurhashAutoGenerate,
    componentsX: config.blurhashComponentsX,
    componentsY: config.blurhashComponentsY,
  }
}

export function isBlurhashEnabled(): boolean {
  return getBlurhashConfig().enabled
}

export function shouldAutoGenerate(): boolean {
  return getBlurhashConfig().autoGenerate
}

// blurhash 生成结果缓存：TTL 1 小时，容量跟随管理后台 cacheMaxKeys 配置
const blurhashCache = new EnhancedCache({ stdTTL: 3600 })

async function extractPixels(
  buffer: Buffer
): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
  try {
    const pixelLimit = getSharpInputPixelLimit()
    const metadata = await sharp(buffer, { limitInputPixels: pixelLimit }).metadata()

    // Downsize very large images to keep encoding fast
    const MAX_DIMENSION = 100
    let targetWidth = metadata.width ?? 64
    let targetHeight = metadata.height ?? 64

    if (metadata.width && metadata.height) {
      const maxSide = Math.max(metadata.width, metadata.height)
      if (maxSide > MAX_DIMENSION) {
        const scale = MAX_DIMENSION / maxSide
        targetWidth = Math.max(1, Math.round(metadata.width * scale))
        targetHeight = Math.max(1, Math.round(metadata.height * scale))
      }
    }

    const { data, info } = await sharp(buffer, { limitInputPixels: pixelLimit })
      .ensureAlpha()
      .removeAlpha()
      .resize(targetWidth, targetHeight, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true })

    return {
      data: new Uint8ClampedArray(data),
      width: info.width,
      height: info.height,
    }
  } catch (error) {
    console.error('[Blurhash] Failed to extract pixels:', error)
    return null
  }
}

export async function generateBlurhashFromBuffer(buffer: Buffer): Promise<string | null> {
  const config = getBlurhashConfig()
  if (!config.enabled) {
    console.log('[Blurhash] Blurhash is disabled')
    return null
  }

  if (!buffer || buffer.length === 0) {
    console.warn('[Blurhash] Empty buffer provided')
    return null
  }

  try {
    const pixels = await extractPixels(buffer)
    if (!pixels) {
      return null
    }

    const blurhash = encode(
      pixels.data,
      pixels.width,
      pixels.height,
      config.componentsX,
      config.componentsY
    )

    if (!blurhash || blurhash.length < 4) {
      console.warn('[Blurhash] Invalid blurhash generated')
      return null
    }

    console.log(
      `[Blurhash] Generated blurhash (${pixels.width}x${pixels.height}): ${blurhash.substring(0, 20)}...`
    )
    return blurhash
  } catch (error) {
    console.error('[Blurhash] Error generating blurhash from buffer:', error)
    return null
  }
}

export async function generateBlurhashFromFile(filePath: string): Promise<string | null> {
  if (!isBlurhashEnabled()) {
    console.log('[Blurhash] Blurhash is disabled')
    return null
  }

  if (!filePath) {
    console.warn('[Blurhash] File path is empty')
    return null
  }

  const cacheKey = `blurhash_file_${filePath}`
  const cached = blurhashCache.get<string>(cacheKey)
  if (cached) {
    console.log('[Blurhash] Using cached blurhash for:', filePath)
    return cached
  }

  try {
    const buffer = await fs.promises.readFile(filePath)
    const blurhash = await generateBlurhashFromBuffer(buffer)

    if (blurhash) {
      blurhashCache.set(cacheKey, blurhash)
    }

    return blurhash
  } catch (error) {
    console.error('[Blurhash] Error generating blurhash from file:', error)
    return null
  }
}

export async function generateImageHashesFromFile(filePath: string): Promise<BlurhashResult> {
  const config = getBlurhashConfig()
  if (!config.enabled) {
    console.log('[Blurhash] Blurhash is disabled')
    return {}
  }

  const cacheKey = `hashes_file_${filePath}`
  const cached = blurhashCache.get<BlurhashResult>(cacheKey)
  if (cached) {
    console.log('[Blurhash] Using cached hashes for:', filePath)
    return cached
  }

  const result: BlurhashResult = {}

  if (config.autoGenerate) {
    console.log('[Blurhash] Auto-generating hashes for:', filePath)

    const blurhash = await generateBlurhashFromFile(filePath)
    if (blurhash) {
      result.blurhash = blurhash
    }

    if (Object.keys(result).length > 0) {
      blurhashCache.set(cacheKey, result)
    }
  }

  return result
}
