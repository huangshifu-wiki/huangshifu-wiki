import type { Router } from 'express'
import { requireActiveUser, requireCookieSession } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { profileLimiter } from '../middleware/rateLimiter'
import { createApiKeySchema, validateBody } from '../schemas'
import { createApiKeyMaterial, logger, prisma, toApiKeyResponse } from '../utils'
import { createRouter } from '../utils/typed-router'
import type { AuthenticatedRequest } from '../types'

const router = createRouter()
const API_KEY_DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000
const API_KEY_TTL_MS: Record<'30d' | '90d' | '365d', number> = {
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': API_KEY_DEFAULT_TTL_MS,
  '365d': 365 * 24 * 60 * 60 * 1000,
}

router.get(
  '/',
  requireCookieSession,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const keys = await prisma.userApiKey.findMany({
      where: { userUid: req.authUser!.uid },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        name: true,
        prefix: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
      },
    })

    res.json({ keys: keys.map(toApiKeyResponse) })
  })
)

router.post(
  '/',
  profileLimiter,
  validateBody(createApiKeySchema),
  requireCookieSession,
  requireActiveUser,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { name, expiry } = req.body as { name: string; expiry: '30d' | '90d' | '365d' | 'never' }
    const material = createApiKeyMaterial()
    const createdAt = new Date()
    const expiresAt =
      expiry === 'never' ? null : new Date(createdAt.getTime() + API_KEY_TTL_MS[expiry])
    const key = await prisma.userApiKey.create({
      data: {
        userUid: req.authUser!.uid,
        name,
        tokenHash: material.tokenHash,
        prefix: material.prefix,
        createdAt,
        expiresAt,
      },
      select: {
        id: true,
        name: true,
        prefix: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
      },
    })

    logger.info({ uid: req.authUser!.uid, keyId: key.id }, 'Personal API key created')
    res.status(201).json({ key: toApiKeyResponse(key), token: material.token })
  })
)

router.delete(
  '/:id',
  requireCookieSession,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const id = req.params.id.trim()
    if (!id) {
      res.status(400).json({ error: 'API 密钥 ID 不能为空' })
      return
    }

    const revoked = await prisma.userApiKey.updateMany({
      where: { id, userUid: req.authUser!.uid, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    if (revoked.count > 0) {
      logger.info({ uid: req.authUser!.uid, keyId: id }, 'Personal API key revoked')
    } else {
      const existing = await prisma.userApiKey.findFirst({
        where: { id, userUid: req.authUser!.uid },
        select: { id: true },
      })
      if (!existing) {
        res.status(404).json({ error: 'API 密钥不存在' })
        return
      }
    }

    res.json({ success: true })
  })
)

export function registerApiKeysRoutes(app: Router): void {
  app.use('/api/users/me/api-keys', router)
}
