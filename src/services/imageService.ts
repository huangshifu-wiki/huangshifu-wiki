import { apiDelete, apiGet, apiPost, apiUpload } from '../lib/apiClient'
import { calculateFileMd5Hex } from '../utils/fileMd5'
import type { UploadFileResponse } from '../types/api'

export interface ImageMap {
  id: string
  md5: string
  localUrl: string
  externalUrl?: string
  s3Url?: string
  storageType?: 'local' | 's3' | 'external'

  // WebP 变体 URL
  thumbnailUrl?: string // 1080h 变体（高度 1080，宽度自适应）

  blurhash?: string
  thumbhash?: string
  createdAt: string
}

export interface ImagePreference {
  strategy: 'local' | 's3' | 'external'
  fallback: boolean
  s3BaseUrl?: string
}

let cachedS3BaseUrl: string | null = null

export const getS3BaseUrl = async (): Promise<string> => {
  if (cachedS3BaseUrl) {
    return cachedS3BaseUrl
  }

  try {
    const response = await apiGet<{ s3BaseUrl?: string }>('/api/s3/config')
    cachedS3BaseUrl = response.s3BaseUrl || ''
    return cachedS3BaseUrl
  } catch (error) {
    console.error('Failed to fetch S3 base URL:', error)
    return ''
  }
}

export const clearS3BaseUrlCache = () => {
  cachedS3BaseUrl = null
}

export const buildS3Url = (s3Url: string, s3BaseUrl: string): string => {
  if (!s3Url) return ''
  if (s3Url.startsWith('http://') || s3Url.startsWith('https://')) {
    return s3Url
  }
  if (!s3BaseUrl) {
    return s3Url
  }
  const trimmedBase = s3BaseUrl.replace(/\/+$/, '')
  const trimmedUrl = s3Url.replace(/^\/+/, '')
  return `${trimmedBase}/${trimmedUrl}`
}

export interface ImageUrlResult {
  url: string
  storageType: 'local' | 's3' | 'external'
  blurhash?: string
  md5: string
}

export interface ResolveImageUrlOptions {
  forceType?: 'local' | 's3' | 'external'
}

export interface UploadImageOptions {
  type?: 'general' | 'avatar' | 'cover' | 'gallery' | 'markdown'
  onProgress?: (progress: number) => void
  signal?: AbortSignal
  reuseExisting?: boolean
}

export interface UploadImageResult {
  assetId: string
  imageMapId: string
  url: string
  localUrl?: string
  s3Url?: string
  externalUrl?: string
  storageType: 'local' | 's3' | 'external'
  md5: string
  reused: boolean
  status: 'uploaded' | 'ready' | 'deleted'
  blurhash?: string
}

export const findExistingImageMapByMd5 = async (md5: string): Promise<ImageMap | null> => {
  const listResponse = await apiGet<{ items: ImageMap[] }>('/api/image-maps', { md5 })
  return listResponse.items?.[0] || null
}

export const findExistingImageMapForFile = async (file: File): Promise<ImageMap | null> => {
  const md5 = await calculateFileMd5Hex(file)
  return findExistingImageMapByMd5(md5)
}

let cachedPreference: ImagePreference | null = null

export const getImagePreference = async (): Promise<ImagePreference> => {
  if (cachedPreference) {
    return cachedPreference
  }

  try {
    const response = await apiGet<ImagePreference>('/api/config/image-preference')
    cachedPreference = response
    return response
  } catch (error) {
    console.error('Failed to fetch image preference:', error)
    return { strategy: 'local', fallback: true }
  }
}

export const clearImagePreferenceCache = () => {
  cachedPreference = null
}

export interface UpdateImagePreferenceOptions {
  strategy?: 'local' | 's3' | 'external'
  fallback?: boolean
  autoSync?: boolean
}

export interface UpdateImagePreferenceResult {
  success: boolean
  preference: ImagePreference
  syncTask?: {
    id: string
    status: string
    strategy: string
    total: number
  } | null
}

/**
 * 更新图片存储偏好设置
 * 当切换到 S3 或 external 策略时，会自动启动图片同步任务
 */
export const updateImagePreference = async (
  options: UpdateImagePreferenceOptions
): Promise<UpdateImagePreferenceResult> => {
  const response = await apiPost<UpdateImagePreferenceResult>(
    '/api/config/image-preference',
    options
  )

  // 清除缓存，下次获取时会重新加载
  clearImagePreferenceCache()

  return response
}

const getUrlByPreference = (map: ImageMap, preference: ImagePreference): string | null => {
  const { strategy, fallback } = preference

  const getPrimaryUrl = () => {
    switch (strategy) {
      case 'external':
        return map.externalUrl || null
      case 's3':
        return map.s3Url || null
      case 'local':
      default:
        return map.localUrl || null
    }
  }

  const primaryUrl = getPrimaryUrl()
  if (primaryUrl) {
    return primaryUrl
  }

  if (!fallback) {
    return null
  }

  const fallbackUrls = [map.s3Url, map.externalUrl, map.localUrl].filter(Boolean) as string[]

  if (fallbackUrls.length > 0) {
    return fallbackUrls[0]
  }

  return null
}

export const getDisplayImageUrl = (map: ImageMap, preference: ImagePreference): string | null => {
  return map.thumbnailUrl || getUrlByPreference(map, preference)
}

export const resolveImageUrl = async (
  map: ImageMap,
  preference: ImagePreference,
  options: ResolveImageUrlOptions = {}
): Promise<ImageUrlResult> => {
  const { forceType } = options
  const strategy = forceType || preference.strategy
  const { fallback } = preference

  const getPrimaryUrl = (): { url: string | null; type: 'local' | 's3' | 'external' } => {
    switch (strategy) {
      case 'external':
        return { url: map.externalUrl || null, type: 'external' }
      case 's3':
        return { url: map.s3Url || null, type: 's3' }
      case 'local':
      default:
        return { url: map.localUrl || null, type: 'local' }
    }
  }

  const primary = getPrimaryUrl()
  if (primary.url) {
    let resolvedUrl = primary.url
    if (primary.type === 's3') {
      const s3BaseUrl = preference.s3BaseUrl || (await getS3BaseUrl())
      resolvedUrl = buildS3Url(primary.url, s3BaseUrl)
    }
    return {
      url: resolvedUrl,
      storageType: primary.type,
      blurhash: map.blurhash,
      md5: map.md5,
    }
  }

  if (!fallback) {
    return {
      url: '',
      storageType: 'local',
      blurhash: map.blurhash,
      md5: map.md5,
    }
  }

  const fallbackUrls = [
    { url: map.s3Url || '', type: 's3' as const },
    { url: map.externalUrl || '', type: 'external' as const },
    { url: map.localUrl || '', type: 'local' as const },
  ].filter((item) => item.url && item.url !== primary.url)

  if (fallbackUrls.length > 0) {
    const first = fallbackUrls[0]
    let resolvedUrl = first.url
    if (first.type === 's3') {
      const s3BaseUrl = preference.s3BaseUrl || (await getS3BaseUrl())
      resolvedUrl = buildS3Url(first.url, s3BaseUrl)
    }
    return {
      url: resolvedUrl,
      storageType: first.type,
      blurhash: map.blurhash,
      md5: map.md5,
    }
  }

  return {
    url: '',
    storageType: map.storageType || 'local',
    blurhash: map.blurhash,
    md5: map.md5,
  }
}

export const getImageUrlWithMeta = async (
  imageId: string,
  options: ResolveImageUrlOptions = {}
): Promise<ImageUrlResult | null> => {
  try {
    const response = await apiGet<{ item: ImageMap }>(`/api/image-maps/${imageId}`)
    const data = response.item
    const preference = await getImagePreference()
    return resolveImageUrl(data, preference, options)
  } catch (e) {
    console.error('Error fetching image URL with meta:', e)
  }
  return null
}

export const getImageUrl = async (imageId: string): Promise<string[]> => {
  try {
    const response = await apiGet<{ item: ImageMap }>(`/api/image-maps/${imageId}`)
    const data = response.item
    const preference = await getImagePreference()

    const primaryUrl = getUrlByPreference(data, preference)
    if (!primaryUrl) {
      return []
    }

    if (!preference.fallback) {
      return [primaryUrl]
    }

    const fallbackUrls = [data.s3Url, data.externalUrl, data.localUrl].filter(
      (url) => url && url !== primaryUrl
    ) as string[]

    return [primaryUrl, ...fallbackUrls]
  } catch (e) {
    console.error('Error fetching image map:', e)
  }
  return []
}

export const getPrimaryImageUrl = async (imageId: string): Promise<string | null> => {
  try {
    const response = await apiGet<{ item: ImageMap }>(`/api/image-maps/${imageId}`)
    const data = response.item
    const preference = await getImagePreference()
    return getUrlByPreference(data, preference)
  } catch (e) {
    console.error('Error fetching primary image URL:', e)
  }
  return null
}

export const uploadMarkdownImage = async (file: File): Promise<string> => {
  try {
    const result = await uploadImageWithStrategy(file, { type: 'markdown' })
    return result.url
  } catch (error) {
    console.error('Markdown image upload failed:', error)
    throw error
  }
}

/**
 * 统一图片上传函数（支持存储策略）
 *
 * 根据当前存储策略自动选择上传方式：
 * - local: 上传到本地
 * - s3: 上传到 S3（同时本地备份）
 * - external: 上传到外部图床（同时本地和 S3 备份）
 *
 * 返回包含 assetId 和根据策略选择的 URL，以及所有存储位置的 URL
 */
export const uploadImageWithStrategy = async (
  file: File,
  options: UploadImageOptions = {}
): Promise<UploadImageResult> => {
  const { onProgress, signal, reuseExisting = true } = options
  const preference = await getImagePreference()

  if (reuseExisting) {
    const existing = await findExistingImageMapForFile(file)
    if (existing && (existing.localUrl || existing.s3Url || existing.externalUrl)) {
      const reuseResponse = await apiPost<{
        asset: UploadFileResponse['asset']
        storageErrors?: string[]
      }>(
        '/api/uploads/assets/reuse',
        {
          imageMapId: existing.id,
          fileName: file.name,
          mimeType: file.type || 'image/jpeg',
          sizeBytes: file.size,
        },
        signal
      )
      const resolved = await resolveImageUrl(existing, preference)
      return {
        assetId: reuseResponse.asset.id,
        imageMapId: reuseResponse.asset.imageMapId,
        url: resolved.url || existing.localUrl || existing.s3Url || existing.externalUrl || '',
        localUrl: existing.localUrl,
        s3Url: existing.s3Url,
        externalUrl: existing.externalUrl,
        storageType: resolved.storageType,
        md5: existing.md5,
        reused: true,
        status: 'ready',
      }
    }
  }

  const useTripleStorage = preference.strategy === 's3' || preference.strategy === 'external'
  let sessionId: string | null = null
  try {
    const sessionResponse = await apiPost<{ session: UploadFileResponse['session'] }>(
      '/api/uploads/sessions',
      {}
    )
    sessionId = sessionResponse.session.id

    const formData = new FormData()
    formData.append('file', file)
    const uploadPath = `/api/uploads/sessions/${sessionId}/files${
      useTripleStorage ? '?tripleStorage=true' : ''
    }`
    const data = await apiUpload<UploadFileResponse>(uploadPath, formData, { signal, onProgress })
    await apiPost(`/api/uploads/sessions/${sessionId}/finalize`, undefined, signal)

    const localUrl = data.tripleStorage?.localUrl || data.asset.publicUrl || undefined
    const s3Url = data.tripleStorage?.s3Url
    const externalUrl = data.tripleStorage?.externalUrl
    let selectedUrl = localUrl || ''
    if (preference.strategy === 's3') selectedUrl = s3Url || externalUrl || localUrl || ''
    if (preference.strategy === 'external') selectedUrl = externalUrl || s3Url || localUrl || ''

    return {
      assetId: data.asset.id,
      imageMapId: data.asset.imageMapId,
      url: selectedUrl,
      localUrl,
      s3Url,
      externalUrl,
      storageType:
        s3Url && preference.strategy === 's3'
          ? 's3'
          : externalUrl && preference.strategy === 'external'
            ? 'external'
            : 'local',
      md5: data.asset.md5,
      reused: data.asset.reused,
      status: 'ready',
    }
  } catch (error) {
    if (sessionId) {
      await apiDelete(`/api/uploads/sessions/${sessionId}`).catch(() => undefined)
    }
    throw error
  }
}

/**
 * 上传头像（支持裁剪和存储策略）
 *
 * @param blob 裁剪后的头像图片 Blob（注意：从 canvas.toBlob 出来的 Blob.type 已经是正确 MIME）
 * @param options 上传选项
 * @returns 上传后的头像 URL 和完整结果
 */
export const uploadAvatar = async (
  blob: Blob,
  options?: UploadImageOptions
): Promise<UploadImageResult> => {
  // 根据 blob.type 选择文件后缀，避免 PNG 被错认成 JPG 导致 server 端校验失败
  const mime = (blob.type || 'image/jpeg').toLowerCase()
  const extByMime: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
  }
  const ext = extByMime[mime] || 'jpg'
  const file = new File([blob], `avatar.${ext}`, { type: mime || 'image/jpeg' })
  return uploadImageWithStrategy(file, { ...options, type: 'avatar' })
}
