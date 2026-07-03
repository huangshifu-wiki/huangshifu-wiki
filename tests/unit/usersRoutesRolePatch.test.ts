import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type TestUserRole = 'user' | 'admin' | 'super_admin'

const SUPER_ADMIN_UID = 'super-admin'
const TARGET_USER_UID = 'target-user'
const CURRENT_PASSWORD = 'CurrentPassword123!'
const HASHED_CURRENT_PASSWORD = 'hashed-current-password'

const mockPrisma = vi.hoisted(() => ({
  user: {
    count: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}))

const mockClearUserCache = vi.hoisted(() => vi.fn())
const mockBcryptCompare = vi.hoisted(() => vi.fn())
const mockAllowSuperAdminManageSuperAdmins = vi.hoisted(() => ({ value: false }))
const mockTargetRole = vi.hoisted(() => ({ value: 'user' as TestUserRole }))
const mockOperatorPasswordHash = vi.hoisted(() => ({
  value: 'hashed-current-password' as string | null,
}))

vi.mock('bcryptjs', () => ({
  default: {
    compare: mockBcryptCompare,
    hash: vi.fn(),
  },
  compare: mockBcryptCompare,
  hash: vi.fn(),
}))

vi.mock('../../src/server/middleware/auth', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!(req as express.Request & { authUser?: unknown }).authUser) {
      res.status(401).json({ error: '请先登录' })
      return
    }
    next()
  },
  requireActiveUser: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
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
  profileLimiter: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}))

vi.mock('../../src/server/utils', () => ({
  prisma: mockPrisma,
  get ALLOW_SUPER_ADMIN_MANAGE_SUPER_ADMINS() {
    return mockAllowSuperAdminManageSuperAdmins.value
  },
  toUserResponse: vi.fn((user) => user),
  buildPostVisibilityWhere: vi.fn(() => ({})),
  toPostResponse: vi.fn((post) => post),
  toCommentResponse: vi.fn((comment) => comment),
  safeDeleteUploadFileByUrl: vi.fn(),
  parsePagination: vi.fn(() => ({ limit: 20, offset: 0 })),
  getPasswordSaltRounds: vi.fn(() => 12),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

async function createApp(
  authUser: { uid: string; role: string } = {
    uid: SUPER_ADMIN_UID,
    role: 'super_admin',
  }
) {
  vi.resetModules()
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

const buildAdminUser = (overrides: Record<string, unknown> = {}) => ({
  uid: TARGET_USER_UID,
  email: 'target@example.com',
  displayName: 'Target User',
  photoURL: null,
  role: 'admin',
  status: 'active',
  banReason: null,
  bannedAt: null,
  level: 1,
  signature: '',
  bio: null,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-02T00:00:00.000Z'),
  ...overrides,
})

describe('users routes role update compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAllowSuperAdminManageSuperAdmins.value = false
    mockTargetRole.value = 'user'
    mockOperatorPasswordHash.value = HASHED_CURRENT_PASSWORD
    mockBcryptCompare.mockResolvedValue(true)
    mockPrisma.user.findUnique.mockImplementation(async ({ where, select }) => {
      if (where.uid === SUPER_ADMIN_UID) {
        return { passwordHash: mockOperatorPasswordHash.value }
      }
      if (select?.deletedAt) {
        return { uid: where.uid, role: mockTargetRole.value, deletedAt: null }
      }
      return buildAdminUser({ uid: where.uid, role: mockTargetRole.value })
    })
    mockPrisma.user.count.mockResolvedValue(1)
    mockPrisma.user.update.mockResolvedValue(buildAdminUser())
  })

  it('accepts PATCH /api/users/:userId/role for super admins', async () => {
    const app = await createApp()

    const response = await request(app)
      .patch(`/api/users/${TARGET_USER_UID}/role`)
      .send({ role: 'admin' })

    expect(response.status).toBe(200)
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { uid: TARGET_USER_UID },
        data: { role: 'admin' },
      })
    )
    expect(mockClearUserCache).toHaveBeenCalledWith(TARGET_USER_UID)
    expect(response.body.user.role).toBe('admin')
  })

  it('requires and validates the operator password when promoting to super admin', async () => {
    mockAllowSuperAdminManageSuperAdmins.value = true
    const app = await createApp()

    const missingPasswordResponse = await request(app)
      .put(`/api/users/${TARGET_USER_UID}/role`)
      .send({ role: 'super_admin' })
    expect(missingPasswordResponse.status).toBe(400)
    expect(mockPrisma.user.update).not.toHaveBeenCalled()

    mockBcryptCompare.mockResolvedValueOnce(false)
    const wrongPasswordResponse = await request(app)
      .put(`/api/users/${TARGET_USER_UID}/role`)
      .send({ role: 'super_admin', currentPassword: 'wrong-password' })
    expect(wrongPasswordResponse.status).toBe(401)
    expect(mockPrisma.user.update).not.toHaveBeenCalled()

    mockBcryptCompare.mockResolvedValueOnce(true)
    const response = await request(app)
      .put(`/api/users/${TARGET_USER_UID}/role`)
      .send({ role: 'super_admin', currentPassword: CURRENT_PASSWORD })

    expect(response.status).toBe(200)
    expect(mockBcryptCompare).toHaveBeenLastCalledWith(CURRENT_PASSWORD, HASHED_CURRENT_PASSWORD)
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { uid: TARGET_USER_UID },
        data: { role: 'super_admin' },
      })
    )
  })

  it('rejects promoting a user to super admin when the environment switch is false', async () => {
    const app = await createApp()

    const response = await request(app)
      .put(`/api/users/${TARGET_USER_UID}/role`)
      .send({ role: 'super_admin', currentPassword: CURRENT_PASSWORD })

    expect(response.status).toBe(403)
    expect(response.body.error).toBe('当前配置不允许变更超级管理员身份')
    expect(mockBcryptCompare).not.toHaveBeenCalled()
    expect(mockPrisma.user.count).not.toHaveBeenCalled()
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it('rejects changing the current user role', async () => {
    const app = await createApp()

    const response = await request(app)
      .patch(`/api/users/${SUPER_ADMIN_UID}/role`)
      .send({ role: 'admin', currentPassword: CURRENT_PASSWORD })

    expect(response.status).toBe(400)
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it('keeps at least one active super admin when demoting a super admin', async () => {
    mockAllowSuperAdminManageSuperAdmins.value = true
    mockTargetRole.value = 'super_admin'
    mockPrisma.user.count.mockResolvedValueOnce(0)
    const app = await createApp()

    const response = await request(app)
      .patch(`/api/users/${TARGET_USER_UID}/role`)
      .send({ role: 'admin', currentPassword: CURRENT_PASSWORD })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('至少需要保留一名超级管理员')
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it('rejects demoting another super admin by default before password and count checks', async () => {
    mockTargetRole.value = 'super_admin'
    const app = await createApp()

    const response = await request(app)
      .patch(`/api/users/${TARGET_USER_UID}/role`)
      .send({ role: 'admin', currentPassword: CURRENT_PASSWORD })

    expect(response.status).toBe(403)
    expect(response.body.error).toBe('当前配置不允许变更超级管理员身份')
    expect(mockBcryptCompare).not.toHaveBeenCalled()
    expect(mockPrisma.user.count).not.toHaveBeenCalled()
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it('allows demoting another super admin when the environment switch is true', async () => {
    mockAllowSuperAdminManageSuperAdmins.value = true
    mockTargetRole.value = 'super_admin'
    const app = await createApp()

    const response = await request(app)
      .patch(`/api/users/${TARGET_USER_UID}/role`)
      .send({ role: 'admin', currentPassword: CURRENT_PASSWORD })

    expect(response.status).toBe(200)
    expect(mockPrisma.user.count).toHaveBeenCalledWith({
      where: {
        role: 'super_admin',
        status: 'active',
        deletedAt: null,
        uid: { not: TARGET_USER_UID },
      },
    })
    expect(mockBcryptCompare).toHaveBeenCalledWith(CURRENT_PASSWORD, HASHED_CURRENT_PASSWORD)
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { uid: TARGET_USER_UID },
        data: { role: 'admin' },
      })
    )
  })

  it('does not allow demoting a super admin directly to regular user', async () => {
    mockAllowSuperAdminManageSuperAdmins.value = true
    mockTargetRole.value = 'super_admin'
    const app = await createApp()

    const response = await request(app)
      .patch(`/api/users/${TARGET_USER_UID}/role`)
      .send({ role: 'user', currentPassword: CURRENT_PASSWORD })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('超级管理员只能降为管理员')
    expect(mockBcryptCompare).not.toHaveBeenCalled()
    expect(mockPrisma.user.count).not.toHaveBeenCalled()
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it('rejects invalid role request bodies before hitting database updates', async () => {
    mockAllowSuperAdminManageSuperAdmins.value = true
    const app = await createApp()

    const response = await request(app).patch(`/api/users/${TARGET_USER_UID}/role`).send({
      role: 'super_admin',
      currentPassword: 123,
    })

    expect(response.status).toBe(400)
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it('returns a clear error when the operator has no local password', async () => {
    mockAllowSuperAdminManageSuperAdmins.value = true
    mockOperatorPasswordHash.value = null
    const app = await createApp()

    const response = await request(app)
      .patch(`/api/users/${TARGET_USER_UID}/role`)
      .send({ role: 'super_admin', currentPassword: CURRENT_PASSWORD })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('当前账户未设置密码，请先在个人设置中设置登录密码')
    expect(mockBcryptCompare).not.toHaveBeenCalled()
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it('does not update the database when the target already has the requested role', async () => {
    mockTargetRole.value = 'admin'
    const app = await createApp()

    const response = await request(app)
      .patch(`/api/users/${TARGET_USER_UID}/role`)
      .send({ role: 'admin' })

    expect(response.status).toBe(200)
    expect(response.body.user.role).toBe('admin')
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
    expect(mockClearUserCache).not.toHaveBeenCalled()
  })

  it('rejects role updates from regular admins', async () => {
    const app = await createApp({
      uid: 'admin-user',
      role: 'admin',
    })

    const response = await request(app)
      .patch(`/api/users/${TARGET_USER_UID}/role`)
      .send({ role: 'admin' })

    expect(response.status).toBe(403)
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })
})
