import { Router } from 'express'
import { prisma } from '../prisma'
import { requireAdmin } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { enhancedCache, CACHE_KEYS, CACHE_TTL_SEC } from '../utils/cache'
import type { AuthenticatedRequest } from '../types'

const router = Router()

function clearAnnouncementCache(): void {
  enhancedCache.delete(CACHE_KEYS.ANNOUNCEMENT_LATEST)
}

router.get('/latest', asyncHandler(async (_req, res) => {
  const cached = enhancedCache.get(CACHE_KEYS.ANNOUNCEMENT_LATEST)
  if (cached) {
    res.json(cached)
    return
  }

  const announcement = await prisma.announcement.findFirst({
    where: { active: true },
    orderBy: { createdAt: 'desc' },
  })

  const result = { announcement }

  enhancedCache.set(CACHE_KEYS.ANNOUNCEMENT_LATEST, result, CACHE_TTL_SEC.ANNOUNCEMENT)

  res.json(result)
}))

router.get('/', requireAdmin, asyncHandler(async (_req, res) => {
  const announcements = await prisma.announcement.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  res.json({ announcements })
}))

router.post('/', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  const { content, link, active } = req.body as {
    content?: string
    link?: string
    active?: boolean
  }

  if (!content) {
    res.status(400).json({ error: '公告内容不能为空' })
    return
  }

  const announcement = await prisma.announcement.create({
    data: {
      content,
      link: link || null,
      active: active ?? true,
    },
  })

  clearAnnouncementCache()

  res.status(201).json({ announcement })
}))

router.patch('/:id', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  const { active, content, link } = req.body as {
    active?: boolean
    content?: string
    link?: string
  }

  const announcement = await prisma.announcement.update({
    where: { id: req.params.id },
    data: {
      active: typeof active === 'boolean' ? active : undefined,
      content: typeof content === 'string' ? content : undefined,
      link: typeof link === 'string' ? link : undefined,
    },
  })

  clearAnnouncementCache()

  res.json({ announcement })
}))

router.delete('/:id', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  await prisma.announcement.delete({
    where: { id: req.params.id },
  })

  clearAnnouncementCache()

  res.json({ success: true })
}))

export function registerAnnouncementsRoutes(app: Router) {
  app.use('/api/announcements', router)
}
