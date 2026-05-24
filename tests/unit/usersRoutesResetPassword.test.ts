import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}))

const mockClearUserCache = vi.hoisted(() => vi.fn())
const mockHash = vi.hoisted(() => vi.fn())

vi.mock('bcryptjs', () => ({
  default: {
    hash: mockHash,
    compare: vi.fn(),
  },
}))

vi.mock('../../src/server/middleware/auth', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!(req as express.Request & { authUser?: unknown }).authUser) {
      res.status(401).json({ error: '请先登录' })
      return
    }
    next()
  },
  requireActiveUser: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authUser = (req as express.Request & { authUser?: { role?: string } }).authUser
    if (!authUser) {
      res.status(401).json({ error: '请先登录' })
      return
    }
    if (!['admin', 'super_admin'].includes(authUser.role || '')) {
      res.status(403).json({ error: '需要管理员权限' })
      return
    }
    next()
  },
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

vi.mock('../../src/server/utils', async () => {
  const actual = await vi.importActual<typeof import('../../src/server/utils')>('../../src/server/utils')

  return {
    ...actual,
    prisma: mockPrisma,
    toUserResponse: vi.fn((user) => user),
    buildPostVisibilityWhere: vi.fn(() => ({})),
    toPostResponse: vi.fn((post) => post),
    toCommentResponse: vi.fn((comment) => comment),
    safeDeleteUploadFileByUrl: vi.fn(),
    parsePagination: vi.fn(() => ({ limit: 20, offset: 0 })),
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  }
})

describe('users routes reset password', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHash.mockResolvedValue('hashed-password')
  })

  async function createApp(authUser: { uid: string; role: string }) {
    const { registerUsersRoutes } = await import('../../src/server/routes/users.routes')

    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
      ;(req as express.Request & { authUser?: { uid: string; role: string } }).authUser = authUser
      next()
    })
    registerUsersRoutes(app as unknown as express.Router)

    return app
  }

  it('allows admin to reset a regular user password', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      uid: 'target-user',
      role: 'user',
    })
    mockPrisma.user.update.mockResolvedValue({ uid: 'target-user' })

    const app = await createApp({ uid: 'admin-1', role: 'admin' })
    const response = await request(app)
      .put('/api/users/target-user/reset-password')
      .send({ newPassword: 'NewPassword123!' })

    expect(response.status).toBe(200)
    expect(mockHash).toHaveBeenCalledWith('NewPassword123!', 12)
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { uid: 'target-user' },
      data: { passwordHash: 'hashed-password' },
    })
    expect(mockClearUserCache).toHaveBeenCalledWith('target-user')
    expect(response.body).toEqual({ success: true })
  })

  it('blocks admin from resetting another admin password', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      uid: 'target-admin',
      role: 'admin',
    })

    const app = await createApp({ uid: 'admin-1', role: 'admin' })
    const response = await request(app)
      .put('/api/users/target-admin/reset-password')
      .send({ newPassword: 'NewPassword123!' })

    expect(response.status).toBe(403)
    expect(response.body.error).toBe('只能重置普通用户的密码')
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it('allows super admin to reset another admin password', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      uid: 'target-admin',
      role: 'admin',
    })
    mockPrisma.user.update.mockResolvedValue({ uid: 'target-admin' })

    const app = await createApp({ uid: 'super-admin', role: 'super_admin' })
    const response = await request(app)
      .put('/api/users/target-admin/reset-password')
      .send({ newPassword: 'NewPassword123!' })

    expect(response.status).toBe(200)
    expect(mockPrisma.user.update).toHaveBeenCalled()
  })

  it('allows super admin to reset another super admin password', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      uid: 'peer-super-admin',
      role: 'super_admin',
    })
    mockPrisma.user.update.mockResolvedValue({ uid: 'peer-super-admin' })

    const app = await createApp({ uid: 'root-super-admin', role: 'super_admin' })
    const response = await request(app)
      .put('/api/users/peer-super-admin/reset-password')
      .send({ newPassword: 'NewPassword123!' })

    expect(response.status).toBe(200)
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { uid: 'peer-super-admin' },
      data: { passwordHash: 'hashed-password' },
    })
    expect(mockClearUserCache).toHaveBeenCalledWith('peer-super-admin')
  })

  it('rejects invalid password payloads', async () => {
    const app = await createApp({ uid: 'admin-1', role: 'admin' })
    const response = await request(app)
      .put('/api/users/target-user/reset-password')
      .send({ newPassword: 'short' })

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      error: 'Validation failed',
      fields: {
        newPassword: '密码至少8个字符',
      },
    })
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('rejects resetting own password from admin route', async () => {
    const app = await createApp({ uid: 'admin-1', role: 'super_admin' })
    const response = await request(app)
      .put('/api/users/admin-1/reset-password')
      .send({ newPassword: 'NewPassword123!' })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('不能重置自己的密码')
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
  })
})
