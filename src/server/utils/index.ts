import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  Prisma,
  UserRole as PrismaUserRole,
} from '@prisma/client';
import {
  parseMusicUrl,
  type MusicPlatform as ParsedMusicPlatform,
  type MusicResourceType as ParsedMusicResourceType,
} from '../music/musicUrlParser';
import {
  getMusicResourcePreview,
  resolveAudioUrl as resolveMetingAudioUrl,
  resolveLyric as resolveMetingLyric,
  resolveCoverUrl as resolveMetingCoverUrl,
  searchMusicResources,
} from '../music/metingService';
import {
  createUploadStorageInfo,
  getStorageKeyFromFilePath,
} from '../uploadPath';
import type {
  UserStatus,
  ContentStatus,
  WikiBranchStatus,
  WikiPullRequestStatus,
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
  WechatCodeSessionResponse,
  ApiUser,
  AuthenticatedRequest,
  WikiResponseInput,
  WikiRelationPageLite,
  WikiReverseRelationEntry,
  WikiRelationBundle,
  WikiBranchWithPage,
  WikiPullRequestWithRelations,
} from '../types';
import {
  WIKI_RELATION_SCAN_LIMIT,
  MUSIC_SECTION_ID,
  EDIT_LOCK_COLLECTION_ALLOWLIST,
  ALLOWED_IMAGE_EXTENSIONS,
  ALLOWED_IMAGE_MIME_TYPES,
} from '../types';
import { userToApiUser, isAdminRole } from '../middleware/auth';
import { prisma } from '../prisma';

const prismaAny = prisma as any;

// 注意：此文件不加载 dotenv，依赖 server.ts 中已加载的环境变量

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const defaultUploadsDir = path.join(__dirname, '..', '..', '..', 'uploads');
const uploadsDir = process.env.UPLOADS_PATH || defaultUploadsDir;
fs.mkdirSync(uploadsDir, { recursive: true });
const backupsDir = path.join(__dirname, '..', '..', '..', 'backups');
fs.mkdirSync(backupsDir, { recursive: true });

const SUPER_ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL || '';
const BACKUP_PASSWORD = process.env.BACKUP_PASSWORD || '';
const BACKUP_RETAIN_COUNT = Math.max(1, Number(process.env.BACKUP_RETAIN_COUNT || 20));
const WECHAT_MP_APPID = process.env.WECHAT_MP_APPID || process.env.WECHAT_APP_ID || '';
const WECHAT_MP_APP_SECRET =
  process.env.WECHAT_MP_APP_SECRET || process.env.WECHAT_MP_APPSECRET || process.env.WECHAT_APP_SECRET || '';
const WECHAT_LOGIN_MOCK = process.env.NODE_ENV !== 'production' && process.env.WECHAT_LOGIN_MOCK === 'true';
const UPLOAD_SESSION_TTL_MINUTES = Math.max(5, Number(process.env.UPLOAD_SESSION_TTL_MINUTES || 45));
const PLAY_URL_CACHE_TTL_MS = Math.max(60, Number(process.env.MUSIC_PLAY_URL_CACHE_TTL_SECONDS || 600)) * 1000;
const playUrlCache = new Map<string, PlayUrlCacheValue>();

const WIKI_RELATION_TYPE_LABELS: Record<WikiRelationType, string> = {
  related_person: '相关人物',
  work_relation: '作品关联',
  timeline_relation: '时间线关联',
  custom: '自定义关系',
};

const DEFAULT_MUSIC_PLATFORMS: MusicPlatform[] = ['netease', 'tencent', 'kugou', 'baidu', 'kuwo'];

function parseDate(date: string | Date | null | undefined) {
  if (!date) return null;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parseInteger(value: unknown, fallback: number, options?: { min?: number; max?: number }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  let normalized = Math.floor(parsed);
  if (typeof options?.min === 'number') {
    normalized = Math.max(options.min, normalized);
  }
  if (typeof options?.max === 'number') {
    normalized = Math.min(options.max, normalized);
  }
  return normalized;
}

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

function extractBase64Payload(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('data:')) {
    const commaIndex = trimmed.indexOf(',');
    if (commaIndex < 0) {
      return null;
    }
    return trimmed.slice(commaIndex + 1);
  }

  return trimmed;
}

function parseMinSimilarityScore(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.max(0, Math.min(1, parsed));
}

function toEmbeddingPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const galleryId = typeof record.galleryId === 'string' ? record.galleryId : '';
  const galleryImageId = typeof record.galleryImageId === 'string' ? record.galleryImageId : '';
  if (!galleryId || !galleryImageId) {
    return null;
  }

  return {
    galleryId,
    galleryImageId,
    imageUrl: typeof record.imageUrl === 'string' ? record.imageUrl : '',
    imageName: typeof record.imageName === 'string' ? record.imageName : '',
  };
}

function normalizeTagList(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 30);
}

function serializeTags(value: unknown) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [];
}

function hasTag(value: unknown, tag: string) {
  return serializeTags(value).some((item) => typeof item === 'string' && item === tag);
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
  if (normalized === '相关人物') return 'related_person';
  if (normalized === '作品关联') return 'work_relation';
  if (normalized === '时间线关联') return 'timeline_relation';
  if (normalized === '自定义关系') return 'custom';
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

function normalizeWikiRelationList(value: unknown, sourceSlug?: string) {
  if (!Array.isArray(value)) {
    return [] as WikiRelationRecord[];
  }

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

async function normalizeWikiRelationListForWrite(value: unknown, sourceSlug?: string) {
  const normalizedSourceSlug = normalizeWikiSlug(sourceSlug);
  const relations = normalizeWikiRelationList(value, normalizedSourceSlug);
  if (!relations.length) {
    return [] as WikiRelationRecord[];
  }

  const uniqueTargets = [...new Set(relations.map((item) => item.targetSlug))];
  const existingTargets = await prisma.wikiPage.findMany({
    where: {
      slug: {
        in: uniqueTargets,
      },
    },
    select: {
      slug: true,
    },
  });
  const targetSet = new Set(existingTargets.map((item) => item.slug));
  return relations.filter((item) => targetSet.has(item.targetSlug));
}

function serializeRelations(value: unknown, sourceSlug?: string) {
  return normalizeWikiRelationList(value, sourceSlug);
}

function relationTypeLabel(type: WikiRelationType) {
  return WIKI_RELATION_TYPE_LABELS[type] || '自定义关系';
}

function relationIdentityKey(relation: Pick<WikiRelationRecord, 'type' | 'targetSlug' | 'label'>) {
  return `${relation.type}|${relation.targetSlug}|${(relation.label || '').toLowerCase()}`;
}

function buildWikiReverseRelationIndex(pages: WikiRelationPageLite[]) {
  const index = new Map<string, WikiReverseRelationEntry[]>();

  pages.forEach((page) => {
    const relations = serializeRelations(page.relations, page.slug);
    relations.forEach((relation) => {
      if (!relation.bidirectional) return;
      const list = index.get(relation.targetSlug) || [];
      list.push({
        sourcePage: page,
        relation,
      });
      index.set(relation.targetSlug, list);
    });
  });

  return index;
}

function buildResolvedWikiRelations(
  centerPage: WikiRelationPageLite,
  pageMap: Map<string, WikiRelationPageLite>,
  reverseIndex: Map<string, WikiReverseRelationEntry[]>,
) {
  const resolved: WikiRelationResolved[] = [];
  const seen = new Set<string>();

  const centerRelations = serializeRelations(centerPage.relations, centerPage.slug);
  centerRelations.forEach((relation) => {
    const target = pageMap.get(relation.targetSlug);
    if (!target) return;

    const key = relationIdentityKey({
      type: relation.type,
      targetSlug: target.slug,
      label: relation.label,
    });
    if (seen.has(key)) return;
    seen.add(key);

    resolved.push({
      type: relation.type,
      typeLabel: relationTypeLabel(relation.type),
      targetSlug: target.slug,
      targetTitle: target.title,
      targetCategory: target.category,
      label: relation.label,
      bidirectional: relation.bidirectional,
      inferred: false,
      sourceSlug: centerPage.slug,
      sourceTitle: centerPage.title,
    });
  });

  const reverseEntries = reverseIndex.get(centerPage.slug) || [];
  reverseEntries.forEach((entry) => {
    if (entry.sourcePage.slug === centerPage.slug) return;

    const key = relationIdentityKey({
      type: entry.relation.type,
      targetSlug: entry.sourcePage.slug,
      label: entry.relation.label,
    });
    if (seen.has(key)) return;
    seen.add(key);

    resolved.push({
      type: entry.relation.type,
      typeLabel: relationTypeLabel(entry.relation.type),
      targetSlug: entry.sourcePage.slug,
      targetTitle: entry.sourcePage.title,
      targetCategory: entry.sourcePage.category,
      label: entry.relation.label,
      bidirectional: entry.relation.bidirectional,
      inferred: true,
      sourceSlug: entry.sourcePage.slug,
      sourceTitle: entry.sourcePage.title,
    });
  });

  return resolved.sort((a, b) => {
    const typeCompare = a.typeLabel.localeCompare(b.typeLabel, 'zh-CN');
    if (typeCompare !== 0) return typeCompare;
    return a.targetTitle.localeCompare(b.targetTitle, 'zh-CN');
  });
}

function buildWikiRelationGraph(
  centerPage: WikiRelationPageLite,
  pageMap: Map<string, WikiRelationPageLite>,
  reverseIndex: Map<string, WikiReverseRelationEntry[]>,
) {
  const edges: WikiRelationGraphEdge[] = [];
  const edgeSet = new Set<string>();

  const addEdge = (sourceSlug: string, targetSlug: string, relation: WikiRelationRecord, inferred: boolean) => {
    if (sourceSlug === targetSlug) return;
    if (!pageMap.has(sourceSlug) || !pageMap.has(targetSlug)) return;

    const edgeKey = `${sourceSlug}|${targetSlug}|${relation.type}|${(relation.label || '').toLowerCase()}`;
    if (edgeSet.has(edgeKey)) return;
    edgeSet.add(edgeKey);

    edges.push({
      sourceSlug,
      targetSlug,
      type: relation.type,
      typeLabel: relationTypeLabel(relation.type),
      label: relation.label || null,
      inferred,
    });
  };

  const centerRelations = serializeRelations(centerPage.relations, centerPage.slug);
  centerRelations.forEach((relation) => addEdge(centerPage.slug, relation.targetSlug, relation, false));

  const centerReverse = reverseIndex.get(centerPage.slug) || [];
  centerReverse.forEach((entry) => addEdge(entry.sourcePage.slug, centerPage.slug, entry.relation, true));

  const firstLayer = new Set<string>();
  edges.forEach((edge) => {
    if (edge.sourceSlug === centerPage.slug) {
      firstLayer.add(edge.targetSlug);
    }
    if (edge.targetSlug === centerPage.slug) {
      firstLayer.add(edge.sourceSlug);
    }
  });

  firstLayer.forEach((slug) => {
    const page = pageMap.get(slug);
    if (!page) return;

    const relations = serializeRelations(page.relations, page.slug);
    relations.forEach((relation) => addEdge(page.slug, relation.targetSlug, relation, false));

    const reverseEntries = reverseIndex.get(page.slug) || [];
    reverseEntries.forEach((entry) => addEdge(entry.sourcePage.slug, page.slug, entry.relation, true));
  });

  const adjacency = new Map<string, Set<string>>();
  edges.forEach((edge) => {
    const sourceNeighbors = adjacency.get(edge.sourceSlug) || new Set<string>();
    sourceNeighbors.add(edge.targetSlug);
    adjacency.set(edge.sourceSlug, sourceNeighbors);

    const targetNeighbors = adjacency.get(edge.targetSlug) || new Set<string>();
    targetNeighbors.add(edge.sourceSlug);
    adjacency.set(edge.targetSlug, targetNeighbors);
  });

  const depthMap = new Map<string, number>();
  depthMap.set(centerPage.slug, 0);
  const queue: string[] = [centerPage.slug];

  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    const currentDepth = depthMap.get(current);
    if (currentDepth === undefined || currentDepth >= 2) continue;

    const neighbors = adjacency.get(current);
    if (!neighbors) continue;

    neighbors.forEach((nextSlug) => {
      if (depthMap.has(nextSlug)) return;
      const nextDepth = currentDepth + 1;
      if (nextDepth > 2) return;
      depthMap.set(nextSlug, nextDepth);
      queue.push(nextSlug);
    });
  }

  const nodes: WikiRelationGraphNode[] = [];
  depthMap.forEach((depth, slug) => {
    const page = pageMap.get(slug);
    if (!page) return;

    nodes.push({
      slug,
      title: page.title,
      category: page.category,
      depth: depth as 0 | 1 | 2,
      isCenter: slug === centerPage.slug,
    });
  });

  const nodeSet = new Set(nodes.map((node) => node.slug));
  const filteredEdges = edges.filter((edge) => nodeSet.has(edge.sourceSlug) && nodeSet.has(edge.targetSlug));

  nodes.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    if (a.isCenter !== b.isCenter) return a.isCenter ? -1 : 1;
    return a.title.localeCompare(b.title, 'zh-CN');
  });

  return {
    nodes,
    edges: filteredEdges,
  };
}

async function findWikiRelationCenterPage(slug: string, authUser?: ApiUser) {
  const centerPage = await prisma.wikiPage.findUnique({
    where: { slug },
    select: {
      slug: true,
      title: true,
      category: true,
      status: true,
      lastEditorUid: true,
      relations: true,
    },
  });

  if (!centerPage || !canViewWikiPage(centerPage, authUser)) {
    return null;
  }

  return centerPage as WikiRelationPageLite;
}

async function buildWikiRelationBundle(centerPage: WikiRelationPageLite, authUser?: ApiUser): Promise<WikiRelationBundle> {
  const visibilityWhere = buildWikiVisibilityWhere(authUser);

  const relationPages = await prisma.wikiPage.findMany({
    where: visibilityWhere,
    select: {
      slug: true,
      title: true,
      category: true,
      status: true,
      lastEditorUid: true,
      relations: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: WIKI_RELATION_SCAN_LIMIT,
  });

  const pageMap = new Map<string, WikiRelationPageLite>();
  relationPages.forEach((page) => {
    pageMap.set(page.slug, page as WikiRelationPageLite);
  });

  if (!pageMap.has(centerPage.slug)) {
    pageMap.set(centerPage.slug, centerPage);
  }

  const directTargetSlugs = [...new Set(serializeRelations(centerPage.relations, centerPage.slug).map((item) => item.targetSlug))];
  const missingDirectTargets = directTargetSlugs.filter((slug) => !pageMap.has(slug));

  if (missingDirectTargets.length) {
    const extraPages = await prisma.wikiPage.findMany({
      where: {
        ...visibilityWhere,
        slug: { in: missingDirectTargets },
      },
      select: {
        slug: true,
        title: true,
        category: true,
        status: true,
        lastEditorUid: true,
        relations: true,
      },
    });

    extraPages.forEach((page) => {
      pageMap.set(page.slug, page as WikiRelationPageLite);
    });
  }

  const allPages = [...pageMap.values()];
  const reverseIndex = buildWikiReverseRelationIndex(allPages);
  const relations = buildResolvedWikiRelations(centerPage, pageMap, reverseIndex);
  const graph = buildWikiRelationGraph(centerPage, pageMap, reverseIndex);

  return {
    centerPage,
    relations,
    graph,
  };
}

function canViewWikiPage(page: { status: ContentStatus; lastEditorUid: string }, authUser?: ApiUser) {
  if (page.status === 'published') return true;
  if (!authUser) return false;
  if (isAdminRole(authUser.role)) return true;
  return page.lastEditorUid === authUser.uid;
}

function canViewPost(post: { status: ContentStatus; authorUid: string }, authUser?: ApiUser) {
  if (post.status === 'published') return true;
  if (!authUser) return false;
  if (isAdminRole(authUser.role)) return true;
  return post.authorUid === authUser.uid;
}

function canViewGallery(gallery: { published: boolean; authorUid: string }, authUser?: ApiUser) {
  if (gallery.published) return true;
  if (!authUser) return false;
  if (isAdminRole(authUser.role)) return true;
  return gallery.authorUid === authUser.uid;
}

function canManageGallery(gallery: { authorUid: string }, authUser?: ApiUser) {
  if (!authUser) return false;
  if (isAdminRole(authUser.role)) return true;
  return gallery.authorUid === authUser.uid;
}

function buildWikiVisibilityWhere(authUser?: ApiUser) {
  if (!authUser) {
    return { status: 'published' as ContentStatus };
  }
  if (isAdminRole(authUser.role)) {
    return {};
  }
  return {
    OR: [
      { status: 'published' as ContentStatus },
      { lastEditorUid: authUser.uid },
    ],
  };
}

function buildPostVisibilityWhere(authUser?: ApiUser) {
  if (!authUser) {
    return { status: 'published' as ContentStatus };
  }
  if (isAdminRole(authUser.role)) {
    return {};
  }
  return {
    OR: [
      { status: 'published' as ContentStatus },
      { authorUid: authUser.uid },
    ],
  };
}

function parseContentStatus(value: unknown): ContentStatus | null {
  if (value === 'draft' || value === 'pending' || value === 'published' || value === 'rejected') {
    return value;
  }
  return null;
}

function normalizeWikiWriteStatus(rawStatus: unknown, authUser: ApiUser) {
  const status = parseContentStatus(rawStatus);
  if (isAdminRole(authUser.role)) {
    return 'published';
  }
  if (status === 'pending') return 'pending';
  if (status === 'rejected') return 'rejected';
  return 'draft';
}

function normalizePostWriteStatus(rawStatus: unknown, authUser: ApiUser) {
  const status = parseContentStatus(rawStatus);
  if (isAdminRole(authUser.role)) {
    return status || 'published';
  }
  if (status === 'pending') return 'pending';
  if (status === 'rejected') return 'rejected';
  return 'draft';
}

function parseFavoriteType(value: unknown): FavoriteTargetType | null {
  if (value === 'wiki' || value === 'post' || value === 'music') {
    return value;
  }
  return null;
}

function parseMusicPlatform(value: unknown): MusicPlatform | null {
  if (value === 'netease' || value === 'tencent' || value === 'kugou' || value === 'baidu' || value === 'kuwo') {
    return value;
  }
  return null;
}

function parseDisplayAlbumMode(value: unknown): DisplayAlbumMode | null {
  if (value === 'none' || value === 'linked' || value === 'manual') {
    return value;
  }
  return null;
}

function parseMusicCollectionType(value: unknown): MusicCollectionType | null {
  if (value === 'album' || value === 'playlist') {
    return value;
  }
  return null;
}

function parseBrowsingTargetType(value: unknown): BrowsingTargetType | null {
  if (value === 'wiki' || value === 'post' || value === 'music') {
    return value;
  }
  return null;
}

function parseModerationTargetType(value: unknown): ModerationTargetType | null {
  if (value === 'wiki' || value === 'post') {
    return value;
  }
  return null;
}

function normalizeModerationTargetType(value: unknown): ModerationTargetType | null {
  if (value === 'posts') {
    return 'post';
  }
  return parseModerationTargetType(value);
}

function parsePostSort(value: unknown): PostSortType {
  if (value === 'hot' || value === 'recommended') {
    return value;
  }
  return 'latest';
}

function normalizeOptionalDocId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeKeyword(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 64);
}

function calculatePostHotScore(post: {
  likesCount: number;
  commentsCount: number;
  viewCount?: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  const now = Date.now();
  const anchor = post.updatedAt && post.updatedAt > post.createdAt ? post.updatedAt : post.createdAt;
  const hoursSince = Math.max(0, (now - anchor.getTime()) / (1000 * 60 * 60));
  const timeDecay = 6 / (1 + (hoursSince / 24));
  const score = post.likesCount * 3 + post.commentsCount * 2 + (post.viewCount ?? 0) * 0.2 + timeDecay;
  return Number(score.toFixed(3));
}

async function refreshPostHotScore(postId: string) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      likesCount: true,
      commentsCount: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!post) return 0;

  const viewCountRow = await prisma.$queryRaw<Array<{ viewCount: number }>>`
    SELECT "viewCount" AS "viewCount"
    FROM "Post"
    WHERE "id" = ${postId}
    LIMIT 1
  `;
  const viewCount = Number(viewCountRow[0]?.viewCount || 0);

  const hotScore = calculatePostHotScore({
    likesCount: post.likesCount,
    commentsCount: post.commentsCount,
    viewCount,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  });

  await prisma.$executeRaw`UPDATE "Post" SET "hotScore" = ${hotScore} WHERE "id" = ${postId}`;
  return hotScore;
}

function toNotificationResponse(notification: {
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

async function createNotification(userUid: string, type: NotificationType, payload: Record<string, unknown>) {
  try {
    await prisma.notification.create({
      data: {
        userUid,
        type,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    console.error('Create notification error:', error);
  }
}

async function recordBrowsingHistory(userUid: string, targetType: BrowsingTargetType, targetId: string) {
  const dedupeAfter = new Date(Date.now() - 30 * 60 * 1000);
  try {
    const existing = await prisma.browsingHistory.findFirst({
      where: {
        userUid,
        targetType,
        targetId,
        createdAt: {
          gte: dedupeAfter,
        },
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!existing) {
      await prisma.browsingHistory.create({
        data: {
          userUid,
          targetType,
          targetId,
        },
      });
    }
  } catch (error) {
    console.error('Record browsing history error:', error);
  }
}

async function increaseSearchKeywordCount(rawKeyword: string) {
  const keyword = normalizeKeyword(rawKeyword);
  if (!keyword) return;

  try {
    await prisma.searchKeyword.upsert({
      where: { keyword },
      update: {
        count: {
          increment: 1,
        },
      },
      create: {
        keyword,
        count: 1,
      },
    });
  } catch (error) {
    console.error('Increase search keyword count error:', error);
  }
}

function toWikiResponse(page: WikiResponseInput) {
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
    status: page.status,
    reviewNote: page.reviewNote,
    reviewedBy: page.reviewedBy,
    reviewedAt: page.reviewedAt ? page.reviewedAt.toISOString() : null,
    viewCount: page.viewCount ?? 0,
    favoritesCount: page.favoritesCount,
    isPinned: page.isPinned,
    likesCount: page.likesCount,
    dislikesCount: page.dislikesCount,
    lastEditorUid: page.lastEditorUid,
    lastEditorName: page.lastEditorName,
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  };
}

function toWikiBranchResponse(branch: WikiBranchWithPage) {
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

function toWikiPullRequestResponse(pr: WikiPullRequestWithRelations) {
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

function canManageWikiPullRequest(pr: { createdByUid: string }, authUser: ApiUser) {
  if (isAdminRole(authUser.role)) return true;
  return pr.createdByUid === authUser.uid;
}

function toPostResponse(post: {
  id: string;
  title: string;
  section: string;
  musicDocId?: string | null;
  albumDocId?: string | null;
  content: string;
  tags: unknown;
  locationCode?: string | null;
  authorUid: string;
  author?: { displayName: string } | null;
  status: ContentStatus;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  hotScore?: number;
  viewCount?: number;
  likesCount: number;
  dislikesCount: number;
  commentsCount: number;
  isPinned?: boolean;
  createdAt: Date;
  updatedAt: Date;
  location?: { code: string; name: string; fullName: string } | null;
}) {
  return {
    ...post,
    authorName: post.author?.displayName || null,
    locationCode: post.locationCode || null,
    locationName: post.location?.fullName || null,
    hotScore: post.hotScore ?? 0,
    viewCount: post.viewCount ?? 0,
    tags: serializeTags(post.tags),
    musicDocId: post.musicDocId || null,
    albumDocId: post.albumDocId || null,
    reviewedAt: post.reviewedAt ? post.reviewedAt.toISOString() : null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

function toCommentResponse(comment: {
  id: string;
  postId?: string | null;
  galleryId?: string | null;
  authorUid: string;
  authorName: string;
  authorPhoto: string | null;
  content: string;
  parentId: string | null;
  createdAt: Date;
}) {
  return {
    ...comment,
    createdAt: comment.createdAt.toISOString(),
  };
}

async function toGalleryResponse(gallery: {
  id: string;
  title: string;
  description: string;
  authorUid: string;
  authorName: string;
  tags: unknown;
  locationCode?: string | null;
  copyright?: string | null;
  published: boolean;
  publishedAt: Date | null;
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
}) {
  let storageStrategy: 'local' | 's3' | 'external' = 'local';
  try {
    const storageConfig = await prisma.siteConfig.findUnique({
      where: { key: 'image_preference' },
    });
    const preference = storageConfig?.value as { strategy?: 'local' | 's3' | 'external' };
    storageStrategy = preference?.strategy || 'local';
  } catch (error) {
    console.warn('Failed to get storage strategy:', error);
  }

  const storageKeys = gallery.images
    .map(img => img.asset?.storageKey)
    .filter((key): key is string => Boolean(key));

  const imageMaps = storageKeys.length > 0
    ? await prisma.imageMap.findMany({
        where: {
          localUrl: {
            in: storageKeys.map(key => `/uploads/${key}`),
          },
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
    copyright: gallery.copyright || null,
    published: gallery.published,
    publishedAt: gallery.publishedAt ? gallery.publishedAt.toISOString() : null,
    createdAt: gallery.createdAt.toISOString(),
    updatedAt: gallery.updatedAt.toISOString(),
    images: gallery.images
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((image) => {
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

        return {
          id: image.id,
          assetId: image.assetId || image.asset?.id || null,
          url,
          name: image.asset?.fileName || image.name,
          mimeType: image.asset?.mimeType || null,
          sizeBytes: image.asset?.sizeBytes || null,
        };
      }),
  };
}

function toMusicResponse(track: {
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
    createdAt: track.createdAt.toISOString(),
    updatedAt: track.updatedAt.toISOString(),
  };
}

function toEditLockResponse(lock: {
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

function toUserResponse(user: {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  role: PrismaUserRole;
  status: UserStatus;
  banReason: string | null;
  bannedAt: Date | null;
  level: number;
  bio: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...user,
    bannedAt: user.bannedAt ? user.bannedAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function toUploadSessionResponse(session: {
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

function toMediaAssetResponse(asset: {
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

function toSongResponse(song: MusicTrackWithRelations, options?: { favoritedByMe?: boolean }) {
  const displayAlbum = resolveSongDisplayAlbum(song);
  const coverUrl = resolveSongCoverUrl(song);
  const customPlatformLinks = normalizeSongCustomPlatformLinks(song.customPlatformLinks);

  return {
    docId: song.docId,
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    cover: coverUrl,
    audioUrl: song.audioUrl,
    lyric: song.lyric,
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
  };
}

function toAlbumResponse(album: {
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

function resolveSongDisplayAlbum(song: {
  displayAlbumMode: DisplayAlbumMode;
  manualAlbumName: string | null;
  albumRelations: Array<{
    isDisplay: boolean;
    album: {
      docId: string;
      title: string;
    };
  }>;
}) {
  if (song.displayAlbumMode === 'none') {
    return {
      mode: 'none' as const,
      albumDocId: null,
      title: '',
    };
  }

  if (song.displayAlbumMode === 'manual') {
    return {
      mode: 'manual' as const,
      albumDocId: null,
      title: song.manualAlbumName || '',
    };
  }

  const displayRelation = song.albumRelations.find((item) => item.isDisplay) || song.albumRelations[0] || null;
  if (!displayRelation) {
    return {
      mode: 'linked' as const,
      albumDocId: null,
      title: '',
    };
  }

  return {
    mode: 'linked' as const,
    albumDocId: displayRelation.album.docId,
    title: displayRelation.album.title,
  };
}

function resolveSongCoverUrl(song: Pick<MusicTrackWithRelations, 'cover' | 'defaultCoverSource' | 'covers' | 'albumRelations'>) {
  const source = (song.defaultCoverSource || '').trim();
  if (!source || source === 'old_cover') {
    return song.cover || '';
  }

  if (source.startsWith('song_cover:')) {
    const coverId = source.slice('song_cover:'.length);
    const matched = song.covers.find((item) => item.id === coverId);
    return matched?.publicUrl || song.cover || '';
  }

  if (source.startsWith('album_cover:')) {
    const coverId = source.slice('album_cover:'.length);
    for (const relation of song.albumRelations) {
      const matched = relation.album.covers.find((item) => item.id === coverId);
      if (matched?.publicUrl) {
        return matched.publicUrl;
      }
    }
    return song.cover || '';
  }

  return song.cover || '';
}

function normalizeSongCustomPlatformLinkUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const raw = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function normalizeSongCustomPlatformLinks(input: unknown): SongCustomPlatformLink[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const deduped = new Set<string>();
  const links: SongCustomPlatformLink[] = [];

  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const rawLabel = typeof (item as { label?: unknown }).label === 'string'
      ? (item as { label: string }).label.trim()
      : '';
    const normalizedLabel = rawLabel.slice(0, 30);
    const rawUrl = typeof (item as { url?: unknown }).url === 'string'
      ? (item as { url: string }).url
      : '';
    const normalizedUrl = normalizeSongCustomPlatformLinkUrl(rawUrl);

    if (!normalizedLabel || !normalizedUrl) {
      continue;
    }

    const key = `${normalizedLabel}::${normalizedUrl}`;
    if (deduped.has(key)) {
      continue;
    }

    deduped.add(key);
    links.push({
      label: normalizedLabel,
      url: normalizedUrl,
    });

    if (links.length >= 10) {
      break;
    }
  }

  return links;
}

function getPlatformSourceId(song: {
  neteaseId?: string | null;
  tencentId?: string | null;
  kugouId?: string | null;
  baiduId?: string | null;
  kuwoId?: string | null;
  id?: string | null;
}, platform: MusicPlatform): string {
  if (platform === 'netease') return song.neteaseId?.trim() || '';
  if (platform === 'tencent') return song.tencentId?.trim() || '';
  if (platform === 'kugou') return song.kugouId?.trim() || '';
  if (platform === 'baidu') return song.baiduId?.trim() || '';
  if (platform === 'kuwo') return song.kuwoId?.trim() || '';
  return song.id?.trim() || '';
}

function getPlatformSourceField(platform: MusicPlatform):
  | 'neteaseId'
  | 'tencentId'
  | 'kugouId'
  | 'baiduId'
  | 'kuwoId' {
  if (platform === 'netease') return 'neteaseId';
  if (platform === 'tencent') return 'tencentId';
  if (platform === 'kugou') return 'kugouId';
  if (platform === 'baidu') return 'baiduId';
  return 'kuwoId';
}

function buildPlaybackPlatformCandidates(song: {
  enabledPlatform?: MusicPlatform | null;
  primaryPlatform?: MusicPlatform | null;
}): MusicPlatform[] {
  const preferred = song.enabledPlatform || song.primaryPlatform || null;
  const deduped = new Set<MusicPlatform>();
  if (preferred) {
    deduped.add(preferred);
  }
  DEFAULT_MUSIC_PLATFORMS.forEach((platform) => deduped.add(platform));
  return [...deduped.values()];
}

function clearExpiredPlayUrlCache() {
  const now = Date.now();
  for (const [cacheKey, value] of playUrlCache.entries()) {
    if (value.expiresAt <= now) {
      playUrlCache.delete(cacheKey);
    }
  }
}

function getCachedPlayUrl(cacheKey: string) {
  const cached = playUrlCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    playUrlCache.delete(cacheKey);
    return null;
  }
  return cached;
}

function setCachedPlayUrl(cacheKey: string, value: Omit<PlayUrlCacheValue, 'fetchedAt' | 'expiresAt'>) {
  const now = Date.now();
  const record: PlayUrlCacheValue = {
    ...value,
    fetchedAt: now,
    expiresAt: now + PLAY_URL_CACHE_TTL_MS,
  };
  playUrlCache.set(cacheKey, record);
  return record;
}

async function resolveMusicPlayUrl(song: {
  docId: string;
  id: string;
  audioUrl: string;
  primaryPlatform: MusicPlatform;
  enabledPlatform: MusicPlatform | null;
  neteaseId: string | null;
  tencentId: string | null;
  kugouId: string | null;
  baiduId: string | null;
  kuwoId: string | null;
}) {
  clearExpiredPlayUrlCache();

  const candidates = buildPlaybackPlatformCandidates(song);
  const errors: Array<{ platform: MusicPlatform; reason: string }> = [];

  for (const platform of candidates) {
    const sourceId = getPlatformSourceId(song, platform);
    if (!sourceId) {
      continue;
    }

    const cacheKey = `${song.docId}:${platform}:${sourceId}`;
    const cached = getCachedPlayUrl(cacheKey);
    if (cached?.url) {
      return {
        platform: cached.platform,
        sourceId: cached.sourceId,
        playUrl: cached.url,
        cached: true,
        cacheExpiresAt: new Date(cached.expiresAt).toISOString(),
      };
    }

    try {
      const resolvedUrl = await resolveMetingAudioUrl(platform as ParsedMusicPlatform, sourceId);
      if (!resolvedUrl) {
        errors.push({ platform, reason: 'empty_url' });
        continue;
      }

      const cachedRecord = setCachedPlayUrl(cacheKey, {
        platform,
        sourceId,
        url: resolvedUrl,
      });

      return {
        platform,
        sourceId,
        playUrl: resolvedUrl,
        cached: false,
        cacheExpiresAt: new Date(cachedRecord.expiresAt).toISOString(),
      };
    } catch (error) {
      errors.push({ platform, reason: error instanceof Error ? error.message : 'resolve_failed' });
    }
  }

  const fallbackUrl = song.audioUrl?.trim() || '';
  if (fallbackUrl) {
    return {
      platform: song.primaryPlatform,
      sourceId: song.id,
      playUrl: fallbackUrl,
      cached: false,
      cacheExpiresAt: null,
      fallback: true,
      errors,
    };
  }

  return {
    platform: song.primaryPlatform,
    sourceId: song.id,
    playUrl: '',
    cached: false,
    cacheExpiresAt: null,
    errors,
  };
}

function normalizeMusicImportTracks(input: unknown) {
  if (!Array.isArray(input)) {
    return [] as ImportSongInput[];
  }

  return input
    .map((item): ImportSongInput | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const record = item as Record<string, unknown>;
      const sourceId = typeof record.sourceId === 'string' ? record.sourceId.trim() : '';
      if (!sourceId) {
        return null;
      }

      return {
        sourceId,
        title: typeof record.title === 'string' ? record.title.trim() : '',
        artist: typeof record.artist === 'string' ? record.artist.trim() : '',
        album: typeof record.album === 'string' ? record.album.trim() : '',
        picId: typeof record.picId === 'string' ? record.picId.trim() : sourceId,
        urlId: typeof record.urlId === 'string' ? record.urlId.trim() : sourceId,
        lyricId: typeof record.lyricId === 'string' ? record.lyricId.trim() : sourceId,
        cover: typeof record.cover === 'string' ? record.cover.trim() : '',
        sourceUrl: typeof record.sourceUrl === 'string' ? record.sourceUrl.trim() : '',
        isInstrumental: typeof record.isInstrumental === 'boolean' ? record.isInstrumental : undefined,
      };
    })
    .filter((item): item is ImportSongInput => Boolean(item));
}

function buildAlbumTracksPayload(relations: Array<{
  songDocId: string;
  trackOrder: number;
  discNumber: number;
  song: {
    docId: string;
    title: string;
    artist: string;
    cover: string;
    id: string;
  };
}>) {
  const byDisc = new Map<number, Array<{ songDocId: string; trackOrder: number; song: { docId: string; title: string; artist: string; cover: string; id: string } }>>();

  relations.forEach((relation) => {
    const disc = relation.discNumber > 0 ? relation.discNumber : 1;
    if (!byDisc.has(disc)) {
      byDisc.set(disc, []);
    }
    byDisc.get(disc)!.push({
      songDocId: relation.songDocId,
      trackOrder: relation.trackOrder,
      song: relation.song,
    });
  });

  return [...byDisc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([disc, songs]) => ({
      disc,
      name: `Disc ${disc}`,
      songs: songs
        .sort((a, b) => a.trackOrder - b.trackOrder)
        .map((entry) => ({
          songDocId: entry.songDocId,
          trackOrder: entry.trackOrder,
          song: entry.song,
        })),
    }));
}

async function applyAlbumTracksToRelations(albumDocId: string, tracks: ReturnType<typeof normalizeTrackDiscPayload>) {
  await prisma.songAlbumRelation.deleteMany({ where: { albumDocId } });

  const createRows: Array<{
    songDocId: string;
    albumDocId: string;
    discNumber: number;
    trackOrder: number;
    isDisplay: boolean;
  }> = [];

  tracks.forEach((discEntry) => {
    discEntry.songs.forEach((songEntry) => {
      createRows.push({
        songDocId: songEntry.songDocId,
        albumDocId,
        discNumber: discEntry.disc,
        trackOrder: songEntry.trackOrder,
        isDisplay: false,
      });
    });
  });

  if (!createRows.length) {
    return;
  }

  await prisma.songAlbumRelation.createMany({
    data: createRows,
    skipDuplicates: true,
  });
}

async function addSongCoverFromAsset(songDocId: string, assetId: string, markDefault = false) {
  const asset = await prisma.mediaAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      storageKey: true,
      publicUrl: true,
      status: true,
    },
  });

  if (!asset || asset.status !== 'ready') {
    throw new Error('媒体资源不存在或不可用');
  }

  const currentCount = await prisma.songCover.count({ where: { songDocId } });

  const cover = await prisma.songCover.create({
    data: {
      songDocId,
      assetId: asset.id,
      storageKey: asset.storageKey,
      publicUrl: asset.publicUrl,
      sortOrder: currentCount,
      isDefault: markDefault,
    },
  });

  if (markDefault) {
    await prisma.songCover.updateMany({
      where: {
        songDocId,
        id: { not: cover.id },
      },
      data: {
        isDefault: false,
      },
    });
    await prisma.musicTrack.update({
      where: { docId: songDocId },
      data: {
        defaultCoverSource: `song_cover:${cover.id}`,
      },
    });
  }

  return cover;
}

async function addAlbumCoverFromAsset(albumDocId: string, assetId: string, markDefault = false) {
  const asset = await prisma.mediaAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      storageKey: true,
      publicUrl: true,
      status: true,
    },
  });

  if (!asset || asset.status !== 'ready') {
    throw new Error('媒体资源不存在或不可用');
  }

  const currentCount = await prisma.albumCover.count({ where: { albumDocId } });

  const cover = await prisma.albumCover.create({
    data: {
      albumDocId,
      assetId: asset.id,
      storageKey: asset.storageKey,
      publicUrl: asset.publicUrl,
      sortOrder: currentCount,
      isDefault: markDefault,
    },
  });

  if (markDefault) {
    await prisma.albumCover.updateMany({
      where: {
        albumDocId,
        id: { not: cover.id },
      },
      data: {
        isDefault: false,
      },
    });
    await prisma.album.update({
      where: { docId: albumDocId },
      data: {
        defaultCoverSource: `album_cover:${cover.id}`,
      },
    });
  }

  return cover;
}

async function createOrUpdateImportedSong(params: {
  platform: MusicPlatform;
  track: ImportSongInput;
  userUid: string;
  albumNameFallback?: string;
}) {
  const { platform, track, userUid, albumNameFallback } = params;
  const sourceField = getPlatformSourceField(platform);
  const platformId = track.sourceId;

  const existingByPlatformId = await prisma.musicTrack.findFirst({
    where: {
      OR: [
        { [sourceField]: platformId },
        { id: track.sourceId },
      ] as Prisma.MusicTrackWhereInput[],
    },
  });

  if (existingByPlatformId) {
    const fallbackTitle = `未命名歌曲 ${track.sourceId}`;
    const title = track.title || fallbackTitle;
    const artist = track.artist || '未知歌手';
    const album = track.album || albumNameFallback || '未知专辑';

    const resolvedCover = (await resolveMetingCoverUrl(platform as ParsedMusicPlatform, track.picId, track.cover)) || track.cover;
    const resolvedAudioUrl = (await resolveMetingAudioUrl(platform as ParsedMusicPlatform, track.urlId)) || '';
    const resolvedLyric = (await resolveMetingLyric(platform as ParsedMusicPlatform, track.lyricId)) || '';

    const song = await prisma.musicTrack.update({
      where: { docId: existingByPlatformId.docId },
      data: {
        id: existingByPlatformId.id || track.sourceId,
        title,
        artist,
        album,
        cover: resolvedCover || '',
        audioUrl: resolvedAudioUrl || '',
        lyric: resolvedLyric || null,
        primaryPlatform: platform,
        enabledPlatform: platform,
        [sourceField]: platformId,
      },
    });
    return {
      song,
      created: false,
      linked: false,
    };
  }

  const fallbackTitle = `未命名歌曲 ${track.sourceId}`;
  const title = track.title || fallbackTitle;
  const artist = track.artist || '未知歌手';
  const album = track.album || albumNameFallback || '未知专辑';

  const existingByTitleArtist = await prisma.musicTrack.findFirst({
    where: {
      AND: [
        { title: { equals: title } },
        { artist: { equals: artist } },
        {
          OR: [
            { neteaseId: { not: null } },
            { tencentId: { not: null } },
            { kugouId: { not: null } },
            { baiduId: { not: null } },
            { kuwoId: { not: null } },
          ],
        },
      ],
    } as Prisma.MusicTrackWhereInput,
  });

  const resolvedCover = (await resolveMetingCoverUrl(platform as ParsedMusicPlatform, track.picId, track.cover)) || track.cover;
  const resolvedAudioUrl = (await resolveMetingAudioUrl(platform as ParsedMusicPlatform, track.urlId)) || '';
  const resolvedLyric = (await resolveMetingLyric(platform as ParsedMusicPlatform, track.lyricId)) || '';

  if (existingByTitleArtist) {
    const conflictPlatformId = (existingByTitleArtist as unknown as Record<string, string | null>)[sourceField];
    if (conflictPlatformId) {
      const song = await prisma.musicTrack.create({
        data: {
          id: track.sourceId,
          title,
          artist,
          album,
          cover: resolvedCover || '',
          audioUrl: resolvedAudioUrl || '',
          lyric: resolvedLyric || null,
          primaryPlatform: platform,
          enabledPlatform: platform,
          [sourceField]: platformId,
          addedBy: userUid,
        },
      });
      return {
        song,
        created: true,
        linked: false,
      };
    }

    const updatedSong = await prisma.musicTrack.update({
      where: { docId: existingByTitleArtist.docId },
      data: {
        id: existingByTitleArtist.id || track.sourceId,
        title,
        artist,
        album,
        cover: resolvedCover || '',
        audioUrl: resolvedAudioUrl || '',
        lyric: resolvedLyric || null,
        primaryPlatform: platform,
        enabledPlatform: platform,
        [sourceField]: platformId,
      },
    });
    return {
      song: updatedSong,
      created: false,
      linked: true,
      linkedFrom: {
        docId: existingByTitleArtist.docId,
        title: existingByTitleArtist.title,
        artist: existingByTitleArtist.artist,
      },
    };
  }

  const song = await prisma.musicTrack.create({
    data: {
      id: track.sourceId,
      title,
      artist,
      album,
      cover: resolvedCover || '',
      audioUrl: resolvedAudioUrl || '',
      lyric: resolvedLyric || null,
      primaryPlatform: platform,
      enabledPlatform: platform,
      [sourceField]: platformId,
      addedBy: userUid,
    },
  });

  await autoLinkInstrumental(song.docId, title, artist, track.isInstrumental);

  return {
    song,
    created: true,
    linked: false,
  };
}

async function autoLinkInstrumental(
  songDocId: string,
  title: string,
  artist: string,
  isInstrumentalFromAPI?: boolean,
): Promise<void> {
  const instrumentalPatterns = [
    /\(伴奏\)/,
    /（伴奏）/,
    /-伴奏/,
    /\s+伴奏$/,
    /伴奏版$/,
    /inst\.?$/i,
    /instrumental$/i,
  ];

  const isInstrumental = isInstrumentalFromAPI || instrumentalPatterns.some((pattern) => pattern.test(title));
  if (!isInstrumental) return;

  let originalTitle = title;
  if (!isInstrumentalFromAPI) {
    originalTitle = title
      .replace(/\(伴奏\)/, '')
      .replace(/（伴奏）/, '')
      .replace(/-伴奏/, '')
      .replace(/伴奏版$/, '')
      .replace(/inst\.?$/i, '')
      .replace(/instrumental$/i, '')
      .trim();
  }

  if (!originalTitle) return;

  const originalSong = await prisma.musicTrack.findFirst({
    where: {
      title: originalTitle,
      artist: artist,
      docId: { not: songDocId },
    },
  });

  if (!originalSong) return;

  await prisma.songInstrumentalRelation.upsert({
    where: {
      songDocId_targetSongDocId: {
        songDocId: songDocId,
        targetSongDocId: originalSong.docId,
      },
    },
    update: {},
    create: {
      songDocId: songDocId,
      targetSongDocId: originalSong.docId,
    },
  });
}

async function fetchSongsWithRelations(where?: Record<string, unknown>) {
  const songs = await prisma.musicTrack.findMany({
    where,
    include: {
      covers: {
        orderBy: { sortOrder: 'asc' },
      },
      albumRelations: {
        include: {
          album: {
            include: {
              covers: {
                orderBy: { sortOrder: 'asc' },
              },
            },
          },
        },
        orderBy: [{ discNumber: 'asc' }, { trackOrder: 'asc' }],
      },
      instrumentalLinks: {
        select: {
          targetSongDocId: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  return songs as MusicTrackWithRelations[];
}

async function fetchSongWithRelationsByDocId(songDocId: string) {
  const song = await prisma.musicTrack.findUnique({
    where: { docId: songDocId },
    include: {
      covers: {
        orderBy: { sortOrder: 'asc' },
      },
      albumRelations: {
        include: {
          album: {
            include: {
              covers: {
                orderBy: { sortOrder: 'asc' },
              },
            },
          },
        },
        orderBy: [{ discNumber: 'asc' }, { trackOrder: 'asc' }],
      },
      instrumentalLinks: {
        select: {
          targetSongDocId: true,
        },
      },
    },
  });
  return song as unknown as MusicTrackWithRelations | null;
}

function ensureDisplayRelation(relations: any[]) {
  const hasDisplay = relations.some((relation) => relation.isDisplay);
  if (hasDisplay || !relations.length) {
    return relations;
  }
  return relations.map((relation, index) => ({
    ...relation,
    isDisplay: index === 0,
  }));
}

function createWechatPlaceholderEmail(openId: string) {
  const safe = openId.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64);
  const fallback = safe || `wx_${Date.now().toString(36)}`;
  return `${fallback}@wechat.local`;
}

async function exchangeWechatLoginCode(rawCode: string) {
  const code = rawCode.trim();
  if (!code) {
    throw new Error('缺少 code');
  }

  if (WECHAT_LOGIN_MOCK) {
    const mockPayload = code.replace(/^mock:/, '');
    const [openIdPart, unionIdPart] = mockPayload.split(':');
    const openId = (openIdPart || `mock_openid_${Date.now().toString(36)}`).slice(0, 128);
    const unionId = unionIdPart ? unionIdPart.slice(0, 128) : null;
    return { openId, unionId };
  }

  if (!WECHAT_MP_APPID || !WECHAT_MP_APP_SECRET) {
    throw new Error('服务器未配置微信登录参数');
  }

  const response = await axios.get<WechatCodeSessionResponse>('https://api.weixin.qq.com/sns/jscode2session', {
    params: {
      appid: WECHAT_MP_APPID,
      secret: WECHAT_MP_APP_SECRET,
      js_code: code,
      grant_type: 'authorization_code',
    },
    timeout: 10_000,
  });

  const data = response.data;
  if (typeof data?.errcode === 'number' && data.errcode !== 0) {
    throw new Error(`微信登录失败：${data.errmsg || `errcode=${data.errcode}`}`);
  }

  if (!data?.openid) {
    throw new Error('微信登录失败：未获取到 openid');
  }

  return {
    openId: data.openid,
    unionId: data.unionid || null,
  };
}

async function buildUniqueWechatEmail(openId: string) {
  const base = createWechatPlaceholderEmail(openId);
  const [name, domain] = base.split('@');
  let candidate = base;

  for (let i = 0; i < 8; i += 1) {
    const existing = await prisma.user.findUnique({
      where: { email: candidate },
      select: { uid: true },
    });
    if (!existing) {
      return candidate;
    }
    candidate = `${name}_${i + 1}@${domain || 'wechat.local'}`;
  }

  return `${name}_${Date.now().toString(36)}@${domain || 'wechat.local'}`;
}

function normalizeTrackDiscPayload(rawTracks: unknown) {
  if (!Array.isArray(rawTracks)) {
    return [] as Array<{
      disc: number;
      name: string;
      songs: Array<{ songDocId: string; trackOrder: number }>;
    }>;
  }

  const normalized = rawTracks
    .map((item, index) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const record = item as Record<string, unknown>;
      const disc = parseInteger(record.disc, index + 1, { min: 1, max: 20 });
      const nameRaw = typeof record.name === 'string' ? record.name.trim() : '';
      const name = nameRaw || `Disc ${disc}`;
      const songsRaw = Array.isArray(record.songs) ? record.songs : [];

      const songs = songsRaw
        .map((songItem, songIndex) => {
          if (!songItem || typeof songItem !== 'object') {
            return null;
          }
          const songRecord = songItem as Record<string, unknown>;
          const songDocId = typeof songRecord.songDocId === 'string' ? songRecord.songDocId.trim() : '';
          if (!songDocId) {
            return null;
          }
          const trackOrder = parseInteger(songRecord.trackOrder, songIndex, { min: 0, max: 5000 });
          return {
            songDocId,
            trackOrder,
          };
        })
        .filter((entry): entry is { songDocId: string; trackOrder: number } => Boolean(entry));

      return {
        disc,
        name,
        songs,
      };
    })
    .filter((entry): entry is { disc: number; name: string; songs: Array<{ songDocId: string; trackOrder: number }> } => Boolean(entry));

  normalized.sort((a, b) => a.disc - b.disc);
  return normalized;
}

function normalizeEditLockCollection(value: unknown) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  if (!normalized) return '';
  if (EDIT_LOCK_COLLECTION_ALLOWLIST.has(normalized)) return normalized;
  return '';
}

function normalizeEditLockRecordId(value: unknown) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized) return '';
  if (normalized.length > 191) {
    return normalized.slice(0, 191);
  }
  return normalized;
}

function createUploadSessionExpiresAt() {
  return new Date(Date.now() + UPLOAD_SESSION_TTL_MINUTES * 60 * 1000);
}

function isUploadSessionExpired(expiresAt: Date) {
  return expiresAt.getTime() <= Date.now();
}

function buildUploadPublicUrl(fileName: string) {
  return `/uploads/${fileName}`;
}

function resolveUploadPathByStorageKey(storageKey: string) {
  const normalized = storageKey.replace(/\\/g, '/').replace(/^\/+/, '');
  const base = path.resolve(uploadsDir);
  const target = path.resolve(base, normalized);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    return null;
  }
  return target;
}

function extractStorageKeyFromUploadUrl(url: string) {
  if (!url.startsWith('/uploads/')) {
    return null;
  }
  const raw = url.slice('/uploads/'.length);
  if (!raw) {
    return null;
  }
  return decodeURIComponent(raw);
}

async function safeDeleteUploadFileByStorageKey(storageKey: string) {
  const filePath = resolveUploadPathByStorageKey(storageKey);
  if (!filePath) {
    return;
  }
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Delete upload file error:', error);
    }
  }
}

async function safeDeleteUploadFileByUrl(url: string) {
  const storageKey = extractStorageKeyFromUploadUrl(url);
  if (!storageKey) {
    return;
  }
  await safeDeleteUploadFileByStorageKey(storageKey);
}

async function uploadFileToS3(
  filePath: string,
  objectKey: string,
  contentType: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const { getS3ClientWrite, getPublicConfig } = await import('../s3/s3Service');
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');

    const s3Client = getS3ClientWrite();
    const config = getPublicConfig();

    if (!config.enabled) {
      return { success: false, error: 'S3 not enabled' };
    }

    const fileBuffer = await fs.promises.readFile(filePath);

    // S3 Key 应该是原始字符串，不需要 encodeURIComponent
    // AWS SDK 会自动处理 UTF-8 字符
    const s3Key = objectKey;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: contentType,
      })
    );

    // URL 中的 key 需要编码
    const encodedKeyForUrl = encodeURIComponent(s3Key).replace(/%2F/g, '/');
    const url = config.publicDomain
      ? `${config.publicDomain}/${encodedKeyForUrl}`
      : `${config.endpoint}/${config.bucket}/${encodedKeyForUrl}`;

    return { success: true, url };
  } catch (error) {
    console.error('[S3 Upload] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'S3 upload failed',
    };
  }
}

async function uploadFileToExternal(
  filePath: string,
  fileName: string,
  contentType: string,
  config: {
    apiUrl: string;
    apiKey?: string;
    customHeaders?: Record<string, string>;
  }
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const FormData = (await import('form-data')).default;

    const formData = new FormData();
    formData.append('file', await fs.promises.readFile(filePath), {
      filename: fileName,
      contentType,
    });

    const headers: Record<string, string> = {
      ...config.customHeaders,
      ...formData.getHeaders(),
    };
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers,
      body: formData as unknown as BodyInit,
    });

    if (!response.ok) {
      return {
        success: false,
        error: `External upload failed: ${response.status} ${response.statusText}`,
      };
    }

    const data = await response.json();

    let externalUrl: string | undefined;
    if (data.url) {
      externalUrl = data.url;
    } else if (data.data?.url) {
      externalUrl = data.data.url;
    } else if (data.image?.url) {
      externalUrl = data.image.url;
    } else if (data.link) {
      externalUrl = data.link;
    } else if (Array.isArray(data) && data[0]?.url) {
      externalUrl = data[0].url;
    }

    if (!externalUrl) {
      return { success: false, error: 'Failed to parse external upload response' };
    }

    return { success: true, url: externalUrl };
  } catch (error) {
    console.error('[External Upload] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'External upload failed',
    };
  }
}

async function uploadToSuperbed(
  filePath: string,
  fileName: string,
  contentType: string,
  token: string,
  categories: string = '',
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    if (!token) {
      return {
        success: false,
        error: 'Superbed API Token 未配置',
      };
    }

    const FormData = (await import('form-data')).default;

    const formData = new FormData();
    formData.append('file', await fs.promises.readFile(filePath), {
      filename: fileName,
      contentType,
    });
    formData.append('token', token);
    if (categories) {
      formData.append('categories', categories);
    }

    const response = await fetch('https://api.superbed.cn/upload', {
      method: 'POST',
      headers: {
        ...formData.getHeaders(),
      },
      body: formData as unknown as BodyInit,
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Superbed upload failed: ${response.status} ${response.statusText}`,
      };
    }

    const data = await response.json();

    let superbedUrl: string | undefined;
    if (data.url) {
      superbedUrl = data.url;
    } else if (data.data?.url) {
      superbedUrl = data.data.url;
    } else if (data.image?.url) {
      superbedUrl = data.image.url;
    } else if (data.link) {
      superbedUrl = data.link;
    }

    if (!superbedUrl) {
      return { success: false, error: 'Failed to parse Superbed upload response' };
    }

    console.log('[Superbed Upload] Successfully uploaded:', fileName, '->', superbedUrl);
    return { success: true, url: superbedUrl };
  } catch (error) {
    console.error('[Superbed Upload] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Superbed upload failed',
    };
  }
}

async function deleteFromSuperbed(
  imageIds: string[],
  token: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!token) {
      return {
        success: false,
        error: 'Superbed API Token 未配置',
      };
    }

    if (imageIds.length === 0) {
      return { success: true };
    }

    const idsParam = imageIds.join(',');

    const params = new URLSearchParams();
    params.append('token', token);
    params.append('ids', idsParam);

    const response = await fetch('https://api.superbed.cn/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Superbed delete failed: ${response.status} ${response.statusText}`,
      };
    }

    const data = await response.json();

    if (data.code && data.code !== 0) {
      return {
        success: false,
        error: `Superbed delete failed: ${data.message || JSON.stringify(data)}`,
      };
    }

    console.log('[Superbed Delete] Successfully deleted', imageIds.length, 'image(s)');
    return { success: true };
  } catch (error) {
    console.error('[Superbed Delete] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Superbed delete failed',
    };
  }
}

async function validateUploadedImage(file: Express.Multer.File) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
    throw new Error('不支持的图片扩展名');
  }

  const buffer = await fs.promises.readFile(file.path);
  const detectedMimeType = detectImageMimeType(buffer);
  if (!detectedMimeType || !ALLOWED_IMAGE_MIME_TYPES.has(detectedMimeType)) {
    throw new Error('文件内容与图片格式不匹配');
  }

  const expectedMimeByExt: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
  };
  const expectedMimeType = expectedMimeByExt[ext];
  if (!expectedMimeType || detectedMimeType !== expectedMimeType) {
    throw new Error('图片扩展名与文件内容不一致');
  }

  return {
    mimeType: detectedMimeType,
  };
}

function detectImageMimeType(buffer: Buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (
    buffer.length >= 6
    && buffer[0] === 0x47
    && buffer[1] === 0x49
    && buffer[2] === 0x46
    && buffer[3] === 0x38
    && (buffer[4] === 0x37 || buffer[4] === 0x39)
    && buffer[5] === 0x61
  ) {
    return 'image/gif';
  }

  if (
    buffer.length >= 12
    && buffer[0] === 0x52
    && buffer[1] === 0x49
    && buffer[2] === 0x46
    && buffer[3] === 0x46
    && buffer[8] === 0x57
    && buffer[9] === 0x45
    && buffer[10] === 0x42
    && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return 'image/bmp';
  }

  return null;
}

function getUploadFileStorageKey(file: Express.Multer.File) {
  const storageKey = getStorageKeyFromFilePath(file.path, uploadsDir);
  return storageKey || file.filename;
}

function parseAssetIdList(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  const deduped = new Set<string>();
  value.forEach((item) => {
    if (typeof item !== 'string') return;
    const normalized = item.trim();
    if (!normalized) return;
    deduped.add(normalized);
  });
  return [...deduped];
}

function parseDatabaseUrl(url: string) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port || '5432',
      user: parsed.username,
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.slice(1),
    };
  } catch {
    return null;
  }
}

function verifyBackupPassword(password: string): boolean {
  if (!BACKUP_PASSWORD) return false;
  return password === BACKUP_PASSWORD;
}

function sanitizeFilename(name: string): boolean {
  return /^backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.zip$/.test(name);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function cleanupOldBackups() {
  try {
    const files = fs.readdirSync(backupsDir)
      .filter((f) => f.startsWith('backup_') && f.endsWith('.zip'))
      .map((f) => {
        const filePath = path.join(backupsDir, f);
        const stat = fs.statSync(filePath);
        return { name: f, mtime: stat.mtime.getTime() };
      })
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length > BACKUP_RETAIN_COUNT) {
      const toDelete = files.slice(BACKUP_RETAIN_COUNT);
      for (const file of toDelete) {
        fs.unlinkSync(path.join(backupsDir, file.name));
        console.log(`Cleaned up old backup: ${file.name}`);
      }
    }
  } catch (error) {
    console.error('Cleanup old backups error:', error);
  }
}

function encryptBuffer(buffer: Buffer, password: string): Buffer {
  const key = crypto.scryptSync(password, 'huangshifu-backup-salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([iv, cipher.update(buffer), cipher.final()]);
  return encrypted;
}

function decryptBuffer(buffer: Buffer, password: string): Buffer {
  const key = crypto.scryptSync(password, 'huangshifu-backup-salt', 32);
  const iv = buffer.subarray(0, 16);
  const encrypted = buffer.subarray(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export {
  prisma,
  prismaAny,
  uploadsDir,
  backupsDir,
  WIKI_RELATION_TYPE_LABELS,
  DEFAULT_MUSIC_PLATFORMS,
  parseDate,
  parseInteger,
  parseBoolean,
  extractBase64Payload,
  parseMinSimilarityScore,
  toEmbeddingPayload,
  normalizeTagList,
  serializeTags,
  hasTag,
  normalizeWikiSlug,
  normalizeWikiRelationType,
  normalizeWikiRelationLabel,
  normalizeWikiRelationList,
  normalizeWikiRelationListForWrite,
  serializeRelations,
  relationTypeLabel,
  relationIdentityKey,
  buildWikiReverseRelationIndex,
  buildResolvedWikiRelations,
  buildWikiRelationGraph,
  findWikiRelationCenterPage,
  buildWikiRelationBundle,
  canViewWikiPage,
  canViewPost,
  canViewGallery,
  canManageGallery,
  buildWikiVisibilityWhere,
  buildPostVisibilityWhere,
  parseContentStatus,
  normalizeWikiWriteStatus,
  normalizePostWriteStatus,
  parseFavoriteType,
  parseMusicPlatform,
  parseDisplayAlbumMode,
  parseMusicCollectionType,
  parseBrowsingTargetType,
  parseModerationTargetType,
  normalizeModerationTargetType,
  parsePostSort,
  normalizeOptionalDocId,
  normalizeKeyword,
  calculatePostHotScore,
  refreshPostHotScore,
  toNotificationResponse,
  createNotification,
  recordBrowsingHistory,
  increaseSearchKeywordCount,
  toWikiResponse,
  toWikiBranchResponse,
  toWikiPullRequestResponse,
  canManageWikiPullRequest,
  toPostResponse,
  toCommentResponse,
  toGalleryResponse,
  toMusicResponse,
  toEditLockResponse,
  toUserResponse,
  toUploadSessionResponse,
  toMediaAssetResponse,
  toSongResponse,
  toAlbumResponse,
  resolveSongDisplayAlbum,
  resolveSongCoverUrl,
  normalizeSongCustomPlatformLinkUrl,
  normalizeSongCustomPlatformLinks,
  getPlatformSourceId,
  getPlatformSourceField,
  buildPlaybackPlatformCandidates,
  clearExpiredPlayUrlCache,
  getCachedPlayUrl,
  setCachedPlayUrl,
  resolveMusicPlayUrl,
  normalizeMusicImportTracks,
  buildAlbumTracksPayload,
  applyAlbumTracksToRelations,
  addSongCoverFromAsset,
  addAlbumCoverFromAsset,
  createOrUpdateImportedSong,
  autoLinkInstrumental,
  fetchSongsWithRelations,
  fetchSongWithRelationsByDocId,
  ensureDisplayRelation,
  createWechatPlaceholderEmail,
  exchangeWechatLoginCode,
  buildUniqueWechatEmail,
  normalizeTrackDiscPayload,
  normalizeEditLockCollection,
  normalizeEditLockRecordId,
  createUploadSessionExpiresAt,
  isUploadSessionExpired,
  buildUploadPublicUrl,
  resolveUploadPathByStorageKey,
  extractStorageKeyFromUploadUrl,
  safeDeleteUploadFileByStorageKey,
  safeDeleteUploadFileByUrl,
  uploadFileToS3,
  uploadFileToExternal,
  uploadToSuperbed,
  deleteFromSuperbed,
  validateUploadedImage,
  detectImageMimeType,
  getUploadFileStorageKey,
  parseAssetIdList,
  parseDatabaseUrl,
  verifyBackupPassword,
  sanitizeFilename,
  formatFileSize,
  cleanupOldBackups,
  encryptBuffer,
  decryptBuffer,
};
