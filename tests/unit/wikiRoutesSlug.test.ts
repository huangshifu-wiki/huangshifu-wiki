import express from 'express';
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(async (fn) => fn(mockPrisma)),
  wikiPage: {
    create: vi.fn(),
    update: vi.fn(),
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
}));

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
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

type TestUser = {
  uid: string;
  role: string;
  displayName: string;
};

async function createApp(authUser: TestUser | null) {
  const { registerWikiRoutes } = await import('../../src/server/routes/wiki.routes');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { authUser?: TestUser }).authUser = authUser ?? undefined;
    next();
  });
  registerWikiRoutes(app as unknown as express.Router);
  return app;
}

async function postJson(app: express.Express, path: string, body: unknown) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        resolve,
      );
      req.on('error', reject);
      req.write(JSON.stringify(body));
      req.end();
    });

    const responseBody = await new Promise<unknown>((resolve, reject) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        raw += chunk;
      });
      response.on('end', () => {
        if (!raw) {
          resolve(null);
          return;
        }

        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
      response.on('error', reject);
    });

    return {
      status: response.statusCode ?? 0,
      body: responseBody,
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

describe('wiki routes slug normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.wikiPage.create.mockImplementation(async ({ data }) => ({
      ...data,
      id: 'page_1',
      mainBranchId: null,
    }));
    mockPrisma.wikiRevision.create.mockResolvedValue({ id: 'revision_1' });
    mockPrisma.wikiBranch.create.mockResolvedValue({ id: 'branch_1' });
    mockPrisma.wikiPage.update.mockResolvedValue({});
  });

  it('canonicalizes created wiki page slugs before writing', async () => {
    const app = await createApp({ uid: 'user_1', role: 'user', displayName: 'Tester' });

    const response = await postJson(app, '/api/wiki', {
      title: 'Test Page',
      slug: ' Test/Page\\Name ',
      category: 'biography',
      content: 'Body',
      tags: [],
      relations: [],
      status: 'draft',
    });

    expect(response.status).toBe(201);
    expect(mockPrisma.wikiPage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        slug: 'test-page-name',
      }),
    }));
    expect(mockPrisma.wikiRevision.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        pageSlug: 'test-page-name',
        slug: 'test-page-name',
      }),
    }));
    expect(mockPrisma.wikiBranch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        pageSlug: 'test-page-name',
      }),
    }));
  });
});
