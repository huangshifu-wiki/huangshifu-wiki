import type { Router } from 'express'
import { createRouter } from '../utils/typed-router'
import { requireAuth, requireActiveUser, requireAdmin, isAdminRole } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { galleryWriteLimiter } from '../middleware/rateLimiter'
import { adminBatchGalleryImagesSchema, galleryDeleteSchema, validateBody } from '../schemas'
import type { ApiUser, AuthenticatedRequest, ContentStatus } from '../types'
import {
  serializeTags,
  normalizeTagList,
  parseAssetIdList,
  parseBoolean,
  parsePagination,
  normalizeGalleryWriteStatus,
  canViewGallery,
  createUploadSessionExpiresAt,
  isUploadSessionExpired,
  safeDeleteUploadFileByStorageKey,
  uploadFileToS3,
  uploadFileToExternal,
  toCommentResponse,
  toGalleryResponse,
  toGalleryListResponse,
  enhancedCache,
  fetchGalleryCommentsForResponse,
  resolveCommentReplyTarget,
  notifyCommentReply,
  GALLERY_ADMIN_ONLY,
  ensureTextLimit,
  softDeleteData,
  resolveDeleteReason,
  createNotification,
  notifyMentionUsers,
  resolveMentionTargetsForText,
} from '../utils'
import { CONTENT_LIMITS } from '../../lib/contentLimits'
import { enqueueGalleryImageEmbeddings } from '../vector/embeddingSync'
import { prisma } from '../prisma'
import { syncGalleryImageToImageMapWithVariant } from '../services/galleryImageSyncService'
import { cleanupUnusedMediaAssetById, cleanupUntrackedUploadImageByUrl } from '../services/mediaAssetCleanupService'

function ensureGalleryTextLimits(
  res: Parameters<typeof ensureTextLimit>[0],
  input: {
    title?: unknown
    description?: unknown
    locationCode?: unknown
    locationDetail?: unknown
    copyright?: unknown
  }
) {
  return (
    ensureTextLimit(res, input.title, '图集标题', CONTENT_LIMITS.gallery.title) &&
    ensureTextLimit(res, input.description, '图集描述', CONTENT_LIMITS.gallery.description) &&
    ensureTextLimit(res, input.locationCode, '地点编码', CONTENT_LIMITS.gallery.locationCode) &&
    ensureTextLimit(res, input.locationDetail, '地点详情', CONTENT_LIMITS.gallery.locationDetail) &&
    ensureTextLimit(res, input.copyright, '版权信息', CONTENT_LIMITS.gallery.copyright)
  )
}

function canManageGallery(gallery: { authorUid: string }, authUser?: ApiUser) {
  if (!authUser) return false
  if (isAdminRole(authUser.role)) return true
  if (GALLERY_ADMIN_ONLY) return false
  return gallery.authorUid === authUser.uid
}

function canCreateGallery(authUser?: ApiUser) {
  if (!authUser) return false
  if (isAdminRole(authUser.role)) return true
  return !GALLERY_ADMIN_ONLY
}

const router = createRouter()

async function cleanupRemovedGalleryImages(
  images: Array<{ assetId: string | null; url: string }>
) {
  await Promise.all(
    images.map(async (image) => {
      if (image.assetId) {
        await cleanupUnusedMediaAssetById(image.assetId)
        return
      }
      await cleanupUntrackedUploadImageByUrl(image.url)
    })
  )
}

async function fetchGalleryForResponse(galleryId: string) {
  return prisma.gallery.findUnique({
    where: { id: galleryId },
    include: {
      images: {
        include: {
          asset: true,
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })
}

function parseAppendAssetIdList(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[]
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

function resolveGalleryRequestedStatus(
  body: Record<string, unknown>,
  authUser: ApiUser,
  fallbackStatus: ContentStatus = 'draft'
) {
  if (body.status !== undefined) {
    return normalizeGalleryWriteStatus(body.status, authUser)
  }
  if (body.published !== undefined) {
    return resolveGalleryPublishStatus(parseBoolean(body.published, false), authUser, fallbackStatus)
  }
  return normalizeGalleryWriteStatus(undefined, authUser)
}

function resolveGalleryPublishStatus(
  published: boolean,
  authUser: ApiUser,
  currentStatus: ContentStatus
) {
  if (!published) {
    return isAdminRole(authUser.role)
      ? 'draft'
      : resolveGalleryUpdateStatus('draft', currentStatus, authUser)
  }
  return isAdminRole(authUser.role) ? 'published' : 'pending'
}

function resolveGalleryUpdateStatus(
  requestedStatus: ContentStatus | undefined,
  currentStatus: ContentStatus,
  authUser: ApiUser
) {
  if (isAdminRole(authUser.role)) {
    return requestedStatus === undefined
      ? currentStatus
      : normalizeGalleryWriteStatus(requestedStatus, authUser)
  }
  if (currentStatus === 'published') {
    return 'pending'
  }
  const normalized = normalizeGalleryWriteStatus(requestedStatus ?? currentStatus, authUser)
  return currentStatus === 'pending' && normalized === 'draft' ? 'pending' : normalized
}

function galleryStatusData(status: ReturnType<typeof normalizeGalleryWriteStatus>) {
  return {
    status,
    reviewNote: null,
    reviewedBy: null,
    reviewedAt: null,
    published: status === 'published',
    publishedAt: status === 'published' ? new Date() : null,
  }
}

function gallerySubmissionLogData(
  targetId: string,
  nextStatus: ContentStatus,
  authUser: ApiUser,
  note: string | null = null
) {
  if (nextStatus !== 'pending') return null
  return {
    targetType: 'gallery' as const,
    targetId,
    action: 'submit' as const,
    operatorUid: authUser.uid,
    note,
  }
}

async function updateGalleryStatusWithSubmitLog(
  galleryId: string,
  nextStatus: ContentStatus,
  authUser: ApiUser,
  note: string | null = null
) {
  return prisma.$transaction(async (tx) => {
    const nextGallery = await tx.gallery.update({
      where: { id: galleryId },
      data: galleryStatusData(nextStatus),
      include: {
        images: {
          include: {
            asset: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })
    const submissionLog = gallerySubmissionLogData(nextGallery.id, nextStatus, authUser, note)
    if (submissionLog) {
      await tx.moderationLog.create({ data: submissionLog })
    }
    return nextGallery
  })
}

async function attachGalleryInteractions<T extends { id: string }>(
  gallery: T,
  authUser?: ApiUser
): Promise<T & {
  likedByMe: boolean
  dislikedByMe: boolean
  favoritedByMe: boolean
}> {
  if (!authUser) {
    return {
      ...gallery,
      likedByMe: false,
      dislikedByMe: false,
      favoritedByMe: false,
    }
  }

  const [like, dislike, favorite] = await Promise.all([
    prisma.galleryLike.findUnique({
      where: {
        galleryId_userUid: {
          galleryId: gallery.id,
          userUid: authUser.uid,
        },
      },
      select: { id: true },
    }),
    prisma.galleryDislike.findUnique({
      where: {
        galleryId_userUid: {
          galleryId: gallery.id,
          userUid: authUser.uid,
        },
      },
      select: { id: true },
    }),
    prisma.favorite.findUnique({
      where: {
        userUid_targetType_targetId: {
          userUid: authUser.uid,
          targetType: 'gallery',
          targetId: gallery.id,
        },
      },
      select: { id: true },
    }),
  ])

  return {
    ...gallery,
    likedByMe: Boolean(like),
    dislikedByMe: Boolean(dislike),
    favoritedByMe: Boolean(favorite),
  }
}

async function attachGalleryListInteractions<T extends { id: string }>(
  galleries: T[],
  authUser?: ApiUser
): Promise<Array<T & {
  likedByMe: boolean
  dislikedByMe: boolean
  favoritedByMe: boolean
}>> {
  if (!authUser || galleries.length === 0) {
    return galleries.map((gallery) => ({
      ...gallery,
      likedByMe: false,
      dislikedByMe: false,
      favoritedByMe: false,
    }))
  }

  const galleryIds = galleries.map((gallery) => gallery.id)
  const [likes, dislikes, favorites] = await Promise.all([
    prisma.galleryLike.findMany({
      where: {
        galleryId: { in: galleryIds },
        userUid: authUser.uid,
      },
      select: { galleryId: true },
    }),
    prisma.galleryDislike.findMany({
      where: {
        galleryId: { in: galleryIds },
        userUid: authUser.uid,
      },
      select: { galleryId: true },
    }),
    prisma.favorite.findMany({
      where: {
        targetType: 'gallery',
        targetId: { in: galleryIds },
        userUid: authUser.uid,
      },
      select: { targetId: true },
    }),
  ])

  const likedGalleryIds = new Set(likes.map((like) => like.galleryId))
  const dislikedGalleryIds = new Set(dislikes.map((dislike) => dislike.galleryId))
  const favoritedGalleryIds = new Set(favorites.map((favorite) => favorite.targetId))

  return galleries.map((gallery) => ({
    ...gallery,
    likedByMe: likedGalleryIds.has(gallery.id),
    dislikedByMe: dislikedGalleryIds.has(gallery.id),
    favoritedByMe: favoritedGalleryIds.has(gallery.id),
  }))
}

function isString(value: string | null): value is string {
  return typeof value === 'string'
}

router.get('/', asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const { limit, page, offset: skip } = parsePagination(req.query)
    const refreshThumbnails = parseBoolean(req.query.refreshThumbnails, false)

    const where = {
      status: 'published' as ContentStatus,
      deletedAt: null,
    }

    if (!req.authUser && !refreshThumbnails) {
      const cacheKey = `gallery_list_public:${page}:${limit}`
      const cached = enhancedCache.get(cacheKey)
      if (cached) {
        res.json(cached)
        return
      }
    }

    const [galleries, total] = await Promise.all([
      prisma.gallery.findMany({
        where,
        include: {
          images: {
            include: {
              asset: true,
            },
            orderBy: { sortOrder: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      prisma.gallery.count({ where }),
    ])

    const result = {
      galleries: await toGalleryListResponse(await attachGalleryListInteractions(galleries, req.authUser)),
      total,
      page,
      limit,
      hasMore: skip + galleries.length < total,
    }

    if (!req.authUser) {
      const cacheKey = `gallery_list_public:${page}:${limit}`
      enhancedCache.set(cacheKey, result, 120)
    }

    res.json(result)
  } catch (error) {
    console.error('Fetch galleries error:', error)
    res.status(500).json({ error: '获取图集失败' })
  }
}))

router.get('/:id', asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const gallery = await prisma.gallery.findUnique({
      where: { id: req.params.id },
      include: {
        images: {
          include: {
            asset: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    if (!gallery || gallery.deletedAt) {
      res.status(404).json({ error: '图集不存在' })
      return
    }

    if (!canViewGallery(gallery, req.authUser)) {
      res.status(403).json({ error: '该图集尚未发布' })
      return
    }

    res.json({ gallery: await toGalleryResponse(await attachGalleryInteractions(gallery, req.authUser)) })
  } catch (error) {
    console.error('Fetch gallery detail error:', error)
    res.status(500).json({ error: '获取图集详情失败' })
  }
}))

router.post('/:id/like', requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const galleryId = req.params.id
    const gallery = await prisma.gallery.findUnique({
      where: { id: galleryId },
      select: {
        id: true,
        status: true,
        published: true,
        authorUid: true,
        deletedAt: true,
      },
    })

    if (!gallery || gallery.deletedAt || !canViewGallery(gallery, req.authUser)) {
      res.status(404).json({ error: '图集不存在' })
      return
    }

    await prisma.$transaction(async (tx) => {
      await tx.galleryDislike.deleteMany({
        where: { galleryId, userUid: req.authUser!.uid },
      })

      try {
        await tx.galleryLike.create({
          data: {
            galleryId,
            userUid: req.authUser!.uid,
          },
        })
      } catch {
        // already liked
      }

      const [likesCount, dislikesCount] = await Promise.all([
        tx.galleryLike.count({ where: { galleryId } }),
        tx.galleryDislike.count({ where: { galleryId } }),
      ])

      await tx.gallery.update({
        where: { id: galleryId },
        data: { likesCount, dislikesCount },
      })
    })

    const [likesCount, dislikesCount] = await Promise.all([
      prisma.galleryLike.count({ where: { galleryId } }),
      prisma.galleryDislike.count({ where: { galleryId } }),
    ])

    if (gallery.authorUid !== req.authUser!.uid) {
      await createNotification(gallery.authorUid, 'like', {
        galleryId,
        targetType: 'gallery',
        actorUid: req.authUser!.uid,
        actorName: req.authUser!.displayName,
      })
    }

    res.json({ liked: true, likesCount, dislikesCount })
  } catch (error) {
    console.error('Like gallery error:', error)
    res.status(500).json({ error: '点赞失败' })
  }
}))

router.delete('/:id/like', requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const galleryId = req.params.id
    const gallery = await prisma.gallery.findUnique({
      where: { id: galleryId },
      select: { id: true, status: true, published: true, authorUid: true, deletedAt: true },
    })

    if (!gallery || gallery.deletedAt || !canViewGallery(gallery, req.authUser)) {
      res.status(404).json({ error: '图集不存在' })
      return
    }

    await prisma.$transaction(async (tx) => {
      const deleted = await tx.galleryLike.deleteMany({
        where: {
          galleryId,
          userUid: req.authUser!.uid,
        },
      })

      if (!deleted.count) return

      const likesCount = await tx.galleryLike.count({ where: { galleryId } })
      await tx.gallery.update({
        where: { id: galleryId },
        data: { likesCount },
      })
    })

    const likesCount = await prisma.galleryLike.count({ where: { galleryId } })
    res.json({ liked: false, likesCount })
  } catch (error) {
    console.error('Unlike gallery error:', error)
    res.status(500).json({ error: '取消点赞失败' })
  }
}))

router.post('/:id/dislike', requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const galleryId = req.params.id
    const gallery = await prisma.gallery.findUnique({
      where: { id: galleryId },
      select: {
        id: true,
        status: true,
        published: true,
        authorUid: true,
        deletedAt: true,
      },
    })

    if (!gallery || gallery.deletedAt || !canViewGallery(gallery, req.authUser)) {
      res.status(404).json({ error: '图集不存在' })
      return
    }

    await prisma.$transaction(async (tx) => {
      await tx.galleryLike.deleteMany({
        where: { galleryId, userUid: req.authUser!.uid },
      })

      try {
        await tx.galleryDislike.create({
          data: {
            galleryId,
            userUid: req.authUser!.uid,
          },
        })
      } catch {
        // already disliked
      }

      const [likesCount, dislikesCount] = await Promise.all([
        tx.galleryLike.count({ where: { galleryId } }),
        tx.galleryDislike.count({ where: { galleryId } }),
      ])

      await tx.gallery.update({
        where: { id: galleryId },
        data: { likesCount, dislikesCount },
      })
    })

    const [likesCount, dislikesCount] = await Promise.all([
      prisma.galleryLike.count({ where: { galleryId } }),
      prisma.galleryDislike.count({ where: { galleryId } }),
    ])

    res.json({ disliked: true, dislikesCount, likesCount })
  } catch (error) {
    console.error('Dislike gallery error:', error)
    res.status(500).json({ error: '踩失败' })
  }
}))

router.delete('/:id/dislike', requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const galleryId = req.params.id
    const gallery = await prisma.gallery.findUnique({
      where: { id: galleryId },
      select: { id: true, status: true, published: true, authorUid: true, deletedAt: true },
    })

    if (!gallery || gallery.deletedAt || !canViewGallery(gallery, req.authUser)) {
      res.status(404).json({ error: '图集不存在' })
      return
    }

    await prisma.$transaction(async (tx) => {
      const deleted = await tx.galleryDislike.deleteMany({
        where: {
          galleryId,
          userUid: req.authUser!.uid,
        },
      })

      if (!deleted.count) return

      const dislikesCount = await tx.galleryDislike.count({ where: { galleryId } })
      await tx.gallery.update({
        where: { id: galleryId },
        data: { dislikesCount },
      })
    })

    const dislikesCount = await prisma.galleryDislike.count({ where: { galleryId } })
    res.json({ disliked: false, dislikesCount })
  } catch (error) {
    console.error('Undislike gallery error:', error)
    res.status(500).json({ error: '取消踩失败' })
  }
}))

router.post('/', galleryWriteLimiter, requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    if (!canCreateGallery(req.authUser)) {
      res.status(403).json({ error: '当前图集已临时限制为仅管理员可操作' })
      return
    }

    const { title, description, tags, images, assetIds, uploadSessionId, locationCode, locationDetail, copyright } = req.body as {
      title?: string
      description?: string
      tags?: string[]
      images?: { url: string; name: string }[]
      assetIds?: string[]
      uploadSessionId?: string
      locationCode?: string
      locationDetail?: string
      copyright?: string
    }

    const normalizedAssetIds = parseAssetIdList(assetIds)
    const normalizedCopyright =
      copyright !== undefined ? (typeof copyright === 'string' ? copyright.trim() : null) : undefined
    if (!ensureGalleryTextLimits(res, { title, description, locationCode, locationDetail, copyright: normalizedCopyright })) {
      return
    }

    if (normalizedAssetIds.length > 0) {
      const finalTitle = typeof title === 'string' && title.trim() ? title.trim() : '默认图集'
      const finalDescription = typeof description === 'string' ? description.trim() : ''
      const finalTags = normalizeTagList(tags)
      const nextStatus = resolveGalleryRequestedStatus(
        req.body as Record<string, unknown>,
        req.authUser!
      )

      const assets = await prisma.mediaAsset.findMany({
        where: {
          id: { in: normalizedAssetIds },
          ownerUid: req.authUser!.uid,
          status: 'ready',
        },
        orderBy: { createdAt: 'asc' },
      })

      if (assets.length !== normalizedAssetIds.length) {
        res.status(400).json({ error: '包含无效或无权限的图片资源' })
        return
      }

      if (uploadSessionId && typeof uploadSessionId === 'string') {
        const session = await prisma.uploadSession.findUnique({
          where: { id: uploadSessionId },
          select: {
            id: true,
            ownerUid: true,
            status: true,
            expiresAt: true,
          },
        })

        if (!session || session.ownerUid !== req.authUser!.uid) {
          res.status(400).json({ error: '上传会话不存在' })
          return
        }

        if (session.status === 'expired' || isUploadSessionExpired(session.expiresAt)) {
          if (session.status !== 'expired') {
            await prisma.uploadSession.update({
              where: { id: session.id },
              data: { status: 'expired' },
            })
          }
          res.status(410).json({ error: '上传会话已过期，请重新上传' })
          return
        }

        if (session.status !== 'finalized') {
          res.status(400).json({ error: '请先完成上传会话' })
          return
        }
      }

      const assetsById = new Map(assets.map((asset) => [asset.id, asset]))
      const orderedAssets = normalizedAssetIds
        .map((id) => assetsById.get(id))
        .filter((asset): asset is typeof assets[number] => Boolean(asset))

      const gallery = await prisma.$transaction(async (tx) => {
        const created = await tx.gallery.create({
          data: {
            title: finalTitle,
            description: finalDescription,
            authorUid: req.authUser!.uid,
            authorName: req.authUser!.displayName,
            tags: finalTags,
            locationCode: locationCode || null,
            locationDetail: locationDetail || null,
            copyright: normalizedCopyright,
            ...galleryStatusData(nextStatus),
            images: {
              create: orderedAssets.map((asset, index) => ({
                assetId: asset.id,
                url: asset.publicUrl,
                name: asset.fileName || `image-${index + 1}`,
                sortOrder: index,
              })),
            },
          },
          include: {
            images: {
              orderBy: { sortOrder: 'asc' },
              include: {
                asset: true,
              },
            },
          },
        })
        const submissionLog = gallerySubmissionLogData(created.id, nextStatus, req.authUser!)
        if (submissionLog) {
          await tx.moderationLog.create({ data: submissionLog })
        }
        return created
      })

      try {
        await enqueueGalleryImageEmbeddings(
          prisma,
          gallery.images.map((image) => image.id),
        )
      } catch (error) {
        console.error('Enqueue gallery image embeddings error:', error)
      }

      try {
        for (const asset of orderedAssets) {
          await syncGalleryImageToImageMapWithVariant(asset.publicUrl, asset.storageKey)
        }
      } catch (error) {
        console.error('Sync gallery images to ImageMap error:', error)
      }

      res.status(201).json({ gallery: await toGalleryResponse(gallery) })
      return
    }

    if (!images || !Array.isArray(images) || images.length === 0) {
      res.status(400).json({ error: '图集至少需要一张图片' })
      return
    }

    const normalizedTitle = typeof title === 'string' && title.trim() ? title.trim() : '默认图集'
    const normalizedDescription = typeof description === 'string' ? description.trim() : ''
    const normalizedTags = normalizeTagList(tags)
    const nextStatus = resolveGalleryRequestedStatus(req.body as Record<string, unknown>, req.authUser!)

    const normalizedImages = images
      .map((image, index) => {
        if (!image || typeof image.url !== 'string') {
          return null
        }
        const url = image.url.trim()
        if (!url || !url.startsWith('/uploads/')) {
          return null
        }
        const fallbackName = `image-${index + 1}`
        const name = typeof image.name === 'string' && image.name.trim() ? image.name.trim() : fallbackName
        if (
          url.length > CONTENT_LIMITS.gallery.imageUrl ||
          name.length > CONTENT_LIMITS.gallery.imageName
        ) {
          return null
        }
        return {
          url,
          name,
        }
      })
      .filter((item): item is { url: string; name: string } => Boolean(item))

    if (!normalizedImages.length || normalizedImages.length !== images.length) {
      res.status(400).json({ error: '图片地址不合法，请重新上传' })
      return
    }

    const fallbackAssets = await prisma.mediaAsset.findMany({
      where: {
        ownerUid: req.authUser!.uid,
        status: 'ready',
        publicUrl: {
          in: normalizedImages.map((item) => item.url),
        },
      },
      select: {
        id: true,
        publicUrl: true,
      },
    })
    const assetByUrl = new Map(fallbackAssets.map((item) => [item.publicUrl, item.id]))

    const gallery = await prisma.$transaction(async (tx) => {
      const created = await tx.gallery.create({
        data: {
          title: normalizedTitle,
          description: normalizedDescription,
          authorUid: req.authUser!.uid,
          authorName: req.authUser!.displayName,
          tags: normalizedTags,
          locationCode: locationCode || null,
          locationDetail: locationDetail || null,
          copyright: normalizedCopyright,
          ...galleryStatusData(nextStatus),
          images: {
            create: normalizedImages.map((image, index) => ({
              assetId: assetByUrl.get(image.url),
              url: image.url,
              name: image.name,
              sortOrder: index,
            })),
          },
        },
        include: {
          images: {
            orderBy: { sortOrder: 'asc' },
            include: {
              asset: true,
            },
          },
        },
      })
      const submissionLog = gallerySubmissionLogData(created.id, nextStatus, req.authUser!)
      if (submissionLog) {
        await tx.moderationLog.create({ data: submissionLog })
      }
      return created
    })

    try {
      await enqueueGalleryImageEmbeddings(
        prisma,
        gallery.images.map((image) => image.id),
      )
    } catch (error) {
      console.error('Enqueue gallery image embeddings error:', error)
    }

    try {
      for (const asset of fallbackAssets) {
        const assetRecord = await prisma.mediaAsset.findUnique({
          where: { id: asset.id },
        })
        if (assetRecord) {
          await syncGalleryImageToImageMapWithVariant(assetRecord.publicUrl, assetRecord.storageKey)
        }
      }
    } catch (error) {
      console.error('Sync gallery images to ImageMap error:', error)
    }

    res.status(201).json({ gallery: await toGalleryResponse(gallery) })
  } catch (error) {
    console.error('Create gallery error:', error)
    res.status(500).json({ error: '创建图集失败' })
  }
}))

router.patch('/:id', requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    if (GALLERY_ADMIN_ONLY && !isAdminRole(req.authUser?.role)) {
      res.status(403).json({ error: '当前图集已临时限制为仅管理员可操作' })
      return
    }

    const gallery = await prisma.gallery.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        authorUid: true,
        status: true,
        published: true,
      },
    })

    if (!gallery) {
      res.status(404).json({ error: '图集不存在' })
      return
    }

    if (!canManageGallery(gallery, req.authUser)) {
      res.status(403).json({ error: '无权限编辑该图集' })
      return
    }

    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : undefined
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : undefined
    const tags = req.body?.tags !== undefined ? normalizeTagList(req.body.tags) : undefined
    const locationCode = req.body?.locationCode !== undefined ? (typeof req.body.locationCode === 'string' && req.body.locationCode.length > 0 ? req.body.locationCode : null) : undefined
    const locationDetail = req.body?.locationDetail !== undefined ? (typeof req.body.locationDetail === 'string' && req.body.locationDetail.length > 0 ? req.body.locationDetail : null) : undefined
    const copyright = req.body?.copyright !== undefined ? (typeof req.body.copyright === 'string' ? req.body.copyright.trim() : null) : undefined
    if (!ensureGalleryTextLimits(res, { title, description, locationCode, locationDetail, copyright })) {
      return
    }
    const requestedStatus =
      req.body?.status !== undefined || req.body?.published !== undefined
        ? resolveGalleryRequestedStatus(req.body as Record<string, unknown>, req.authUser!, gallery.status)
        : undefined
    const nextStatus = resolveGalleryUpdateStatus(
      requestedStatus,
      gallery.status as ContentStatus,
      req.authUser!
    )
    const imagesRaw = Array.isArray(req.body?.images) ? req.body.images : undefined
    const imageInstructions = imagesRaw?.map((item) => {
      if (!item || typeof item !== 'object') {
        return null
      }
      const parsed = item as Record<string, unknown>
      const imageId = typeof parsed.imageId === 'string'
        ? parsed.imageId.trim()
        : ''
      const assetId = typeof parsed.assetId === 'string'
        ? parsed.assetId.trim()
        : ''
      const url = typeof parsed.url === 'string'
        ? parsed.url.trim()
        : ''
      const name = typeof parsed.name === 'string' && parsed.name.trim()
        ? parsed.name.trim()
        : ''
      if (
        url.length > CONTENT_LIMITS.gallery.imageUrl ||
        name.length > CONTENT_LIMITS.gallery.imageName
      ) {
        return null
      }
      if (imageId && !assetId) {
        return { kind: 'existing' as const, imageId }
      }
      if (assetId && !imageId) {
        return { kind: 'asset' as const, assetId }
      }
      if (url && !imageId && !assetId && url.startsWith('/uploads/')) {
        return { kind: 'url' as const, url, name }
      }
      return null
    }) ?? undefined

    const data: {
      title?: string
      description?: string
      tags?: string[]
      locationCode?: string | null
      locationDetail?: string | null
      copyright?: string | null
      status?: ReturnType<typeof normalizeGalleryWriteStatus>
      reviewNote?: string | null
      reviewedBy?: string | null
      reviewedAt?: Date | null
      published?: boolean
      publishedAt?: Date | null
    } = {}

    if (title !== undefined && title.length > 0) {
      data.title = title
    }
    if (description !== undefined) {
      data.description = description
    }
    if (tags !== undefined) {
      data.tags = tags
    }
    if (locationCode !== undefined) {
      data.locationCode = locationCode
    }
    if (locationDetail !== undefined) {
      data.locationDetail = locationDetail
    }
    if (copyright !== undefined) {
      data.copyright = copyright
    }
    if (nextStatus !== gallery.status) {
      Object.assign(data, galleryStatusData(nextStatus))
    }

    if (imageInstructions !== undefined) {
      if (!imageInstructions.length || imageInstructions.some((item) => !item)) {
        res.status(400).json({ error: '图片保存数据无效' })
        return
      }
    }

    if (!Object.keys(data).length && imageInstructions === undefined) {
      res.status(400).json({ error: '没有可更新的字段' })
      return
    }

    const newImageIds: string[] = []
    const removedImages: Array<{ id: string; assetId: string | null; url: string }> = []

    const updated = await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length) {
        await tx.gallery.update({
          where: { id: req.params.id },
          data,
        })
      }

      const submissionLog = gallerySubmissionLogData(
        req.params.id,
        nextStatus,
        req.authUser!,
        !isAdminRole(req.authUser!.role) && gallery.status === 'published'
          ? '编辑后重新提交审核'
          : null
      )
      if (submissionLog) {
        await tx.moderationLog.create({ data: submissionLog })
      }

      if (imageInstructions !== undefined) {
        const validatedInstructions = imageInstructions.filter(
          (item): item is
            | { kind: 'existing'; imageId: string }
            | { kind: 'asset'; assetId: string }
            | { kind: 'url'; url: string; name: string } => Boolean(item),
        )
        if (validatedInstructions.length !== imageInstructions.length) {
          throw new Error('图片保存数据无效')
        }

        const existingImages = await tx.galleryImage.findMany({
          where: { galleryId: req.params.id },
          select: {
            id: true,
            assetId: true,
            url: true,
          },
        })

        const existingImageMap = new Map(existingImages.map((item) => [item.id, item]))
        const existingIdsInPayload = validatedInstructions
          .filter((item): item is { kind: 'existing'; imageId: string } => item?.kind === 'existing')
          .map((item) => item.imageId)
        if (new Set(existingIdsInPayload).size !== existingIdsInPayload.length) {
          throw new Error('排序列表包含重复图片')
        }
        if (existingIdsInPayload.some((imageId) => !existingImageMap.has(imageId))) {
          throw new Error('排序列表包含无效图片')
        }

        const assetIdsInPayload = validatedInstructions
          .filter((item): item is { kind: 'asset'; assetId: string } => item?.kind === 'asset')
          .map((item) => item.assetId)
        if (new Set(assetIdsInPayload).size !== assetIdsInPayload.length) {
          throw new Error('图片列表包含重复资源')
        }

        const assets: Array<{ id: string; publicUrl: string; fileName: string | null }> = assetIdsInPayload.length
          ? await tx.mediaAsset.findMany({
              select: {
                id: true,
                publicUrl: true,
                fileName: true,
              },
              where: {
                id: { in: assetIdsInPayload },
                ownerUid: req.authUser!.uid,
                status: 'ready',
              },
            })
          : []
        if (assets.length !== assetIdsInPayload.length) {
          throw new Error('图片列表包含无效或无权限的资源')
        }
        const assetMap = new Map(assets.map((asset) => [asset.id, asset]))

        const urlsInPayload = validatedInstructions
          .filter((item): item is { kind: 'url'; url: string; name: string } => item?.kind === 'url')
          .map((item) => item.url)
        const urlAssets: Array<{ id: string; publicUrl: string; fileName: string | null }> = urlsInPayload.length
          ? await tx.mediaAsset.findMany({
              select: {
                id: true,
                publicUrl: true,
                fileName: true,
              },
              where: {
                ownerUid: req.authUser!.uid,
                status: 'ready',
                publicUrl: {
                  in: urlsInPayload,
                },
              },
            })
          : []
        const assetByUrl = new Map(urlAssets.map((asset) => [asset.publicUrl, asset]))

        const keptIds = new Set(existingIdsInPayload)
        removedImages.push(...existingImages.filter((item) => !keptIds.has(item.id)))
        if (
          removedImages.length === existingImages.length
          && assetIdsInPayload.length === 0
          && urlsInPayload.length === 0
        ) {
          throw new Error('图集至少需要保留一张图片')
        }

        if (removedImages.length) {
          await tx.galleryImage.deleteMany({
            where: { id: { in: removedImages.map((item) => item.id) } },
          })
        }

        for (const [index, instruction] of validatedInstructions.entries()) {
          if (instruction.kind === 'existing') {
            await tx.galleryImage.update({
              where: { id: instruction.imageId },
              data: { sortOrder: index },
            })
            continue
          }

          if (instruction.kind === 'url') {
            const asset = assetByUrl.get(instruction.url) || null
            const created = await tx.galleryImage.create({
              data: {
                galleryId: req.params.id,
                assetId: asset?.id || null,
                url: instruction.url,
                name: instruction.name || asset?.fileName || `image-${index + 1}`,
                sortOrder: index,
              },
              select: { id: true },
            })
            newImageIds.push(created.id)
            continue
          }

          const asset = assetMap.get(instruction.assetId)
          if (!asset) {
            throw new Error('图片列表包含无效或无权限的资源')
          }
          const created = await tx.galleryImage.create({
            data: {
              galleryId: req.params.id,
              assetId: asset.id,
              url: asset.publicUrl,
              name: asset.fileName || `image-${index + 1}`,
              sortOrder: index,
            },
            select: { id: true },
          })
          newImageIds.push(created.id)
        }
      }

      return tx.gallery.findUnique({
        where: { id: req.params.id },
        include: {
          images: {
            include: {
              asset: true,
            },
            orderBy: { sortOrder: 'asc' },
          },
        },
      })
    })

    if (!updated) {
      res.status(404).json({ error: '图集不存在' })
      return
    }

    if (newImageIds.length) {
      try {
        await enqueueGalleryImageEmbeddings(prisma, newImageIds)
      } catch (error) {
        console.error('Enqueue gallery image embeddings error:', error)
      }
    }

    if (removedImages.length) {
      await cleanupRemovedGalleryImages(removedImages)
    }

    res.json({ gallery: await toGalleryResponse(updated) })
  } catch (error) {
    console.error('Update gallery error:', error)
    res.status(500).json({ error: '更新图集失败' })
  }
}))

router.patch('/:id/publish', requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    if (GALLERY_ADMIN_ONLY && !isAdminRole(req.authUser?.role)) {
      res.status(403).json({ error: '当前图集已临时限制为仅管理员可操作' })
      return
    }

    const gallery = await prisma.gallery.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        authorUid: true,
        status: true,
        published: true,
      },
    })

    if (!gallery) {
      res.status(404).json({ error: '图集不存在' })
      return
    }

    if (!canManageGallery(gallery, req.authUser)) {
      res.status(403).json({ error: '无权限修改图集发布状态' })
      return
    }

    const nextPublished = parseBoolean(req.body?.published, gallery.status !== 'published')
    const nextStatus = resolveGalleryPublishStatus(
      nextPublished,
      req.authUser!,
      gallery.status as ContentStatus
    )
    const updated = await updateGalleryStatusWithSubmitLog(
      req.params.id,
      nextStatus,
      req.authUser!
    )

    res.json({ gallery: await toGalleryResponse(updated) })
  } catch (error) {
    console.error('Update gallery publish status error:', error)
    res.status(500).json({ error: '修改图集发布状态失败' })
  }
}))

router.post('/:id/submit', requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    if (GALLERY_ADMIN_ONLY && !isAdminRole(req.authUser?.role)) {
      res.status(403).json({ error: '当前图集已临时限制为仅管理员可操作' })
      return
    }

    const gallery = await prisma.gallery.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        authorUid: true,
        status: true,
      },
    })

    if (!gallery) {
      res.status(404).json({ error: '图集不存在' })
      return
    }

    if (!canManageGallery(gallery, req.authUser)) {
      res.status(403).json({ error: '无权限提交该图集' })
      return
    }

    const nextStatus = resolveGalleryUpdateStatus(
      'pending',
      gallery.status as ContentStatus,
      req.authUser!
    )
    const updated = await updateGalleryStatusWithSubmitLog(
      req.params.id,
      nextStatus,
      req.authUser!
    )

    res.json({ gallery: await toGalleryResponse(updated) })
  } catch (error) {
    console.error('Submit gallery review error:', error)
    res.status(500).json({ error: '提交审核失败' })
  }
}))

router.delete(
  '/:id',
  requireAuth,
  requireActiveUser,
  validateBody(galleryDeleteSchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const gallery = await prisma.gallery.findUnique({
        where: { id: req.params.id },
        select: { authorUid: true, title: true, deletedAt: true },
      })

      if (!gallery || gallery.deletedAt) {
        res.status(404).json({ error: '图集不存在' })
        return
      }

      const isOwner = gallery.authorUid === req.authUser!.uid
      const isAdmin = isAdminRole(req.authUser!.role)
      if (!isOwner && !isAdmin) {
        res.status(403).json({ error: '无权删除该图集' })
        return
      }

      const reason = resolveDeleteReason(req.body?.reason, isOwner)
      if (!isOwner && !reason) {
        res.status(400).json({ error: '删除理由不能为空' })
        return
      }
      if (!ensureTextLimit(res, reason, '删除理由', CONTENT_LIMITS.gallery.reviewNote)) {
        return
      }

      await prisma.$transaction(async (tx) => {
        await tx.gallery.update({
          where: { id: req.params.id },
          data: softDeleteData(req.authUser!.uid),
        })

        await tx.moderationLog.create({
          data: {
            targetType: 'gallery',
            targetId: req.params.id,
            action: 'delete',
            operatorUid: req.authUser!.uid,
            note: reason,
          },
        })
      })

      if (gallery.authorUid !== req.authUser!.uid) {
        await createNotification(gallery.authorUid, 'review_result', {
          approved: false,
          action: 'deleted',
          targetType: 'gallery',
          targetId: req.params.id,
          title: gallery.title,
          note: reason,
          operatorUid: req.authUser!.uid,
          operatorName: req.authUser!.displayName,
        })
      }

      res.json({ success: true })
      enhancedCache.invalidateByPrefix('gallery_list_public:')
    } catch (error) {
      console.error('Delete gallery error:', error)
      res.status(500).json({ error: '删除图集失败' })
    }
  })
)

router.post('/:id/images', requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    if (GALLERY_ADMIN_ONLY && !isAdminRole(req.authUser?.role)) {
      res.status(403).json({ error: '当前图集已临时限制为仅管理员可操作' })
      return
    }

    const gallery = await prisma.gallery.findUnique({
      where: { id: req.params.id },
      include: {
        images: {
          select: {
            id: true,
            sortOrder: true,
          },
        },
      },
    })

    if (!gallery) {
      res.status(404).json({ error: '图集不存在' })
      return
    }

    if (!canManageGallery(gallery, req.authUser)) {
      res.status(403).json({ error: '无权限编辑该图集' })
      return
    }

    const assetIds = parseAppendAssetIdList(req.body?.assetIds)
    if (!assetIds.length) {
      res.status(400).json({ error: '请提供至少一个图片资源' })
      return
    }

    const uploadSessionId = typeof req.body?.uploadSessionId === 'string' ? req.body.uploadSessionId.trim() : ''
    if (uploadSessionId) {
      const session = await prisma.uploadSession.findUnique({
        where: { id: uploadSessionId },
        select: {
          id: true,
          ownerUid: true,
          status: true,
          expiresAt: true,
        },
      })
      if (!session || session.ownerUid !== req.authUser!.uid) {
        res.status(400).json({ error: '上传会话不存在' })
        return
      }
      if (session.status === 'expired' || isUploadSessionExpired(session.expiresAt)) {
        if (session.status !== 'expired') {
          await prisma.uploadSession.update({
            where: { id: session.id },
            data: { status: 'expired' },
          })
        }
        res.status(410).json({ error: '上传会话已过期，请重新上传' })
        return
      }
      if (session.status !== 'finalized') {
        res.status(400).json({ error: '请先完成上传会话' })
        return
      }
    }

    const uniqueAssetIds = [...new Set(assetIds)]
    const assets = await prisma.mediaAsset.findMany({
      where: {
        id: { in: uniqueAssetIds },
        ownerUid: req.authUser!.uid,
        status: 'ready',
      },
      orderBy: { createdAt: 'asc' },
    })

    if (assets.length !== uniqueAssetIds.length) {
      res.status(400).json({ error: '包含无效或无权限的图片资源' })
      return
    }

    const assetMap = new Map(assets.map((asset) => [asset.id, asset]))
    const orderedAssets = assetIds
      .map((id) => assetMap.get(id))
      .filter((asset): asset is typeof assets[number] => Boolean(asset))
    const baseSortOrder = gallery.images.length
      ? Math.max(...gallery.images.map((item) => item.sortOrder)) + 1
      : 0

    await prisma.gallery.update({
      where: { id: gallery.id },
      data: {
        images: {
          create: orderedAssets.map((asset, index) => ({
            assetId: asset.id,
            url: asset.publicUrl,
            name: asset.fileName || `image-${baseSortOrder + index + 1}`,
            sortOrder: baseSortOrder + index,
          })),
        },
      },
    })

    const updated = await fetchGalleryForResponse(gallery.id)

    if (updated) {
      try {
        await enqueueGalleryImageEmbeddings(
          prisma,
          updated.images.map((image) => image.id),
        )
      } catch (error) {
        console.error('Enqueue gallery image embeddings error:', error)
      }

      try {
        for (const asset of orderedAssets) {
          await syncGalleryImageToImageMapWithVariant(asset.publicUrl, asset.storageKey)
        }
      } catch (error) {
        console.error('Sync gallery images to ImageMap error:', error)
      }

      res.json({ gallery: await toGalleryResponse(updated) })
      return
    }

    res.status(404).json({ error: '图集不存在' })
  } catch (error) {
    console.error('Append gallery images error:', error)
    res.status(500).json({ error: '追加图集图片失败' })
  }
}))

router.delete(
  '/:id/images',
  requireAuth,
  requireActiveUser,
  validateBody(adminBatchGalleryImagesSchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      if (GALLERY_ADMIN_ONLY && !isAdminRole(req.authUser?.role)) {
        res.status(403).json({ error: '当前图集已临时限制为仅管理员可操作' })
        return
      }

      const gallery = await prisma.gallery.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          authorUid: true,
        },
      })

      if (!gallery) {
        res.status(404).json({ error: '图集不存在' })
        return
      }

      if (!canManageGallery(gallery, req.authUser)) {
        res.status(403).json({ error: '无权限编辑该图集' })
        return
      }

      const imageIds = req.body.imageIds as string[]
      const existingImages = await prisma.galleryImage.findMany({
        where: { galleryId: gallery.id },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          assetId: true,
          url: true,
        },
      })
      const existingIdSet = new Set(existingImages.map((image) => image.id))
      if (imageIds.some((imageId) => !existingIdSet.has(imageId))) {
        res.status(400).json({ error: '图片列表包含无效图片' })
        return
      }

      const deleteIdSet = new Set(imageIds)
      const removedImages = existingImages.filter((image) => deleteIdSet.has(image.id))
      if (existingImages.length - removedImages.length <= 0) {
        res.status(400).json({ error: '图集至少需要保留一张图片' })
        return
      }

      await prisma.galleryImage.deleteMany({
        where: {
          galleryId: gallery.id,
          id: { in: imageIds },
        },
      })

      await cleanupRemovedGalleryImages(removedImages)

      const remaining = await prisma.galleryImage.findMany({
        where: { galleryId: gallery.id },
        orderBy: { sortOrder: 'asc' },
        select: { id: true },
      })

      await prisma.$transaction(
        remaining.map((image, index) =>
          prisma.galleryImage.update({
            where: { id: image.id },
            data: { sortOrder: index },
          })
        )
      )

      const updated = await fetchGalleryForResponse(gallery.id)
      if (!updated) {
        res.status(404).json({ error: '图集不存在' })
        return
      }

      enhancedCache.invalidateByPrefix('gallery_list_public:')
      res.json({ deleted: removedImages.length, gallery: await toGalleryResponse(updated) })
    } catch (error) {
      console.error('Batch delete gallery images error:', error)
      res.status(500).json({ error: '批量删除图集图片失败' })
    }
  })
)

router.delete('/:id/images/:imageId', requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    if (GALLERY_ADMIN_ONLY && !isAdminRole(req.authUser?.role)) {
      res.status(403).json({ error: '当前图集已临时限制为仅管理员可操作' })
      return
    }

    const gallery = await prisma.gallery.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        authorUid: true,
      },
    })

    if (!gallery) {
      res.status(404).json({ error: '图集不存在' })
      return
    }

    if (!canManageGallery(gallery, req.authUser)) {
      res.status(403).json({ error: '无权限编辑该图集' })
      return
    }

    const image = await prisma.galleryImage.findUnique({
      where: { id: req.params.imageId },
      select: {
        id: true,
        galleryId: true,
        assetId: true,
        url: true,
      },
    })

    if (!image || image.galleryId !== gallery.id) {
      res.status(404).json({ error: '图片不存在' })
      return
    }

    const imageCount = await prisma.galleryImage.count({ where: { galleryId: gallery.id } })
    if (imageCount <= 1) {
      res.status(400).json({ error: '图集至少需要保留一张图片' })
      return
    }

    await prisma.galleryImage.delete({ where: { id: image.id } })

    await cleanupRemovedGalleryImages([image])

    const remaining = await prisma.galleryImage.findMany({
      where: { galleryId: gallery.id },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    })

    await Promise.all(
      remaining.map((item, index) =>
        prisma.galleryImage.update({
          where: { id: item.id },
          data: { sortOrder: index },
        }),
      ),
    )

    const updated = await fetchGalleryForResponse(gallery.id)

    if (!updated) {
      res.status(404).json({ error: '图集不存在' })
      return
    }

    enhancedCache.invalidateByPrefix('gallery_list_public:')
    res.json({ gallery: await toGalleryResponse(updated) })
  } catch (error) {
    console.error('Delete gallery image error:', error)
    res.status(500).json({ error: '删除图集图片失败' })
  }
}))

router.patch('/:id/images/reorder', requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    if (GALLERY_ADMIN_ONLY && !isAdminRole(req.authUser?.role)) {
      res.status(403).json({ error: '当前图集已临时限制为仅管理员可操作' })
      return
    }

    const gallery = await prisma.gallery.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        authorUid: true,
      },
    })

    if (!gallery) {
      res.status(404).json({ error: '图集不存在' })
      return
    }

    if (!canManageGallery(gallery, req.authUser)) {
      res.status(403).json({ error: '无权限编辑该图集' })
      return
    }

    const imageIdsRaw = Array.isArray(req.body?.imageIds) ? req.body.imageIds : []
    const imageIds = imageIdsRaw
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)

    if (!imageIds.length) {
      res.status(400).json({ error: '请提供图片排序列表' })
      return
    }

    const existing = await prisma.galleryImage.findMany({
      where: { galleryId: gallery.id },
      select: { id: true },
    })
    const existingIds = existing.map((item) => item.id)
    if (existingIds.length !== imageIds.length) {
      res.status(400).json({ error: '排序列表与当前图片数量不一致' })
      return
    }
    const existingSet = new Set(existingIds)
    if (imageIds.some((id) => !existingSet.has(id))) {
      res.status(400).json({ error: '排序列表包含无效图片' })
      return
    }

    await prisma.$transaction(
      imageIds.map((imageId, index) =>
        prisma.galleryImage.update({
          where: { id: imageId },
          data: { sortOrder: index },
        }),
      ),
    )

    const updated = await fetchGalleryForResponse(gallery.id)

    if (!updated) {
      res.status(404).json({ error: '图集不存在' })
      return
    }

    enhancedCache.invalidateByPrefix('gallery_list_public:')
    res.json({ gallery: await toGalleryResponse(updated) })
  } catch (error) {
    console.error('Reorder gallery images error:', error)
    res.status(500).json({ error: '重排图集图片失败' })
  }
}))

router.get('/:id/comments', asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const includeDeletedComments =
      isAdminRole(req.authUser?.role) && req.query.includeDeleted === 'true'
    const gallery = await prisma.gallery.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        status: true,
        published: true,
        authorUid: true,
      },
    })

    if (!gallery) {
      res.status(404).json({ error: '图集不存在' })
      return
    }

    if (!canViewGallery(gallery, req.authUser)) {
      res.status(403).json({ error: '该图集尚未发布' })
      return
    }

    const comments = await fetchGalleryCommentsForResponse(req.params.id, {
      authUserUid: req.authUser?.uid,
      includeDeleted: includeDeletedComments,
    })

    res.json({
      comments,
    })
  } catch (error) {
    console.error('Fetch gallery comments error:', error)
    res.status(500).json({ error: '获取图集评论失败' })
  }
}))

router.post('/:id/comments', galleryWriteLimiter, requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const { content, parentId } = req.body as {
      content?: string
      parentId?: string | null
    }

    if (!content || !content.trim()) {
      res.status(400).json({ error: '评论内容不能为空' })
      return
    }
    if (!ensureTextLimit(res, content, '评论内容', CONTENT_LIMITS.gallery.comment)) {
      return
    }

    const gallery = await prisma.gallery.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        status: true,
        published: true,
        authorUid: true,
      },
    })

    if (!gallery || !canViewGallery(gallery, req.authUser)) {
      res.status(404).json({ error: '图集不存在' })
      return
    }

    if (gallery.status !== 'published') {
      res.status(403).json({ error: '仅已发布内容可评论' })
      return
    }

    let replyTargetUid: string | null = null
    let rootParentId: string | null = null
    let replyToId: string | null = null
    if (parentId) {
      const replyTarget = await resolveCommentReplyTarget(parentId, { galleryId: req.params.id })
      if (!replyTarget) {
        res.status(400).json({ error: '回复目标不存在' })
        return
      }
      rootParentId = replyTarget.parentId
      replyToId = replyTarget.replyToId
      replyTargetUid = replyTarget.replyTargetUid
    }

    const comment = await prisma.postComment.create({
      data: {
        galleryId: req.params.id,
        authorUid: req.authUser!.uid,
        content,
        parentId: rootParentId,
        replyToId,
      },
      include: {
        author: {
          select: { displayName: true, photoURL: true },
        },
        replyTo: {
          select: {
            authorUid: true,
            author: {
              select: { displayName: true },
            },
          },
        },
        _count: {
          select: { likes: true },
        },
      },
    })

    await notifyCommentReply({
      ownerUid: gallery.authorUid,
      replyTargetUid,
      actorUid: req.authUser!.uid,
      actorName: req.authUser!.displayName,
      commentId: comment.id,
      content: comment.content,
      parentId: comment.parentId,
      target: { type: 'gallery', id: req.params.id },
    })
    const mentionTargets = await resolveMentionTargetsForText(comment.content)
    const replyRecipientUid = replyTargetUid || gallery.authorUid
    await notifyMentionUsers({
      content: comment.content,
      mentionTargets,
      actorUid: req.authUser!.uid,
      actorName: req.authUser!.displayName,
      target: { type: 'gallery', id: req.params.id, commentId: comment.id },
      excludeUserUids:
        replyRecipientUid && replyRecipientUid !== req.authUser!.uid ? [replyRecipientUid] : [],
    })

    res.status(201).json({
      comment: toCommentResponse({
        ...comment,
        mentionTargets,
      }),
    })
  } catch (error) {
    console.error('Create gallery comment error:', error)
    res.status(500).json({ error: '发表评论失败' })
  }
}))

export function registerGalleriesRoutes(app: Router) {
  app.use('/api/galleries', router)
}
