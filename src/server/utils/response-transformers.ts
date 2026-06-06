// API 响应 → DTO 转换器

import { serializeTags } from './parsers';

import {
  resolveSongDisplayAlbum,
  resolveSongCoverUrl,
  normalizeSongCustomPlatformLinks,
} from './music';

import {
  Prisma,
  UserRole as PrismaUserRole,
} from '@prisma/client';
import { RELATION_TYPE_LABELS } from '../../lib/relationConstants';

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
  MusicCollectionType,
  WikiRelationRecord,
  WikiRelationResolved,
  WikiRelationGraphNode,
  WikiRelationGraphEdge,
  MusicTrackWithRelations,
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
} from '../types';

import { prisma } from './config';

// ---------------------------------------------------------------------------
// 内部辅助：serializeRelations 及其依赖链（原 index.ts 局部函数）
// ---------------------------------------------------------------------------

const RELATION_LABEL_TO_TYPE: Record<string, WikiRelationType> = Object.fromEntries(
  Object.entries(RELATION_TYPE_LABELS).map(([type, label]) => [label, type as WikiRelationType])
);

function parseBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true' || lowered === '1') return true;
    if (lowered === 'false' || lowered === '0') return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return fallback;
}

function normalizeWikiSlug(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function normalizeWikiRelationType(value: unknown): WikiRelationType | null {
  if (value === 'related_person' || value === 'work_relation' || value === 'timeline_relation' || value === 'custom') {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  const mapped = RELATION_LABEL_TO_TYPE[normalized];
  if (mapped) return mapped;
  return null;
}

function normalizeWikiRelationLabel(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, 60);
}

function normalizeWikiRelationList(value: unknown, sourceSlug?: string): WikiRelationRecord[] {
  if (Array.isArray(value)) {
    return doNormalizeArray(value, sourceSlug);
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return doNormalizeArray(parsed, sourceSlug);
      }
    } catch {
      // JSON parse failed — fall through to default empty return
    }
  }

  if (value != null && typeof value !== 'string') {
    console.warn('[normalizeWikiRelationList] Unexpected non-array input, data dropped:', typeof value);
  }

  return [] as WikiRelationRecord[];
}

function doNormalizeArray(value: unknown[], sourceSlug: string | undefined): WikiRelationRecord[] {
  const normalizedSourceSlug = normalizeWikiSlug(sourceSlug);
  const deduped = new Set<string>();
  const relations: WikiRelationRecord[] = [];

  value.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const record = item as Record<string, unknown>;

    const type = normalizeWikiRelationType(record.type);
    if (!type) return;

    const targetSlug = normalizeWikiSlug(record.targetSlug);
    if (!targetSlug) return;
    if (normalizedSourceSlug && targetSlug === normalizedSourceSlug) return;

    const label = normalizeWikiRelationLabel(record.label);
    const bidirectional = parseBoolean(record.bidirectional, true);

    const dedupeKey = `${type}|${targetSlug}|${(label || '').toLowerCase()}`;
    if (deduped.has(dedupeKey)) return;
    deduped.add(dedupeKey);

    relations.push({
      type,
      targetSlug,
      label,
      bidirectional,
    });
  });

  return relations.slice(0, 80);
}

function serializeRelations(value: unknown, sourceSlug?: string) {
  return normalizeWikiRelationList(value, sourceSlug);
}

// ---------------------------------------------------------------------------
// 导出的响应转换函数
// ---------------------------------------------------------------------------

export function toNotificationResponse(notification: {
  id: string;
  userUid: string;
  type: NotificationType;
  payload: unknown;
  isRead: boolean;
  createdAt: Date;
}) {
  return {
    id: notification.id,
    userUid: notification.userUid,
    type: notification.type,
    payload: notification.payload,
    isRead: notification.isRead,
    createdAt: notification.createdAt.toISOString(),
  };
}

export function toWikiResponse(page: WikiResponseInput) {
  const deletedAt = 'deletedAt' in page ? page.deletedAt as Date | null | undefined : null
  const deletedBy = 'deletedBy' in page ? page.deletedBy as string | null | undefined : null
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
    lastEditorName: page.lastEditor?.displayName || "匿名",
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  };
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
  };
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
  };
}

export function toPostResponse(post: {
  id: string;
  title: string;
  section: string;
  musicDocId?: string | null;
  albumDocId?: string | null;
  content: string;
  tags: unknown;
  locationCode?: string | null;
  locationDetail?: string | null;
  authorUid: string;
  author?: { displayName: string } | null;
  status: ContentStatus;
  reviewNote?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: Date | null;
  hotScore?: number;
  viewCount?: number;
  likesCount: number;
  dislikesCount: number;
  commentsCount: number;
  isPinned?: boolean;
  createdAt: Date;
  updatedAt: Date;
  location?: { code: string; name: string; fullName: string } | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
}) {
  return {
    ...post,
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
  };
}

const DELETED_COMMENT_PLACEHOLDER = '评论已删除'

type CommentResponseInput = {
  id: string;
  postId?: string | null;
  galleryId?: string | null;
  authorUid: string;
  content: string;
  parentId: string | null;
  replyToId?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  createdAt: Date;
  _count?: {
    likes?: number;
  };
  // author 关系是可选的——评论查询时如果忘记 include 就回退到 null/匿名，
  // 而不是直接抛 TS 错误。生产路径都应该 include 关系。
  author?: {
    displayName: string;
    photoURL: string | null;
  } | null;
  replyTo?: {
    authorUid: string;
    author?: {
      displayName: string;
    } | null;
  } | null;
}

export function toCommentResponse(comment: CommentResponseInput, options?: {
  maskDeletedContent?: boolean;
  hideDeletedAuthor?: boolean;
  likedByMe?: boolean;
  deletedByName?: string | null;
}) {
  const isDeleted = Boolean(comment.deletedAt)
  const hideDeletedAuthor = Boolean(options?.hideDeletedAuthor && isDeleted)
  return {
    id: comment.id,
    postId: comment.postId ?? null,
    galleryId: comment.galleryId ?? null,
    authorUid: comment.authorUid,
    authorName: hideDeletedAuthor ? null : comment.author?.displayName ?? '匿名用户',
    authorPhoto: hideDeletedAuthor ? null : comment.author?.photoURL ?? null,
    content: options?.maskDeletedContent && isDeleted ? DELETED_COMMENT_PLACEHOLDER : comment.content,
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
  };
}

type GalleryInput = {
  id: string;
  title: string;
  description: string;
  authorUid: string;
  authorName: string;
  tags: unknown;
  locationCode?: string | null;
  locationDetail?: string | null;
  copyright?: string | null;
  published: boolean;
  publishedAt: Date | null;
  likesCount?: number;
  dislikesCount?: number;
  favoritesCount?: number;
  likedByMe?: boolean;
  dislikedByMe?: boolean;
  favoritedByMe?: boolean;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
  location?: { code: string; name: string; fullName: string } | null;
  images: {
    id: string;
    url: string;
    name: string;
    sortOrder: number;
    assetId?: string | null;
    asset?: {
      id: string;
      publicUrl: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      status: string;
      storageKey: string;
    } | null;
  }[];
};

function resolveImageUrl(
  image: GalleryInput['images'][number],
  imageMapByLocalUrl: Map<string, { localUrl: string; externalUrl: string | null; s3Url: string | null; thumbnailUrl: string | null }>,
  storageStrategy: 'local' | 's3' | 'external',
) {
  let url = image.asset?.publicUrl || image.url;

  if (image.asset?.storageKey) {
    const localUrl = `/uploads/${image.asset.storageKey}`;
    const imageMap = imageMapByLocalUrl.get(localUrl);

    if (imageMap) {
      switch (storageStrategy) {
        case 'external':
          url = imageMap.externalUrl || imageMap.s3Url || imageMap.localUrl || url;
          break;
        case 's3':
          url = imageMap.s3Url || imageMap.externalUrl || imageMap.localUrl || url;
          break;
        case 'local':
        default:
          url = imageMap.localUrl || url;
          break;
      }
    }
  }

  return url;
}

function resolveThumbnailUrl(
  image: GalleryInput['images'][number],
  imageMapByLocalUrl: Map<string, { localUrl: string; externalUrl: string | null; s3Url: string | null; thumbnailUrl: string | null }>,
): string | null {
  if (image.asset?.storageKey) {
    const localUrl = `/uploads/${image.asset.storageKey}`;
    const imageMap = imageMapByLocalUrl.get(localUrl);

    if (imageMap?.thumbnailUrl) {
      return imageMap.thumbnailUrl;
    }
  }

  return null;
}

export async function toGalleryResponse(gallery: GalleryInput, storageStrategy?: string) {
  let resolvedStorageStrategy: 'local' | 's3' | 'external' = 'local';

  if (storageStrategy && ['local', 's3', 'external'].includes(storageStrategy)) {
    resolvedStorageStrategy = storageStrategy as 'local' | 's3' | 'external';
  } else {
    try {
      const storageConfig = await prisma.siteConfig.findUnique({
        where: { key: 'image_preference' },
        select: { value: true },
      });
      const preference = storageConfig?.value as { strategy?: 'local' | 's3' | 'external' } | undefined;
      resolvedStorageStrategy = preference?.strategy || 'local';
    } catch (error) {
      console.warn('Failed to get storage strategy:', error);
    }
  }

  const localUrls: string[] = [];
  for (const img of gallery.images) {
    if (img.asset?.storageKey) {
      localUrls.push(`/uploads/${img.asset.storageKey}`);
    }
  }

  const imageMaps = localUrls.length > 0
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
        },
      })
    : [];

  const imageMapByLocalUrl = new Map(imageMaps.map(im => [im.localUrl, im]));

  return {
    id: gallery.id,
    title: gallery.title,
    description: gallery.description,
    authorUid: gallery.authorUid,
    authorName: gallery.authorName,
    tags: serializeTags(gallery.tags),
    locationCode: gallery.locationCode || null,
    locationName: gallery.location?.fullName || null,
    locationDetail: gallery.locationDetail || null,
    copyright: gallery.copyright || null,
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
        originalUrl: resolveImageUrl(image, imageMapByLocalUrl, resolvedStorageStrategy),
        thumbnailUrl: resolveThumbnailUrl(image, imageMapByLocalUrl),
        name: image.asset?.fileName || image.name,
        mimeType: image.asset?.mimeType || null,
        sizeBytes: image.asset?.sizeBytes || null,
      })),
  };
}

export async function toGalleryListResponse(galleries: GalleryInput[], storageStrategy?: string) {
  if (galleries.length === 0) return [];

  let resolvedStorageStrategy: 'local' | 's3' | 'external' = 'local';

  if (storageStrategy && ['local', 's3', 'external'].includes(storageStrategy)) {
    resolvedStorageStrategy = storageStrategy as 'local' | 's3' | 'external';
  } else {
    try {
      const storageConfig = await prisma.siteConfig.findUnique({
        where: { key: 'image_preference' },
        select: { value: true },
      });
      const preference = storageConfig?.value as { strategy?: 'local' | 's3' | 'external' } | undefined;
      resolvedStorageStrategy = preference?.strategy || 'local';
    } catch (error) {
      console.warn('Failed to get storage strategy:', error);
    }
  }

  const allLocalUrls: string[] = [];
  for (const gallery of galleries) {
    for (const img of gallery.images) {
      if (img.asset?.storageKey) {
        allLocalUrls.push(`/uploads/${img.asset.storageKey}`);
      }
    }
  }

  const imageMaps = allLocalUrls.length > 0
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
        },
      })
    : [];

  const imageMapByLocalUrl = new Map(imageMaps.map(im => [im.localUrl, im]));

  return galleries.map((gallery) => ({
    id: gallery.id,
    title: gallery.title,
    description: gallery.description,
    authorUid: gallery.authorUid,
    authorName: gallery.authorName,
    tags: serializeTags(gallery.tags),
    locationCode: gallery.locationCode || null,
    locationName: gallery.location?.fullName || null,
    locationDetail: gallery.locationDetail || null,
    copyright: gallery.copyright || null,
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
        originalUrl: resolveImageUrl(image, imageMapByLocalUrl, resolvedStorageStrategy),
        thumbnailUrl: resolveThumbnailUrl(image, imageMapByLocalUrl),
        name: image.asset?.fileName || image.name,
        mimeType: image.asset?.mimeType || null,
        sizeBytes: image.asset?.sizeBytes || null,
      })),
  }));
}

export function toMusicResponse(track: {
  docId: string;
  id: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  audioUrl: string;
  lyric?: string | null;
  primaryPlatform: string;
  enabledPlatform?: string | null;
  neteaseId?: string | null;
  tencentId?: string | null;
  kugouId?: string | null;
  baiduId?: string | null;
  kuwoId?: string | null;
  displayAlbumMode: string;
  manualAlbumName?: string | null;
  defaultCoverSource?: string | null;
  addedBy?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    docId: track.docId,
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    cover: track.cover || track.defaultCoverSource || '',
    audioUrl: track.audioUrl,
    lyric: track.lyric || null,
    primaryPlatform: track.primaryPlatform,
    enabledPlatform: track.enabledPlatform || null,
    platforms: {
      netease: track.neteaseId,
      tencent: track.tencentId,
      kugou: track.kugouId,
      baidu: track.baiduId,
      kuwo: track.kuwoId,
    },
    displayAlbumMode: track.displayAlbumMode,
    manualAlbumName: track.manualAlbumName || null,
    addedBy: track.addedBy || null,
    isDeleted: Boolean(track.deletedAt),
    deletedAt: track.deletedAt ? track.deletedAt.toISOString() : null,
    deletedBy: track.deletedBy ?? null,
    createdAt: track.createdAt.toISOString(),
    updatedAt: track.updatedAt.toISOString(),
  };
}

export function toEditLockResponse(lock: {
  id: string;
  collection: string;
  recordId: string;
  userId: string;
  username: string;
  createdAt: Date;
  expiresAt: Date;
}) {
  return {
    ...lock,
    createdAt: lock.createdAt.toISOString(),
    expiresAt: lock.expiresAt.toISOString(),
  };
}

export function toUserResponse(user: {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  role: PrismaUserRole;
  status: UserStatus;
  banReason: string | null;
  bannedAt: Date | null;
  level: number;
  signature: string;
  bio: string;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...user,
    isDeleted: Boolean(user.deletedAt),
    deletedAt: user.deletedAt ? user.deletedAt.toISOString() : null,
    deletedBy: user.deletedBy ?? null,
    bannedAt: user.bannedAt ? user.bannedAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function toUploadSessionResponse(session: {
  id: string;
  ownerUid: string;
  status: string;
  maxFiles: number;
  uploadedFiles: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
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
  };
}

export function toMediaAssetResponse(asset: {
  id: string;
  ownerUid: string;
  sessionId: string | null;
  storageKey: string;
  publicUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
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
  };
}

export function toSongResponse(song: MusicTrackWithRelations, options?: { favoritedByMe?: boolean; excludeLyric?: boolean }) {
  const displayAlbum = resolveSongDisplayAlbum(song);
  const coverUrl = resolveSongCoverUrl(song);
  const customPlatformLinks = normalizeSongCustomPlatformLinks(song.customPlatformLinks);

  const base = {
    docId: song.docId,
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    cover: coverUrl,
    audioUrl: song.audioUrl,
    primaryPlatform: song.primaryPlatform,
    enabledPlatform: song.enabledPlatform,
    platformIds: {
      neteaseId: song.neteaseId,
      tencentId: song.tencentId,
      kugouId: song.kugouId,
      baiduId: song.baiduId,
      kuwoId: song.kuwoId,
    },
    customPlatformLinks,
    displayAlbumMode: song.displayAlbumMode,
    displayAlbum,
    manualAlbumName: song.manualAlbumName,
    defaultCoverSource: song.defaultCoverSource,
    covers: song.covers.map((cover) => ({
      id: cover.id,
      url: cover.publicUrl,
      isDefault: cover.isDefault,
      sortOrder: cover.sortOrder,
    })),
    linkedAlbums: song.albumRelations.map((relation) => ({
      albumDocId: relation.albumDocId,
      albumId: relation.album.docId,
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

  if (options?.excludeLyric) return base
  return { ...base, lyric: song.lyric }
}

export function toAlbumResponse(album: {
  docId: string;
  id: string;
  resourceType: MusicCollectionType;
  platform: MusicPlatform;
  sourceId: string;
  title: string;
  artist: string;
  cover: string;
  description: string | null;
  platformUrl: string | null;
  tracks: Prisma.JsonValue;
  defaultCoverSource: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
  covers?: Array<{
    id: string;
    publicUrl: string;
    isDefault: boolean;
    sortOrder: number;
  }>;
  songRelations?: Array<{
    songDocId: string;
    discNumber: number;
    trackOrder: number;
    isDisplay: boolean;
    song?: {
      docId: string;
      id: string;
      title: string;
      artist: string;
      cover: string;
    };
  }>;
}) {
  return {
    docId: album.docId,
    id: album.id,
    resourceType: album.resourceType,
    platform: album.platform,
    sourceId: album.sourceId,
    title: album.title,
    artist: album.artist,
    cover: album.cover,
    description: album.description,
    platformUrl: album.platformUrl,
    tracks: album.tracks || [],
    defaultCoverSource: album.defaultCoverSource,
    isDeleted: Boolean(album.deletedAt),
    deletedAt: album.deletedAt ? album.deletedAt.toISOString() : null,
    deletedBy: album.deletedBy ?? null,
    covers: (album.covers || []).map((cover) => ({
      id: cover.id,
      url: cover.publicUrl,
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
            id: relation.song.id,
            title: relation.song.title,
            artist: relation.song.artist,
            cover: relation.song.cover,
          }
        : null,
    })),
    createdAt: album.createdAt.toISOString(),
    updatedAt: album.updatedAt.toISOString(),
  };
}
