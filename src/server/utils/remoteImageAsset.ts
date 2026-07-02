import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'

import { UPLOAD_MAX_FILE_SIZE_BYTES } from '../../lib/uploadLimits'
import { buildUploadPublicUrl, createUploadStorageInfo } from '../uploadPath'
import { ALLOWED_IMAGE_EXTENSIONS, ALLOWED_IMAGE_MIME_TYPES } from '../types'
import { prisma, uploadsDir } from './config'

type LocalizedImageAsset = {
  assetId: string
  storageKey: string
  publicUrl: string
  fileName: string
  mimeType: string
  sizeBytes: number
}

type LocalizeRemoteImageOptions = {
  namespace: string
  ownerUid?: string
  fallbackName?: string
}

const IMAGE_EXTENSION_BY_FORMAT: Record<string, string> = {
  jpeg: '.jpg',
  jpg: '.jpg',
  png: '.png',
  webp: '.webp',
  gif: '.gif',
  heif: '.heic',
  avif: '.avif',
  tiff: '.tiff',
  svg: '.svg',
}

const IMAGE_MIME_BY_FORMAT: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
}

function normalizeRemoteImageUrl(url: string) {
  const trimmed = url.trim()
  if (!trimmed) {
    throw new Error('图片 URL 不能为空')
  }

  const parsed = new URL(trimmed)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('只支持 HTTP/HTTPS 图片 URL')
  }
  return parsed
}

function getFileNameFromUrl(url: URL, fallbackName: string) {
  const basename = path.basename(decodeURIComponent(url.pathname || ''))
  return basename && basename.includes('.') ? basename : fallbackName
}

function normalizeExtension(format: string | undefined, originalName: string) {
  const detectedExt = format ? IMAGE_EXTENSION_BY_FORMAT[format] : ''
  const originalExt = path.extname(originalName).toLowerCase()
  const ext = detectedExt || originalExt || '.jpg'
  if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
    throw new Error(`不支持的图片格式：${ext}`)
  }
  return ext
}

function normalizeMimeType(format: string | undefined, responseContentType: string | null) {
  const detectedMime = format ? IMAGE_MIME_BY_FORMAT[format] : ''
  const headerMime = responseContentType?.split(';')[0]?.trim().toLowerCase() || ''
  const mime = detectedMime || headerMime
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mime)) {
    throw new Error(`不支持的图片类型：${mime || 'unknown'}`)
  }
  return mime
}

async function resolveMediaAssetOwnerUid(ownerUid?: string) {
  if (ownerUid) {
    const user = await prisma.user.findFirst({
      where: { uid: ownerUid, deletedAt: null },
      select: { uid: true },
    })
    if (user) return user.uid
  }

  const user = await prisma.user.findFirst({
    where: { deletedAt: null },
    orderBy: [{ role: 'desc' }, { createdAt: 'asc' }],
    select: { uid: true },
  })
  if (!user) {
    throw new Error('无法创建媒体资源：系统中没有可用用户')
  }
  return user.uid
}

async function downloadRemoteImageBuffer(url: URL) {
  const response = await fetch(url, {
    headers: {
      Accept: [...ALLOWED_IMAGE_MIME_TYPES].join(','),
      'User-Agent': 'huangshifu-wiki/1.0',
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    throw new Error(`下载图片失败：${response.status} ${response.statusText}`)
  }

  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > UPLOAD_MAX_FILE_SIZE_BYTES) {
    throw new Error('图片超过 20MB 限制')
  }

  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > UPLOAD_MAX_FILE_SIZE_BYTES) {
      throw new Error('图片超过 20MB 限制')
    }
    chunks.push(buffer)
  }

  return {
    buffer: Buffer.concat(chunks),
    contentType: response.headers.get('content-type'),
  }
}

export async function findReadyMediaAssetByPublicUrl(
  publicUrl: string
): Promise<LocalizedImageAsset | null> {
  const asset = await prisma.mediaAsset.findFirst({
    where: {
      publicUrl,
      status: 'ready',
    },
    select: {
      id: true,
      storageKey: true,
      publicUrl: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
    },
  })

  if (!asset) return null

  return {
    assetId: asset.id,
    storageKey: asset.storageKey,
    publicUrl: asset.publicUrl,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
  }
}

export async function localizeImageUrlAsMediaAsset(
  imageUrl: string,
  options: LocalizeRemoteImageOptions
): Promise<LocalizedImageAsset> {
  const trimmed = imageUrl.trim()
  if (trimmed.startsWith('/uploads/')) {
    const asset = await findReadyMediaAssetByPublicUrl(trimmed)
    if (!asset) {
      throw new Error('本地图片未关联可用媒体资源')
    }
    return asset
  }

  const parsedUrl = normalizeRemoteImageUrl(trimmed)
  const { buffer, contentType } = await downloadRemoteImageBuffer(parsedUrl)
  const metadata = await sharp(buffer, { animated: true }).metadata()
  const ext = normalizeExtension(metadata.format, getFileNameFromUrl(parsedUrl, 'image.jpg'))
  const mimeType = normalizeMimeType(metadata.format, contentType)
  const ownerUid = await resolveMediaAssetOwnerUid(options.ownerUid)
  const originalName = getFileNameFromUrl(parsedUrl, options.fallbackName || `image${ext}`)
  const basename = path.basename(originalName, path.extname(originalName)) || 'image'
  const normalizedName = `${basename}${ext}`
  const storageInfo = createUploadStorageInfo(uploadsDir, options.namespace, normalizedName)
  const absolutePath = path.join(storageInfo.absoluteDir, storageInfo.fileName)

  await fs.writeFile(absolutePath, buffer)

  try {
    const publicUrl = buildUploadPublicUrl(storageInfo.storageKey)
    const asset = await prisma.mediaAsset.create({
      data: {
        ownerUid,
        storageKey: storageInfo.storageKey,
        publicUrl,
        fileName: normalizedName,
        mimeType,
        sizeBytes: buffer.length,
        status: 'ready',
      },
      select: {
        id: true,
        storageKey: true,
        publicUrl: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
      },
    })

    return {
      assetId: asset.id,
      storageKey: asset.storageKey,
      publicUrl: asset.publicUrl,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
    }
  } catch (error) {
    await fs.unlink(absolutePath).catch(() => undefined)
    throw error
  }
}
