// 通用解析、验证与规范化工具函数

import type {
  ContentStatus,
  FavoriteTargetType,
  ModerationTargetType,
  BrowsingTargetType,
  PostSortType,
  MusicPlatform,
  DisplayAlbumMode,
  ApiUser,
} from '../types'
import { isAdminRole } from '../middleware/auth'
import { CONTENT_LIMITS } from '../../lib/contentLimits'

export function parseDate(date: string | Date | null | undefined) {
  if (!date) return null
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

export function normalizeOptionalDateOnlyString(value: unknown): string | null | undefined {
  if (value === null || value === '') return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined
  const date = new Date(`${trimmed}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString().slice(0, 10) === trimmed ? trimmed : undefined
}

export function normalizeOptionalDateOnly(value: unknown): Date | null | undefined {
  const normalized = normalizeOptionalDateOnlyString(value)
  if (normalized === null) return null
  if (normalized === undefined) return undefined
  return new Date(`${normalized}T00:00:00.000Z`)
}

export function normalizeOptionalDurationMs(value: unknown) {
  if (value === null || value === '') return null
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    if (Number.isInteger(parsed) && parsed >= 0) return parsed
  }
  return undefined
}

export function parseInteger(
  value: unknown,
  fallback: number,
  options?: { min?: number; max?: number }
) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  let normalized = Math.floor(parsed)
  if (typeof options?.min === 'number') {
    normalized = Math.max(options.min, normalized)
  }
  if (typeof options?.max === 'number') {
    normalized = Math.min(options.max, normalized)
  }
  return normalized
}

export function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return undefined
  return value.find((item): item is string => typeof item === 'string')
}

export function parseQueryString(value: unknown) {
  return firstString(value)?.trim() || ''
}

export function parseRouteParam(value: unknown) {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.filter((item): item is string => typeof item === 'string').join('/')
}

export function parseBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase()
    if (lowered === 'true' || lowered === '1') return true
    if (lowered === 'false' || lowered === '0') return false
  }
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
  }
  return fallback
}

export function extractBase64Payload(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed.startsWith('data:')) {
    const commaIndex = trimmed.indexOf(',')
    if (commaIndex < 0) {
      return null
    }
    return trimmed.slice(commaIndex + 1)
  }

  return trimmed
}

export function parseMinSimilarityScore(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return undefined
  }

  return Math.max(0, Math.min(1, parsed))
}

export function toEmbeddingPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const record = payload as Record<string, unknown>
  const galleryId = typeof record.galleryId === 'string' ? record.galleryId : ''
  const galleryImageId = typeof record.galleryImageId === 'string' ? record.galleryImageId : ''
  if (!galleryId || !galleryImageId) {
    return null
  }

  return {
    galleryId,
    galleryImageId,
    imageUrl: typeof record.imageUrl === 'string' ? record.imageUrl : '',
    imageName: typeof record.imageName === 'string' ? record.imageName : '',
  }
}

export function normalizeTagList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [] as string[]
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .map((item) => item.slice(0, CONTENT_LIMITS.gallery.tag))
    .slice(0, CONTENT_LIMITS.gallery.tags)
}

export function serializeTags(value: unknown) {
  if (!value) return []
  if (Array.isArray(value)) return value
  return []
}

export function hasTag(value: unknown, tag: string) {
  return serializeTags(value).some((item) => typeof item === 'string' && item === tag)
}

export function normalizeWikiSlug(value: unknown) {
  if (typeof value !== 'string') return null
  return value.trim().toLowerCase()
}

export function normalizeOptionalDocId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  return normalized ? normalized : null
}

export function normalizeKeyword(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 64)
}

export function parseAssetIdList(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[]
  }

  const deduped = new Set<string>()
  value.forEach((item) => {
    if (typeof item !== 'string') return
    const normalized = item.trim()
    if (!normalized) return
    deduped.add(normalized)
  })
  return [...deduped]
}

export function parseContentStatus(value: unknown): ContentStatus | null {
  if (value === 'draft' || value === 'pending' || value === 'published' || value === 'rejected') {
    return value
  }
  return null
}

/**
 * 规范化 Wiki 写入状态
 * 权限审查：管理员角色保存为草稿时保留草稿，其余情况直接发布；普通用户仅允许 pending/rejected/draft 状态
 * 安全评估：通过 isAdminRole 进行角色校验，防止未授权状态提升
 */
export function normalizeWikiWriteStatus(rawStatus: unknown, authUser: ApiUser): ContentStatus {
  const status = parseContentStatus(rawStatus)
  if (isAdminRole(authUser.role)) {
    if (status === 'draft') return 'draft'
    return 'published'
  }
  if (status === 'pending') return 'pending'
  if (status === 'rejected') return 'rejected'
  return 'draft'
}

export function normalizePostWriteStatus(rawStatus: unknown, authUser: ApiUser): ContentStatus {
  const status = parseContentStatus(rawStatus)
  if (isAdminRole(authUser.role)) {
    if (status === 'draft') return 'draft'
    return 'published'
  }
  if (status === 'pending') return 'pending'
  if (status === 'rejected') return 'rejected'
  return 'draft'
}

export function normalizeGalleryWriteStatus(rawStatus: unknown, authUser: ApiUser): ContentStatus {
  return normalizePostWriteStatus(rawStatus, authUser)
}

export function parseFavoriteType(value: unknown): FavoriteTargetType | null {
  if (value === 'wiki' || value === 'post' || value === 'music' || value === 'gallery') {
    return value
  }
  return null
}

export function parseMusicPlatform(value: unknown): MusicPlatform | null {
  if (
    value === 'netease' ||
    value === 'tencent' ||
    value === 'kugou' ||
    value === 'baidu' ||
    value === 'kuwo'
  ) {
    return value
  }
  return null
}

export function parseDisplayAlbumMode(value: unknown): DisplayAlbumMode | null {
  if (value === 'none' || value === 'linked' || value === 'manual') {
    return value
  }
  return null
}

export function parseBrowsingTargetType(value: unknown): BrowsingTargetType | null {
  if (value === 'wiki' || value === 'post' || value === 'music') {
    return value
  }
  return null
}

export function parseModerationTargetType(value: unknown): ModerationTargetType | null {
  if (value === 'wiki' || value === 'post' || value === 'gallery' || value === 'comment') {
    return value
  }
  return null
}

export function normalizeModerationTargetType(value: unknown): ModerationTargetType | null {
  if (value === 'posts') {
    return 'post'
  }
  if (value === 'galleries') {
    return 'gallery'
  }
  if (value === 'comments') {
    return 'comment'
  }
  return parseModerationTargetType(value)
}

export function parsePostSort(value: unknown): PostSortType {
  if (value === 'hot' || value === 'recommended') {
    return value
  }
  return 'latest'
}

export function parsePagination(query: Record<string, unknown>) {
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100)
  const page = Math.max(Number(query.page) || 1, 1)
  const offset = (page - 1) * limit
  return { limit, page, offset }
}
