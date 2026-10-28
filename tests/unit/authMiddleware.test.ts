import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import type { SignOptions } from 'jsonwebtoken'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authMiddleware, requireAuth } from '../../src/server/middleware/auth'
import { createApiKeyMaterial } from '../../src/server/utils/api-keys'

const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
  userApiKey: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
}))

const mockCache = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
}))

const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
}))

const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_replace_with_random_string'
const CURRENT_PASSWORD_HASH = 'current-password-hash'

vi.mock('../../src/server/prisma', () => ({
  prisma: mockPrisma,
}))

vi.mock('../../src/server/utils/cache', () => ({
  enhancedCache: mockCache,
  CACHE_KEYS: {
    AUTH_USER: 'auth:user',
  },
  CACHE_TTL_SEC: {
    AUTH_USER: 60,
  },
}))

vi.mock('../../src/server/utils/logger', () => ({
  logger: mockLogger,
}))

function cachedApiUser(role: 'user' | 'admin' | 'super_admin') {
  return {
    uid: 'user-1',
    email: 'user@example.com',
    displayName: 'User One',
    photoURL: null,
    wechatBound: false,
    role,
    status: 'active',
    banReason: null,
    bannedAt: null,
    level: 1,
    signature: '',
    bio: '',
  }
}

function dbUser(role: 'user' | 'admin' | 'super_admin', passwordHash = CURRENT_PASSWORD_HASH) {
  return {
    uid: 'user-1',
    email: 'user@example.com',
    displayName: 'User One',
    photoURL: null,
    wechatOpenId: null,
    role,
    status: 'active',
    banReason: null,
    bannedAt: null,
    emailVerifiedAt: null,
    level: 1,
    signature: '',
    bio: '',
    passwordHash,
  }
}

async function signToken(
  role: 'user' | 'admin' | 'super_admin',
  passwordHash: string,
  expiresIn: SignOptions['expiresIn'] = '90d'
) {
  const { createSessionVersion } = await import('../../src/server/utils/auth-session')
  const sessionVersion = createSessionVersion(passwordHash)

  return {
    sessionVersion,
    token: jwt.sign({ uid: 'user-1', role, sessionVersion }, JWT_SECRET, { expiresIn }),
  }
}

function createAuthApp(token: string, authMiddleware: express.RequestHandler) {
  const app = express()
  app.use((req, _res, next) => {
    req.headers.authorization = `Bearer ${token}`
    next()
  })
  app.use(authMiddleware)
  return app
}

describe('auth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCache.get.mockReturnValue(undefined)
  })

  it('rejects stale session tokens after password hash changes', async () => {
    const { authMiddleware } = await import('../../src/server/middleware/auth')
    const { token } = await signToken('user', 'old-password-hash')

    mockPrisma.user.findUnique.mockResolvedValue(dbUser('user', 'new-password-hash'))

    const app = createAuthApp(token, authMiddleware)
    app.get('/auth-check', (req, res) => {
      res.json({
        hasUser: Boolean((req as express.Request & { authUser?: unknown }).authUser),
      })
    })

    const response = await request(app).get('/auth-check')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ hasUser: false })
    expect(mockLogger.info).toHaveBeenCalledWith(
      { uid: 'user-1' },
      'Rejecting token with stale session version'
    )
    expect(mockCache.set).not.toHaveBeenCalled()
  })

  it('rejects stale session tokens even when auth user cache is populated', async () => {
    const { authMiddleware } = await import('../../src/server/middleware/auth')
    const { createSessionVersion } = await import('../../src/server/utils/auth-session')
    const { token } = await signToken('user', 'old-password-hash')

    mockCache.get.mockReturnValue({
      apiUser: cachedApiUser('user'),
      sessionVersion: createSessionVersion('new-password-hash'),
    })

    const app = createAuthApp(token, authMiddleware)
    app.get('/auth-check', (req, res) => {
      res.json({
        hasUser: Boolean((req as express.Request & { authUser?: unknown }).authUser),
      })
    })

    const response = await request(app).get('/auth-check')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ hasUser: false })
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { uid: 'user-1' },
    })
  })

  it('refreshes cached admin roles from database before authorization', async () => {
    const { authMiddleware, requireSuperAdmin } = await import('../../src/server/middleware/auth')
    const { sessionVersion, token } = await signToken('super_admin', CURRENT_PASSWORD_HASH)

    mockCache.get.mockReturnValue({
      apiUser: cachedApiUser('super_admin'),
      sessionVersion,
    })
    mockPrisma.user.findUnique.mockResolvedValue(dbUser('admin'))

    const app = createAuthApp(token, authMiddleware)
    app.get('/super-admin-only', requireSuperAdmin, (_req, res) => {
      res.json({ ok: true })
    })

    const response = await request(app).get('/super-admin-only')

    expect(response.status).toBe(403)
    expect(response.body).toEqual({ error: '需要超级管理员权限' })
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { uid: 'user-1' },
    })
    expect(mockCache.set).toHaveBeenCalledWith(
      'auth:user:user-1',
      expect.objectContaining({
        apiUser: expect.objectContaining({ role: 'admin' }),
        sessionVersion,
      }),
      60
    )
  })

  it('allows newly promoted super admins without waiting for cached user expiry', async () => {
    const { authMiddleware, requireSuperAdmin } = await import('../../src/server/middleware/auth')
    const { sessionVersion, token } = await signToken('user', CURRENT_PASSWORD_HASH)

    mockCache.get.mockReturnValue({
      apiUser: cachedApiUser('user'),
      sessionVersion,
    })
    mockPrisma.user.findUnique.mockResolvedValue(dbUser('super_admin'))

    const app = createAuthApp(token, authMiddleware)
    app.get('/super-admin-only', requireSuperAdmin, (_req, res) => {
      res.json({ ok: true })
    })

    const response = await request(app).get('/super-admin-only')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true })
    expect(mockCache.set).toHaveBeenCalledWith(
      'auth:user:user-1',
      expect.objectContaining({
        apiUser: expect.objectContaining({ role: 'super_admin' }),
        sessionVersion,
      }),
      60
    )
  })
  it('authenticates API keys from uncached current user data without issuing cookies', async () => {
    const { token, tokenHash } = createApiKeyMaterial()
    mockPrisma.userApiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      userUid: 'user-1',
      revokedAt: null,
      expiresAt: null,
      lastUsedAt: null,
      user: {
        ...dbUser('admin'),
        publicId: 'public-user-1',
        photoAssetId: null,
        deletedAt: null,
      },
    })
    mockPrisma.userApiKey.updateMany.mockResolvedValue({ count: 1 })

    const app = createAuthApp(token, authMiddleware)
    app.get('/auth-check', (req, res) => {
      const authReq = req as express.Request & {
        authUser?: { uid: string; role: string }
        authSource?: string
      }
      res.json({
        user: authReq.authUser,
        source: authReq.authSource,
      })
    })

    const response = await request(app).get('/auth-check')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      user: expect.objectContaining({ uid: 'user-1', role: 'admin' }),
      source: 'api_key',
    })
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(mockPrisma.userApiKey.findUnique).toHaveBeenCalledWith({
      where: { tokenHash },
      select: expect.objectContaining({ userUid: true, user: expect.any(Object) }),
    })
    expect(mockPrisma.userApiKey.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'key-1', revokedAt: null }),
      })
    )
    expect(mockCache.get).not.toHaveBeenCalled()
    expect(mockCache.set).not.toHaveBeenCalled()
  })

  it('does not fall back to a valid cookie when an explicit bearer credential is invalid', async () => {
    const { token: validCookieToken } = await signToken('user', CURRENT_PASSWORD_HASH)
    const app = express()
    app.use((req, _res, next) => {
      req.headers.authorization = 'Bearer invalid-token'
      req.cookies = { hsf_token: validCookieToken }
      next()
    })
    app.use(authMiddleware)
    app.get('/auth-check', requireAuth, (_req, res) => res.json({ ok: true }))

    const response = await request(app).get('/auth-check')

    expect(response.status).toBe(401)
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('forwards API key database failures instead of treating the request as anonymous', async () => {
    const { token } = createApiKeyMaterial()
    mockPrisma.userApiKey.findUnique.mockRejectedValue(new Error('database unavailable'))

    const app = express()
    app.use(authMiddleware)
    app.get('/auth-check', (_req, res) => res.json({ ok: true }))
    app.use(
      (error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
        res.status(500).json({ error: error.message })
    )

    const response = await request(app).get('/auth-check').set('Authorization', `Bearer ${token}`)

    expect(response.status).toBe(500)
    expect(response.body.error).toBe('database unavailable')
  })
})
