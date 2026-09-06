import type { Router } from 'express'
import { Prisma } from '@prisma/client'
import { createRouter } from '../utils/typed-router'
import { requireAdmin } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { validateBody, eventWriteSchema } from '../schemas'
import type { AuthenticatedRequest } from '../types'
import { prisma } from '../prisma'
import { CONTENT_LIMITS } from '../../lib/contentLimits'
import {
  allocateNumericSlug,
  parsePagination,
  softDeleteData,
  restoreDeleteData,
  toEventResponse,
  toEventListResponse,
  invalidateTicketListingCaches,
  isNumericSlug,
  logger,
} from '../utils'
import {
  cleanupUnusedMediaAssetById,
  cleanupUntrackedUploadImageByUrl,
} from '../services/mediaAssetCleanupService'
import {
  assertUploadSessionAssets,
  getCanonicalMediaUrl,
  getReadyAssetsForOwner,
  MediaAssetRequestError,
  releaseMediaAsset,
} from '../services/mediaAssetService'
import { getReadyAssetForOwner } from '../services/mediaAssetService'
import type { EventWriteInput } from '../schemas/event.schema'

const router = createRouter()

const eventInclude = {
  coverAsset: { include: { imageMap: true } },
  createdBy: { select: { displayName: true } },
  updatedBy: { select: { displayName: true } },
  posters: {
    orderBy: { sortOrder: 'asc' as const },
    include: { asset: { include: { imageMap: true } } },
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
    throw new MediaAssetRequestError(400, '海报列表包含重复图片')
  }
  if (new Set(assetIds).size !== assetIds.length) {
    throw new MediaAssetRequestError(400, '海报列表包含重复资源')
  }

  const existingPosters =
    existingIds.length && currentEventId
      ? await tx.eventPoster.findMany({
          where: { id: { in: existingIds }, eventId: currentEventId },
          select: {
            id: true,
            assetId: true,
            url: true,
            name: true,
            asset: { select: { imageMapId: true } },
          },
        })
      : []
  if (existingPosters.length !== existingIds.length) {
    throw new MediaAssetRequestError(400, '海报列表包含无效图片')
  }

  const assetMap = new Map(
    (await getReadyAssetsForOwner(tx, assetIds, ownerUid)).map((asset) => [asset.id, asset])
  )
  const posterMap = new Map(existingPosters.map((poster) => [poster.id, poster]))
  const createData = posters.map((poster, index) => {
    if ('imageId' in poster) {
      const existing = posterMap.get(poster.imageId)
      if (!existing) throw new MediaAssetRequestError(400, '海报列表包含无效图片')
      return {
        id: existing.id,
        assetId: existing.assetId,
        imageMapId: existing.asset?.imageMapId || `legacy:${existing.id}`,
        url: existing.url,
        name: existing.name,
        sortOrder: index,
      }
    }

    const asset = assetMap.get(poster.assetId)
    if (!asset) throw new MediaAssetRequestError(400, '海报列表包含无效或无权限的资源')
    return {
      assetId: asset.id,
      imageMapId: asset.imageMapId,
      url: getCanonicalMediaUrl(asset),
      name: `poster-${index + 1}`,
      sortOrder: index,
    }
  })

  if (new Set(createData.map((poster) => poster.imageMapId)).size !== createData.length) {
    throw new MediaAssetRequestError(400, '海报列表包含重复图片内容')
  }
  return createData.map(({ imageMapId: _imageMapId, ...poster }) => poster)
}
function isString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

function parseEventTagQuery(value: unknown) {
  if (typeof value !== 'string') return ''
  const tag = value.trim()
  return tag.length > CONTENT_LIMITS.event.tag ? null : tag
}

type EventListSortOrder = 'asc' | 'desc' | 'upcoming'

function parseEventSortOrder(value: unknown): EventListSortOrder {
  return value === 'asc' || value === 'upcoming' ? value : 'desc'
}

function getLocalTodayValue() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

// upcoming 排序：未来按近到远，其次过去按近到远，无时间垫底；跨桶分页时用已耗尽的桶数量折算剩余 skip
async function findEventsInUpcomingOrder(
  where: Prisma.EventWhereInput,
  skip: number,
  take: number
) {
  const today = getLocalTodayValue()
  const futureWhere = { ...where, sortStart: { gte: today } }
  const pastWhere = { ...where, sortStart: { lt: today } }

  const future = await prisma.event.findMany({
    where: futureWhere,
    include: eventInclude,
    orderBy: [{ sortStart: 'asc' }, { createdAt: 'desc' }],
    skip,
    take,
  })
  if (future.length === take) return future

  // 未填满时未来桶必然已耗尽：返回数大于 0 说明 futureCount = skip + 返回数，否则需查 count
  const futureCount =
    future.length > 0 ? skip + future.length : await prisma.event.count({ where: futureWhere })

  const pastSkip = Math.max(0, skip - futureCount)
  const past = await prisma.event.findMany({
    where: pastWhere,
    include: eventInclude,
    orderBy: [{ sortStart: 'desc' }, { createdAt: 'desc' }],
    skip: pastSkip,
    take: take - future.length,
  })
  const merged = [...future, ...past]
  if (merged.length === take) return merged

  const pastCount =
    past.length > 0 ? pastSkip + past.length : await prisma.event.count({ where: pastWhere })

  const pending = await prisma.event.findMany({
    where: { ...where, sortStart: null },
    include: eventInclude,
    orderBy: [{ createdAt: 'desc' }],
    skip: Math.max(0, skip - futureCount - pastCount),
    take: take - merged.length,
  })
  return [...merged, ...pending]
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
  await Promise.all([
    ...assetIds.map((assetId) => cleanupUnusedMediaAssetById(assetId)),
    ...urlsWithoutAsset.map((url) => cleanupUntrackedUploadImageByUrl(url)),
  ])
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, page, offset: skip } = parsePagination(req.query)
    const tag = parseEventTagQuery(req.query.tag)
    const sortOrder = parseEventSortOrder(req.query.sortOrder)
    if (tag === null) {
      res.status(400).json({ error: `标签不能超过${CONTENT_LIMITS.event.tag}个字符` })
      return
    }
    const where: Prisma.EventWhereInput = {
      deletedAt: null,
      ...(tag ? { tags: { array_contains: [tag] } } : {}),
    }
    const [total, events] = await Promise.all([
      prisma.event.count({ where }),
      sortOrder === 'upcoming'
        ? findEventsInUpcomingOrder(where, skip, limit)
        : prisma.event.findMany({
            where,
            include: eventInclude,
            orderBy: [{ sortStart: { sort: sortOrder, nulls: 'last' } }, { createdAt: 'desc' }],
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
  '/tags',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.$queryRaw<Array<{ tag: string }>>`
      SELECT DISTINCT event_tag.tag AS tag
      FROM "Event"
      CROSS JOIN LATERAL jsonb_array_elements_text("Event"."tags") AS event_tag(tag)
      WHERE "Event"."deletedAt" IS NULL AND btrim(event_tag.tag) <> ''
    `
    const tags = rows
      .map((row) => row.tag)
      .sort((left, right) => left.localeCompare(right, 'zh-CN'))

    res.json({ tags })
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
    try {
      const input = req.body as EventWriteInput
      const sortFields = deriveEventSortFields(input.timeSlots)
      const event = await prisma.$transaction(async (tx) => {
        const coverAsset = input.coverAssetId
          ? await getReadyAssetForOwner(tx, input.coverAssetId, req.authUser!.uid)
          : null
        const posterCreateData = await buildPosterCreateData(input.posters, req.authUser!.uid, tx)
        const assetIds = [
          ...(coverAsset?.id ? [coverAsset.id] : []),
          ...posterCreateData.map((poster) => poster.assetId).filter(isString),
        ]
        if (input.uploadSessionId) {
          await assertUploadSessionAssets(tx, input.uploadSessionId, req.authUser!.uid, assetIds)
        }
        const slug = await allocateNumericSlug(tx, 'Event')
        return tx.event.create({
          data: {
            slug,
            title: input.title,
            location: input.location,
            content: input.content,
            timeSlots: input.timeSlots,
            ticketPrices: input.ticketPrices,
            saleTimes: input.saleTimes,
            lineup: input.lineup,
            tags: input.tags,
            externalLinks: input.externalLinks,
            relatedLinks: input.relatedLinks,
            ...sortFields,
            coverAssetId: coverAsset?.id || null,
            coverUrl: coverAsset ? getCanonicalMediaUrl(coverAsset) : null,
            coverName: coverAsset?.fileName || null,
            createdByUid: req.authUser!.uid,
            updatedByUid: req.authUser!.uid,
            posters: { create: posterCreateData },
          },
          include: eventInclude,
        })
      })
      res.status(201).json({ event: await toEventResponse(event) })
    } catch (error) {
      if (error instanceof MediaAssetRequestError) {
        res.status(error.statusCode).json({ error: error.message })
        return
      }
      throw error
    }
  })
)

router.put(
  '/:id',
  requireAdmin,
  validateBody(eventWriteSchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const input = req.body as EventWriteInput
      const current = await prisma.event.findUnique({
        where: { id: req.params.id },
        include: { posters: true },
      })
      if (!current || current.deletedAt) {
        res.status(404).json({ error: '活动不存在' })
        return
      }
      const sortFields = deriveEventSortFields(input.timeSlots)
      const event = await prisma.$transaction(async (tx) => {
        const coverAsset = input.coverAssetId
          ? await getReadyAssetForOwner(tx, input.coverAssetId, req.authUser!.uid)
          : null
        const posterCreateData = await buildPosterCreateData(
          input.posters,
          req.authUser!.uid,
          tx,
          current.id
        )
        const assetIds = [
          ...(coverAsset?.id ? [coverAsset.id] : []),
          ...posterCreateData.map((poster) => poster.assetId).filter(isString),
        ]
        if (input.uploadSessionId) {
          await assertUploadSessionAssets(tx, input.uploadSessionId, req.authUser!.uid, assetIds)
        }
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
            tags: input.tags,
            externalLinks: input.externalLinks,
            relatedLinks: input.relatedLinks,
            ...sortFields,
            coverAssetId: coverAsset?.id || null,
            coverUrl: coverAsset ? getCanonicalMediaUrl(coverAsset) : null,
            coverName: coverAsset?.fileName || null,
            updatedByUid: req.authUser!.uid,
            posters: { create: posterCreateData },
          },
          include: eventInclude,
        })
      })

      const nextPosterAssetIds = new Set(
        event.posters.map((poster) => poster.assetId).filter(isString)
      )
      const nextPosterUrlsWithoutAsset = new Set(
        event.posters.filter((poster) => !poster.assetId).map((poster) => poster.url)
      )
      const removedPosterAssets = current.posters
        .filter((poster) =>
          poster.assetId
            ? !nextPosterAssetIds.has(poster.assetId)
            : !nextPosterUrlsWithoutAsset.has(poster.url)
        )
        .map((poster) => ({ assetId: poster.assetId, url: poster.url }))
      const removedCoverAsset =
        current.coverAssetId !== event.coverAssetId || current.coverUrl !== event.coverUrl
          ? [{ assetId: current.coverAssetId, url: current.coverUrl }]
          : []

      await cleanupRemovedAssetReferences([...removedPosterAssets, ...removedCoverAsset]).catch(
        (error) =>
          logger.error({ err: error, eventId: current.id }, 'Cleanup removed event images error')
      )
      invalidateTicketListingCaches()
      res.json({ event: await toEventResponse(event) })
    } catch (error) {
      if (error instanceof MediaAssetRequestError) {
        res.status(error.statusCode).json({ error: error.message })
        return
      }
      throw error
    }
  })
)

router.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        deletedAt: true,
        coverAssetId: true,
        posters: { select: { assetId: true } },
      },
    })
    if (!event || event.deletedAt) {
      res.status(404).json({ error: '活动不存在' })
      return
    }

    await prisma.$transaction(async (tx) => {
      await tx.event.update({
        where: { id: event.id },
        data: softDeleteData(req.authUser!.uid),
      })
      await tx.moderationLog.create({
        data: {
          targetType: 'event',
          targetId: event.id,
          action: 'delete',
          operatorUid: req.authUser!.uid,
          note: null,
        },
      })
    })
    const assetIds = [
      ...(event.coverAssetId ? [event.coverAssetId] : []),
      ...event.posters.map((poster) => poster.assetId).filter(isString),
    ]
    await Promise.all(
      [...new Set(assetIds)].map((assetId) =>
        releaseMediaAsset(assetId).catch((error) =>
          console.error('Release deleted event media asset error:', error)
        )
      )
    )

    invalidateTicketListingCaches()
    res.json({ success: true })
  })
)

router.post(
  '/:id/restore',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const current = await prisma.event.findUnique({
      where: { id: req.params.id },
      select: { id: true, deletedAt: true },
    })
    if (!current) {
      res.status(404).json({ error: '活动不存在' })
      return
    }
    if (!current.deletedAt) {
      res.status(400).json({ error: '该记录未被删除' })
      return
    }

    const event = await prisma.$transaction(async (tx) => {
      const restored = await tx.event.update({
        where: { id: req.params.id },
        data: {
          ...restoreDeleteData,
          updatedByUid: req.authUser!.uid,
        },
        include: eventInclude,
      })
      await tx.moderationLog.create({
        data: {
          targetType: 'event',
          targetId: req.params.id,
          action: 'restore',
          operatorUid: req.authUser!.uid,
          note: null,
        },
      })
      return restored
    })

    invalidateTicketListingCaches()
    res.json({ event: await toEventResponse(event) })
  })
)

router.delete(
  '/:id/permanent',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: { posters: true },
    })
    if (!event) {
      res.status(404).json({ error: '活动不存在' })
      return
    }

    await prisma.$transaction(async (tx) => {
      await tx.ticketListing.updateMany({
        where: { eventId: event.id },
        data: { eventId: null, customEventName: event.title },
      })
      await tx.event.delete({ where: { id: event.id } })
      await tx.moderationLog.create({
        data: {
          targetType: 'event',
          targetId: event.id,
          action: 'permanentDelete',
          operatorUid: req.authUser!.uid,
          note: null,
        },
      })
    })
    await cleanupRemovedAssetReferences([
      ...event.posters.map((poster) => ({ assetId: poster.assetId, url: poster.url })),
      { assetId: event.coverAssetId, url: event.coverUrl },
    ]).catch((error) => {
      console.error('Cleanup permanently deleted event images error:', error)
    })

    invalidateTicketListingCaches()
    res.json({ success: true })
  })
)

export function registerEventsRoutes(app: Router) {
  app.use('/api/events', router)
}
