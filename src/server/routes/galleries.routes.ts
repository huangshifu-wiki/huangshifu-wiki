import { Router } from 'express'
import { requireAuth, requireActiveUser, requireAdmin, isAdminRole } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { galleryWriteLimiter } from '../middleware/rateLimiter'
import type { ApiUser, AuthenticatedRequest } from '../types'
import {
  serializeTags,
  normalizeTagList,
  parseAssetIdList,
  parseBoolean,
  parsePagination,
  createUploadSessionExpiresAt,
  isUploadSessionExpired,
  buildUploadPublicUrl,
  getUploadFileStorageKey,
  safeDeleteUploadFileByStorageKey,
  validateUploadedImage,
  uploadFileToS3,
  uploadFileToExternal,
  toCommentResponse,
  toGalleryResponse,
  toGalleryListResponse,
  enhancedCache,
  fetchGalleryCommentsForResponse,
  resolveCommentReplyTarget,
  GALLERY_ADMIN_ONLY,
} from '../utils'
import { enqueueGalleryImageEmbeddings } from '../vector/embeddingSync'
import { prisma } from '../prisma'
import { syncGalleryImageToImageMap, syncGalleryImageToImageMapWithVariant } from '../services/galleryImageSyncService'
import {
  cleanupUnusedMediaAssetById,
  cleanupUntrackedUploadImageByUrl,
} from '../services/mediaAssetCleanupService'

function canViewGallery(gallery: { published: boolean; authorUid: string }, authUser?: ApiUser) {
  if (gallery.published) return true
  if (!authUser) return false
  if (isAdminRole(authUser.role)) return true
  return gallery.authorUid === authUser.uid
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

const router = Router()

function isString(value: string | null): value is string {
  return typeof value === 'string'
}

router.get('/', asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const { limit, page, offset: skip } = parsePagination(req.query)

    const visibilityWhere = req.authUser
      ? (isAdminRole(req.authUser.role)
          ? {}
          : {
              OR: [
                { published: true },
                { authorUid: req.authUser.uid },
              ],
            })
      : { published: true }

    if (!req.authUser) {
      const cacheKey = `gallery_list_public:${page}:${limit}`
      const cached = enhancedCache.get(cacheKey)
      if (cached) {
        res.json(cached)
        return
      }
    }

    const [galleries, total] = await Promise.all([
      prisma.gallery.findMany({
        where: visibilityWhere,
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
      prisma.gallery.count({ where: visibilityWhere }),
    ])

    const result = {
      galleries: await toGalleryListResponse(galleries),
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

    if (!gallery) {
      res.status(404).json({ error: '图集不存在' })
      return
    }

    if (!canViewGallery(gallery, req.authUser)) {
      res.status(403).json({ error: '该图集尚未发布' })
      return
    }

    res.json({ gallery: await toGalleryResponse(gallery) })
  } catch (error) {
    console.error('Fetch gallery detail error:', error)
    res.status(500).json({ error: '获取图集详情失败' })
  }
}))

router.post('/upload', galleryWriteLimiter, requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  if (!canCreateGallery(req.authUser)) {
    res.status(403).json({ error: '当前图集已临时限制为仅管理员可操作' })
    return
  }

  const files = req.files as Express.Multer.File[]
  const createdAssetIds: string[] = []
  try {
    const title = typeof req.body.title === 'string' ? req.body.title : ''
    const description = typeof req.body.description === 'string' ? req.body.description : ''
    const tagsRaw = typeof req.body.tags === 'string' ? req.body.tags : ''
    const tags = tagsRaw
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)

    if (!files || files.length === 0) {
      res.status(400).json({ error: '请上传至少一张图片' })
      return
    }

    const finalTitle = title || '默认图集'
    const validatedFiles = await Promise.all(
      files.map(async (file) => {
        const { mimeType } = await validateUploadedImage(file)
        const asset = await prisma.mediaAsset.create({
          data: {
            ownerUid: req.authUser!.uid,
            storageKey: getUploadFileStorageKey(file),
            publicUrl: buildUploadPublicUrl(getUploadFileStorageKey(file)),
            fileName: file.originalname,
            mimeType,
            sizeBytes: file.size,
            status: 'ready',
          },
        })
        createdAssetIds.push(asset.id)
        return {
          file,
          asset,
        }
      }),
    )

    const gallery = await prisma.gallery.create({
      data: {
        title: finalTitle,
        description: description || `${finalTitle} 图集`,
        authorUid: req.authUser!.uid,
        authorName: req.authUser!.displayName,
        tags,
        images: {
          create: validatedFiles.map((entry, index) => ({
            assetId: entry.asset.id,
            url: entry.asset.publicUrl,
            name: entry.asset.fileName,
            sortOrder: index,
          })),
        },
      },
      include: {
        images: {
          include: {
            asset: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
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
      for (const entry of validatedFiles) {
        await syncGalleryImageToImageMapWithVariant(entry.asset.publicUrl, entry.asset.storageKey)
      }
    } catch (error) {
      console.error('Sync gallery images to ImageMap error:', error)
    }

    res.status(201).json({ gallery: await toGalleryResponse(gallery) })
  } catch (error) {
    if (createdAssetIds.length > 0) {
      await prisma.mediaAsset.deleteMany({
        where: {
          id: { in: createdAssetIds },
        },
      })
    }
    await Promise.all(
      files.map((file) => safeDeleteUploadFileByStorageKey(file.filename)),
    )
    console.error('Upload gallery error:', error)
    const message = error instanceof Error ? error.message : ''
    if (message.includes('图片') || message.includes('文件')) {
      res.status(400).json({ error: message })
      return
    }
    res.status(500).json({ error: '上传图集失败' })
  }
}))

router.post('/', galleryWriteLimiter, requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    if (!canCreateGallery(req.authUser)) {
      res.status(403).json({ error: '当前图集已临时限制为仅管理员可操作' })
      return
    }

    const { title, description, tags, images, assetIds, uploadSessionId, locationCode, locationDetail } = req.body as {
      title?: string
      description?: string
      tags?: string[]
      images?: { url: string; name: string }[]
      assetIds?: string[]
      uploadSessionId?: string
      locationCode?: string
      locationDetail?: string
    }

    const normalizedAssetIds = parseAssetIdList(assetIds)

    if (normalizedAssetIds.length > 0) {
      const finalTitle = typeof title === 'string' && title.trim() ? title.trim() : '默认图集'
      const finalDescription = typeof description === 'string' && description.trim()
        ? description.trim()
        : `${finalTitle} 图集`
      const finalTags = normalizeTagList(tags)

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

      const gallery = await prisma.gallery.create({
        data: {
          title: finalTitle,
          description: finalDescription,
          authorUid: req.authUser!.uid,
          authorName: req.authUser!.displayName,
          tags: finalTags,
          locationCode: locationCode || null,
          locationDetail: locationDetail || null,
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
    const normalizedDescription = typeof description === 'string' && description.trim() ? description.trim() : '无描述'
    const normalizedTags = normalizeTagList(tags)

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

    const gallery = await prisma.gallery.create({
      data: {
        title: normalizedTitle,
        description: normalizedDescription,
        authorUid: req.authUser!.uid,
        authorName: req.authUser!.displayName,
        tags: normalizedTags,
        locationCode: locationCode || null,
        locationDetail: locationDetail || null,
        images: {
          create: normalizedImages.map((image, index) => ({
            assetId: assetByUrl.get(image.url) || null,
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
    const published = req.body?.published !== undefined ? parseBoolean(req.body.published, false) : undefined
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
      published?: boolean
      publishedAt?: Date | null
    } = {}

    if (title !== undefined && title.length > 0) {
      data.title = title
    }
    if (description !== undefined) {
      data.description = description || '无描述'
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
    if (published !== undefined) {
      data.published = published
      data.publishedAt = published ? new Date() : null
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
      await Promise.all(
        removedImages.map(async (item) => {
          if (item.assetId) {
            await cleanupUnusedMediaAssetById(item.assetId)
          } else {
            await cleanupUntrackedUploadImageByUrl(item.url)
          }
        }),
      )
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

    const nextPublished = parseBoolean(req.body?.published, !gallery.published)
    const updated = await prisma.gallery.update({
      where: { id: req.params.id },
      data: {
        published: nextPublished,
        publishedAt: nextPublished ? new Date() : null,
      },
      include: {
        images: {
          include: {
            asset: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    res.json({ gallery: await toGalleryResponse(updated) })
  } catch (error) {
    console.error('Update gallery publish status error:', error)
    res.status(500).json({ error: '修改图集发布状态失败' })
  }
}))

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

    const assetIds = parseAssetIdList(req.body?.assetIds)
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

    const assets = await prisma.mediaAsset.findMany({
      where: {
        id: { in: assetIds },
        ownerUid: req.authUser!.uid,
        status: 'ready',
      },
      orderBy: { createdAt: 'asc' },
    })

    if (assets.length !== assetIds.length) {
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

    const updated = await prisma.gallery.findUnique({
      where: { id: gallery.id },
      include: {
        images: {
          include: {
            asset: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

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

    if (image.assetId) {
      await cleanupUnusedMediaAssetById(image.assetId)
    } else {
      await cleanupUntrackedUploadImageByUrl(image.url)
    }

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

    const updated = await prisma.gallery.findUnique({
      where: { id: gallery.id },
      include: {
        images: {
          include: {
            asset: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    if (!updated) {
      res.status(404).json({ error: '图集不存在' })
      return
    }

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

    const updated = await prisma.gallery.findUnique({
      where: { id: gallery.id },
      include: {
        images: {
          include: {
            asset: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    if (!updated) {
      res.status(404).json({ error: '图集不存在' })
      return
    }

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

    const gallery = await prisma.gallery.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        published: true,
        authorUid: true,
      },
    })

    if (!gallery || !canViewGallery(gallery, req.authUser)) {
      res.status(404).json({ error: '图集不存在' })
      return
    }

    if (!gallery.published) {
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

    res.status(201).json({ comment: toCommentResponse(comment) })
  } catch (error) {
    console.error('Create gallery comment error:', error)
    res.status(500).json({ error: '发表评论失败' })
  }
}))

router.delete('/:id', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const gallery = await prisma.gallery.findUnique({
      where: { id: req.params.id },
      include: {
        images: true,
      },
    })

    if (!gallery) {
      res.status(404).json({ error: '图集不存在' })
      return
    }

    const assetIds = [...new Set(gallery.images.map((img) => img.assetId).filter(isString))]
    const imagesWithoutAsset = gallery.images.filter((img) => !img.assetId)

    await prisma.gallery.delete({
      where: { id: req.params.id },
    })

    if (assetIds.length > 0) {
      await Promise.all(assetIds.map((assetId) => cleanupUnusedMediaAssetById(assetId)))
    }

    if (imagesWithoutAsset.length > 0) {
      await Promise.all(
        imagesWithoutAsset.map((image) => cleanupUntrackedUploadImageByUrl(image.url)),
      )
    }

    res.json({ success: true })
  } catch (error) {
    console.error('Delete gallery error:', error)
    res.status(500).json({ error: '删除图集失败' })
  }
}))

export function registerGalleriesRoutes(app: Router) {
  app.use('/api/galleries', router)
}
