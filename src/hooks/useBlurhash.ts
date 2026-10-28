import { useState, useEffect, useRef } from 'react'
import { decode, encode } from 'blurhash'

export interface UseBlurhashReturn {
  isDecoded: boolean
  imageData: ImageData | null
  rgba: Uint8ClampedArray | null
  width: number
  height: number
  error: Error | null
}

export interface DecodeOptions {
  width?: number
  height?: number
  punch?: number
}

export function useBlurhash(
  blurhash: string | null | undefined,
  options: DecodeOptions = {}
): UseBlurhashReturn {
  const [isDecoded, setIsDecoded] = useState(false)
  const [imageData, setImageData] = useState<ImageData | null>(null)
  const [rgba, setRgba] = useState<Uint8ClampedArray | null>(null)
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)
  const [error, setError] = useState<Error | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!blurhash || blurhash.length === 0) {
      setIsDecoded(false)
      setImageData(null)
      setRgba(null)
      setWidth(0)
      setHeight(0)
      setError(null)
      return
    }

    try {
      const { width: w = 32, height: h = 32, punch = 1 } = options

      const pixels = decode(blurhash, w, h, punch)

      setRgba(pixels)
      setWidth(w)
      setHeight(h)
      setIsDecoded(true)
      setError(null)

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')

      if (ctx) {
        const imgData = ctx.createImageData(w, h)
        imgData.data.set(pixels)
        ctx.putImageData(imgData, 0, 0)
        setImageData(imgData)
        canvasRef.current = canvas
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      console.error('[Blurhash] Decode error:', error)
      setError(error)
      setIsDecoded(false)
      setImageData(null)
      setRgba(null)
      setWidth(0)
      setHeight(0)
    }
  }, [blurhash, options.width, options.height, options.punch])

  return {
    isDecoded,
    imageData,
    rgba,
    width,
    height,
    error,
  }
}

export function decodeBlurhashToDataURL(
  blurhash: string,
  width = 32,
  height = 32,
  punch = 1
): string | null {
  try {
    const pixels = decode(blurhash, width, height, punch)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')

    if (!ctx) {
      return null
    }

    const imageData = ctx.createImageData(width, height)
    imageData.data.set(pixels)
    ctx.putImageData(imageData, 0, 0)

    return canvas.toDataURL()
  } catch (error) {
    console.error('[Blurhash] Decode to DataURL error:', error)
    return null
  }
}

export function encodeImageToBlurhash(
  imageData: ImageData,
  componentX = 4,
  componentY = 3
): string | null {
  try {
    return encode(imageData.data, imageData.width, imageData.height, componentX, componentY)
  } catch (error) {
    console.error('[Blurhash] Encode error:', error)
    return null
  }
}

export async function encodeImageElementToBlurhash(
  image: HTMLImageElement,
  componentX = 4,
  componentY = 3
): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        resolve(null)
        return
      }

      ctx.drawImage(image, 0, 0)
      const imageData = ctx.getImageData(0, 0, image.width, image.height)

      const blurhash = encode(imageData.data, image.width, image.height, componentX, componentY)

      resolve(blurhash)
    } catch (error) {
      console.error('[Blurhash] Encode from element error:', error)
      resolve(null)
    }
  })
}
