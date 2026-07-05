import type { Router } from 'express'
import { Prisma } from '@prisma/client'
import { createRouter } from '../utils/typed-router'
import { requireAdmin } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { validateBody, eventWriteSchema } from '../schemas'
import type { AuthenticatedRequest } from '../types'
import { prisma } from '../prisma'
import {
  parsePagination,
  softDeleteData,
  restoreDeleteData,
  toEventResponse,
  toEventListResponse,
  allocateNumericSlug,
  isNumericSlug,
} from '../utils'
import { syncGalleryImageToImageMapWithVariant } from '../services/galleryImageSyncService'
import {
  cleanupUnusedMediaAssetById,
  cleanupUntrackedUploadImageByUrl,
} from '../services/mediaAssetCleanupService'
import type { EventWriteInput } from '../schemas/event.schema'

const router = createRouter()

const eventInclude = {
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

function deriveEventSortFields(timeSlots: EventWriteInput['timeSlots']) {
  const values = timeSlots
    .flatMap((slot) => [slot.start, slot.end])
    .filter((value): value is string => Boolean(value))
    .sort()

  return {
    sortStart: values[0] || null,
    sortEnd: values[values.length - 1] || null,
  }
}

async function resolveAsset(
  assetId: string | null | undefined,
  ownerUid: string,
  preservedAssetId?: string | null
) {
  if (!assetId) return null
  return prisma.mediaAsset.findFirst({
    where: {
      id: assetId,
      status: 'ready',
      OR: [{ ownerUid }, ...(assetId === preservedAssetId ? [{ id: assetId }] : [])],
    },
  })
}

async function cleanupRemovedAssetReferences(
  removed: Array<{ assetId: string | null; url?: string | null }>
) {
  const assetIds = [...new Set(removed.map((item) => item.assetId).filter(isString))]
  const urlsWithoutAsset = [
    ...new Set(
      removed
        .filter((item) => !item.assetId)
        .map((item) => item.url)
        .filter(isString)
    ),
  ]

  await Promise.all(
    assetIds
      .map((assetId) => cleanupUnusedMediaAssetById(assetId))
      .concat(urlsWithoutAsset.map((url) => cleanupUntrackedUploadImageByUrl(url)))
  )
}

function isString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

async function syncAssetsToImageMap(assetIds: string[]) {
  const uniqueIds = [...new Set(assetIds.filter(Boolean))]
  if (uniqueIds.length === 0) return
  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: uniqueIds }, status: 'ready' },
    select: { publicUrl: true, storageKey: true },
  })
  await Promise.all(
    assets.map((asset) => syncGalleryImageToImageMapWithVariant(asset.publicUrl, asset.storageKey))
  )
}

async function buildPosterCreateData(
  posters: EventWriteInput['posters'],
  ownerUid: string,
  tx: Prisma.TransactionClient,
  currentEventId?: string
) {
  const existingIds = posters
    .filter((poster): poster is { imageId: string } => 'imageId' in poster)
    .map((poster) => poster.imageId)
  const assetIds = posters
    .filter((poster): poster is { assetId: string } => 'assetId' in poster)
    .map((poster) => poster.assetId)

  if (new Set(existingIds).size !== existingIds.length) {
    throw new Error('海报列表包含重复图片')
  }
  if (new Set(assetIds).size !== assetIds.length) {
    throw new Error('海报列表包含重复资源')
  }

  const [existingPosters, assets] = await Promise.all([
    existingIds.length && currentEventId
      ? tx.eventPoster.findMany({
          where: { id: { in: existingIds }, eventId: currentEventId },
        })
      : Promise.resolve([]),
    assetIds.length
      ? tx.mediaAsset.findMany({
          where: { id: { in: assetIds }, ownerUid, status: 'ready' },
        })
      : Promise.resolve([]),
  ])

  if (existingPosters.length !== existingIds.length) {
    throw new Error('海报列表包含无效图片')
  }
  if (assets.length !== assetIds.length) {
    throw new Error('海报列表包含无效或无权限的资源')
  }

  const posterMap = new Map(existingPosters.map((poster) => [poster.id, poster]))
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]))

  const createData = posters.map((poster, index) => {
    if ('imageId' in poster) {
      const existing = posterMap.get(poster.imageId)
      if (!existing) throw new Error('海报列表包含无效图片')
      return {
        id: existing.id,
        assetId: existing.assetId,
        url: existing.url,
        name: existing.name,
        sortOrder: index,
      }
    }

    const asset = assetMap.get(poster.assetId)
    if (!asset) throw new Error('海报列表包含无效或无权限的资源')
    return {
      assetId: asset.id,
      url: asset.publicUrl,
      name: asset.fileName || `poster-${index + 1}`,
      sortOrder: index,
    }
  })

  const referenceKeys = createData.map((poster) =>
    poster.assetId ? `asset:${poster.assetId}` : `url:${poster.url}`
  )
  if (new Set(referenceKeys).size !== referenceKeys.length) {
    throw new Error('海报列表包含重复资源')
  }

  return createData
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, page, offset: skip } = parsePagination(req.query)
    const where = { deletedAt: null }
    const [total, events] = await Promise.all([
      prisma.event.count({ where }),
      prisma.event.findMany({
        where,
        include: eventInclude,
        orderBy: [{ sortStart: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
    ])

    res.json({
      events: await toEventListResponse(events),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore: skip + events.length < total,
    })
  })
)

router.get(
  '/:slug',
  asyncHandler(async (req, res) => {
    if (!isNumericSlug(req.params.slug)) {
      res.status(404).json({ error: '活动不存在' })
      return
    }

    const event = await prisma.event.findFirst({
      where: { slug: req.params.slug, deletedAt: null },
      include: eventInclude,
    })

    if (!event) {
      res.status(404).json({ error: '活动不存在' })
      return
    }

    res.json({ event: await toEventResponse(event) })
  })
)

router.post(
  '/',
  requireAdmin,
  validateBody(eventWriteSchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const input = req.body as EventWriteInput
    const coverAsset = await resolveAsset(input.coverAssetId, req.authUser!.uid)
    if (input.coverAssetId && !coverAsset) {
      res.status(400).json({ error: '封面资源无效或无权限' })
      return
    }
    const sortFields = deriveEventSortFields(input.timeSlots)

    let createdAssetIds: string[] = []
    const event = await prisma.$transaction(async (tx) => {
      const slug = await allocateNumericSlug(tx, 'Event')
      const posterCreateData = await buildPosterCreateData(input.posters, req.authUser!.uid, tx)
      createdAssetIds = posterCreateData
        .map((poster) => poster.assetId)
        .filter((id): id is string => Boolean(id))
      const created = await tx.event.create({
        data: {
          slug,
          title: input.title,
          location: input.location,
          content: input.content,
          timeSlots: input.timeSlots,
          ticketPrices: input.ticketPrices,
          saleTimes: input.saleTimes,
          lineup: input.lineup,
          externalLinks: input.externalLinks,
          ...sortFields,
          coverAssetId: coverAsset?.id || null,
          coverUrl: coverAsset?.publicUrl || null,
          coverName: coverAsset?.fileName || null,
          createdByUid: req.authUser!.uid,
          updatedByUid: req.authUser!.uid,
          posters: {
            create: posterCreateData,
          },
        },
        include: eventInclude,
      })
      return created
    })

    await syncAssetsToImageMap([
      ...(coverAsset?.id ? [coverAsset.id] : []),
      ...createdAssetIds,
    ]).catch((error) => {
      console.error('Sync event images to ImageMap error:', error)
    })

    res.status(201).json({ event: await toEventResponse(event) })
  })
)

router.put(
  '/:id',
  requireAdmin,
  validateBody(eventWriteSchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const input = req.body as EventWriteInput
    const current = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: { posters: true },
    })
    if (!current || current.deletedAt) {
      res.status(404).json({ error: '活动不存在' })
      return
    }

    const coverAsset = await resolveAsset(
      input.coverAssetId,
      req.authUser!.uid,
      current.coverAssetId
    )
    if (input.coverAssetId && !coverAsset) {
      res.status(400).json({ error: '封面资源无效或无权限' })
      return
    }
    const sortFields = deriveEventSortFields(input.timeSlots)
    const nextCoverReference = {
      assetId: coverAsset?.id || null,
      url: coverAsset?.publicUrl || null,
    }

    let nextPosterReferences: Array<{ assetId: string | null; url: string }> = []
    const event = await prisma.$transaction(async (tx) => {
      const posterCreateData = await buildPosterCreateData(
        input.posters,
        req.authUser!.uid,
        tx,
        current.id
      )
      nextPosterReferences = posterCreateData.map((poster) => ({
        assetId: poster.assetId,
        url: poster.url,
      }))

      await tx.eventPoster.deleteMany({ where: { eventId: current.id } })
      return tx.event.update({
        where: { id: current.id },
        data: {
          title: input.title,
          location: input.location,
          content: input.content,
          timeSlots: input.timeSlots,
          ticketPrices: input.ticketPrices,
          saleTimes: input.saleTimes,
          lineup: input.lineup,
          externalLinks: input.externalLinks,
          ...sortFields,
          coverAssetId: nextCoverReference.assetId,
          coverUrl: nextCoverReference.url,
          coverName: coverAsset?.fileName || null,
          updatedByUid: req.authUser!.uid,
          posters: {
            create: posterCreateData,
          },
        },
        include: eventInclude,
      })
    })

    const nextPosterAssetIds = new Set(
      nextPosterReferences.map((poster) => poster.assetId).filter(isString)
    )
    const nextPosterUrlsWithoutAsset = new Set(
      nextPosterReferences
        .filter((poster) => !poster.assetId)
        .map((poster) => poster.url)
        .filter(isString)
    )
    const removedPosterAssets = current.posters
      .filter((poster) =>
        poster.assetId
          ? !nextPosterAssetIds.has(poster.assetId)
          : !nextPosterUrlsWithoutAsset.has(poster.url)
      )
      .map((poster) => ({ assetId: poster.assetId, url: poster.url }))
    const removedCoverAsset =
      current.coverAssetId !== nextCoverReference.assetId ||
      current.coverUrl !== nextCoverReference.url
        ? [{ assetId: current.coverAssetId, url: current.coverUrl }]
        : []

    await cleanupRemovedAssetReferences([...removedPosterAssets, ...removedCoverAsset]).catch(
      (error) => {
        console.error('Cleanup removed event images error:', error)
      }
    )
    await syncAssetsToImageMap([
      ...(coverAsset?.id ? [coverAsset.id] : []),
      ...nextPosterAssetIds,
    ]).catch((error) => {
      console.error('Sync event images to ImageMap error:', error)
    })

    res.json({ event: await toEventResponse(event) })
  })
)

router.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
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

    res.json({ success: true })
  })
)

router.post(
  '/:id/restore',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const current = await prisma.event.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    })
    if (!current) {
      res.status(404).json({ error: '活动不存在' })
      return
    }

    const event = await prisma.event.update({
      where: { id: req.params.id },
      data: {
        ...restoreDeleteData,
        updatedByUid: req.authUser!.uid,
      },
      include: eventInclude,
    })

    res.json({ event: await toEventResponse(event) })
  })
)

router.delete(
  '/:id/permanent',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: { posters: true },
    })
    if (!event) {
      res.status(404).json({ error: '活动不存在' })
      return
    }

    await prisma.event.delete({ where: { id: event.id } })
    await cleanupRemovedAssetReferences([
      ...event.posters.map((poster) => ({ assetId: poster.assetId, url: poster.url })),
      { assetId: event.coverAssetId, url: event.coverUrl },
    ]).catch((error) => {
      console.error('Cleanup permanently deleted event images error:', error)
    })

    res.json({ success: true })
  })
)

export function registerEventsRoutes(app: Router) {
  app.use('/api/events', router)
}
