import type { Router } from 'express'
import { prisma } from '../prisma'
import { createRouter } from '../utils/typed-router'
import { requireActiveUser, requireAuth, isAdminRole } from '../middleware/auth'
import { postWriteLimiter } from '../middleware/rateLimiter'
import { asyncHandler } from '../middleware/asyncHandler'
import { validateBody, postDeleteSchema, ticketListingWriteSchema } from '../schemas'
import type { AuthenticatedRequest, ContentStatus, TicketListingType } from '../types'
import { CONTENT_LIMITS } from '../../lib/contentLimits'
import {
  allocateNumericSlug,
  canViewTicketListing,
  createNotification,
  createPaginationMeta,
  enhancedCache,
  ensureTextLimit,
  normalizeTicketListingWriteStatus,
  parsePagination,
  parseQueryString,
  resolveDeleteReason,
  softDeleteData,
  invalidateTicketListingCaches,
  toTicketListingListResponse,
  toTicketListingResponse,
} from '../utils'
const router = createRouter()

const listingDetailInclude = {
  event: {
    select: {
      id: true,
      slug: true,
      title: true,
      location: true,
      deletedAt: true,
    },
  },
  author: {
    select: {
      publicId: true,
      displayName: true,
    },
  },
} as const

const publicListingListSelect = {
  id: true,
  slug: true,
  type: true,
  eventId: true,
  customEventName: true,
  quantity: true,
  ticketTier: true,
  seat: true,
  authorUid: true,
  createdAt: true,
  updatedAt: true,
  event: listingDetailInclude.event,
  author: listingDetailInclude.author,
} as const

const listingListSelect = {
  id: true,
  slug: true,
  type: true,
  eventId: true,
  customEventName: true,
  quantity: true,
  ticketTier: true,
  seat: true,
  authorUid: true,
  status: true,
  reviewNote: true,
  reviewedBy: true,
  reviewedAt: true,
  deletedAt: true,
  deletedBy: true,
  createdAt: true,
  updatedAt: true,
  event: listingDetailInclude.event,
  author: listingDetailInclude.author,
} as const

type TicketListingWriteInput = {
  type: TicketListingType
  quantity: number
  ticketTier: string
  seat: string
  description: string
  contact: string
  eventId?: string
  customEventName?: string
  status?: 'draft' | 'pending' | 'published'
}

function getEventSearchLimit(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 20
  return Math.min(Math.max(Math.floor(parsed), 1), 20)
}

router.get(
  '/',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const rawType = parseQueryString(req.query.type)
    const type = (rawType || null) as TicketListingType | null
    if (type && type !== 'offer' && type !== 'request') {
      res.status(400).json({ error: '无效的盘票类型' })
      return
    }

    const q = parseQueryString(req.query.q).slice(0, CONTENT_LIMITS.event.title)
    const eventId = parseQueryString(req.query.eventId)
    const { limit, page, offset } = parsePagination(req.query)
    const where = {
      status: 'published' as const,
      deletedAt: null,
      ...(type ? { type } : {}),
      ...(eventId ? { eventId } : {}),
      ...(q
        ? {
            OR: [
              { customEventName: { contains: q, mode: 'insensitive' as const } },
              { ticketTier: { contains: q, mode: 'insensitive' as const } },
              { seat: { contains: q, mode: 'insensitive' as const } },
              { event: { title: { contains: q, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    }

    const cacheKey = `ticket_listing_list:${JSON.stringify([
      page,
      limit,
      type,
      eventId || null,
      q || null,
    ])}`
    const cached = enhancedCache.get(cacheKey)
    if (cached) {
      res.json(cached)
      return
    }

    const [listings, total] = await Promise.all([
      prisma.ticketListing.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
        select: publicListingListSelect,
      }),
      prisma.ticketListing.count({ where }),
    ])

    const result = {
      listings: listings.map((listing) => toTicketListingListResponse(listing)),
      ...createPaginationMeta(total, page, limit, listings.length),
    }
    enhancedCache.set(cacheKey, result, 60)
    res.json(result)
  })
)

router.get(
  '/events',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const q = parseQueryString(req.query.q).slice(0, CONTENT_LIMITS.event.title)
    const events = await prisma.event.findMany({
      where: {
        deletedAt: null,
        ...(q ? { title: { contains: q, mode: 'insensitive' as const } } : {}),
      },
      orderBy: [{ sortStart: 'asc' }, { title: 'asc' }],
      take: getEventSearchLimit(req.query.limit),
      select: {
        id: true,
        slug: true,
        title: true,
        location: true,
        sortStart: true,
      },
    })
    res.json({ events })
  })
)

router.get(
  '/mine',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { limit, page, offset } = parsePagination(req.query)
    const where = { authorUid: req.authUser!.uid, deletedAt: null }
    const [listings, total] = await Promise.all([
      prisma.ticketListing.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
        select: listingListSelect,
      }),
      prisma.ticketListing.count({ where }),
    ])
    res.json({
      listings: listings.map((listing) =>
        toTicketListingListResponse(listing, { includePrivate: true })
      ),
      ...createPaginationMeta(total, page, limit, listings.length),
    })
  })
)

router.get(
  '/:slug',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!/^\d+$/.test(req.params.slug)) {
      res.status(404).json({ error: '盘票信息未找到' })
      return
    }

    const listing = await prisma.ticketListing.findUnique({
      where: { slug: req.params.slug },
      include: listingDetailInclude,
    })
    if (!listing || !canViewTicketListing(listing, req.authUser)) {
      res.status(404).json({ error: '盘票信息未找到' })
      return
    }

    const includePrivate =
      Boolean(req.authUser) &&
      (listing.authorUid === req.authUser!.uid || isAdminRole(req.authUser!.role))
    res.json({ listing: toTicketListingResponse(listing, { includePrivate }) })
  })
)

router.post(
  '/',
  postWriteLimiter,
  requireAuth,
  requireActiveUser,
  validateBody(ticketListingWriteSchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const input = req.body as TicketListingWriteInput
    const nextStatus = normalizeTicketListingWriteStatus(input.status, req.authUser!)

    const listing = await prisma.$transaction(async (tx) => {
      if (input.eventId) {
        const event = await tx.event.findFirst({
          where: { id: input.eventId, deletedAt: null },
          select: { id: true },
        })
        if (!event) return null
      }

      const slug = await allocateNumericSlug(tx, 'TicketListing')
      const created = await tx.ticketListing.create({
        data: {
          slug,
          type: input.type,
          eventId: input.eventId || null,
          customEventName: input.customEventName || null,
          quantity: input.quantity,
          ticketTier: input.ticketTier,
          seat: input.seat,
          description: input.description,
          contact: input.contact,
          authorUid: req.authUser!.uid,
          status: nextStatus,
          reviewNote: null,
          reviewedBy: null,
          reviewedAt: null,
        },
        include: listingDetailInclude,
      })

      if (nextStatus === 'pending') {
        await tx.moderationLog.create({
          data: {
            targetType: 'ticketListing',
            targetId: created.id,
            action: 'submit',
            operatorUid: req.authUser!.uid,
            note: null,
          },
        })
      }
      return created
    })

    if (!listing) {
      res.status(400).json({ error: '关联活动不存在或已删除' })
      return
    }

    invalidateTicketListingCaches()
    res.status(201).json({
      listing: toTicketListingResponse(listing, { includePrivate: true }),
    })
  })
)

router.put(
  '/:id',
  postWriteLimiter,
  requireAuth,
  requireActiveUser,
  validateBody(ticketListingWriteSchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const input = req.body as TicketListingWriteInput
    const existing = await prisma.ticketListing.findUnique({
      where: { id: req.params.id },
      select: { id: true, authorUid: true, status: true, deletedAt: true },
    })
    if (!existing || existing.deletedAt) {
      res.status(404).json({ error: '盘票信息未找到' })
      return
    }

    const isAdmin = isAdminRole(req.authUser!.role)
    const isOwner = existing.authorUid === req.authUser!.uid
    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: '无权编辑该盘票信息' })
      return
    }

    let nextStatus: ContentStatus
    if (isAdmin) {
      nextStatus =
        input.status === undefined
          ? existing.status
          : normalizeTicketListingWriteStatus(input.status, req.authUser!)
    } else if (existing.status === 'published' || existing.status === 'pending') {
      nextStatus = 'pending'
    } else {
      nextStatus = normalizeTicketListingWriteStatus(input.status ?? existing.status, req.authUser!)
    }

    const listing = await prisma.$transaction(async (tx) => {
      if (input.eventId) {
        const event = await tx.event.findFirst({
          where: { id: input.eventId, deletedAt: null },
          select: { id: true },
        })
        if (!event) return null
      }

      const updateResult = await tx.ticketListing.updateMany({
        where: { id: req.params.id, deletedAt: null },
        data: {
          type: input.type,
          eventId: input.eventId || null,
          customEventName: input.customEventName || null,
          quantity: input.quantity,
          ticketTier: input.ticketTier,
          seat: input.seat,
          description: input.description,
          contact: input.contact,
          status: nextStatus,
          reviewNote: null,
          reviewedBy: null,
          reviewedAt: null,
        },
      })
      if (!updateResult.count) return null
      const updated = await tx.ticketListing.findUnique({
        where: { id: req.params.id },
        include: listingDetailInclude,
      })
      if (!updated) return null

      if (nextStatus === 'pending') {
        await tx.moderationLog.create({
          data: {
            targetType: 'ticketListing',
            targetId: updated.id,
            action: 'submit',
            operatorUid: req.authUser!.uid,
            note: !isAdmin && existing.status === 'published' ? '编辑后重新提交审核' : null,
          },
        })
      }
      return updated
    })

    if (!listing) {
      res.status(400).json({ error: '关联活动不存在或已删除' })
      return
    }

    invalidateTicketListingCaches()
    res.json({ listing: toTicketListingResponse(listing, { includePrivate: true }) })
  })
)

router.delete(
  '/:id',
  requireAuth,
  requireActiveUser,
  validateBody(postDeleteSchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const listing = await prisma.ticketListing.findUnique({
      where: { id: req.params.id },
      select: { authorUid: true, slug: true, deletedAt: true },
    })
    if (!listing || listing.deletedAt) {
      res.status(404).json({ error: '盘票信息未找到' })
      return
    }

    const isAdmin = isAdminRole(req.authUser!.role)
    const isOwner = listing.authorUid === req.authUser!.uid
    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: '无权删除该盘票信息' })
      return
    }

    const reason = resolveDeleteReason(req.body?.reason, isOwner)
    if (!isOwner && !reason) {
      res.status(400).json({ error: '删除理由不能为空' })
      return
    }
    if (!ensureTextLimit(res, reason, '删除理由', CONTENT_LIMITS.ticketListing.reviewNote)) return

    const deleted = await prisma.$transaction(async (tx) => {
      const result = await tx.ticketListing.updateMany({
        where: { id: req.params.id, deletedAt: null },
        data: softDeleteData(req.authUser!.uid),
      })
      if (!result.count) return false
      await tx.moderationLog.create({
        data: {
          targetType: 'ticketListing',
          targetId: req.params.id,
          action: 'delete',
          operatorUid: req.authUser!.uid,
          note: reason,
        },
      })
      return true
    })
    if (!deleted) {
      res.status(404).json({ error: '盘票信息未找到' })
      return
    }

    if (!isOwner) {
      await createNotification(listing.authorUid, 'review_result', {
        approved: false,
        action: 'deleted',
        targetType: 'ticketListing',
        targetId: req.params.id,
        targetSlug: listing.slug,
        note: reason,
        operatorUid: req.authUser!.uid,
        operatorName: req.authUser!.displayName,
      })
    }

    invalidateTicketListingCaches()
    res.json({ success: true })
  })
)

export function registerTicketListingsRoutes(app: Router) {
  app.use('/api/ticket-listings', router)
}
