import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  wikiBranch: {
    findUnique: vi.fn(),
  },
  wikiRevision: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
}));

const mockCanViewWikiPage = vi.hoisted(() => vi.fn(() => true));

vi.mock('../../src/server/middleware/auth', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!(req as { authUser?: unknown }).authUser) {
      res.status(401).json({ error: '请先登录' });
      return;
    }
    next();
  },
  requireActiveUser: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  isAdminRole: (role: string | undefined) => role === 'admin' || role === 'super_admin',
}));

vi.mock('../../src/server/utils', () => ({
  prisma: mockPrisma,
  toWikiResponse: vi.fn((page) => page),
  buildWikiVisibilityWhere: vi.fn(() => ({})),
  canViewWikiPage: mockCanViewWikiPage,
  serializeRelations: vi.fn(() => []),
  normalizeWikiRelationListForWrite: vi.fn(() => []),
  serializeTags: vi.fn(() => []),
  normalizeWikiWriteStatus: vi.fn(() => 'draft'),
  recordBrowsingHistory: vi.fn(),
  toWikiBranchResponse: vi.fn((branch) => ({
    id: branch.id,
    pageSlug: branch.pageSlug,
    editorUid: branch.editorUid,
    editorName: branch.editorName,
    status: branch.status,
    latestRevisionId: branch.latestRevisionId,
    createdAt: branch.createdAt.toISOString(),
    updatedAt: branch.updatedAt.toISOString(),
    page: branch.page,
  })),
  toWikiPullRequestResponse: vi.fn((pullRequest) => pullRequest),
  hasTag: vi.fn(() => false),
  buildWikiRelationBundle: vi.fn(),
}));

type TestUser = {
  uid: string;
  role: string;
};

type TestResponse = {
  status: number;
  body: unknown;
};

function createBranch(overrides?: Record<string, unknown>) {
  return {
    id: 'branch_1',
    pageSlug: 'page-1',
    editorUid: 'author_uid',
    editorName: 'Author',
    status: 'pending_review',
    latestRevisionId: 'revision_1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    page: {
      slug: 'page-1',
      title: 'Page 1',
      category: 'biography',
      status: 'published',
      lastEditorUid: 'author_uid',
    },
    ...overrides,
  };
}

async function createApp(authUser: TestUser | null) {
  const { registerWikiRoutes } = await import('../../src/server/routes/wiki.routes');
  const app = express();
  app.use((req, _res, next) => {
    (req as express.Request & { authUser?: TestUser }).authUser = authUser ?? undefined;
    next();
  });
  registerWikiRoutes(app as unknown as express.Router);
  return app;
}

async function request(app: express.Express, path: string): Promise<TestResponse> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    return {
      status: response.status,
      body: await response.json(),
    };
  } finally {
    await new Promise<void>((resolve, reject) => {
      (server as Server).close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

describe('wiki branch routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanViewWikiPage.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks unrelated users from pending review branch details', async () => {
    mockPrisma.wikiBranch.findUnique.mockResolvedValueOnce(createBranch());
    const app = await createApp({ uid: 'other_uid', role: 'user' });

    const response = await request(app, '/api/wiki/branches/branch_1');

    expect(response).toEqual({ status: 403, body: { error: '无权访问该分支' } });
    expect(mockPrisma.wikiRevision.findUnique).not.toHaveBeenCalled();
  });

  it('blocks unrelated users from conflicted branch revision history', async () => {
    mockPrisma.wikiBranch.findUnique.mockResolvedValueOnce(createBranch({ status: 'conflict' }));
    const app = await createApp({ uid: 'other_uid', role: 'user' });

    const response = await request(app, '/api/wiki/branches/branch_1/revisions');

    expect(response).toEqual({ status: 403, body: { error: '无权查看修订历史' } });
    expect(mockPrisma.wikiRevision.findMany).not.toHaveBeenCalled();
  });
});
