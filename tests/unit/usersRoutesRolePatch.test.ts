import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  user: {
    update: vi.fn(),
  },
}))

const mockClearUserCache = vi.hoisted(() => vi.fn())

vi.mock('../../src/server/middleware/auth', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!(req as express.Request & { authUser?: unknown }).authUser) {
      res.status(401).json({ error: '请先登录' })
      return
    }
    next()
  },
  requireActiveUser: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  requireSuperAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authUser = (req as express.Request & { authUser?: { role?: string } }).authUser
    if (!authUser) {
      res.status(401).json({ error: '请先登录' })
      return
    }
    if (authUser.role !== 'super_admin') {
      res.status(403).json({ error: '需要超级管理员权限' })
      return
    }
    next()
  },
  userToApiUser: vi.fn((user) => user),
  clearUserCache: mockClearUserCache,
}))

vi.mock('../../src/server/middleware/rateLimiter', () => ({
  profileLimiter: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}))

vi.mock('../../src/server/utils', () => ({
  prisma: mockPrisma,
  toUserResponse: vi.fn((user) => user),
  buildPostVisibilityWhere: vi.fn(() => ({})),
  toPostResponse: vi.fn((post) => post),
  toCommentResponse: vi.fn((comment) => comment),
  safeDeleteUploadFileByUrl: vi.fn(),
  parsePagination: vi.fn(() => ({ limit: 20, offset: 0 })),
  getPasswordSaltRounds: vi.fn(() => 12),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

describe('users routes role update compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.user.update.mockResolvedValue({
      uid: 'target-user',
      email: 'target@example.com',
      displayName: 'Target User',
      photoURL: null,
      role: 'admin',
      status: 'active',
      banReason: null,
      bannedAt: null,
      level: 1,
      bio: null,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    })
  })

  it('accepts PATCH /api/users/:userId/role for super admins', async () => {
    const { registerUsersRoutes } = await import('../../src/server/routes/users.routes')

    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
      ;(req as express.Request & { authUser?: { uid: string; role: string } }).authUser = {
        uid: 'super-admin',
        role: 'super_admin',
      }
      next()
    })
    registerUsersRoutes(app as unknown as express.Router)

    const response = await request(app)
      .patch('/api/users/target-user/role')
      .send({ role: 'admin' })

    expect(response.status).toBe(200)
    expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { uid: 'target-user' },
      data: { role: 'admin' },
    }))
    expect(mockClearUserCache).toHaveBeenCalledWith('target-user')
    expect(response.body.user.role).toBe('admin')
  })
})
