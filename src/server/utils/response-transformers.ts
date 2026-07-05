// API 响应 → DTO 转换器

import { serializeTags } from './parsers'

import {
  resolveSongDisplayAlbum,
  resolveSongCoverUrl,
  resolveAlbumCoverUrl,
  resolveSongCoverThumbnailUrl,
  resolveAlbumCoverThumbnailUrl,
  normalizeSongCustomPlatformLinks,
} from './music'

import { Prisma, UserRole as PrismaUserRole } from '@prisma/client'
import type { VariantStatus } from '@prisma/client'
import { normalizeStringListInput } from '../../lib/musicCredits'
import { isPlayableSong } from '../../lib/musicPlayback'
import { RELATION_TYPE_LABELS } from '../../lib/relationConstants'

import type {
  UserStatus,
  ContentStatus,
  WikiRelationType,
  FavoriteTargetType,
  ModerationTargetType,
  NotificationType,
  BrowsingTargetType,
  PostSortType,
  MusicPlatform,
  DisplayAlbumMode,
  WikiRelationRecord,
  WikiRelationResolved,
  WikiRelationGraphNode,
  WikiRelationGraphEdge,
  MusicTrackWithRelations,
  MusicExternalSourceRecord,
  PlayUrlCacheValue,
  ImportSongInput,
  SongCustomPlatformLink,
  SessionJwtPayload,
  ApiUser,
  AuthenticatedRequest,
  WikiResponseInput,
  WikiRelationPageLite,
  WikiReverseRelationEntry,
  WikiRelationBundle,
  WikiBranchWithPage,
  WikiPullRequestWithRelations,
} from '../types'

import { prisma } from './config'

// ---------------------------------------------------------------------------
// 内部辅助：serializeRelations 及其依赖链（原 index.ts 局部函数）
// ---------------------------------------------------------------------------

const RELATION_LABEL_TO_TYPE: Record<string, WikiRelationType> = Object.fromEntries(
  Object.entries(RELATION_TYPE_LABELS).map(([type, label]) => [label, type as WikiRelationType])
)

function formatDateOnly(value?: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null
}

function serializeMusicExternalSources(sources: MusicExternalSourceRecord[]) {
  return sources.map((source) => ({
    id: source.id,
    resourceType: source.resourceType,
    platform: source.platform,
    sourceId: source.sourceId,
    sourceUrl: source.sourceUrl,
    isPrimary: source.isPrimary,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  }))
}

function parseBoolean(value: unknown, fallback = false) {
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

function normalizeWikiSlug(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase()
}

function normalizeWikiRelationType(value: unknown): WikiRelationType | null {
  if (
    value === 'related_person' ||
    value === 'work_relation' ||
    value === 'timeline_relation' ||
    value === 'custom'
  ) {
    return value
  }

  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  const mapped = RELATION_LABEL_TO_TYPE[normalized]
  if (mapped) return mapped
  return null
}

function normalizeWikiRelationLabel(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }
  const normalized = value.trim()
  if (!normalized) {
    return undefined
  }
  return normalized.slice(0, 60)
}

function normalizeWikiRelationList(value: unknown, sourceSlug?: string): WikiRelationRecord[] {
  if (Array.isArray(value)) {
    return doNormalizeArray(value, sourceSlug)
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        return doNormalizeArray(parsed, sourceSlug)
      }
    } catch {
      // JSON parse failed — fall through to default empty return
    }
  }

  if (value != null && typeof value !== 'string') {
    console.warn(
      '[normalizeWikiRelationList] Unexpected non-array input, data dropped:',
      typeof value
    )
  }

  return [] as WikiRelationRecord[]
}

function doNormalizeArray(value: unknown[], sourceSlug: string | undefined): WikiRelationRecord[] {
  const normalizedSourceSlug = normalizeWikiSlug(sourceSlug)
  const deduped = new Set<string>()
  const relations: WikiRelationRecord[] = []

  value.forEach((item) => {
    if (!item || typeof item !== 'object') return
    const record = item as Record<string, unknown>

    const type = normalizeWikiRelationType(record.type)
    if (!type) return

    const targetSlug = normalizeWikiSlug(record.targetSlug)
    if (!targetSlug) return
    if (normalizedSourceSlug && targetSlug === normalizedSourceSlug) return

    const label = normalizeWikiRelationLabel(record.label)
    const bidirectional = parseBoolean(record.bidirectional, true)

    const dedupeKey = `${type}|${targetSlug}|${(label || '').toLowerCase()}`
    if (deduped.has(dedupeKey)) return
    deduped.add(dedupeKey)

    relations.push({
      type,
      targetSlug,
      label,
      bidirectional,
    })
  })

  return relations.slice(0, 80)
}

function serializeRelations(value: unknown, sourceSlug?: string) {
  return normalizeWikiRelationList(value, sourceSlug)
}

// ---------------------------------------------------------------------------
// 导出的响应转换函数
// ---------------------------------------------------------------------------

export function toNotificationResponse(notification: {
  id: string
  userUid: string
  type: NotificationType
  payload: unknown
  isRead: boolean
  createdAt: Date
}) {
  return {
    id: notification.id,
    userUid: notification.userUid,
    type: notification.type,
    payload: notification.payload,
    isRead: notification.isRead,
    createdAt: notification.createdAt.toISOString(),
  }
}

export function toWikiResponse(page: WikiResponseInput) {
  const deletedAt = 'deletedAt' in page ? (page.deletedAt as Date | null | undefined) : null
  const deletedBy = 'deletedBy' in page ? (page.deletedBy as string | null | undefined) : null
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    category: page.category,
    content: page.content,
    tags: serializeTags(page.tags),
    relations: serializeRelations(page.relations, page.slug),
    eventDate: page.eventDate,
    locationCode: page.locationCode || null,
    locationName: page.location?.fullName || null,
    locationDetail: page.locationDetail || null,
    status: page.status,
    reviewNote: page.reviewNote,
    reviewedBy: page.reviewedBy,
    reviewedAt: page.reviewedAt ? page.reviewedAt.toISOString() : null,
    viewCount: page.viewCount ?? 0,
    favoritesCount: page.favoritesCount,
    isPinned: page.isPinned,
    likesCount: page.likesCount,
    dislikesCount: page.dislikesCount,
    isDeleted: Boolean(deletedAt),
    deletedAt: deletedAt ? deletedAt.toISOString() : null,
    deletedBy: deletedBy ?? null,
    lastEditorUid: page.lastEditorUid,
    lastEditorName: page.lastEditor?.displayName || '匿名',
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  }
}

export function toWikiListResponse(page: WikiResponseInput) {
  const { content: _, ...rest } = toWikiResponse(page)
  return rest
}

export function toWikiBranchResponse(branch: WikiBranchWithPage) {
  return {
    id: branch.id,
    pageSlug: branch.pageSlug,
    editorUid: branch.editorUid,
    editorName: branch.editorName,
    status: branch.status,
    latestRevisionId: branch.latestRevisionId,
    createdAt: branch.createdAt.toISOString(),
    updatedAt: branch.updatedAt.toISOString(),
    page: branch.page
      ? {
          slug: branch.page.slug,
          title: branch.page.title,
          category: branch.page.category,
        }
      : null,
  }
}

export function toWikiPullRequestResponse(pr: WikiPullRequestWithRelations) {
  return {
    id: pr.id,
    branchId: pr.branchId,
    pageSlug: pr.pageSlug,
    title: pr.title,
    description: pr.description,
    status: pr.status,
    createdByUid: pr.createdByUid,
    createdByName: pr.createdByName,
    reviewedBy: pr.reviewedBy,
    reviewedAt: pr.reviewedAt ? pr.reviewedAt.toISOString() : null,
    mergedAt: pr.mergedAt ? pr.mergedAt.toISOString() : null,
    baseRevisionId: pr.baseRevisionId,
    conflictData: pr.conflictData ?? null,
    createdAt: pr.createdAt.toISOString(),
    updatedAt: pr.updatedAt.toISOString(),
    branch: pr.branch ? toWikiBranchResponse(pr.branch) : null,
    page: pr.page
      ? {
          slug: pr.page.slug,
          title: pr.page.title,
          category: pr.page.category,
        }
      : null,
    comments: (pr.comments || []).map((comment) => ({
      id: comment.id,
      prId: comment.prId,
      authorUid: comment.authorUid,
      authorName: comment.authorName,
      content: comment.content,
      createdAt: comment.createdAt.toISOString(),
    })),
  }
}

export function toPostResponse(post: {
  id: string
  slug?: string
  title: string
  section: string
  musicDocId?: string | null
  albumDocId?: string | null
  content: string
  mentionTargets?: Array<{
    uid: string
    publicId?: string
    displayName: string
    photoURL?: string | null
  }>
  tags: unknown
  locationCode?: string | null
  locationDetail?: string | null
  authorUid: string
  author?: { publicId?: string; displayName: string } | null
  status: ContentStatus
  reviewNote?: string | null
  reviewedBy?: string | null
  reviewedAt?: Date | null
  hotScore?: number
  viewCount?: number
  likesCount: number
  dislikesCount: number
  commentsCount: number
  isPinned?: boolean
  createdAt: Date
  updatedAt: Date
  location?: { code: string; name: string; fullName: string } | null
  deletedAt?: Date | null
  deletedBy?: string | null
  pendingReviewBaseContent?: string | null
}) {
  const { pendingReviewBaseContent: _pendingReviewBaseContent, ...publicPost } = post
  return {
    ...publicPost,
    authorPublicId: post.author?.publicId || null,
    authorName: post.author?.displayName || null,
    locationCode: post.locationCode || null,
    locationName: post.location?.fullName || null,
    locationDetail: post.locationDetail || null,
    hotScore: post.hotScore ?? 0,
    viewCount: post.viewCount ?? 0,
    tags: serializeTags(post.tags),
    musicDocId: post.musicDocId || null,
    albumDocId: post.albumDocId || null,
    isDeleted: Boolean(post.deletedAt),
    deletedAt: post.deletedAt ? post.deletedAt.toISOString() : null,
    deletedBy: post.deletedBy ?? null,
    reviewedAt: post.reviewedAt ? post.reviewedAt.toISOString() : null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  }
}

const DELETED_COMMENT_PLACEHOLDER = '评论已删除'

type CommentResponseInput = {
  id: string
  postId?: string | null
  galleryId?: string | null
  authorUid: string
  content: string
  mentionTargets?: Array<{
    uid: string
    publicId?: string
    displayName: string
    photoURL?: string | null
  }>
  parentId: string | null
  replyToId?: string | null
  deletedAt?: Date | null
  deletedBy?: string | null
  createdAt: Date
  _count?: {
    likes?: number
  }
  // author 关系是可选的——评论查询时如果忘记 include 就回退到 null/匿名，
  // 而不是直接抛 TS 错误。生产路径都应该 include 关系。
  author?: {
    publicId?: string
    displayName: string
    photoURL: string | null
  } | null
  replyTo?: {
    authorUid: string
    author?: {
      displayName: string
    } | null
  } | null
}

export function toCommentResponse(
  comment: CommentResponseInput,
  options?: {
    maskDeletedContent?: boolean
    hideDeletedAuthor?: boolean
    likedByMe?: boolean
    deletedByName?: string | null
  }
) {
  const isDeleted = Boolean(comment.deletedAt)
  const hideDeletedAuthor = Boolean(options?.hideDeletedAuthor && isDeleted)
  return {
    id: comment.id,
    postId: comment.postId ?? null,
    galleryId: comment.galleryId ?? null,
    authorUid: comment.authorUid,
    authorPublicId: comment.author?.publicId ?? null,
    authorName: hideDeletedAuthor ? null : (comment.author?.displayName ?? '匿名用户'),
    authorPhoto: hideDeletedAuthor ? null : (comment.author?.photoURL ?? null),
    content:
      options?.maskDeletedContent && isDeleted ? DELETED_COMMENT_PLACEHOLDER : comment.content,
    mentionTargets: options?.maskDeletedContent && isDeleted ? [] : (comment.mentionTargets ?? []),
    parentId: comment.parentId,
    replyToId: comment.replyToId ?? null,
    replyToAuthorUid: comment.replyTo?.authorUid ?? null,
    replyToAuthorName: comment.replyTo?.author?.displayName ?? null,
    isDeleted,
    deletedAt: comment.deletedAt ? comment.deletedAt.toISOString() : null,
    deletedBy: comment.deletedBy ?? null,
    deletedByName: options?.deletedByName ?? null,
    likesCount: comment._count?.likes ?? 0,
    likedByMe: Boolean(options?.likedByMe),
    createdAt: comment.createdAt.toISOString(),
  }
}

type GalleryInput = {
  id: string
  slug?: string
  title: string
  description: string
  authorUid: string
  author?: { publicId?: string; displayName?: string | null } | null
  authorName: string
  tags: unknown
  locationCode?: string | null
  locationDetail?: string | null
  copyright?: string | null
  status: ContentStatus
  reviewNote?: string | null
  reviewedBy?: string | null
  reviewedAt?: Date | null
  published: boolean
  publishedAt: Date | null
  likesCount?: number
  dislikesCount?: number
  favoritesCount?: number
  likedByMe?: boolean
  dislikedByMe?: boolean
  favoritedByMe?: boolean
  deletedAt?: Date | null
  deletedBy?: string | null
  createdAt: Date
  updatedAt: Date
  location?: { code: string; name: string; fullName: string } | null
  images: {
    id: string
    url: string
    name: string
    sortOrder: number
    assetId?: string | null
    asset?: {
      id: string
      publicUrl: string
      fileName: string
      mimeType: string
      sizeBytes: number
      status: string
      storageKey: string
    } | null
  }[]
}

type GalleryImageMapEntry = {
  localUrl: string
  externalUrl: string | null
  s3Url: string | null
  thumbnailUrl: string | null
  variantStatus: VariantStatus | null
}

function resolveGalleryImageLocalUrl(image: GalleryInput['images'][number]) {
  if (image.asset?.storageKey) {
    return `/uploads/${image.asset.storageKey}`
  }
  if (image.url?.startsWith('/uploads/')) {
    return image.url
  }
  return null
}

function resolveImageUrl(
  image: GalleryInput['images'][number],
  imageMapByLocalUrl: Map<string, GalleryImageMapEntry>
) {
  let url = image.asset?.publicUrl || image.url
  const localUrl = resolveGalleryImageLocalUrl(image)

  if (localUrl) {
    const imageMap = imageMapByLocalUrl.get(localUrl)

    if (imageMap) {
      url = imageMap.localUrl || url
    }
  }

  return url
}

function resolveThumbnailUrl(
  image: GalleryInput['images'][number],
  imageMapByLocalUrl: Map<string, GalleryImageMapEntry>
): string | null {
  const localUrl = resolveGalleryImageLocalUrl(image)
  if (localUrl) {
    const imageMap = imageMapByLocalUrl.get(localUrl)

    if (imageMap?.thumbnailUrl) {
      return imageMap.thumbnailUrl
    }
  }

  return null
}

function resolveThumbnailStatus(
  image: GalleryInput['images'][number],
  imageMapByLocalUrl: Map<string, GalleryImageMapEntry>
): VariantStatus | null {
  const localUrl = resolveGalleryImageLocalUrl(image)
  if (!localUrl) return null
  return imageMapByLocalUrl.get(localUrl)?.variantStatus ?? null
}

export async function toGalleryResponse(gallery: GalleryInput, storageStrategy?: string) {
  void storageStrategy

  const localUrls: string[] = []
  for (const img of gallery.images) {
    const localUrl = resolveGalleryImageLocalUrl(img)
    if (localUrl) {
      localUrls.push(localUrl)
    }
  }

  const imageMaps =
    localUrls.length > 0
      ? await prisma.imageMap.findMany({
          where: {
            deletedAt: null,
            localUrl: { in: localUrls },
          },
          select: {
            localUrl: true,
            externalUrl: true,
            s3Url: true,
            thumbnailUrl: true,
            variantStatus: true,
          },
        })
      : []

  const imageMapByLocalUrl = new Map(imageMaps.map((im) => [im.localUrl, im]))

  return {
    id: gallery.id,
    slug: gallery.slug || gallery.id,
    title: gallery.title,
    description: gallery.description,
    authorUid: gallery.authorUid,
    authorPublicId: gallery.author?.publicId || null,
    authorName: gallery.authorName,
    tags: serializeTags(gallery.tags),
    locationCode: gallery.locationCode || null,
    locationName: gallery.location?.fullName || null,
    locationDetail: gallery.locationDetail || null,
    copyright: gallery.copyright || null,
    status: gallery.status,
    reviewNote: gallery.reviewNote ?? null,
    reviewedBy: gallery.reviewedBy ?? null,
    reviewedAt: gallery.reviewedAt ? gallery.reviewedAt.toISOString() : null,
    published: gallery.published,
    publishedAt: gallery.publishedAt ? gallery.publishedAt.toISOString() : null,
    likesCount: gallery.likesCount ?? 0,
    dislikesCount: gallery.dislikesCount ?? 0,
    favoritesCount: gallery.favoritesCount ?? 0,
    likedByMe: Boolean(gallery.likedByMe),
    dislikedByMe: Boolean(gallery.dislikedByMe),
    favoritedByMe: Boolean(gallery.favoritedByMe),
    isDeleted: Boolean(gallery.deletedAt),
    deletedAt: gallery.deletedAt ? gallery.deletedAt.toISOString() : null,
    deletedBy: gallery.deletedBy ?? null,
    createdAt: gallery.createdAt.toISOString(),
    updatedAt: gallery.updatedAt.toISOString(),
    images: gallery.images
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((image) => ({
        id: image.id,
        assetId: image.assetId || image.asset?.id || null,
        url: resolveThumbnailUrl(image, imageMapByLocalUrl) || '',
        originalUrl: resolveImageUrl(image, imageMapByLocalUrl),
        thumbnailUrl: resolveThumbnailUrl(image, imageMapByLocalUrl),
        thumbnailStatus: resolveThumbnailStatus(image, imageMapByLocalUrl),
        name: image.asset?.fileName || image.name,
        mimeType: image.asset?.mimeType || null,
        sizeBytes: image.asset?.sizeBytes || null,
      })),
  }
}

export async function toGalleryListResponse(galleries: GalleryInput[], storageStrategy?: string) {
  if (galleries.length === 0) return []
  void storageStrategy

  const allLocalUrls: string[] = []
  for (const gallery of galleries) {
    for (const img of gallery.images) {
      const localUrl = resolveGalleryImageLocalUrl(img)
      if (localUrl) {
        allLocalUrls.push(localUrl)
      }
    }
  }

  const imageMaps =
    allLocalUrls.length > 0
      ? await prisma.imageMap.findMany({
          where: {
            deletedAt: null,
            localUrl: { in: allLocalUrls },
          },
          select: {
            localUrl: true,
            externalUrl: true,
            s3Url: true,
            thumbnailUrl: true,
            variantStatus: true,
          },
        })
      : []

  const imageMapByLocalUrl = new Map(imageMaps.map((im) => [im.localUrl, im]))

  return galleries.map((gallery) => ({
    id: gallery.id,
    slug: gallery.slug || gallery.id,
    title: gallery.title,
    description: gallery.description,
    authorUid: gallery.authorUid,
    authorPublicId: gallery.author?.publicId || null,
    authorName: gallery.authorName,
    tags: serializeTags(gallery.tags),
    locationCode: gallery.locationCode || null,
    locationName: gallery.location?.fullName || null,
    locationDetail: gallery.locationDetail || null,
    copyright: gallery.copyright || null,
    status: gallery.status,
    reviewNote: gallery.reviewNote ?? null,
    reviewedBy: gallery.reviewedBy ?? null,
    reviewedAt: gallery.reviewedAt ? gallery.reviewedAt.toISOString() : null,
    published: gallery.published,
    publishedAt: gallery.publishedAt ? gallery.publishedAt.toISOString() : null,
    likesCount: gallery.likesCount ?? 0,
    dislikesCount: gallery.dislikesCount ?? 0,
    favoritesCount: gallery.favoritesCount ?? 0,
    likedByMe: Boolean(gallery.likedByMe),
    dislikedByMe: Boolean(gallery.dislikedByMe),
    favoritedByMe: Boolean(gallery.favoritedByMe),
    isDeleted: Boolean(gallery.deletedAt),
    deletedAt: gallery.deletedAt ? gallery.deletedAt.toISOString() : null,
    deletedBy: gallery.deletedBy ?? null,
    createdAt: gallery.createdAt.toISOString(),
    updatedAt: gallery.updatedAt.toISOString(),
    images: gallery.images
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((image) => ({
        id: image.id,
        assetId: image.assetId || image.asset?.id || null,
        url: resolveThumbnailUrl(image, imageMapByLocalUrl) || '',
        originalUrl: resolveImageUrl(image, imageMapByLocalUrl),
        thumbnailUrl: resolveThumbnailUrl(image, imageMapByLocalUrl),
        thumbnailStatus: resolveThumbnailStatus(image, imageMapByLocalUrl),
        name: image.asset?.fileName || image.name,
        mimeType: image.asset?.mimeType || null,
        sizeBytes: image.asset?.sizeBytes || null,
      })),
  }))
}

type EventImageInput = {
  id: string
  url: string
  name: string
  sortOrder: number
  assetId?: string | null
  asset?: {
    id: string
    publicUrl: string
    fileName: string
    mimeType: string
    sizeBytes: number
    status: string
    storageKey: string
  } | null
}

type EventInput = {
  id: string
  slug: string
  title: string
  location: string
  content: string
  timeSlots: unknown
  ticketPrices: unknown
  saleTimes: unknown
  lineup: unknown
  tags: unknown
  externalLinks: unknown
  relatedLinks: unknown
  sortStart?: string | null
  sortEnd?: string | null
  coverAssetId?: string | null
  coverUrl?: string | null
  coverName?: string | null
  coverAsset?: EventImageInput['asset']
  createdByUid: string
  updatedByUid?: string | null
  deletedAt?: Date | null
  deletedBy?: string | null
  createdAt: Date
  updatedAt: Date
  createdBy?: { displayName: string } | null
  updatedBy?: { displayName: string } | null
  posters: EventImageInput[]
}

function arrayJson(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function resolveEventCoverImage(event: EventInput): EventImageInput | null {
  if (!event.coverUrl && !event.coverAsset?.publicUrl) return null
  return {
    id: event.coverAssetId || 'cover',
    assetId: event.coverAssetId || null,
    url: event.coverUrl || event.coverAsset?.publicUrl || '',
    name: event.coverName || event.coverAsset?.fileName || 'cover',
    sortOrder: 0,
    asset: event.coverAsset || null,
  }
}

function collectEventImageMaps(events: EventInput[]) {
  const localUrls: string[] = []
  for (const event of events) {
    const cover = resolveEventCoverImage(event)
    if (cover) {
      const coverLocalUrl = resolveGalleryImageLocalUrl(cover)
      if (coverLocalUrl) localUrls.push(coverLocalUrl)
    }
    for (const poster of event.posters) {
      const localUrl = resolveGalleryImageLocalUrl(poster)
      if (localUrl) localUrls.push(localUrl)
    }
  }
  return localUrls
}

async function loadImageMapsByLocalUrl(localUrls: string[]) {
  if (localUrls.length === 0) return new Map<string, GalleryImageMapEntry>()
  const uniqueLocalUrls = [...new Set(localUrls)]
  const imageMaps = await prisma.imageMap.findMany({
    where: {
      deletedAt: null,
      localUrl: { in: uniqueLocalUrls },
    },
    select: {
      localUrl: true,
      externalUrl: true,
      s3Url: true,
      thumbnailUrl: true,
      variantStatus: true,
    },
  })
  return new Map(imageMaps.map((im) => [im.localUrl, im]))
}

function toEventPosterResponse(
  image: EventImageInput,
  imageMapByLocalUrl: Map<string, GalleryImageMapEntry>
) {
  const thumbnailUrl = resolveThumbnailUrl(image, imageMapByLocalUrl)
  const originalUrl = resolveImageUrl(image, imageMapByLocalUrl)

  return {
    id: image.id,
    assetId: image.assetId || image.asset?.id || null,
    url: thumbnailUrl || originalUrl,
    originalUrl,
    thumbnailUrl,
    thumbnailStatus: resolveThumbnailStatus(image, imageMapByLocalUrl),
    name: image.asset?.fileName || image.name,
  }
}

function toEventResponseWithImageMaps(
  event: EventInput,
  imageMapByLocalUrl: Map<string, GalleryImageMapEntry>
) {
  const cover = resolveEventCoverImage(event)
  const coverResponse = cover ? toEventPosterResponse(cover, imageMapByLocalUrl) : null

  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    location: event.location,
    content: event.content,
    timeSlots: arrayJson(event.timeSlots),
    ticketPrices: arrayJson(event.ticketPrices),
    saleTimes: arrayJson(event.saleTimes),
    lineup: arrayJson(event.lineup),
    tags: serializeTags(event.tags),
    externalLinks: arrayJson(event.externalLinks),
    relatedLinks: arrayJson(event.relatedLinks),
    sortStart: event.sortStart || null,
    sortEnd: event.sortEnd || null,
    coverAssetId: event.coverAssetId || null,
    coverUrl: coverResponse?.originalUrl || event.coverUrl || null,
    coverName: event.coverName || event.coverAsset?.fileName || null,
    coverThumbnailUrl: coverResponse?.thumbnailUrl || null,
    coverThumbnailStatus: coverResponse?.thumbnailStatus || null,
    createdByUid: event.createdByUid,
    createdByName: event.createdBy?.displayName || null,
    updatedByUid: event.updatedByUid || null,
    updatedByName: event.updatedBy?.displayName || null,
    isDeleted: Boolean(event.deletedAt),
    deletedAt: event.deletedAt ? event.deletedAt.toISOString() : null,
    deletedBy: event.deletedBy || null,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
    posters: [...event.posters]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((poster) => toEventPosterResponse(poster, imageMapByLocalUrl)),
  }
}

export async function toEventResponse(event: EventInput) {
  const imageMapByLocalUrl = await loadImageMapsByLocalUrl(collectEventImageMaps([event]))
  return toEventResponseWithImageMaps(event, imageMapByLocalUrl)
}

export async function toEventListResponse(events: EventInput[]) {
  if (events.length === 0) return []
  const imageMapByLocalUrl = await loadImageMapsByLocalUrl(collectEventImageMaps(events))
  return events.map((event) => toEventResponseWithImageMaps(event, imageMapByLocalUrl))
}

export function toMusicResponse(track: {
  docId: string
  slug?: string
  title: string
  artists: string[]
  lyricists?: string[]
  composers?: string[]
  arrangers?: string[]
  vocals?: string[]
  album: string
  audioUrl: string
  lyric?: string | null
  releaseDate?: Date | null
  durationMs?: number | null
  coverId?: string | null
  coverAlbumDocId?: string | null
  covers?: Array<{
    id: string
    publicUrl: string
    thumbnailUrl?: string | null
    isDefault?: boolean
  }>
  albumRelations?: Array<{
    album: {
      docId: string
      coverId: string | null
      covers: Array<{
        id: string
        publicUrl: string
        thumbnailUrl?: string | null
        isDefault?: boolean
      }>
    }
  }>
  externalSources?: MusicExternalSourceRecord[]
  displayAlbumMode: string
  manualAlbumName?: string | null
  deletedAt?: Date | null
  deletedBy?: string | null
  createdAt: Date
  updatedAt: Date
}) {
  const cover = resolveSongCoverUrl({
    coverId: track.coverId ?? null,
    coverAlbumDocId: track.coverAlbumDocId ?? null,
    covers: track.covers || [],
    albumRelations: track.albumRelations || [],
  })
  const coverThumbnail = resolveSongCoverThumbnailUrl({
    coverId: track.coverId ?? null,
    coverAlbumDocId: track.coverAlbumDocId ?? null,
    covers: track.covers || [],
    albumRelations: track.albumRelations || [],
  })

  return {
    docId: track.docId,
    slug: track.slug || track.docId,
    title: track.title,
    artists: normalizeStringListInput(track.artists),
    lyricists: normalizeStringListInput(track.lyricists),
    composers: normalizeStringListInput(track.composers),
    arrangers: normalizeStringListInput(track.arrangers),
    vocals: normalizeStringListInput(track.vocals),
    album: track.album,
    cover,
    coverThumbnail,
    audioUrl: track.audioUrl,
    lyric: track.lyric || null,
    releaseDate: formatDateOnly(track.releaseDate),
    durationMs: track.durationMs ?? null,
    sources: serializeMusicExternalSources(track.externalSources || []),
    playable: isPlayableSong(track),
    displayAlbumMode: track.displayAlbumMode,
    manualAlbumName: track.manualAlbumName || null,
    isDeleted: Boolean(track.deletedAt),
    deletedAt: track.deletedAt ? track.deletedAt.toISOString() : null,
    deletedBy: track.deletedBy ?? null,
    createdAt: track.createdAt.toISOString(),
    updatedAt: track.updatedAt.toISOString(),
  }
}

export function toEditLockResponse(lock: {
  id: string
  collection: string
  recordId: string
  userId: string
  username: string
  createdAt: Date
  expiresAt: Date
}) {
  return {
    ...lock,
    createdAt: lock.createdAt.toISOString(),
    expiresAt: lock.expiresAt.toISOString(),
  }
}

export function toUserResponse(user: {
  uid: string
  publicId: string
  email: string
  displayName: string
  photoURL: string | null
  role: PrismaUserRole
  status: UserStatus
  banReason: string | null
  bannedAt: Date | null
  emailVerifiedAt?: Date | null
  level: number
  signature: string
  bio: string
  deletedAt?: Date | null
  deletedBy?: string | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    ...user,
    emailVerified: Boolean(user.emailVerifiedAt),
    emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
    isDeleted: Boolean(user.deletedAt),
    deletedAt: user.deletedAt ? user.deletedAt.toISOString() : null,
    deletedBy: user.deletedBy ?? null,
    bannedAt: user.bannedAt ? user.bannedAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  }
}

export function toUploadSessionResponse(session: {
  id: string
  ownerUid: string
  status: string
  maxFiles: number
  uploadedFiles: number
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: session.id,
    ownerUid: session.ownerUid,
    status: session.status,
    maxFiles: session.maxFiles,
    uploadedFiles: session.uploadedFiles,
    expiresAt: session.expiresAt.toISOString(),
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  }
}

export function toMediaAssetResponse(asset: {
  id: string
  ownerUid: string
  sessionId: string | null
  storageKey: string
  publicUrl: string
  fileName: string
  mimeType: string
  sizeBytes: number
  status: string
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: asset.id,
    ownerUid: asset.ownerUid,
    sessionId: asset.sessionId,
    storageKey: asset.storageKey,
    url: asset.publicUrl,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    status: asset.status,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  }
}

export function toSongResponse(
  song: MusicTrackWithRelations,
  options?: { favoritedByMe?: boolean; excludeLyric?: boolean; excludeDescription?: boolean }
) {
  const displayAlbum = resolveSongDisplayAlbum(song)
  const coverUrl = resolveSongCoverUrl(song)
  const coverThumbnail = resolveSongCoverThumbnailUrl(song)
  const customPlatformLinks = normalizeSongCustomPlatformLinks(song.customPlatformLinks)

  const base = {
    docId: song.docId,
    slug: song.slug || song.docId,
    title: song.title,
    artists: normalizeStringListInput(song.artists),
    lyricists: normalizeStringListInput(song.lyricists),
    composers: normalizeStringListInput(song.composers),
    arrangers: normalizeStringListInput(song.arrangers),
    vocals: normalizeStringListInput(song.vocals),
    album: song.album,
    cover: coverUrl,
    coverThumbnail,
    audioUrl: song.audioUrl,
    releaseDate: formatDateOnly(song.releaseDate),
    durationMs: song.durationMs ?? null,
    sources: serializeMusicExternalSources(song.externalSources),
    playable: isPlayableSong(song),
    customPlatformLinks,
    displayAlbumMode: song.displayAlbumMode,
    displayAlbum,
    manualAlbumName: song.manualAlbumName,
    coverId: song.coverId,
    coverAlbumDocId: song.coverAlbumDocId,
    covers: song.covers.map((cover) => ({
      id: cover.id,
      url: cover.publicUrl,
      thumbnailUrl: cover.thumbnailUrl,
      isDefault: cover.isDefault,
      sortOrder: cover.sortOrder,
    })),
    linkedAlbums: song.albumRelations.map((relation) => ({
      albumDocId: relation.albumDocId,
      albumId: relation.album.docId,
      albumSlug: relation.album.slug,
      title: relation.album.title,
      artist: relation.album.artist,
      discNumber: relation.discNumber,
      trackOrder: relation.trackOrder,
      isDisplay: relation.isDisplay,
    })),
    isInstrumental: (song.instrumentalLinks?.length || 0) > 0,
    favoritedByMe: Boolean(options?.favoritedByMe),
    createdAt: song.createdAt.toISOString(),
    updatedAt: song.updatedAt.toISOString(),
  }

  const withOptionalFields = {
    ...base,
    ...(options?.excludeLyric ? {} : { lyric: song.lyric }),
    ...(options?.excludeDescription ? {} : { description: song.description }),
  }

  return withOptionalFields
}

export function toAlbumResponse(album: {
  docId: string
  slug?: string
  title: string
  artist: string
  description: string | null
  tracks?: Prisma.JsonValue
  releaseDate?: Date | null
  coverId: string | null
  deletedAt?: Date | null
  deletedBy?: string | null
  createdAt: Date
  updatedAt: Date
  covers?: Array<{
    id: string
    publicUrl: string
    thumbnailUrl?: string | null
    isDefault: boolean
    sortOrder: number
  }>
  externalSources?: MusicExternalSourceRecord[]
  songRelations?: Array<{
    songDocId: string
    discNumber: number
    trackOrder: number
    isDisplay: boolean
    song?: {
      docId: string
      slug?: string
      title: string
      artists: string[]
      coverId: string | null
      coverAlbumDocId: string | null
      covers: Array<{
        id: string
        publicUrl: string
        thumbnailUrl?: string | null
        isDefault: boolean
      }>
      albumRelations: MusicTrackWithRelations['albumRelations']
    }
  }>
}) {
  const coverUrl = resolveAlbumCoverUrl({
    coverId: album.coverId,
    covers: album.covers || [],
  })
  const coverThumbnail = resolveAlbumCoverThumbnailUrl({
    coverId: album.coverId,
    covers: album.covers || [],
  })

  return {
    docId: album.docId,
    slug: album.slug || album.docId,
    title: album.title,
    artist: album.artist,
    cover: coverUrl,
    coverThumbnail,
    description: album.description,
    sources: serializeMusicExternalSources(album.externalSources || []),
    releaseDate: formatDateOnly(album.releaseDate),
    tracks: album.tracks || [],
    coverId: album.coverId,
    isDeleted: Boolean(album.deletedAt),
    deletedAt: album.deletedAt ? album.deletedAt.toISOString() : null,
    deletedBy: album.deletedBy ?? null,
    covers: (album.covers || []).map((cover) => ({
      id: cover.id,
      url: cover.publicUrl,
      thumbnailUrl: cover.thumbnailUrl,
      isDefault: cover.isDefault,
      sortOrder: cover.sortOrder,
    })),
    songs: (album.songRelations || []).map((relation) => ({
      songDocId: relation.songDocId,
      discNumber: relation.discNumber,
      trackOrder: relation.trackOrder,
      isDisplay: relation.isDisplay,
      song: relation.song
        ? {
            docId: relation.song.docId,
            slug: relation.song.slug || relation.song.docId,
            title: relation.song.title,
            artists: normalizeStringListInput(relation.song.artists),
            cover: resolveSongCoverUrl(relation.song),
            coverThumbnail: resolveSongCoverThumbnailUrl(relation.song),
          }
        : null,
    })),
    createdAt: album.createdAt.toISOString(),
    updatedAt: album.updatedAt.toISOString(),
  }
}
