import sharp from 'sharp'
import { generateBlurhashFromBuffer } from '../blurhashService'
import { getSharpInputPixelLimit } from '../utils/sharpSafe'

// L-22: imageOptimizer 当前为单函数导出（optimizeImage），无批量调用入口
// 如未来新增批量优化入口，建议引入 p-limit(concurrency=3) 控制并发
// TODO: 当 optimizeImage 被批量调用时，添加 p-limit 并发控制

export interface OptimizeResult {
  success: boolean
  width: number
  height: number
  format: string
  size: number
  originalSize: number
  blurhash?: string
}

/**
 * 优化单张图片
 * @param inputBuffer 原始图片 Buffer
 * @param options 优化选项
 */
export async function optimizeImage(
  inputBuffer: Buffer,
  options: {
    maxWidth?: number
    maxHeight?: number
    quality?: number
    format?: 'webp' | 'jpeg' | 'png'
    generateBlurhash?: boolean
  } = {}
): Promise<OptimizeResult> {
  const {
    maxWidth = 1920,
    maxHeight = 1080,
    quality = 85,
    format = 'webp',
    generateBlurhash = true,
  } = options

  const originalSize = inputBuffer.length
  const pixelLimit = getSharpInputPixelLimit()

  let pipeline = sharp(inputBuffer, { limitInputPixels: pixelLimit }).resize(maxWidth, maxHeight, {
    fit: 'inside',
    withoutEnlargement: true,
  })

  if (format === 'webp') {
    pipeline = pipeline.webp({ quality })
  } else if (format === 'jpeg') {
    pipeline = pipeline.jpeg({ quality })
  } else {
    pipeline = pipeline.png({ compressionLevel: 8 })
  }

  const outputBuffer = await pipeline.toBuffer()

  let blurhash: string | undefined
  if (generateBlurhash) {
    try {
      blurhash = await generateBlurhashFromBuffer(inputBuffer)
    } catch {
      // Blurhash 生成失败不影响主流程
    }
  }

  const metadata = await sharp(outputBuffer, { limitInputPixels: pixelLimit }).metadata()

  return {
    success: true,
    width: metadata.width || 0,
    height: metadata.height || 0,
    format,
    size: outputBuffer.length,
    originalSize,
    blurhash,
  }
}
