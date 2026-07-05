import express from 'express'
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(async (input) =>
    Array.isArray(input) ? Promise.all(input) : input(mockPrisma)
  ),
  wikiPage: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  wikiCategory: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  wikiRevision: {
    create: vi.fn(),
  },
  wikiBranch: {
    create: vi.fn(),
  },
  moderationLog: {
    create: vi.fn(),
  },
}))

vi.mock('../../src/server/middleware/auth', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!(req as { authUser?: unknown }).authUser) {
      res.status(401).json({ error: '请先登录' })
      return
    }
    next()
  },
  requireActiveUser: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
  isAdminRole: (role: string | undefined) => role === 'admin' || role === 'super_admin',
}))

vi.mock('../../src/server/utils', () => ({
  prisma: mockPrisma,
  toWikiResponse: vi.fn((page) => page),
  toWikiListResponse: vi.fn((page) => page),
  buildWikiVisibilityWhere: vi.fn(() => ({})),
  canViewWikiPage: vi.fn(() => true),
  serializeRelations: vi.fn(() => []),
  normalizeWikiRelationListForWrite: vi.fn(() => []),
  serializeTags: vi.fn(() => []),
  normalizeWikiWriteStatus: vi.fn(() => 'draft'),
  recordBrowsingHistory: vi.fn(),
  toWikiBranchResponse: vi.fn((branch) => branch),
  toWikiPullRequestResponse: vi.fn((pullRequest) => pullRequest),
  hasTag: vi.fn(() => false),
  buildWikiRelationBundle: vi.fn(),
  clearWikiRelationCache: vi.fn(),
  allocateNumericSlug: vi.fn(async () => '1'),
  isNumericSlug: vi.fn((value) => /^[1-9]\d*$/.test(String(value))),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

type TestUser = {
  uid: string
  role: string
  displayName: string
}

async function createApp(authUser: TestUser | null) {
  const { registerWikiRoutes } = await import('../../src/server/routes/wiki.routes')
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    ;(req as express.Request & { authUser?: TestUser }).authUser = authUser ?? undefined
    next()
  })
  registerWikiRoutes(app as unknown as express.Router)
  return app
}

async function postJson(app: express.Express, path: string, body: unknown) {
  return requestJson(app, 'POST', path, body)
}

async function requestJson(
  app: express.Express,
  method: 'DELETE' | 'GET' | 'POST',
  path: string,
  body?: unknown
) {
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const { port } = server.address() as AddressInfo

  try {
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          headers: { 'Content-Type': 'application/json' },
        },
        resolve
      )
      req.on('error', reject)
      if (body !== undefined) {
        req.write(JSON.stringify(body))
      }
      req.end()
    })

    const responseBody = await new Promise<unknown>((resolve, reject) => {
      let raw = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        raw += chunk
      })
      response.on('end', () => {
        if (!raw) {
          resolve(null)
          return
        }

        try {
          resolve(JSON.parse(raw))
        } catch (error) {
          reject(error)
        }
      })
      response.on('error', reject)
    })

    return {
      status: response.statusCode ?? 0,
      body: responseBody,
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      ;(server as Server).close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }
}

describe('wiki routes slug normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.wikiPage.create.mockImplementation(async ({ data }) => ({
      ...data,
      id: 'page_1',
      mainBranchId: null,
    }))
    mockPrisma.wikiRevision.create.mockResolvedValue({ id: 'revision_1' })
    mockPrisma.wikiBranch.create.mockResolvedValue({ id: 'branch_1' })
    mockPrisma.wikiPage.findUnique.mockResolvedValue({
      slug: 'test-page',
      category: 'biography',
      lastEditorUid: 'user_1',
      status: 'draft',
    })
    mockPrisma.wikiPage.update.mockResolvedValue({})
    mockPrisma.wikiPage.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.wikiCategory.findFirst.mockResolvedValue({
      id: 'biography',
      name: '人物介绍',
      description: '',
      order: 10,
      requiresAdminEdit: false,
    })
    mockPrisma.wikiCategory.findMany.mockResolvedValue([])
  })

  it('uses the next numeric slug when creating wiki pages', async () => {
    const app = await createApp({ uid: 'user_1', role: 'user', displayName: 'Tester' })

    const response = await postJson(app, '/api/wiki', {
      title: 'Test Page',
      slug: ' Test/Page\\Name ',
      category: 'biography',
      content: 'Body',
      tags: [],
      relations: [],
      status: 'draft',
    })

    expect(response.status).toBe(201)
    expect(mockPrisma.wikiPage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: '1',
        }),
      })
    )
    expect(mockPrisma.wikiRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pageSlug: '1',
          slug: '1',
        }),
      })
    )
    expect(mockPrisma.wikiBranch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pageSlug: '1',
        }),
      })
    )
  })

  it('lists dynamic wiki categories', async () => {
    mockPrisma.wikiCategory.findMany.mockResolvedValue([
      {
        id: 'music',
        name: '音乐作品',
        description: '',
        order: 20,
        requiresAdminEdit: true,
      },
    ])
    const app = await createApp(null)

    const response = await requestJson(app, 'GET', '/api/wiki/categories')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      categories: [
        {
          id: 'music',
          name: '音乐作品',
          description: '',
          order: 20,
          requiresAdminEdit: true,
        },
      ],
    })
    expect(mockPrisma.wikiCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null },
      })
    )
  })

  it('rejects non-admin writes to admin-only wiki categories', async () => {
    mockPrisma.wikiCategory.findFirst.mockResolvedValue({
      id: 'music',
      name: '音乐作品',
      description: '',
      order: 20,
      requiresAdminEdit: true,
    })
    const app = await createApp({ uid: 'user_1', role: 'user', displayName: 'Tester' })

    const response = await postJson(app, '/api/wiki', {
      title: 'Music Page',
      slug: 'music-page',
      category: 'music',
      content: 'Body',
      tags: [],
      relations: [],
      status: 'draft',
    })

    expect(response.status).toBe(403)
    expect(response.body).toEqual({ error: '只有管理员可以编辑该分类内容' })
    expect(mockPrisma.wikiPage.create).not.toHaveBeenCalled()
  })

  it('rejects non-admin submit review for admin-only wiki categories', async () => {
    mockPrisma.wikiPage.findUnique.mockResolvedValue({
      slug: 'music-page',
      category: 'music',
      lastEditorUid: 'user_1',
      status: 'draft',
    })
    mockPrisma.wikiCategory.findFirst.mockResolvedValue({
      id: 'music',
      name: '音乐作品',
      description: '',
      order: 20,
      requiresAdminEdit: true,
    })
    const app = await createApp({ uid: 'user_1', role: 'user', displayName: 'Tester' })

    const response = await postJson(app, '/api/wiki/music-page/submit', {})

    expect(response.status).toBe(403)
    expect(response.body).toEqual({ error: '只有管理员可以编辑该分类内容' })
    expect(mockPrisma.wikiPage.update).not.toHaveBeenCalled()
    expect(mockPrisma.moderationLog.create).not.toHaveBeenCalled()
  })

  it('allows admin submit review for admin-only wiki categories', async () => {
    mockPrisma.wikiPage.findUnique.mockResolvedValue({
      slug: 'music-page',
      category: 'music',
      lastEditorUid: 'user_1',
      status: 'draft',
    })
    mockPrisma.wikiPage.update.mockResolvedValue({
      slug: 'music-page',
      category: 'music',
      status: 'published',
    })
    mockPrisma.wikiCategory.findFirst.mockResolvedValue({
      id: 'music',
      name: '音乐作品',
      description: '',
      order: 20,
      requiresAdminEdit: true,
    })
    const app = await createApp({ uid: 'admin_1', role: 'admin', displayName: 'Admin' })

    const response = await postJson(app, '/api/wiki/music-page/submit', {})

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      page: {
        slug: 'music-page',
        category: 'music',
        status: 'published',
      },
    })
    expect(mockPrisma.wikiPage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: 'music-page' },
        data: expect.objectContaining({ status: 'published' }),
      })
    )
  })

  it('supports the frontend POST route for pinning wiki pages', async () => {
    const app = await createApp({ uid: 'admin_1', role: 'admin', displayName: 'Admin' })

    const response = await requestJson(app, 'POST', '/api/wiki/test-page/pin')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ isPinned: true })
    expect(mockPrisma.wikiPage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: 'test-page' },
        data: { isPinned: true },
      })
    )
  })

  it('supports the frontend DELETE route for unpinning wiki pages', async () => {
    const app = await createApp({ uid: 'admin_1', role: 'admin', displayName: 'Admin' })

    const response = await requestJson(app, 'DELETE', '/api/wiki/test-page/pin')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ isPinned: false })
    expect(mockPrisma.wikiPage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: 'test-page' },
        data: { isPinned: false },
      })
    )
  })
})
