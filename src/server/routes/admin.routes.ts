import { type Request, type Response, type Router } from 'express'
import {
  requireAdmin,
  requireSuperAdmin,
  requireAuth,
  requireActiveUser,
  isAdminRole,
  clearUserCache,
} from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import {
  validateBody,
  backupCreateSchema,
  backupNoteSchema,
  backupRestoreSchema,
  adminBatchEditLocksSchema,
  adminBatchMusicDisplaySchema,
} from '../schemas'
import type { AuthenticatedRequest } from '../types'
import {
  prisma,
  toWikiResponse,
  toPostResponse,
  toGalleryResponse,
  toGalleryListResponse,
  toEventResponse,
  toEventListResponse,
  toUserResponse,
  toEditLockResponse,
  toMusicResponse,
  parseContentStatus,
  parseDisplayAlbumMode,
  parsePagination,
  normalizeModerationTargetType,
  createNotification,
  parseDatabaseUrl,
  sanitizeFilename,
  formatBackupTimestamp,
  formatFileSize,
  cleanupOldBackups,
  readBackupNote,
  writeBackupNote,
  deleteBackupNote,
  BACKUP_METADATA_ENTRY,
  serializeBackupMetadata,
  parseBackupMetadata,
  encryptBuffer,
  decryptBuffer,
  validateSqlContent,
  getPostgresClientExecutable,
  isPostgresClientMissingError,
  formatPostgresClientMissingError,
  logger,
  ensureTextLimit,
  includeDeletedFromQuery,
  deletedAtFilter,
  softDeleteData,
  restoreDeleteData,
  resolveDeleteReason,
  normalizeDeleteReason,
  enhancedCache,
  CACHE_KEYS,
  clearWikiRelationCache,
  notifyMentionUsers,
} from '../utils'
import {
  cleanupUnusedMediaAssetById,
  cleanupUntrackedUploadImageByUrl,
} from '../services/mediaAssetCleanupService'
import {
  generateMediaRestoreReport,
  isMediaRestoreReportFilename,
  resolveMediaRestoreReportPath,
  type MediaRestoreReportSummary,
  type MediaRestoreSource,
} from '../services/mediaRestoreReport.service'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { UPLOAD_MAX_FILE_SIZE_BYTES } from '../../lib/uploadLimits'
import { CONTENT_LIMITS } from '../../lib/contentLimits'
import archiver from 'archiver'
import {
  scanAllWikiLinks,
  getWikiPageLinks,
  previewLinkUpdate,
  batchUpdateWikiLinks,
  switchWikiStorage,
} from '../wiki/markdownLinkUpdater'
import { isSensitiveWord, containsSensitive } from '../../lib/sensitiveWordFilter'
import { variantCleanup, CleanupTrigger } from '../services/variantCleanup.service'
import {
  deleteImageEmbeddingPointsBySource,
  deleteTextEmbeddingPointsBySource,
} from '../vector/qdrantService'
import { createRouter } from '../utils/typed-router'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const router = createRouter()
const BACKUP_RESTORE_RESPONSE_TIMEOUT_MS = 15 * 60 * 1000

const adminEventInclude = {
  coverAsset: true,
  createdBy: { select: { displayName: true } },
  updatedBy: { select: { displayName: true } },
  posters: {
    include: {
      asset: true,
    },
    orderBy: { sortOrder: 'asc' as const },
  },
}

function canManageTargetUserRole(
  operatorRole: AuthenticatedRequest['authUser']['role'] | undefined,
  targetRole: AuthenticatedRequest['authUser']['role']
) {
  if (operatorRole === 'super_admin') return true
  if (operatorRole === 'admin') return targetRole === 'user'
  return false
}

const execFileAsync = promisify(execFile)

function isString(value: string | null): value is string {
  return typeof value === 'string'
}

function invalidateWikiContentCaches() {
  enhancedCache.invalidateByPrefix(`${CACHE_KEYS.WIKI_PAGE}:`)
  enhancedCache.invalidateByPrefix(`${CACHE_KEYS.WIKI_LIST}:`)
  enhancedCache.invalidateByPrefix(`${CACHE_KEYS.WIKI_RECOMMENDED}:`)
  enhancedCache.invalidateByPrefix(`${CACHE_KEYS.WIKI_TIMELINE}:`)
  clearWikiRelationCache()
}

async function getDeleteReasonsByTargetId(
  targetType: 'wiki' | 'post' | 'gallery' | 'comment',
  targetIds: string[]
) {
  const uniqueTargetIds = [...new Set(targetIds.filter(Boolean))]
  if (uniqueTargetIds.length === 0) return new Map<string, string | null>()

  const logs = await prisma.moderationLog.findMany({
    where: {
      targetType,
      targetId: { in: uniqueTargetIds },
      action: 'delete',
    },
    orderBy: { createdAt: 'desc' },
    select: {
      targetId: true,
      note: true,
    },
  })

  const reasons = new Map<string, string | null>()
  for (const log of logs) {
    if (reasons.has(log.targetId)) continue
    reasons.set(log.targetId, log.note)
  }

  return reasons
}

async function hasLatestPostSubmitLogForRepublishedEdit(targetId: string) {
  const latestSubmitLog = await prisma.moderationLog.findFirst({
    where: {
      targetType: 'post',
      targetId,
      action: 'submit',
    },
    orderBy: { createdAt: 'desc' },
    select: { note: true },
  })

  return latestSubmitLog?.note === '编辑后重新提交审核'
}

const backupsDir = path.join(__dirname, '..', '..', '..', 'backups')
fs.mkdirSync(backupsDir, { recursive: true })

const BACKUP_PASSWORD = process.env.BACKUP_PASSWORD || ''

if (!BACKUP_PASSWORD) {
  logger.warn('BACKUP_PASSWORD 未配置或为空 — 新备份将以明文 SQL 写入 zip 文件')
}

async function mapBackupFile(filename: string) {
  const filePath = path.join(backupsDir, filename)
  const stat = await fs.promises.stat(filePath)
  return {
    filename,
    size: stat.size,
    sizeFormatted: formatFileSize(stat.size),
    createdAt: stat.mtime.toISOString(),
    note: await readBackupNote(filename),
  }
}

async function listBackupFiles() {
  const files = (await fs.promises.readdir(backupsDir)).filter(
    (f) => f.startsWith('backup_') && f.endsWith('.zip')
  )
  return (await Promise.all(files.map(mapBackupFile))).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
}

async function handleBackupList(_req: Request, res: Response) {
  try {
    res.json({ backups: await listBackupFiles() })
  } catch (error) {
    logger.error({ err: error }, 'List backups error')
    res.status(500).json({ error: '获取备份列表失败' })
  }
}

async function handleBackupDelete(req: AuthenticatedRequest, res: Response) {
  try {
    const filename = req.params.filename
    const normalized = path.normalize(filename)

    if (normalized.includes('..') || !sanitizeFilename(filename)) {
      res.status(400).json({ error: '无效的文件名' })
      return
    }

    const filePath = path.join(backupsDir, normalized)
    try {
      await fs.promises.access(filePath)
    } catch {
      res.status(404).json({ error: '备份文件不存在' })
      return
    }

    await fs.promises.unlink(filePath)
    await deleteBackupNote(normalized)
    res.json({ success: true })
  } catch (error) {
    logger.error({ err: error }, 'Delete backup error')
    res.status(500).json({ error: '删除备份失败' })
  }
}
const BACKUP_RETAIN_COUNT = Math.max(1, Number(process.env.BACKUP_RETAIN_COUNT || 20))

async function permanentlyDeleteWikiById(id: string) {
  const page = await prisma.wikiPage.findUnique({
    where: { id },
    select: { slug: true },
  })
  if (!page) return false

  await prisma.$transaction(async (tx) => {
    await Promise.all([
      tx.favorite.deleteMany({ where: { targetType: 'wiki', targetId: page.slug } }),
      tx.browsingHistory.deleteMany({ where: { targetType: 'wiki', targetId: page.slug } }),
      tx.wikiImageEmbedding.deleteMany({ where: { wikiPageSlug: page.slug } }),
      tx.textEmbeddingChunk.deleteMany({ where: { sourceType: 'wiki', sourceId: page.slug } }),
    ])
    await tx.wikiPage.delete({ where: { id } })
  })

  void Promise.allSettled([
    deleteImageEmbeddingPointsBySource('wiki', page.slug),
    deleteTextEmbeddingPointsBySource('wiki', page.slug),
  ]).then((results) => {
    results.forEach((result) => {
      if (result.status === 'rejected') {
        logger.warn({ err: result.reason, slug: page.slug }, 'Delete wiki embedding points failed')
      }
    })
  })

  return page.slug
}

async function permanentlyDeletePostById(id: string) {
  const post = await prisma.post.findUnique({
    where: { id },
    select: { id: true, title: true },
  })
  if (!post) return false

  await prisma.$transaction(async (tx) => {
    await Promise.all([
      tx.favorite.deleteMany({ where: { targetType: 'post', targetId: post.id } }),
      tx.browsingHistory.deleteMany({ where: { targetType: 'post', targetId: post.id } }),
      tx.postImageEmbedding.deleteMany({ where: { postId: post.id } }),
      tx.textEmbeddingChunk.deleteMany({ where: { sourceType: 'post', sourceId: post.id } }),
    ])
    await tx.post.delete({ where: { id } })
  })

  void Promise.allSettled([
    deleteImageEmbeddingPointsBySource('post', post.id),
    deleteTextEmbeddingPointsBySource('post', post.id),
  ]).then((results) => {
    results.forEach((result) => {
      if (result.status === 'rejected') {
        logger.warn({ err: result.reason, postId: post.id }, 'Delete post embedding points failed')
      }
    })
  })

  return true
}

async function permanentlyDeleteGalleryById(id: string) {
  const gallery = await prisma.gallery.findUnique({
    where: { id },
    include: { images: true },
  })
  if (!gallery) return false

  const assetIds = [...new Set(gallery.images.map((image) => image.assetId).filter(isString))]
  const imagesWithoutAsset = gallery.images.filter((image) => !image.assetId)

  await prisma.gallery.delete({ where: { id } })

  await Promise.all(assetIds.map((assetId) => cleanupUnusedMediaAssetById(assetId)))
  await Promise.all(imagesWithoutAsset.map((image) => cleanupUntrackedUploadImageByUrl(image.url)))

  return true
}

async function permanentlyDeleteEventById(id: string) {
  const event = await prisma.event.findUnique({
    where: { id },
    include: { posters: true },
  })
  if (!event) return false

  const assetIds = [
    ...new Set(
      [event.coverAssetId, ...event.posters.map((poster) => poster.assetId)].filter(isString)
    ),
  ]
  const imageUrlsWithoutAsset = [
    ...event.posters
      .filter((poster) => !poster.assetId)
      .map((poster) => poster.url)
      .filter(isString),
    ...(event.coverAssetId ? [] : [event.coverUrl].filter(isString)),
  ]

  await prisma.event.delete({ where: { id } })

  await Promise.all(assetIds.map((assetId) => cleanupUnusedMediaAssetById(assetId)))
  await Promise.all(imageUrlsWithoutAsset.map((url) => cleanupUntrackedUploadImageByUrl(url)))

  return true
}

function invalidateSoftDeleteCaches(
  tab: string,
  identifiers: { id?: string; slug?: string; docId?: string } = {}
) {
  enhancedCache.invalidateByPrefix('search:')

  if (tab === 'wiki' || tab === 'wiki-categories') {
    if (identifiers.slug) {
      enhancedCache.delete(`${CACHE_KEYS.WIKI_PAGE}:${identifiers.slug}`)
    }
    enhancedCache.invalidateByPrefix(`${CACHE_KEYS.WIKI_LIST}:`)
    enhancedCache.invalidateByPrefix(`${CACHE_KEYS.WIKI_RECOMMENDED}:`)
    enhancedCache.invalidateByPrefix(`${CACHE_KEYS.WIKI_TIMELINE}:`)
    clearWikiRelationCache()
    return
  }

  if (tab === 'posts' || tab === 'sections') {
    enhancedCache.invalidateByPrefix('post_list:')
    return
  }

  if (tab === 'galleries') {
    enhancedCache.invalidateByPrefix('gallery_list_public:')
    return
  }

  if (tab === 'music') {
    enhancedCache.invalidateByPrefix('music_list:')
    return
  }

  if (tab === 'albums') {
    enhancedCache.invalidateByPrefix('album_list:')
    enhancedCache.invalidateByPrefix('music_list:')
    return
  }

  if (tab === 'announcements') {
    enhancedCache.delete(CACHE_KEYS.ANNOUNCEMENT_LATEST)
  }
}

function canOpenRestoredWikiNotification(
  status: string,
  recipientRole: AuthenticatedRequest['authUser']['role'] | undefined
) {
  if (status === 'draft' || status === 'pending' || status === 'published') {
    return true
  }

  return status === 'rejected' && isAdminRole(recipientRole)
}

async function notifyContentRestored(options: {
  recipientUid: string | null | undefined
  operatorUid: string
  operatorName?: string | null
  targetType: 'wiki' | 'post'
  targetId: string
  title: string
  status: string
  linkable: boolean
  wasDeleted: boolean
}) {
  if (
    !options.wasDeleted ||
    !options.recipientUid ||
    options.recipientUid === options.operatorUid
  ) {
    return
  }

  await createNotification(options.recipientUid, 'review_result', {
    approved: true,
    action: 'restored',
    targetType: options.targetType,
    targetId: options.targetId,
    title: options.title,
    status: options.status,
    linkable: options.linkable,
    operatorUid: options.operatorUid,
    operatorName: options.operatorName || null,
  })
}

async function notifyContentDeleted(options: {
  recipientUid: string | null | undefined
  operatorUid: string
  operatorName?: string | null
  targetType: 'wiki' | 'post' | 'gallery'
  targetId: string
  title: string
  note: string
}) {
  if (!options.recipientUid || options.recipientUid === options.operatorUid) {
    return
  }

  await createNotification(options.recipientUid, 'review_result', {
    approved: false,
    action: 'deleted',
    targetType: options.targetType,
    targetId: options.targetId,
    title: options.title,
    note: options.note,
    operatorUid: options.operatorUid,
    operatorName: options.operatorName || null,
  })
}

async function permanentlyDeleteMusicTrackByDocId(docId: string) {
  const song = await prisma.musicTrack.findUnique({
    where: { docId },
    include: { covers: true },
  })
  if (!song) return false

  const assetIds = [...new Set(song.covers.map((cover) => cover.assetId).filter(isString))]
  const coversWithoutAsset = song.covers.filter((cover) => !cover.assetId)

  await prisma.$transaction([
    prisma.favorite.deleteMany({ where: { targetType: 'music', targetId: docId } }),
    prisma.browsingHistory.deleteMany({ where: { targetType: 'music', targetId: docId } }),
    prisma.musicTrack.delete({ where: { docId } }),
  ])

  await Promise.all(assetIds.map((assetId) => cleanupUnusedMediaAssetById(assetId)))
  await Promise.all(
    coversWithoutAsset.map((cover) => cleanupUntrackedUploadImageByUrl(cover.publicUrl))
  )

  return true
}

async function permanentlyDeleteAlbumByDocId(docId: string) {
  const album = await prisma.album.findUnique({
    where: { docId },
    include: { covers: true },
  })
  if (!album) return false

  const assetIds = [...new Set(album.covers.map((cover) => cover.assetId).filter(isString))]
  const coversWithoutAsset = album.covers.filter((cover) => !cover.assetId)

  await prisma.$transaction(async (tx) => {
    await tx.musicTrack.updateMany({
      where: { coverAlbumDocId: docId },
      data: { coverAlbumDocId: null },
    })

    await tx.songAlbumRelation.deleteMany({ where: { albumDocId: docId } })
    await tx.album.delete({ where: { docId } })
  })

  await Promise.all(assetIds.map((assetId) => cleanupUnusedMediaAssetById(assetId)))
  await Promise.all(
    coversWithoutAsset.map((cover) => cleanupUntrackedUploadImageByUrl(cover.publicUrl))
  )

  return true
}

async function permanentlyDeleteImageMapById(id: string) {
  const existing = await prisma.imageMap.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!existing) return false

  await variantCleanup.cleanupByImageMapId(id, CleanupTrigger.ON_DELETE)
  await prisma.imageMap.delete({ where: { id } })
  return true
}

const uploadBackup = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, backupsDir)
    },
    filename: (_req, file, cb) => {
      cb(null, `restore_${Date.now()}_${file.originalname}`)
    },
  }),
  limits: {
    fileSize: UPLOAD_MAX_FILE_SIZE_BYTES,
  },
})

async function handleReviewAction(
  targetType: 'wiki' | 'post' | 'gallery',
  targetId: string,
  action: 'approve' | 'reject',
  reqAuthUser: { uid: string; role: string; displayName?: string | null },
  note: string
) {
  const reviewedAt = new Date()
  const reviewNote = action === 'reject' ? note : null

  if (targetType === 'wiki') {
    const page = await prisma.wikiPage.update({
      where: { slug: targetId },
      include: {
        lastEditor: { select: { displayName: true } },
        location: true,
      },
      data: {
        status: action === 'approve' ? 'published' : 'rejected',
        reviewNote,
        reviewedBy: reqAuthUser.uid,
        reviewedAt,
      },
    })

    await prisma.moderationLog.create({
      data: {
        targetType: 'wiki',
        targetId,
        action,
        operatorUid: reqAuthUser.uid,
        note: reviewNote,
      },
    })

    if (page.lastEditorUid && page.lastEditorUid !== reqAuthUser.uid) {
      await createNotification(page.lastEditorUid, 'review_result', {
        approved: action === 'approve',
        targetType: 'wiki',
        targetId,
        title: page.title,
        note: reviewNote,
      })
    }

    return {
      item: { ...toWikiResponse(page), sensitiveWords: containsSensitive(page.content || '') },
      targetType,
    }
  }

  if (targetType === 'post') {
    const existingPost = await prisma.post.findUnique({
      where: { id: targetId },
      select: {
        content: true,
        pendingReviewBaseContent: true,
      },
    })
    if (!existingPost) {
      throw new Error(`Post not found: ${targetId}`)
    }

    const suppressLegacyMentionNotifications =
      action === 'approve' &&
      !existingPost.pendingReviewBaseContent &&
      (await hasLatestPostSubmitLogForRepublishedEdit(targetId))
    const previousContentForMentions =
      existingPost.pendingReviewBaseContent ??
      (suppressLegacyMentionNotifications ? existingPost.content : null)

    const post = await prisma.post.update({
      where: { id: targetId },
      data: {
        status: action === 'approve' ? 'published' : 'rejected',
        reviewNote,
        reviewedBy: reqAuthUser.uid,
        reviewedAt,
        pendingReviewBaseContent: null,
      },
      include: { author: { select: { displayName: true } } },
    })

    await prisma.moderationLog.create({
      data: {
        targetType: 'post',
        targetId,
        action,
        operatorUid: reqAuthUser.uid,
        note: reviewNote,
      },
    })

    if (post.authorUid && post.authorUid !== reqAuthUser.uid) {
      await createNotification(post.authorUid, 'review_result', {
        approved: action === 'approve',
        targetType: 'post',
        targetId,
        title: post.title,
        note: reviewNote,
      })
    }

    if (action === 'approve') {
      await notifyMentionUsers({
        content: post.content,
        previousContent: previousContentForMentions,
        actorUid: post.authorUid,
        actorName: post.author?.displayName || '',
        target: { type: 'post', id: post.id },
      })
    }

    return {
      item:
        action === 'approve'
          ? { ...toPostResponse(post), sensitiveWords: containsSensitive(post.content || '') }
          : toPostResponse(post),
      targetType,
    }
  }

  const nextStatus = action === 'approve' ? 'published' : 'rejected'
  const gallery = await prisma.gallery.update({
    where: { id: targetId },
    data: {
      status: nextStatus,
      reviewNote,
      reviewedBy: reqAuthUser.uid,
      reviewedAt,
      published: nextStatus === 'published',
      publishedAt: nextStatus === 'published' ? reviewedAt : null,
    },
    include: {
      images: {
        include: {
          asset: true,
        },
        orderBy: { sortOrder: 'asc' },
      },
      location: true,
    },
  })

  await prisma.moderationLog.create({
    data: {
      targetType: 'gallery',
      targetId,
      action,
      operatorUid: reqAuthUser.uid,
      note: reviewNote,
    },
  })

  if (gallery.authorUid && gallery.authorUid !== reqAuthUser.uid) {
    await createNotification(gallery.authorUid, 'review_result', {
      approved: action === 'approve',
      targetType: 'gallery',
      targetId,
      title: gallery.title,
      note: reviewNote,
    })
  }

  return { item: await toGalleryResponse(gallery), targetType }
}

function isReviewTargetType(value: unknown): value is 'wiki' | 'post' | 'gallery' {
  return value === 'wiki' || value === 'post' || value === 'gallery'
}

/**
 * ====================
 * Review Queue Routes
 * ====================
 */

// GET /api/admin/review-queue/count - Get pending review counts
router.get(
  '/review-queue/count',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const type = normalizeModerationTargetType(req.query.type)
      const status = parseContentStatus(req.query.status) || 'pending'

      if (type && type !== 'wiki' && type !== 'post' && type !== 'gallery') {
        res.status(400).json({ error: 'type 必须为 wiki、posts 或 galleries' })
        return
      }

      const [wiki, posts, galleries] = await Promise.all([
        type && type !== 'wiki'
          ? Promise.resolve(0)
          : prisma.wikiPage.count({ where: { status, deletedAt: null } }),
        type && type !== 'post'
          ? Promise.resolve(0)
          : prisma.post.count({ where: { status, deletedAt: null } }),
        type && type !== 'gallery'
          ? Promise.resolve(0)
          : prisma.gallery.count({ where: { status, deletedAt: null } }),
      ])

      res.json({ status, counts: { wiki, posts, galleries }, total: wiki + posts + galleries })
    } catch (error) {
      logger.error({ err: error }, 'Fetch review queue count error')
      res.status(500).json({ error: '获取审核队列数量失败' })
    }
  })
)

// GET /api/admin/review-queue - Get review queue items
router.get(
  '/review-queue',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const type = normalizeModerationTargetType(req.query.type)
      const status = parseContentStatus(req.query.status) || 'pending'

      if (!type) {
        res.status(400).json({ error: 'type 必须为 wiki、posts 或 galleries' })
        return
      }

      if (type !== 'wiki' && type !== 'post' && type !== 'gallery') {
        res.status(400).json({ error: 'type 必须为 wiki、posts 或 galleries' })
        return
      }

      if (type === 'wiki') {
        const items = await prisma.wikiPage.findMany({
          where: { status, deletedAt: null },
          include: {
            lastEditor: { select: { displayName: true } },
            location: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 200,
        })
        res.json({
          type,
          status,
          items: items.map((item) => ({
            ...toWikiResponse(item),
            sensitiveWords: containsSensitive(item.content || ''),
          })),
        })
        return
      }

      if (type === 'gallery') {
        const items = await prisma.gallery.findMany({
          where: { status, deletedAt: null },
          include: {
            images: {
              include: {
                asset: true,
              },
              orderBy: { sortOrder: 'asc' },
            },
            location: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 200,
        })
        res.json({
          type: 'galleries',
          status,
          items: await toGalleryListResponse(items),
        })
        return
      }

      const items = await prisma.post.findMany({
        where: { status, deletedAt: null },
        include: {
          author: { select: { displayName: true } },
          sectionRef: { select: { name: true } },
          location: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      })
      res.json({
        type: 'posts',
        status,
        items: items.map((item) => ({
          ...toPostResponse(item),
          sectionName: item.sectionRef?.name || item.section,
          sensitiveWords: containsSensitive(item.content || ''),
        })),
      })
    } catch (error) {
      logger.error({ err: error }, 'Fetch review queue error')
      res.status(500).json({ error: '获取审核队列失败' })
    }
  })
)

// PUT /api/admin/review-queue/:id/approve - Approve a review item
router.put(
  '/review-queue/:id/approve',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const targetType = normalizeModerationTargetType(req.body.type) || 'wiki'
      const targetId = req.params.id
      const reqAuthUser = req.authUser!

      if (!isReviewTargetType(targetType)) {
        res.status(400).json({ error: '无效审核类型' })
        return
      }

      const result = await handleReviewAction(targetType, targetId, 'approve', reqAuthUser, '')
      res.json(result)
    } catch (error) {
      logger.error({ err: error }, 'Approve review item error')
      res.status(500).json({ error: '审核通过失败' })
    }
  })
)

// PUT /api/admin/review-queue/:id/reject - Reject a review item
router.put(
  '/review-queue/:id/reject',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const targetType = normalizeModerationTargetType(req.body.type) || 'wiki'
      const targetId = req.params.id
      const note = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
      const reqAuthUser = req.authUser!
      if (!isReviewTargetType(targetType)) {
        res.status(400).json({ error: '无效审核类型' })
        return
      }
      if (!note) {
        res.status(400).json({ error: '驳回原因不能为空' })
        return
      }
      const reviewNoteLimit =
        targetType === 'gallery'
          ? CONTENT_LIMITS.gallery.reviewNote
          : CONTENT_LIMITS.post.reviewNote
      if (!ensureTextLimit(res, note, '审核备注', reviewNoteLimit)) {
        return
      }

      const result = await handleReviewAction(targetType, targetId, 'reject', reqAuthUser, note)
      res.json(result)
    } catch (error) {
      logger.error({ err: error }, 'Reject review item error')
      res.status(500).json({ error: '驳回失败' })
    }
  })
)

// POST /api/admin/review/:type/:id/:action - Legacy compatible route
// Redirects to PUT /api/admin/review-queue/:id/:action
router.post(
  '/review/:type/:id/:action',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { type, id, action } = req.params
      let rejectNote = ''

      if (action !== 'approve' && action !== 'reject') {
        res.status(400).json({ error: '无效的操作' })
        return
      }

      if (action === 'reject') {
        rejectNote = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
        if (!rejectNote) {
          res.status(400).json({ error: '驳回原因不能为空' })
          return
        }
      }

      const targetType = normalizeModerationTargetType(type)
      if (!isReviewTargetType(targetType)) {
        res.status(400).json({ error: '无效的类型' })
        return
      }
      if (action === 'reject') {
        const reviewNoteLimit =
          targetType === 'gallery'
            ? CONTENT_LIMITS.gallery.reviewNote
            : CONTENT_LIMITS.post.reviewNote
        if (!ensureTextLimit(res, rejectNote, '审核备注', reviewNoteLimit)) {
          return
        }
      }

      const result = await handleReviewAction(targetType, id, action, req.authUser!, rejectNote)
      res.json(result)
    } catch (error) {
      logger.error({ err: error }, 'Review action error')
      res.status(500).json({ error: '审核操作失败' })
    }
  })
)

/**
 * ==========================
 * Sensitive Words Management
 * ==========================
 */

// GET /api/admin/sensitive-words - Check if a word is sensitive
router.get(
  '/sensitive-words',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { word } = req.query as { word?: string }
      if (!word) {
        res.status(400).json({ error: '请提供要检查的词语' })
        return
      }
      const isSensitive = isSensitiveWord(word)
      res.json({ word, isSensitive })
    } catch (error) {
      logger.error({ err: error }, 'Check sensitive word error')
      res.status(500).json({ error: '检查敏感词失败' })
    }
  })
)

// POST /api/admin/sensitive-words - Add sensitive word (placeholder - requires file system write)
router.post(
  '/sensitive-words',
  requireSuperAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { word } = req.body as { word?: string }
      if (!word || typeof word !== 'string') {
        res.status(400).json({ error: '请提供要添加的敏感词' })
        return
      }
      if (!ensureTextLimit(res, word, '敏感词', CONTENT_LIMITS.admin.sensitiveWord)) {
        return
      }

      // Note: This is a placeholder. Actual implementation would require
      // writing to the sensitive-words.txt file which needs special handling
      res.status(501).json({
        error: '敏感词管理需要通过文件系统操作，请手动编辑 public/sensitive-words/words.txt 文件',
        hint: '将敏感词添加到 public/sensitive-words/words.txt 文件中，每行一个词',
      })
    } catch (error) {
      logger.error({ err: error }, 'Add sensitive word error')
      res.status(500).json({ error: '添加敏感词失败' })
    }
  })
)

// DELETE /api/admin/sensitive-words/:id - Remove sensitive word (placeholder)
router.delete(
  '/sensitive-words/:id',
  requireSuperAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const word = req.params.id
      if (!word) {
        res.status(400).json({ error: '请提供要删除的敏感词' })
        return
      }

      // Note: This is a placeholder. Actual implementation would require
      // writing to the sensitive-words.txt file which needs special handling
      res.status(501).json({
        error: '敏感词管理需要通过文件系统操作，请手动编辑 public/sensitive-words/words.txt 文件',
        hint: '从 public/sensitive-words/words.txt 文件中删除该敏感词',
      })
    } catch (error) {
      logger.error({ err: error }, 'Remove sensitive word error')
      res.status(500).json({ error: '删除敏感词失败' })
    }
  })
)

/**
 * ==========================
 * Lock Management Routes
 * ==========================
 */

// GET /api/admin/locks - Get all edit locks
router.get(
  '/locks',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    try {
      const locks = await prisma.editLock.findMany({
        orderBy: {
          createdAt: 'desc',
        },
        take: 200,
      })

      res.json({ locks: locks.map(toEditLockResponse) })
    } catch (error) {
      logger.error({ err: error }, 'Fetch edit locks error')
      res.status(500).json({ error: '获取编辑锁列表失败' })
    }
  })
)

// POST /api/admin/locks - Create/edit lock (generic endpoint)
router.post(
  '/locks',
  requireAuth,
  requireActiveUser,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      await prisma.editLock.deleteMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
        },
      })

      const collection = req.body?.collection
      const recordId = req.body?.recordId

      if (!collection || !recordId) {
        res.status(400).json({ error: '缺少有效的锁定目标' })
        return
      }

      const ttlMinutes = 15
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000)
      const force = false

      const existing = await prisma.editLock.findUnique({
        where: {
          collection_recordId: {
            collection,
            recordId,
          },
        },
      })

      if (existing && existing.userId !== req.authUser!.uid) {
        const isExpired = existing.expiresAt.getTime() <= Date.now()
        if (!isExpired && !(force && isAdminRole(req.authUser!.role))) {
          res.status(409).json({
            error: '该记录正在被其他用户编辑',
            lock: toEditLockResponse(existing),
          })
          return
        }

        const takenOver = await prisma.editLock.update({
          where: { id: existing.id },
          data: {
            userId: req.authUser!.uid,
            username: req.authUser!.displayName,
            expiresAt,
          },
        })

        res.json({ lock: toEditLockResponse(takenOver), acquired: true, takeover: true })
        return
      }

      if (existing && existing.userId === req.authUser!.uid) {
        const renewed = await prisma.editLock.update({
          where: { id: existing.id },
          data: {
            username: req.authUser!.displayName,
            expiresAt,
          },
        })
        res.json({ lock: toEditLockResponse(renewed), acquired: true, renewed: true })
        return
      }

      const created = await prisma.editLock.create({
        data: {
          collection,
          recordId,
          userId: req.authUser!.uid,
          username: req.authUser!.displayName,
          expiresAt,
        },
      })

      res.status(201).json({ lock: toEditLockResponse(created), acquired: true })
    } catch (error) {
      logger.error({ err: error }, 'Acquire edit lock error')
      res.status(500).json({ error: '申请编辑锁失败' })
    }
  })
)

// DELETE /api/admin/locks/:id - Delete lock by ID
router.delete(
  '/locks/:id',
  requireAuth,
  requireActiveUser,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const lock = await prisma.editLock.findUnique({ where: { id: req.params.id } })
      if (!lock) {
        res.json({ success: true })
        return
      }

      const canManage = lock.userId === req.authUser!.uid || isAdminRole(req.authUser!.role)
      if (!canManage) {
        res.status(403).json({ error: '无权限释放该编辑锁' })
        return
      }

      await prisma.editLock.delete({ where: { id: lock.id } })
      res.json({ success: true })
    } catch (error) {
      logger.error({ err: error }, 'Release edit lock error')
      res.status(500).json({ error: '释放编辑锁失败' })
    }
  })
)

router.delete(
  '/locks',
  requireAdmin,
  validateBody(adminBatchEditLocksSchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const lockIds = req.body.lockIds as string[]
      const result = await prisma.editLock.deleteMany({
        where: {
          id: { in: lockIds },
        },
      })

      res.json({ success: true, deleted: result.count })
    } catch (error) {
      logger.error({ err: error }, 'Batch release edit locks error')
      res.status(500).json({ error: '批量释放编辑锁失败' })
    }
  })
)

/**
 * ==========================
 * Moderation Logs
 * ==========================
 */

// GET /api/admin/moderation_logs - Get moderation logs
router.get(
  '/moderation_logs',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    try {
      const logs = await prisma.moderationLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          operator: {
            select: { uid: true, displayName: true, email: true },
          },
        },
      })

      res.json({
        logs: logs.map((log) => ({
          id: log.id,
          targetType: log.targetType,
          targetId: log.targetId,
          action: log.action,
          operatorUid: log.operatorUid,
          operatorName: log.operator.displayName || log.operator.email || 'Unknown',
          note: log.note,
          createdAt: log.createdAt.toISOString(),
        })),
      })
    } catch (error) {
      logger.error({ err: error }, 'Fetch moderation logs error')
      res.status(500).json({ error: '获取操作日志失败' })
    }
  })
)

// GET /api/admin/ban_logs - Get ban logs
router.get(
  '/ban_logs',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    try {
      const logs = await prisma.userBanLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          target: {
            select: { uid: true, displayName: true, email: true },
          },
          operator: {
            select: { uid: true, displayName: true, email: true },
          },
        },
      })

      res.json({
        logs: logs.map((log) => ({
          id: log.id,
          targetUid: log.targetUid,
          targetName: log.target.displayName || log.target.email || 'Unknown',
          action: log.action,
          operatorUid: log.operatorUid,
          operatorName: log.operator.displayName || log.operator.email || 'Unknown',
          note: log.note,
          createdAt: log.createdAt.toISOString(),
        })),
      })
    } catch (error) {
      logger.error({ err: error }, 'Fetch ban logs error')
      res.status(500).json({ error: '获取封禁日志失败' })
    }
  })
)

/**
 * ==========================
 * Batch Operations Routes
 * ==========================
 */

router.patch(
  '/music/batch-display',
  requireAdmin,
  validateBody(adminBatchMusicDisplaySchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const songDocIds = req.body.songDocIds as string[]
      const displayAlbumMode = parseDisplayAlbumMode(req.body.displayAlbumMode)
      const manualAlbumName =
        typeof req.body.manualAlbumName === 'string' ? req.body.manualAlbumName.trim() : null
      const displayAlbumDocId =
        typeof req.body.displayAlbumDocId === 'string' ? req.body.displayAlbumDocId.trim() : null

      if (!displayAlbumMode) {
        res.status(400).json({ error: '展示模式无效' })
        return
      }

      if (
        !ensureTextLimit(res, manualAlbumName, '手动专辑名', CONTENT_LIMITS.music.manualAlbumName)
      ) {
        return
      }

      const songs = await prisma.musicTrack.findMany({
        where: {
          docId: { in: songDocIds },
          deletedAt: null,
        },
        select: { docId: true },
      })
      if (songs.length !== songDocIds.length) {
        res.status(400).json({ error: '歌曲列表包含无效歌曲' })
        return
      }

      if (displayAlbumMode === 'manual' && !manualAlbumName) {
        res.status(400).json({ error: '手动专辑名不能为空' })
        return
      }

      if (displayAlbumMode === 'linked' && displayAlbumDocId) {
        const relations = await prisma.songAlbumRelation.findMany({
          where: {
            albumDocId: displayAlbumDocId,
            songDocId: { in: songDocIds },
          },
          select: { songDocId: true },
        })
        const relatedSongDocIds = new Set(relations.map((relation) => relation.songDocId))
        if (songDocIds.some((songDocId) => !relatedSongDocIds.has(songDocId))) {
          res.status(400).json({ error: '展示专辑必须已关联所有选中歌曲' })
          return
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.musicTrack.updateMany({
          where: { docId: { in: songDocIds } },
          data: {
            displayAlbumMode,
            manualAlbumName: displayAlbumMode === 'manual' ? manualAlbumName : null,
          },
        })

        if (displayAlbumMode === 'linked' && displayAlbumDocId) {
          await tx.songAlbumRelation.updateMany({
            where: { songDocId: { in: songDocIds } },
            data: { isDisplay: false },
          })
          await tx.songAlbumRelation.updateMany({
            where: {
              songDocId: { in: songDocIds },
              albumDocId: displayAlbumDocId,
            },
            data: { isDisplay: true },
          })
        }
      })

      enhancedCache.invalidateByPrefix('music_list:')
      res.json({ success: true, updated: songDocIds.length })
    } catch (error) {
      logger.error({ err: error }, 'Batch update music display error')
      res.status(500).json({ error: '批量更新歌曲展示信息失败' })
    }
  })
)

// POST /api/admin/batch-delete-posts - Batch delete posts
router.post(
  '/batch-delete-posts',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const postIds = Array.isArray(req.body?.postIds) ? req.body.postIds : []
      if (!postIds.length) {
        res.status(400).json({ error: '请选择要删除的帖子' })
        return
      }

      const posts = await prisma.post.findMany({
        where: { id: { in: postIds }, deletedAt: null },
        select: { id: true, authorUid: true },
      })
      const hasOtherPeopleContent = posts.some((post) => post.authorUid !== req.authUser!.uid)
      const reason = resolveDeleteReason(req.body?.reason, !hasOtherPeopleContent)
      if (hasOtherPeopleContent && !reason) {
        res.status(400).json({ error: '删除理由不能为空' })
        return
      }
      if (!ensureTextLimit(res, reason, '删除理由', CONTENT_LIMITS.post.reviewNote)) {
        return
      }

      const result = await prisma.$transaction(async (tx) => {
        let deleted = 0
        for (const post of posts) {
          await tx.post.update({
            where: { id: post.id },
            data: softDeleteData(req.authUser!.uid),
          })
          await tx.moderationLog.create({
            data: {
              targetType: 'post',
              targetId: post.id,
              action: 'delete',
              operatorUid: req.authUser!.uid,
              note: post.authorUid === req.authUser!.uid ? resolveDeleteReason(null, true) : reason,
            },
          })
          deleted++
        }
        return { count: deleted }
      })

      res.json({ deleted: result.count })
    } catch (error) {
      logger.error({ err: error }, 'Batch delete posts error')
      res.status(500).json({ error: '批量删除帖子失败' })
    }
  })
)

// POST /api/admin/batch-delete-galleries - Batch delete galleries
router.post(
  '/batch-delete-galleries',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const galleryIds = Array.isArray(req.body?.galleryIds) ? req.body.galleryIds : []
      if (!galleryIds.length) {
        res.status(400).json({ error: '请选择要删除的图集' })
        return
      }

      const galleries = await prisma.gallery.findMany({
        where: { id: { in: galleryIds }, deletedAt: null },
        select: { id: true, authorUid: true },
      })
      const hasOtherPeopleContent = galleries.some(
        (gallery) => gallery.authorUid !== req.authUser!.uid
      )
      const reason = resolveDeleteReason(req.body?.reason, !hasOtherPeopleContent)
      if (hasOtherPeopleContent && !reason) {
        res.status(400).json({ error: '删除理由不能为空' })
        return
      }
      if (!ensureTextLimit(res, reason, '删除理由', CONTENT_LIMITS.gallery.reviewNote)) {
        return
      }

      const deleted = await prisma.$transaction(async (tx) => {
        let count = 0
        for (const gallery of galleries) {
          await tx.gallery.update({
            where: { id: gallery.id },
            data: softDeleteData(req.authUser!.uid),
          })
          await tx.moderationLog.create({
            data: {
              targetType: 'gallery',
              targetId: gallery.id,
              action: 'delete',
              operatorUid: req.authUser!.uid,
              note:
                gallery.authorUid === req.authUser!.uid ? resolveDeleteReason(null, true) : reason,
            },
          })
          count++
        }
        return count
      })

      res.json({ deleted })
    } catch (error) {
      logger.error({ err: error }, 'Batch delete galleries error')
      res.status(500).json({ error: '批量删除图集失败' })
    }
  })
)

// POST /api/admin/batch-delete-comments - Batch delete comments
router.post(
  '/batch-delete-comments',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const commentIds = Array.isArray(req.body?.commentIds) ? req.body.commentIds : []
      if (!commentIds.length) {
        res.status(400).json({ error: '请选择要删除的评论' })
        return
      }

      const comments = await prisma.postComment.findMany({
        where: { id: { in: commentIds }, deletedAt: null },
        select: { id: true, authorUid: true },
      })
      const hasOtherPeopleContent = comments.some(
        (comment) => comment.authorUid !== req.authUser!.uid
      )
      const reason = resolveDeleteReason(req.body?.reason, !hasOtherPeopleContent)
      if (hasOtherPeopleContent && !reason) {
        res.status(400).json({ error: '删除理由不能为空' })
        return
      }
      if (!ensureTextLimit(res, reason, '删除理由', CONTENT_LIMITS.post.reviewNote)) {
        return
      }

      const result = await prisma.$transaction(async (tx) => {
        let deleted = 0
        for (const comment of comments) {
          await tx.postComment.update({
            where: { id: comment.id },
            data: {
              deletedAt: new Date(),
              deletedBy: req.authUser!.uid,
            },
          })
          await tx.moderationLog.create({
            data: {
              targetType: 'comment',
              targetId: comment.id,
              action: 'delete',
              operatorUid: req.authUser!.uid,
              note:
                comment.authorUid === req.authUser!.uid ? resolveDeleteReason(null, true) : reason,
            },
          })
          deleted++
        }
        return { count: deleted }
      })

      res.json({ deleted: result.count })
    } catch (error) {
      logger.error({ err: error }, 'Batch delete comments error')
      res.status(500).json({ error: '批量删除评论失败' })
    }
  })
)

/**
 * ==========================
 * Wiki-links Management
 * ==========================
 */

// GET /api/admin/wiki-links - Get all wiki-links (scan)
router.get(
  '/wiki-links/scan',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    try {
      const result = await scanAllWikiLinks()
      res.json(result)
    } catch (error) {
      logger.error({ err: error }, 'Scan wiki links error')
      res.status(500).json({ error: '扫描 Wiki 链接失败' })
    }
  })
)

// GET /api/admin/wiki-links/:slug - Get wiki page links
router.get(
  '/wiki-links/:slug',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { slug } = req.params
      const result = await getWikiPageLinks(slug)
      res.json(result)
    } catch (error) {
      logger.error({ err: error }, 'Get wiki page links error')
      res.status(500).json({ error: '获取 Wiki 页面链接失败' })
    }
  })
)

// PUT /api/admin/wiki-links/:id - Update wiki link (preview)
router.put(
  '/wiki-links/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { mappings, slugs } = req.body as {
        mappings: Array<{ oldUrl: string; newUrl: string; useRegex?: boolean }>
        slugs?: string[]
      }

      if (!mappings || !Array.isArray(mappings) || mappings.length === 0) {
        res.status(400).json({ error: '请提供链接映射规则' })
        return
      }

      const result = await previewLinkUpdate(mappings, { specificSlugs: slugs })
      res.json(result)
    } catch (error) {
      logger.error({ err: error }, 'Preview link update error')
      res.status(500).json({ error: '预览链接更新失败' })
    }
  })
)

// POST /api/admin/wiki-links/update - Batch update wiki links
router.post(
  '/wiki-links/update',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { mappings, dryRun } = req.body as {
        mappings: Array<{ oldUrl: string; newUrl: string; useRegex?: boolean }>
        dryRun?: boolean
      }

      if (!mappings || !Array.isArray(mappings) || mappings.length === 0) {
        res.status(400).json({ error: '请提供链接映射规则' })
        return
      }

      const result = await batchUpdateWikiLinks(mappings, { dryRun })

      // 批量更新完成后清空 Wiki 相关缓存
      if (!dryRun && result.successCount > 0) {
        invalidateWikiContentCaches()
      }

      res.json(result)
    } catch (error) {
      logger.error({ err: error }, 'Batch update wiki links error')
      res.status(500).json({ error: '批量更新链接失败' })
    }
  })
)

// POST /api/admin/wiki-links/switch-storage - Switch wiki storage strategy
router.post(
  '/wiki-links/switch-storage',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { fromStorage, toStorage, config, dryRun } = req.body as {
        fromStorage: 'local' | 's3' | 'external'
        toStorage: 'local' | 's3' | 'external'
        config: {
          localBaseUrl?: string
          s3BaseUrl?: string
          externalBaseUrl?: string
        }
        dryRun?: boolean
      }

      if (!fromStorage || !toStorage) {
        res.status(400).json({ error: '请提供源存储和目标存储' })
        return
      }

      if (fromStorage === toStorage) {
        res.status(400).json({ error: '源存储和目标存储不能相同' })
        return
      }

      const result = await switchWikiStorage(fromStorage, toStorage, config, { dryRun })
      res.json(result)
    } catch (error) {
      logger.error({ err: error }, 'Switch wiki storage error')
      res.status(500).json({ error: '切换存储策略失败' })
    }
  })
)

// POST /api/admin/wiki-links/sync-with-imagemap - Sync wiki links with ImageMap
router.post(
  '/wiki-links/sync-with-imagemap',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { dryRun } = req.body as { dryRun?: boolean }

      const imageMaps = await prisma.imageMap.findMany({})
      if (imageMaps.length === 0) {
        res.json({ message: 'ImageMap 为空，无需同步', result: null })
        return
      }

      const mappings = imageMaps
        .filter((im) => im.localUrl && im.externalUrl && im.localUrl !== im.externalUrl)
        .map((im) => ({
          oldUrl: im.localUrl!,
          newUrl: im.externalUrl!,
          useRegex: false,
        }))

      if (mappings.length === 0) {
        res.json({ message: '没有需要同步的链接', result: null })
        return
      }

      const result = await batchUpdateWikiLinks(mappings, { dryRun })
      if (!dryRun && result.successCount > 0) {
        invalidateWikiContentCaches()
      }
      res.json({ message: dryRun ? '预览同步完成' : '同步完成', result })
    } catch (error) {
      logger.error({ err: error }, 'Sync wiki links with ImageMap error')
      res.status(500).json({ error: '同步 ImageMap 失败' })
    }
  })
)

/**
 * ==========================
 * Backup Management Routes
 * ==========================
 */

// POST /api/admin/backup/create - Create backup
router.post(
  '/backup/create',
  requireSuperAdmin,
  validateBody(backupCreateSchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { note = '' } = req.body as { note?: string }
      const dbConfig = parseDatabaseUrl(process.env.DATABASE_URL || '')
      if (!dbConfig) {
        res.status(500).json({ error: 'DATABASE_URL 格式无效' })
        return
      }

      const timestamp = formatBackupTimestamp()
      const sqlFilename = `backup_${timestamp}.sql`
      const sqlFilePath = path.join(backupsDir, sqlFilename)
      const zipFilename = `backup_${timestamp}.zip`
      const zipFilePath = path.join(backupsDir, zipFilename)

      const pgDumpArgs = [
        '-h',
        dbConfig.host,
        '-p',
        dbConfig.port,
        '-U',
        dbConfig.user,
        '-d',
        dbConfig.database,
        '--no-owner',
        '--no-privileges',
        '--clean',
        '--if-exists',
        '--exclude-table-data=ImageEmbedding',
        '--exclude-table-data=TextEmbeddingChunk',
        '-f',
        sqlFilePath,
      ]

      const pgDumpEnv = { ...process.env, PGPASSWORD: dbConfig.password }

      await execFileAsync(getPostgresClientExecutable('pg_dump'), pgDumpArgs, {
        env: pgDumpEnv,
        timeout: 300000,
      })

      const sqlContent = await fs.promises.readFile(sqlFilePath)
      await fs.promises.unlink(sqlFilePath)

      const isEncrypted = Boolean(BACKUP_PASSWORD)
      const archiveContent = isEncrypted ? encryptBuffer(sqlContent, BACKUP_PASSWORD) : sqlContent

      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(zipFilePath)
        const archive = archiver('zip', { zlib: { level: 9 } })

        output.on('close', () => resolve())
        archive.on('error', (err) => reject(err))

        archive.pipe(output)
        archive.append(archiveContent, { name: sqlFilename })
        archive.append(
          serializeBackupMetadata({
            format: 'huangshifu-wiki-backup',
            version: 2,
            encrypted: isEncrypted,
            encryption: isEncrypted ? 'aes-256-gcm' : undefined,
          }),
          { name: BACKUP_METADATA_ENTRY }
        )
        archive.finalize()
      })

      const stat = await fs.promises.stat(zipFilePath)
      const savedNote = note.trim() ? await writeBackupNote(zipFilename, note) : ''

      await cleanupOldBackups()

      res.json({
        backup: {
          filename: zipFilename,
          size: stat.size,
          sizeFormatted: formatFileSize(stat.size),
          createdAt: new Date().toISOString(),
          note: savedNote,
        },
      })
    } catch (error) {
      logger.error({ err: error }, 'Create backup error')
      if (isPostgresClientMissingError(error)) {
        res.status(500).json({ error: formatPostgresClientMissingError('pg_dump') })
        return
      }
      res.status(500).json({ error: '创建备份失败，请查看服务器日志' })
    }
  })
)

// GET /api/admin/backup/list - List backups (frontend compatible)
router.get('/backup/list', requireSuperAdmin, asyncHandler(handleBackupList))

// POST /api/admin/backup/:filename/note - Update backup note
router.post(
  '/backup/:filename/note',
  requireSuperAdmin,
  validateBody(backupNoteSchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const filename = req.params.filename
      const normalized = path.normalize(filename)

      if (normalized.includes('..') || !sanitizeFilename(filename)) {
        res.status(400).json({ error: '无效的文件名' })
        return
      }

      const filePath = path.join(backupsDir, normalized)
      try {
        await fs.promises.access(filePath)
      } catch {
        res.status(404).json({ error: '备份文件不存在' })
        return
      }

      const { note } = req.body as { note: string }
      const savedNote = await writeBackupNote(normalized, note)
      res.json({ success: true, note: savedNote })
    } catch (error) {
      logger.error({ err: error }, 'Update backup note error')
      res.status(500).json({ error: '更新备份备注失败' })
    }
  })
)

// POST /api/admin/backup/:filename/download - Download backup
router.post(
  '/backup/:filename/download',
  requireSuperAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const filename = req.params.filename
      const normalized = path.normalize(filename)

      if (normalized.includes('..') || !sanitizeFilename(filename)) {
        res.status(400).json({ error: '无效的文件名' })
        return
      }

      const filePath = path.join(backupsDir, normalized)
      try {
        await fs.promises.access(filePath)
      } catch {
        res.status(404).json({ error: '备份文件不存在' })
        return
      }

      pipeDownloadFile(res, filePath, {
        filename,
        contentType: 'application/zip',
        errorMessage: '下载备份失败',
        logMessage: 'Backup download stream error',
      })
    } catch (error) {
      logger.error({ err: error }, 'Download backup error')
      res.status(500).json({ error: '下载备份失败' })
    }
  })
)

// ─── 站内备份恢复共享函数 ────────────────────────────────────────────

type RestoreFromZipResult = {
  success: boolean
  error?: string
  statusCode?: number
  mediaReport?: MediaRestoreReportSummary
  mediaReportError?: string
}

function pipeDownloadFile(
  res: Response,
  filePath: string,
  options: { filename: string; contentType: string; errorMessage: string; logMessage: string }
) {
  res.setHeader('Content-Type', options.contentType)
  res.setHeader('Content-Disposition', `attachment; filename="${options.filename}"`)
  const fileStream = fs.createReadStream(filePath)
  fileStream.on('error', (err) => {
    logger.error({ err }, options.logMessage)
    if (!res.headersSent) {
      res.status(500).json({ error: options.errorMessage })
    } else {
      res.end()
    }
  })
  fileStream.pipe(res)
}

async function restoreDatabaseFromZip(
  zipFilePath: string,
  dbConfig: { host: string; port: string; user: string; password: string; database: string },
  legacyPassword?: string,
  sourceBackupFilename?: string,
  restoreSource: MediaRestoreSource = { type: 'upload' }
): Promise<RestoreFromZipResult> {
  let sqlContent: Buffer
  try {
    const AdmZip = (await import('adm-zip')).default
    const zip = new AdmZip(zipFilePath)
    const zipEntries = zip.getEntries()

    const sqlEntry = zipEntries.find((e) => e.entryName.endsWith('.sql'))
    if (!sqlEntry) {
      return { success: false, error: '备份文件中未找到 SQL 数据', statusCode: 400 }
    }

    const encryptedContent = sqlEntry.getData()
    const metadataEntry = zipEntries.find((e) => e.entryName === BACKUP_METADATA_ENTRY)
    const metadata = parseBackupMetadata(metadataEntry?.getData())

    if (metadata?.encrypted) {
      if (!BACKUP_PASSWORD) {
        return {
          success: false,
          error: '服务器未配置 BACKUP_PASSWORD，无法恢复加密备份',
          statusCode: 400,
        }
      }
      try {
        sqlContent = decryptBuffer(encryptedContent, BACKUP_PASSWORD)
      } catch {
        return {
          success: false,
          error: '备份文件无法用服务器密钥解密，请确认 BACKUP_PASSWORD 配置',
          statusCode: 400,
        }
      }
    } else if (metadata) {
      sqlContent = encryptedContent
    } else {
      const rawContent = encryptedContent.toString('utf-8')
      if (rawContent.includes('PostgreSQL database dump') || rawContent.includes('pg_dump')) {
        sqlContent = encryptedContent
      } else {
        const candidatePasswords = [BACKUP_PASSWORD, legacyPassword].filter(
          (candidate, index, candidates): candidate is string =>
            Boolean(candidate) && candidates.indexOf(candidate) === index
        )

        let decrypted: Buffer | null = null
        for (const candidate of candidatePasswords) {
          try {
            decrypted = decryptBuffer(encryptedContent, candidate)
            break
          } catch {
            // Try the next compatible legacy password source.
          }
        }

        if (!decrypted) {
          return {
            success: false,
            error: '旧备份文件已加密，请配置 BACKUP_PASSWORD 或提供旧备份解密密码',
            statusCode: 400,
          }
        }

        sqlContent = decrypted
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to parse backup zip')
    return { success: false, error: '备份文件解析失败', statusCode: 400 }
  }

  const sqlContentStr = sqlContent.toString('utf-8')
  if (!sqlContentStr.includes('PostgreSQL database dump') && !sqlContentStr.includes('pg_dump')) {
    return { success: false, error: '备份文件格式无效', statusCode: 400 }
  }

  const validation = validateSqlContent(sqlContentStr)
  if (!validation.valid) {
    logger.error({ reason: validation.reason }, 'SQL validation failed during restore')
    return { success: false, error: validation.reason!, statusCode: 400 }
  }

  // Pre-restore backup
  logger.info('Creating pre-restore backup before database restore')
  try {
    const preRestoreTimestamp = formatBackupTimestamp()
    const preRestoreSqlFilename = `backup_${preRestoreTimestamp}.sql`
    const preRestoreSqlFilePath = path.join(backupsDir, preRestoreSqlFilename)
    const preRestoreZipFilename = `backup_${preRestoreTimestamp}.zip`
    const preRestoreZipFilePath = path.join(backupsDir, preRestoreZipFilename)

    const pgDumpArgs = [
      '-h',
      dbConfig.host,
      '-p',
      dbConfig.port,
      '-U',
      dbConfig.user,
      '-d',
      dbConfig.database,
      '--no-owner',
      '--no-privileges',
      '--clean',
      '--if-exists',
      '--exclude-table-data=ImageEmbedding',
      '--exclude-table-data=TextEmbeddingChunk',
      '-f',
      preRestoreSqlFilePath,
    ]
    const pgDumpEnv = { ...process.env, PGPASSWORD: dbConfig.password }

    await execFileAsync(getPostgresClientExecutable('pg_dump'), pgDumpArgs, {
      env: pgDumpEnv,
      timeout: 300000,
    })

    const preRestoreSqlContent = await fs.promises.readFile(preRestoreSqlFilePath)
    await fs.promises.unlink(preRestoreSqlFilePath)

    const preRestoreEncrypted = Boolean(BACKUP_PASSWORD)
    const preRestoreContent = preRestoreEncrypted
      ? encryptBuffer(preRestoreSqlContent, BACKUP_PASSWORD)
      : preRestoreSqlContent

    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(preRestoreZipFilePath)
      const archive = archiver('zip', { zlib: { level: 9 } })

      output.on('close', () => resolve())
      archive.on('error', (err) => reject(err))

      archive.pipe(output)
      archive.append(preRestoreContent, { name: preRestoreSqlFilename })
      archive.append(
        serializeBackupMetadata({
          format: 'huangshifu-wiki-backup',
          version: 2,
          encrypted: preRestoreEncrypted,
          encryption: preRestoreEncrypted ? 'aes-256-gcm' : undefined,
        }),
        { name: BACKUP_METADATA_ENTRY }
      )
      archive.finalize()
    })

    await cleanupOldBackups(sourceBackupFilename ? [sourceBackupFilename] : undefined)
    logger.info({ filename: preRestoreZipFilename }, 'Pre-restore backup created successfully')
  } catch (preBackupError) {
    logger.error({ err: preBackupError }, 'Pre-restore backup creation failed, aborting restore')
    if (isPostgresClientMissingError(preBackupError)) {
      return { success: false, error: formatPostgresClientMissingError('pg_dump'), statusCode: 500 }
    }
    return {
      success: false,
      error: '预备份创建失败，恢复操作已中止，请查看服务器日志',
      statusCode: 500,
    }
  }

  // Execute restore
  const tempSqlPath = path.join(backupsDir, `restore_${Date.now()}.sql`)
  await fs.promises.writeFile(tempSqlPath, sqlContent)

  try {
    const psqlArgs = [
      '-h',
      dbConfig.host,
      '-p',
      dbConfig.port,
      '-U',
      dbConfig.user,
      '-d',
      dbConfig.database,
      '--single-transaction',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      tempSqlPath,
    ]
    const psqlEnv = { ...process.env, PGPASSWORD: dbConfig.password }

    await execFileAsync(getPostgresClientExecutable('psql'), psqlArgs, {
      env: psqlEnv,
      timeout: 600000,
    })
  } catch (psqlError) {
    logger.error({ err: psqlError }, 'psql restore failed')
    if (isPostgresClientMissingError(psqlError)) {
      return { success: false, error: formatPostgresClientMissingError('psql'), statusCode: 500 }
    }
    return { success: false, error: '恢复数据库失败，请查看服务器日志', statusCode: 500 }
  } finally {
    await fs.promises.unlink(tempSqlPath).catch((err) => logger.warn({ err }, 'Cleanup failed'))
  }

  try {
    const mediaReport = await generateMediaRestoreReport(prisma, restoreSource)
    return { success: true, mediaReport }
  } catch (mediaReportError) {
    logger.error({ err: mediaReportError }, 'Generate restore media report failed')
    return {
      success: true,
      mediaReportError: '图片清单生成失败，请查看服务器日志',
    }
  }
}

// POST /api/admin/backup/restore - Restore backup (upload)
router.post(
  '/backup/restore',
  requireSuperAdmin,
  uploadBackup.single('file'),
  validateBody(backupRestoreSchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    req.setTimeout(BACKUP_RESTORE_RESPONSE_TIMEOUT_MS)
    res.setTimeout(BACKUP_RESTORE_RESPONSE_TIMEOUT_MS)
    const { legacyPassword, confirm } = req.body as { legacyPassword?: string; confirm?: boolean }
    const file = req.file

    if (!confirm) {
      res.status(400).json({ error: '恢复操作需要二次确认，请传入 confirm: true' })
      return
    }

    if (!file) {
      res.status(400).json({ error: '请上传备份文件' })
      return
    }

    const dbConfig = parseDatabaseUrl(process.env.DATABASE_URL || '')
    if (!dbConfig) {
      await fs.promises.unlink(file.path).catch(() => {})
      res.status(500).json({ error: 'DATABASE_URL 格式无效' })
      return
    }

    try {
      const result = await restoreDatabaseFromZip(file.path, dbConfig, legacyPassword, undefined, {
        type: 'upload',
        filename: file.originalname,
      })

      if (!result.success) {
        res.status(result.statusCode).json({ error: result.error })
        return
      }

      res.json({
        success: true,
        message: '数据库恢复成功',
        mediaReport: result.mediaReport,
        mediaReportError: result.mediaReportError,
      })
    } finally {
      await fs.promises.unlink(file.path).catch((err) => logger.warn({ err }, 'Cleanup failed'))
    }
  })
)

// POST /api/admin/backup/:filename/restore - Restore from existing backup
router.post(
  '/backup/:filename/restore',
  requireSuperAdmin,
  validateBody(backupRestoreSchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    req.setTimeout(BACKUP_RESTORE_RESPONSE_TIMEOUT_MS)
    res.setTimeout(BACKUP_RESTORE_RESPONSE_TIMEOUT_MS)
    const { legacyPassword, confirm } = req.body as { legacyPassword?: string; confirm?: boolean }

    if (!confirm) {
      res.status(400).json({ error: '恢复操作需要二次确认，请传入 confirm: true' })
      return
    }

    const filename = req.params.filename
    const normalized = path.normalize(filename)

    if (normalized.includes('..') || !sanitizeFilename(filename)) {
      res.status(400).json({ error: '无效的文件名' })
      return
    }

    const filePath = path.join(backupsDir, normalized)
    try {
      await fs.promises.access(filePath)
    } catch {
      res.status(404).json({ error: '备份文件不存在' })
      return
    }

    const dbConfig = parseDatabaseUrl(process.env.DATABASE_URL || '')
    if (!dbConfig) {
      res.status(500).json({ error: 'DATABASE_URL 格式无效' })
      return
    }

    const result = await restoreDatabaseFromZip(filePath, dbConfig, legacyPassword, normalized, {
      type: 'existing',
      filename: normalized,
    })

    if (!result.success) {
      res.status(result.statusCode).json({ error: result.error })
      return
    }

    // Do NOT delete the original backup file
    res.json({
      success: true,
      message: '数据库恢复成功',
      mediaReport: result.mediaReport,
      mediaReportError: result.mediaReportError,
    })
  })
)

// POST /api/admin/backup/media-reports/:filename/download - Download restore media report
router.post(
  '/backup/media-reports/:filename/download',
  requireSuperAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const filename = req.params.filename
      if (!isMediaRestoreReportFilename(filename)) {
        res.status(400).json({ error: '无效的文件名' })
        return
      }

      const filePath = resolveMediaRestoreReportPath(filename)
      try {
        await fs.promises.access(filePath)
      } catch {
        res.status(404).json({ error: '图片清单不存在' })
        return
      }

      pipeDownloadFile(res, filePath, {
        filename,
        contentType: 'application/json; charset=utf-8',
        errorMessage: '下载图片清单失败',
        logMessage: 'Restore media report download stream error',
      })
    } catch (error) {
      logger.error({ err: error }, 'Download restore media report error')
      res.status(500).json({ error: '下载图片清单失败' })
    }
  })
)

// GET /api/admin/backups - List backups
router.get('/backups', requireSuperAdmin, asyncHandler(handleBackupList))

// DELETE /api/admin/backup/:filename - Delete backup (legacy compatible)
router.post('/backup/:filename/delete', requireSuperAdmin, asyncHandler(handleBackupDelete))

// DELETE /api/admin/backups/:filename - Delete backup
router.post('/backups/:filename/delete', requireSuperAdmin, asyncHandler(handleBackupDelete))

router.post(
  '/wiki-categories',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { id, name, description, order, requiresAdminEdit } = req.body as {
        id?: string
        name?: string
        description?: string
        order?: number
        requiresAdminEdit?: boolean
      }
      const categoryId = id?.trim()
      const categoryName = name?.trim()
      const categoryDescription = description?.trim() || ''

      if (!categoryId || !categoryName) {
        res.status(400).json({ error: '分类 ID 和名称不能为空' })
        return
      }

      if (
        !ensureTextLimit(res, categoryId, '分类 ID', CONTENT_LIMITS.wiki.category) ||
        !ensureTextLimit(res, categoryName, '分类名称', CONTENT_LIMITS.wiki.title) ||
        !ensureTextLimit(res, categoryDescription, '分类描述', CONTENT_LIMITS.section.description)
      ) {
        return
      }

      const category = await prisma.wikiCategory.create({
        data: {
          id: categoryId,
          name: categoryName,
          description: categoryDescription,
          order: typeof order === 'number' && Number.isFinite(order) ? order : 0,
          requiresAdminEdit: Boolean(requiresAdminEdit),
        },
      })

      invalidateSoftDeleteCaches('wiki-categories')
      res.status(201).json({ category })
    } catch (error) {
      logger.error({ err: error }, 'Create wiki category error')
      res.status(500).json({ error: '创建百科分类失败' })
    }
  })
)

router.patch(
  '/wiki-categories/:id',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id
      const { name, description, order, requiresAdminEdit } = req.body as {
        name?: string
        description?: string
        order?: number
        requiresAdminEdit?: boolean
      }
      const categoryName = name?.trim()
      const categoryDescription = description?.trim() || ''

      if (!categoryName) {
        res.status(400).json({ error: '分类名称不能为空' })
        return
      }

      if (
        !ensureTextLimit(res, categoryName, '分类名称', CONTENT_LIMITS.wiki.title) ||
        !ensureTextLimit(res, categoryDescription, '分类描述', CONTENT_LIMITS.section.description)
      ) {
        return
      }

      const category = await prisma.wikiCategory.update({
        where: { id },
        data: {
          name: categoryName,
          description: categoryDescription,
          order: typeof order === 'number' && Number.isFinite(order) ? order : 0,
          requiresAdminEdit: Boolean(requiresAdminEdit),
        },
      })

      invalidateSoftDeleteCaches('wiki-categories')
      res.json({ category })
    } catch (error) {
      logger.error({ err: error }, 'Update wiki category error')
      res.status(500).json({ error: '更新百科分类失败' })
    }
  })
)

/**
 * ==========================
 * Admin Panel Stats & Data
 * ==========================
 */

// GET /api/admin/stats - Get admin panel statistics
router.get(
  '/stats',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    try {
      const [wikiCount, postCount, galleryCount, userCount, musicCount] = await Promise.all([
        prisma.wikiPage.count({ where: { deletedAt: null } }),
        prisma.post.count({ where: { deletedAt: null } }),
        prisma.gallery.count({ where: { deletedAt: null } }),
        prisma.user.count({ where: { deletedAt: null } }),
        prisma.musicTrack.count({ where: { deletedAt: null } }),
      ])

      res.json({
        stats: {
          wiki: wikiCount,
          posts: postCount,
          galleries: galleryCount,
          users: userCount,
          music: musicCount,
        },
      })
    } catch (error) {
      logger.error({ err: error }, 'Fetch admin stats error')
      res.status(500).json({ error: '获取统计数据失败' })
    }
  })
)

// GET /api/admin/:tab - Get admin data by tab
router.get(
  '/:tab',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const tab = req.params.tab
      const includeDeleted = includeDeletedFromQuery(req.query)
      const activeWhere = deletedAtFilter(includeDeleted)

      if (tab === 'wiki') {
        const data = await prisma.wikiPage.findMany({
          where: activeWhere,
          include: {
            lastEditor: { select: { displayName: true } },
            location: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 100,
        })
        const deleteReasonsBySlug = await getDeleteReasonsByTargetId(
          'wiki',
          data.filter((page) => page.deletedAt).map((page) => page.slug)
        )
        res.json({
          data: data.map((page) => ({
            ...toWikiResponse(page),
            deletionReason: deleteReasonsBySlug.get(page.slug) ?? null,
          })),
        })
        return
      }

      if (tab === 'posts') {
        const data = await prisma.post.findMany({
          where: activeWhere,
          include: {
            author: { select: { displayName: true } },
            location: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 100,
        })
        const deleteReasonsById = await getDeleteReasonsByTargetId(
          'post',
          data.filter((post) => post.deletedAt).map((post) => post.id)
        )
        res.json({
          data: data.map((post) => ({
            ...toPostResponse(post),
            deletionReason: deleteReasonsById.get(post.id) ?? null,
          })),
        })
        return
      }

      if (tab === 'galleries') {
        const data = await prisma.gallery.findMany({
          where: activeWhere,
          include: {
            images: {
              include: {
                asset: true,
              },
              orderBy: { sortOrder: 'asc' },
            },
            location: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 100,
        })
        const deleteReasonsById = await getDeleteReasonsByTargetId(
          'gallery',
          data.filter((gallery) => gallery.deletedAt).map((gallery) => gallery.id)
        )
        const serialized = await Promise.all(data.map((g) => toGalleryResponse(g)))
        res.json({
          data: serialized.map((gallery) => ({
            ...gallery,
            deletionReason: deleteReasonsById.get(gallery.id) ?? null,
          })),
        })
        return
      }

      if (tab === 'events') {
        const data = await prisma.event.findMany({
          where: activeWhere,
          include: adminEventInclude,
          orderBy: { updatedAt: 'desc' },
          take: 100,
        })
        res.json({ data: await toEventListResponse(data) })
        return
      }

      if (tab === 'users') {
        const data = await prisma.user.findMany({
          where: activeWhere,
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: {
            uid: true,
            email: true,
            displayName: true,
            photoURL: true,
            role: true,
            status: true,
            banReason: true,
            bannedAt: true,
            emailVerifiedAt: true,
            level: true,
            signature: true,
            bio: true,
            deletedAt: true,
            deletedBy: true,
            createdAt: true,
            updatedAt: true,
          },
        })
        res.json({ data: data.map(toUserResponse) })
        return
      }

      if (tab === 'locks') {
        await prisma.editLock.deleteMany({
          where: {
            expiresAt: {
              lt: new Date(),
            },
          },
        })

        const data = await prisma.editLock.findMany({
          orderBy: { createdAt: 'desc' },
          take: 200,
        })
        res.json({ data: data.map(toEditLockResponse) })
        return
      }

      if (tab === 'music') {
        const { limit, page, offset: skip } = parsePagination(req.query)
        const [total, data] = await Promise.all([
          prisma.musicTrack.count({ where: activeWhere }),
          prisma.musicTrack.findMany({
            where: activeWhere,
            select: {
              docId: true,
              title: true,
              artists: true,
              lyricists: true,
              composers: true,
              arrangers: true,
              vocals: true,
              album: true,
              audioUrl: true,
              lyric: true,
              releaseDate: true,
              durationMs: true,
              coverId: true,
              coverAlbumDocId: true,
              displayAlbumMode: true,
              manualAlbumName: true,
              deletedAt: true,
              deletedBy: true,
              createdAt: true,
              updatedAt: true,
              externalSources: {
                orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
              },
              covers: {
                orderBy: { sortOrder: 'asc' },
                select: {
                  id: true,
                  publicUrl: true,
                  thumbnailUrl: true,
                  isDefault: true,
                },
              },
              albumRelations: {
                select: {
                  album: {
                    select: {
                      docId: true,
                      coverId: true,
                      covers: {
                        orderBy: { sortOrder: 'asc' },
                        select: {
                          id: true,
                          publicUrl: true,
                          thumbnailUrl: true,
                          isDefault: true,
                        },
                      },
                    },
                  },
                },
                orderBy: [{ discNumber: 'asc' }, { trackOrder: 'asc' }],
              },
            },
            orderBy: { updatedAt: 'desc' },
            skip,
            take: limit,
          }),
        ])
        const totalPages = Math.max(1, Math.ceil(total / limit))
        res.json({
          data: data.map(toMusicResponse),
          total,
          page,
          limit,
          totalPages,
          hasMore: skip + data.length < total,
        })
        return
      }

      if (tab === 'announcements') {
        const data = await prisma.announcement.findMany({
          where: activeWhere,
          orderBy: { createdAt: 'desc' },
          take: 100,
        })
        res.json({ data })
        return
      }

      if (tab === 'sections') {
        const data = await prisma.section.findMany({
          where: activeWhere,
          orderBy: { order: 'asc' },
          take: 100,
        })
        res.json({ data })
        return
      }

      if (tab === 'wiki-categories') {
        const data = await prisma.wikiCategory.findMany({
          where: activeWhere,
          orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
          take: 100,
        })
        res.json({ data })
        return
      }

      res.status(400).json({ error: '未知数据类型' })
    } catch (error) {
      logger.error({ err: error }, 'Fetch admin data error')
      res.status(500).json({ error: '获取管理数据失败' })
    }
  })
)

// GET /api/admin/:tab/:id - Get admin item by ID
router.get(
  '/:tab/:id',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const tab = req.params.tab
      const id = req.params.id

      if (tab === 'wiki') {
        const item = await prisma.wikiPage.findUnique({
          where: { id },
          include: {
            lastEditor: { select: { displayName: true } },
            location: true,
          },
        })
        if (!item) {
          res.status(404).json({ error: '记录不存在' })
          return
        }
        res.json({ item: toWikiResponse(item) })
        return
      }

      if (tab === 'posts') {
        const item = await prisma.post.findUnique({ where: { id } })
        if (!item) {
          res.status(404).json({ error: '记录不存在' })
          return
        }
        res.json({ item: toPostResponse(item) })
        return
      }

      if (tab === 'galleries') {
        const item = await prisma.gallery.findUnique({
          where: { id },
          include: {
            images: {
              include: {
                asset: true,
              },
              orderBy: { sortOrder: 'asc' },
            },
          },
        })
        if (!item) {
          res.status(404).json({ error: '记录不存在' })
          return
        }
        res.json({ item: await toGalleryResponse(item) })
        return
      }

      if (tab === 'events') {
        const item = await prisma.event.findUnique({
          where: { id },
          include: adminEventInclude,
        })
        if (!item) {
          res.status(404).json({ error: '记录不存在' })
          return
        }
        res.json({ item: await toEventResponse(item) })
        return
      }

      if (tab === 'users') {
        const item = await prisma.user.findUnique({
          where: { uid: id },
          select: {
            uid: true,
            email: true,
            displayName: true,
            photoURL: true,
            role: true,
            status: true,
            banReason: true,
            bannedAt: true,
            emailVerifiedAt: true,
            level: true,
            signature: true,
            bio: true,
            deletedAt: true,
            deletedBy: true,
            createdAt: true,
            updatedAt: true,
          },
        })
        if (!item) {
          res.status(404).json({ error: '记录不存在' })
          return
        }
        res.json({ item: toUserResponse(item) })
        return
      }

      if (tab === 'locks') {
        const item = await prisma.editLock.findUnique({ where: { id } })
        if (!item) {
          res.status(404).json({ error: '记录不存在' })
          return
        }
        res.json({ item: toEditLockResponse(item) })
        return
      }

      res.status(400).json({ error: '未知数据类型' })
    } catch (error) {
      logger.error({ err: error }, 'Fetch admin item error')
      res.status(500).json({ error: '获取详情失败' })
    }
  })
)

// DELETE /api/admin/:tab/:id - Delete admin item
router.delete(
  '/:tab/:id',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const tab = req.params.tab
      const id = req.params.id
      const rawReason = req.body?.reason

      if (tab === 'wiki') {
        const reason = normalizeDeleteReason(rawReason)
        if (!reason) {
          res.status(400).json({ error: '删除理由不能为空' })
          return
        }
        if (!ensureTextLimit(res, reason, '删除理由', CONTENT_LIMITS.wiki.reviewNote)) {
          return
        }

        const page = await prisma.wikiPage.findUnique({
          where: { id },
          select: { slug: true, title: true, lastEditorUid: true, deletedAt: true },
        })
        if (!page || page.deletedAt) {
          res.status(404).json({ error: '页面不存在' })
          return
        }

        await prisma.$transaction(async (tx) => {
          await tx.wikiPage.update({
            where: { id },
            data: softDeleteData(req.authUser!.uid),
          })

          await tx.moderationLog.create({
            data: {
              targetType: 'wiki',
              targetId: page.slug,
              action: 'delete',
              operatorUid: req.authUser!.uid,
              note: reason,
            },
          })
        })

        await notifyContentDeleted({
          recipientUid: page.lastEditorUid,
          operatorUid: req.authUser!.uid,
          operatorName: req.authUser!.displayName,
          targetType: 'wiki',
          targetId: page.slug,
          title: page.title,
          note: reason,
        })

        invalidateSoftDeleteCaches(tab, { slug: page.slug })
        res.json({ success: true })
        return
      }
      if (tab === 'posts') {
        const post = await prisma.post.findUnique({
          where: { id },
          select: { title: true, authorUid: true, deletedAt: true },
        })
        if (!post || post.deletedAt) {
          res.status(404).json({ error: '帖子不存在' })
          return
        }

        const isSelfDelete = post.authorUid === req.authUser!.uid
        const reason = resolveDeleteReason(rawReason, isSelfDelete)
        if (!isSelfDelete && !reason) {
          res.status(400).json({ error: '删除理由不能为空' })
          return
        }
        if (!ensureTextLimit(res, reason, '删除理由', CONTENT_LIMITS.post.reviewNote)) {
          return
        }

        await prisma.$transaction(async (tx) => {
          await tx.post.update({ where: { id }, data: softDeleteData(req.authUser!.uid) })

          await tx.moderationLog.create({
            data: {
              targetType: 'post',
              targetId: id,
              action: 'delete',
              operatorUid: req.authUser!.uid,
              note: reason,
            },
          })
        })

        if (!isSelfDelete) {
          await notifyContentDeleted({
            recipientUid: post.authorUid,
            operatorUid: req.authUser!.uid,
            operatorName: req.authUser!.displayName,
            targetType: 'post',
            targetId: id,
            title: post.title,
            note: reason,
          })
        }

        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'galleries') {
        const gallery = await prisma.gallery.findUnique({
          where: { id },
          include: { images: true },
        })
        if (!gallery || gallery.deletedAt) {
          res.status(404).json({ error: '图集不存在' })
          return
        }

        const isSelfDelete = gallery.authorUid === req.authUser!.uid
        const reason = resolveDeleteReason(rawReason, isSelfDelete)
        if (!isSelfDelete && !reason) {
          res.status(400).json({ error: '删除理由不能为空' })
          return
        }
        if (!ensureTextLimit(res, reason, '删除理由', CONTENT_LIMITS.gallery.reviewNote)) {
          return
        }

        await prisma.$transaction(async (tx) => {
          await tx.gallery.update({ where: { id }, data: softDeleteData(req.authUser!.uid) })

          await tx.moderationLog.create({
            data: {
              targetType: 'gallery',
              targetId: id,
              action: 'delete',
              operatorUid: req.authUser!.uid,
              note: reason,
            },
          })
        })

        if (!isSelfDelete) {
          await notifyContentDeleted({
            recipientUid: gallery.authorUid,
            operatorUid: req.authUser!.uid,
            operatorName: req.authUser!.displayName,
            targetType: 'gallery',
            targetId: id,
            title: gallery.title,
            note: reason,
          })
        }

        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }

      if (tab === 'events') {
        const event = await prisma.event.findUnique({
          where: { id },
          select: { id: true, deletedAt: true },
        })
        if (!event || event.deletedAt) {
          res.status(404).json({ error: '活动不存在' })
          return
        }

        await prisma.event.update({
          where: { id: event.id },
          data: softDeleteData(req.authUser!.uid),
        })
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'music') {
        await prisma.musicTrack.update({
          where: { docId: id },
          data: softDeleteData(req.authUser!.uid),
        })
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'albums') {
        await prisma.album.update({ where: { docId: id }, data: softDeleteData(req.authUser!.uid) })
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'announcements') {
        await prisma.announcement.update({ where: { id }, data: softDeleteData(req.authUser!.uid) })
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'sections') {
        await prisma.section.update({ where: { id }, data: softDeleteData(req.authUser!.uid) })
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'wiki-categories') {
        const pageCount = await prisma.wikiPage.count({ where: { category: id } })
        if (pageCount > 0) {
          res.status(400).json({
            error: `该分类下还有 ${pageCount} 个百科页面（包括回收站），请先处理页面后再删除分类`,
          })
          return
        }

        await prisma.wikiCategory.update({ where: { id }, data: softDeleteData(req.authUser!.uid) })
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'image-maps') {
        await prisma.imageMap.update({ where: { id }, data: softDeleteData(req.authUser!.uid) })
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'users') {
        const currentUser = req.authUser
        if (currentUser?.uid === id) {
          res.status(400).json({ error: '不能删除自己' })
          return
        }

        const targetUser = await prisma.user.findUnique({
          where: { uid: id },
          select: { uid: true, role: true, deletedAt: true },
        })

        if (!targetUser || targetUser.deletedAt) {
          res.status(404).json({ error: '用户不存在' })
          return
        }

        if (!canManageTargetUserRole(currentUser?.role, targetUser.role)) {
          res.status(403).json({ error: '只能删除普通用户' })
          return
        }

        await prisma.user.update({ where: { uid: id }, data: softDeleteData(req.authUser!.uid) })
        clearUserCache(id)
        res.json({ success: true })
        return
      }
      if (tab === 'locks') {
        await prisma.editLock.delete({ where: { id } })
        res.json({ success: true })
        return
      }

      res.status(400).json({ error: '未知删除类型' })
    } catch (error) {
      logger.error({ err: error }, 'Delete admin data error')
      res.status(500).json({ error: '删除失败' })
    }
  })
)

// POST /api/admin/:tab/:id/restore - Restore soft-deleted admin item
router.post(
  '/:tab/:id/restore',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const tab = req.params.tab
      const id = req.params.id

      if (tab === 'wiki') {
        const page = await prisma.wikiPage.findUnique({
          where: { id },
          select: { slug: true, title: true, status: true, lastEditorUid: true, deletedAt: true },
        })
        if (!page) {
          res.status(404).json({ error: '百科不存在' })
          return
        }

        await prisma.wikiPage.update({ where: { id }, data: restoreDeleteData })
        invalidateSoftDeleteCaches(tab, { slug: page.slug })
        const recipient =
          !page.deletedAt || page.lastEditorUid === req.authUser!.uid
            ? null
            : await prisma.user.findUnique({
                where: { uid: page.lastEditorUid },
                select: { role: true },
              })
        await notifyContentRestored({
          recipientUid: page.lastEditorUid,
          operatorUid: req.authUser!.uid,
          operatorName: req.authUser!.displayName,
          targetType: 'wiki',
          targetId: page.slug,
          title: page.title,
          status: page.status,
          linkable: canOpenRestoredWikiNotification(page.status, recipient?.role),
          wasDeleted: Boolean(page.deletedAt),
        })
        res.json({ success: true })
        return
      }
      if (tab === 'posts') {
        const post = await prisma.post.findUnique({
          where: { id },
          select: { id: true, title: true, status: true, authorUid: true, deletedAt: true },
        })
        if (!post) {
          res.status(404).json({ error: '帖子不存在' })
          return
        }

        await prisma.post.update({ where: { id }, data: restoreDeleteData })
        invalidateSoftDeleteCaches(tab)
        await notifyContentRestored({
          recipientUid: post.authorUid,
          operatorUid: req.authUser!.uid,
          operatorName: req.authUser!.displayName,
          targetType: 'post',
          targetId: post.id,
          title: post.title,
          status: post.status,
          linkable: true,
          wasDeleted: Boolean(post.deletedAt),
        })
        res.json({ success: true })
        return
      }
      if (tab === 'galleries') {
        await prisma.gallery.update({ where: { id }, data: restoreDeleteData })
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'events') {
        const event = await prisma.event.findUnique({
          where: { id },
          select: { id: true },
        })
        if (!event) {
          res.status(404).json({ error: '活动不存在' })
          return
        }

        await prisma.event.update({
          where: { id: event.id },
          data: { ...restoreDeleteData, updatedByUid: req.authUser!.uid },
        })
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'music') {
        await prisma.musicTrack.update({ where: { docId: id }, data: restoreDeleteData })
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'albums') {
        await prisma.album.update({ where: { docId: id }, data: restoreDeleteData })
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'announcements') {
        await prisma.announcement.update({ where: { id }, data: restoreDeleteData })
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'sections') {
        await prisma.section.update({ where: { id }, data: restoreDeleteData })
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'wiki-categories') {
        await prisma.wikiCategory.update({ where: { id }, data: restoreDeleteData })
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'image-maps') {
        await prisma.imageMap.update({ where: { id }, data: restoreDeleteData })
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'users') {
        const targetUser = await prisma.user.findUnique({
          where: { uid: id },
          select: { uid: true, role: true },
        })
        if (!targetUser) {
          res.status(404).json({ error: '用户不存在' })
          return
        }
        if (!canManageTargetUserRole(req.authUser?.role, targetUser.role)) {
          res.status(403).json({ error: '无权恢复该用户' })
          return
        }
        await prisma.user.update({ where: { uid: id }, data: restoreDeleteData })
        clearUserCache(id)
        res.json({ success: true })
        return
      }

      res.status(400).json({ error: '未知恢复类型' })
    } catch (error) {
      logger.error({ err: error }, 'Restore admin data error')
      res.status(500).json({ error: '恢复失败' })
    }
  })
)

// DELETE /api/admin/:tab/:id/permanent - Permanently delete admin item
router.delete(
  '/:tab/:id/permanent',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const tab = req.params.tab
      const id = req.params.id

      if (tab === 'wiki') {
        const deletedSlug = await permanentlyDeleteWikiById(id)
        if (!deletedSlug) {
          res.status(404).json({ error: '记录不存在' })
          return
        }
        invalidateSoftDeleteCaches(tab, { slug: deletedSlug })
        res.json({ success: true })
        return
      }
      if (tab === 'posts') {
        const deleted = await permanentlyDeletePostById(id)
        if (!deleted) {
          res.status(404).json({ error: '记录不存在' })
          return
        }
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'galleries') {
        const deleted = await permanentlyDeleteGalleryById(id)
        if (!deleted) {
          res.status(404).json({ error: '图集不存在' })
          return
        }
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'events') {
        const deleted = await permanentlyDeleteEventById(id)
        if (!deleted) {
          res.status(404).json({ error: '活动不存在' })
          return
        }
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'music') {
        const deleted = await permanentlyDeleteMusicTrackByDocId(id)
        if (!deleted) {
          res.status(404).json({ error: '歌曲不存在' })
          return
        }
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'albums') {
        const deleted = await permanentlyDeleteAlbumByDocId(id)
        if (!deleted) {
          res.status(404).json({ error: '专辑不存在' })
          return
        }
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'announcements') {
        await prisma.announcement.delete({ where: { id } })
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'sections') {
        await prisma.section.delete({ where: { id } })
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'wiki-categories') {
        const pageCount = await prisma.wikiPage.count({ where: { category: id } })
        if (pageCount > 0) {
          res.status(400).json({ error: `该分类下还有 ${pageCount} 个百科页面，不能彻底删除` })
          return
        }

        await prisma.wikiCategory.delete({ where: { id } })
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'image-maps') {
        const deleted = await permanentlyDeleteImageMapById(id)
        if (!deleted) {
          res.status(404).json({ error: '图片映射不存在' })
          return
        }
        invalidateSoftDeleteCaches(tab)
        res.json({ success: true })
        return
      }
      if (tab === 'users') {
        if (req.authUser?.uid === id) {
          res.status(400).json({ error: '不能删除自己' })
          return
        }
        const targetUser = await prisma.user.findUnique({
          where: { uid: id },
          select: { uid: true, role: true },
        })
        if (!targetUser) {
          res.status(404).json({ error: '用户不存在' })
          return
        }
        if (!canManageTargetUserRole(req.authUser?.role, targetUser.role)) {
          res.status(403).json({ error: '无权彻底删除该用户' })
          return
        }
        await prisma.user.delete({ where: { uid: id } })
        clearUserCache(id)
        res.json({ success: true })
        return
      }

      res.status(400).json({ error: '未知彻底删除类型' })
    } catch (error) {
      logger.error({ err: error }, 'Permanent delete admin data error')
      res.status(500).json({ error: '彻底删除失败' })
    }
  })
)

export { registerAdminRoutes }

function registerAdminRoutes(app: Router) {
  app.use('/api/admin', router)
}
