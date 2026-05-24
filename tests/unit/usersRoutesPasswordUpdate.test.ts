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
const mockCompare = vi.hoisted(() => vi.fn())
const mockIssueUserSession = vi.hoisted(() => vi.fn())
const mockIsBearerAuthRequest = vi.hoisted(() => vi.fn())

vi.mock('bcryptjs', () => ({
  default: {
    hash: mockHash,
    compare: mockCompare,
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
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  requireSuperAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  userToApiUser: vi.fn((user) => user),
  clearUserCache: mockClearUserCache,
  createToken: vi.fn(),
  setAuthCookie: vi.fn(),
  issueUserSession: mockIssueUserSession,
  isBearerAuthRequest: mockIsBearerAuthRequest,
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

describe('users routes password update', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHash.mockResolvedValue('hashed-new-password')
    mockCompare.mockResolvedValue(true)
    mockIssueUserSession.mockReturnValue({
      apiUser: {
        uid: 'user-1',
      },
      token: 'new-session-token',
    })
    mockIsBearerAuthRequest.mockReturnValue(false)
    mockPrisma.user.findUnique.mockResolvedValue({
      passwordHash: 'hashed-current-password',
    })
    mockPrisma.user.update.mockResolvedValue({
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
    })
  })

  async function createApp() {
    const { registerUsersRoutes } = await import('../../src/server/routes/users.routes')

    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
      ;(req as express.Request & { authUser?: { uid: string; role: string } }).authUser = {
        uid: 'user-1',
        role: 'user',
      }
      next()
    })
    registerUsersRoutes(app as unknown as express.Router)

    return app
  }

  it('clears auth cache and reissues current cookie session after updating own password', async () => {
    const app = await createApp()
    const response = await request(app)
      .put('/api/users/password')
      .send({
        currentPassword: 'CurrentPassword123!',
        newPassword: 'UpdatedPassword123!',
      })

    expect(response.status).toBe(200)
    expect(mockHash).toHaveBeenCalledWith('UpdatedPassword123!', 12)
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { uid: 'user-1' },
      data: { passwordHash: 'hashed-new-password' },
      select: {
        uid: true,
        email: true,
        displayName: true,
        photoURL: true,
        wechatOpenId: true,
        role: true,
        status: true,
        banReason: true,
        bannedAt: true,
        level: true,
        bio: true,
      },
    })
    expect(mockClearUserCache).toHaveBeenCalledWith('user-1')
    expect(mockIssueUserSession).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), expect.objectContaining({
      uid: 'user-1',
      passwordHash: 'hashed-new-password',
    }))
    expect(response.body).toEqual({ success: true })
  })

  it('returns a fresh bearer token when the password change request uses bearer auth', async () => {
    mockIsBearerAuthRequest.mockReturnValue(true)

    const app = await createApp()
    const response = await request(app)
      .put('/api/users/password')
      .send({
        currentPassword: 'CurrentPassword123!',
        newPassword: 'UpdatedPassword123!',
      })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      success: true,
      token: 'new-session-token',
    })
  })
})
