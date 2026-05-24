import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
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

describe('auth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCache.get.mockReturnValue(undefined)
  })

  it('rejects stale session tokens after password hash changes', async () => {
    const { authMiddleware } = await import('../../src/server/middleware/auth')
    const { createSessionVersion } = await import('../../src/server/utils/auth-session')
    const app = express()
    const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_replace_with_random_string'

    mockPrisma.user.findUnique.mockResolvedValue({
      uid: 'user-1',
      email: 'user@example.com',
      displayName: 'User One',
      photoURL: null,
      wechatOpenId: null,
      role: 'user',
      status: 'active',
      banReason: null,
      bannedAt: null,
      level: 1,
      bio: '',
      passwordHash: 'new-password-hash',
    })

    const staleToken = jwt.sign(
      {
        uid: 'user-1',
        role: 'user',
        sessionVersion: createSessionVersion('old-password-hash'),
      },
      JWT_SECRET,
      { expiresIn: '7d' },
    )

    app.use((req, _res, next) => {
      req.headers.authorization = `Bearer ${staleToken}`
      next()
    })
    app.use(authMiddleware)
    app.get('/auth-check', (req, res) => {
      res.json({
        hasUser: Boolean((req as express.Request & { authUser?: unknown }).authUser),
      })
    })

    const response = await request(app).get('/auth-check')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ hasUser: false })
    expect(mockLogger.info).toHaveBeenCalledWith({ uid: 'user-1' }, 'Rejecting token with stale session version')
    expect(mockCache.set).not.toHaveBeenCalled()
  })

  it('rejects stale session tokens even when auth user cache is populated', async () => {
    const { authMiddleware } = await import('../../src/server/middleware/auth')
    const { createSessionVersion } = await import('../../src/server/utils/auth-session')
    const app = express()
    const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_replace_with_random_string'

    mockCache.get.mockReturnValue({
      apiUser: {
        uid: 'user-1',
        email: 'user@example.com',
        displayName: 'User One',
        photoURL: null,
        wechatBound: false,
        role: 'user',
        status: 'active',
        banReason: null,
        bannedAt: null,
        level: 1,
        bio: '',
      },
      sessionVersion: createSessionVersion('new-password-hash'),
    })

    const staleToken = jwt.sign(
      {
        uid: 'user-1',
        role: 'user',
        sessionVersion: createSessionVersion('old-password-hash'),
      },
      JWT_SECRET,
      { expiresIn: '7d' },
    )

    app.use((req, _res, next) => {
      req.headers.authorization = `Bearer ${staleToken}`
      next()
    })
    app.use(authMiddleware)
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
})
