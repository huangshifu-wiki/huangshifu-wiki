import { Prisma } from '@prisma/client';
import { Router, type Response } from 'express';
import { requireAuth, requireActiveUser, requireAdmin, isAdminRole } from '../middleware/auth';
import {
  prisma,
  toWikiResponse,
  buildWikiVisibilityWhere,
  canViewWikiPage,
  serializeRelations,
  normalizeWikiRelationListForWrite,
  serializeTags,
  normalizeWikiWriteStatus,
  recordBrowsingHistory,
  toWikiBranchResponse,
  toWikiPullRequestResponse,
  hasTag,
  buildWikiRelationBundle,
} from '../utils';
import type {
  AuthenticatedRequest,
  ContentStatus,
  WikiBranchStatus,
  WikiPullRequestStatus,
  WikiBranchWithPage,
  WikiPullRequestWithRelations,
} from '../types';
import { buildWikiBacklinkSearchTerms } from '../../lib/wikiLinkParser';
import { getWikiUniqueConflictMessage, normalizeWikiTitleKey } from '../wiki/wikiTitleKey';
import { canViewWikiBranchContent } from '../wiki/wikiBranchAccess';

const router = Router();

function sendWikiUniqueConflict(error: unknown, res: Response) {
  const message = getWikiUniqueConflictMessage(error);
  if (!message) {
    return false;
  }

  res.status(409).json({ error: message });
  return true;
}

router.get('/', async (req: AuthenticatedRequest, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const category = typeof req.query.category === 'string' ? req.query.category : 'all';
    const tag = typeof req.query.tag === 'string' ? req.query.tag.trim() : '';
    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 24, 1), 100);
    const visibilityWhere = buildWikiVisibilityWhere(req.authUser);
    const where: Prisma.WikiPageWhereInput = {
      ...(category && category !== 'all' ? { category } : {}),
      ...visibilityWhere,
    };

    let visiblePages: Awaited<ReturnType<typeof prisma.wikiPage.findMany>>;
    let total: number;

    if (tag) {
      // tag 存储在 JSON 中，需要 JS 侧过滤后再分页
      const allPages = await prisma.wikiPage.findMany({
        where,
        orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }],
        take: 500,
      });
      const filtered = allPages.filter((p) => hasTag(p.tags, tag));
      total = filtered.length;
      const skip = (page - 1) * pageSize;
      visiblePages = filtered.slice(skip, skip + pageSize);
    } else {
      const [dbPages, count] = await Promise.all([
        prisma.wikiPage.findMany({
          where,
          orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }],
          take: pageSize,
          skip: (page - 1) * pageSize,
        }),
        prisma.wikiPage.count({ where }),
      ]);
      visiblePages = dbPages;
      total = count;
    }

    const favoritedWikiSet = new Set<string>();
    const likedWikiSet = new Set<string>();
    const dislikedWikiSet = new Set<string>();

    if (req.authUser && visiblePages.length) {
      const [favorites, likes, dislikes] = await Promise.all([
        prisma.favorite.findMany({
          where: {
            userUid: req.authUser.uid,
            targetType: 'wiki',
            targetId: { in: visiblePages.map((item) => item.slug) },
          },
          select: { targetId: true },
        }),
        prisma.wikiLike.findMany({
          where: {
            userUid: req.authUser.uid,
            pageSlug: { in: visiblePages.map((item) => item.slug) },
          },
          select: { pageSlug: true },
        }),
        prisma.wikiDislike.findMany({
          where: {
            userUid: req.authUser.uid,
            pageSlug: { in: visiblePages.map((item) => item.slug) },
          },
          select: { pageSlug: true },
        }),
      ]);
      favorites.forEach((item) => favoritedWikiSet.add(item.targetId));
      likes.forEach((item) => likedWikiSet.add(item.pageSlug));
      dislikes.forEach((item) => dislikedWikiSet.add(item.pageSlug));
    }

    res.json({
      pages: visiblePages.map((page) => ({
        ...toWikiResponse(page),
        favoritedByMe: favoritedWikiSet.has(page.slug),
        likedByMe: likedWikiSet.has(page.slug),
        dislikedByMe: dislikedWikiSet.has(page.slug),
      })),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('Fetch wiki pages error:', error);
    res.status(500).json({ error: '获取百科失败' });
  }
});

const mpWikiRouter = Router();

mpWikiRouter.get('/', async (req: AuthenticatedRequest, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const category = typeof req.query.category === 'string' ? req.query.category : 'all';
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    const where = {
      status: 'published' as ContentStatus,
      ...(category && category !== 'all' ? { category } : {}),
    };

    const [pages, total] = await Promise.all([
      prisma.wikiPage.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        take: limit,
        skip,
        select: {
          slug: true,
          title: true,
          category: true,
          tags: true,
          eventDate: true,
          updatedAt: true,
          favoritesCount: true,
        },
      }),
      prisma.wikiPage.count({ where }),
    ]);

    res.json({
      items: pages.map((page) => ({
        slug: page.slug,
        title: page.title,
        category: page.category,
        tags: serializeTags(page.tags),
        eventDate: page.eventDate,
        favoritesCount: page.favoritesCount,
        updatedAt: page.updatedAt.toISOString(),
      })),
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error('Fetch mp wiki list error:', error);
    res.status(500).json({ error: '获取小程序百科失败' });
  }
});

router.get('/timeline', async (req: AuthenticatedRequest, res) => {
  try {
    const pages = await prisma.wikiPage.findMany({
      where: {
        ...buildWikiVisibilityWhere(req.authUser),
        eventDate: {
          not: null,
        },
      },
      orderBy: {
        eventDate: 'asc',
      },
    });

    const favoritedWikiSet = new Set<string>();
    if (req.authUser && pages.length) {
      const favorites = await prisma.favorite.findMany({
        where: {
          userUid: req.authUser.uid,
          targetType: 'wiki',
          targetId: { in: pages.map((item) => item.slug) },
        },
        select: { targetId: true },
      });
      favorites.forEach((item) => favoritedWikiSet.add(item.targetId));
    }

    res.json({
      events: pages.map((page) => ({
        ...toWikiResponse(page),
        favoritedByMe: favoritedWikiSet.has(page.slug),
      })),
    });
  } catch (error) {
    console.error('Fetch wiki timeline error:', error);
    res.status(500).json({ error: '获取时间轴失败' });
  }
});

router.get('/recommended', async (req: AuthenticatedRequest, res) => {
  try {
    const slug = typeof req.query.slug === 'string' ? req.query.slug.trim() : '';
    const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 24);

    const visibilityWhere = buildWikiVisibilityWhere(req.authUser);

    const basePage = slug
      ? await prisma.wikiPage.findUnique({
          where: { slug },
          select: {
            slug: true,
            category: true,
            tags: true,
            status: true,
            lastEditorUid: true,
          },
        })
      : null;

    if (basePage && !canViewWikiPage(basePage, req.authUser)) {
      res.status(404).json({ error: '页面未找到' });
      return;
    }

    const candidates = await prisma.wikiPage.findMany({
      where: {
        ...visibilityWhere,
        ...(slug ? { slug: { not: slug } } : {}),
      },
      orderBy: [{ favoritesCount: 'desc' }, { viewCount: 'desc' }, { updatedAt: 'desc' }],
      take: 120,
    });

    const baseTags = new Set<string>(serializeTags(basePage?.tags).map((item) => String(item).toLowerCase()));

    const scored = candidates.map((item) => {
      let score = item.favoritesCount * 3 + (item.viewCount ?? 0) * 0.35;
      if (basePage && item.category === basePage.category) {
        score += 2;
      }

      if (baseTags.size) {
        const tags = serializeTags(item.tags).map((tag) => String(tag).toLowerCase());
        const sharedCount = tags.filter((tag) => baseTags.has(tag)).length;
        score += sharedCount * 0.8;
      }

      const hoursSince = Math.max(0, (Date.now() - item.updatedAt.getTime()) / (1000 * 60 * 60));
      score += 3 / (1 + (hoursSince / 48));

      return {
        item,
        score: Number(score.toFixed(3)),
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);

    const favoritedWikiSet = new Set<string>();
    if (req.authUser && top.length) {
      const favorites = await prisma.favorite.findMany({
        where: {
          userUid: req.authUser.uid,
          targetType: 'wiki',
          targetId: { in: top.map((entry) => entry.item.slug) },
        },
        select: { targetId: true },
      });
      favorites.forEach((favorite) => favoritedWikiSet.add(favorite.targetId));
    }

    res.json({
      items: top.map((entry) => ({
        ...toWikiResponse(entry.item),
        score: entry.score,
        favoritedByMe: favoritedWikiSet.has(entry.item.slug),
      })),
    });
  } catch (error) {
    console.error('Fetch wiki recommended error:', error);
    res.status(500).json({ error: '获取推荐百科失败' });
  }
});

router.get('/:slug', async (req: AuthenticatedRequest, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const page = await prisma.wikiPage.findUnique({
      where: { slug: req.params.slug },
      include: { lastEditor: { select: { displayName: true } } },
    });

    if (!page || !canViewWikiPage(page, req.authUser)) {
      res.status(404).json({ error: '页面未找到' });
      return;
    }

    await prisma.$executeRaw`UPDATE "WikiPage" SET "viewCount" = "viewCount" + 1 WHERE "slug" = ${req.params.slug}`;
    const freshPage = await prisma.wikiPage.findUnique({
      where: { slug: req.params.slug },
      include: { lastEditor: { select: { displayName: true } } },
    });

    if (!freshPage) {
      res.status(404).json({ error: '页面未找到' });
      return;
    }

    if (req.authUser) {
      await recordBrowsingHistory(req.authUser.uid, 'wiki', req.params.slug);
    }

    const backlinkSearchTerms = buildWikiBacklinkSearchTerms(req.params.slug);
    const backlinks = await prisma.wikiPage.findMany({
      where: {
        ...buildWikiVisibilityWhere(req.authUser),
        slug: { not: req.params.slug },
        AND: [
          {
            OR: backlinkSearchTerms.map((term) => ({
              content: { contains: term },
            })),
          },
        ],
      },
      take: 100,
      orderBy: { updatedAt: 'desc' },
    });

    const relationBundle = await buildWikiRelationBundle(
      {
        slug: freshPage.slug,
        title: freshPage.title,
        category: freshPage.category,
        status: freshPage.status,
        lastEditorUid: freshPage.lastEditorUid,
        relations: freshPage.relations,
      },
      req.authUser,
    );

    const favoritedByMe = req.authUser
      ? (await prisma.favorite.count({
          where: {
            userUid: req.authUser.uid,
            targetType: 'wiki',
            targetId: req.params.slug,
          },
        })) > 0
      : false;

    const likedByMe = req.authUser
      ? (await prisma.wikiLike.count({
          where: {
            userUid: req.authUser.uid,
            pageSlug: req.params.slug,
          },
        })) > 0
      : false;

    const dislikedByMe = req.authUser
      ? (await prisma.wikiDislike.count({
          where: {
            userUid: req.authUser.uid,
            pageSlug: req.params.slug,
          },
        })) > 0
      : false;

    res.json({
      page: {
        ...toWikiResponse(freshPage),
        favoritedByMe,
        likedByMe,
        dislikedByMe,
      },
      backlinks: backlinks.map(toWikiResponse),
      relations: relationBundle.relations,
      relationGraph: relationBundle.graph,
    });
  } catch (error) {
    console.error('Fetch wiki page error:', error);
    res.status(500).json({ error: '获取页面失败' });
  }
});

router.post('/:slug/like', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const slug = req.params.slug;
    const page = await prisma.wikiPage.findUnique({
      where: { slug },
      select: {
        slug: true,
        status: true,
        lastEditorUid: true,
      },
    });

    if (!page || !canViewWikiPage(page, req.authUser)) {
      res.status(404).json({ error: '页面未找到' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.wikiDislike.deleteMany({
        where: { pageSlug: slug, userUid: req.authUser!.uid },
      });

      try {
        await tx.wikiLike.create({
          data: {
            pageSlug: slug,
            userUid: req.authUser!.uid,
          },
        });
      } catch {
        // already liked
      }

      const [likesCount, dislikesCount] = await Promise.all([
        tx.wikiLike.count({ where: { pageSlug: slug } }),
        tx.wikiDislike.count({ where: { pageSlug: slug } }),
      ]);

      await tx.wikiPage.update({
        where: { slug },
        data: { likesCount, dislikesCount },
      });
    });

    const [likesCount, dislikesCount] = await Promise.all([
      prisma.wikiLike.count({ where: { pageSlug: slug } }),
      prisma.wikiDislike.count({ where: { pageSlug: slug } }),
    ]);

    res.json({ liked: true, likesCount, dislikesCount });
  } catch (error) {
    console.error('Like wiki page error:', error);
    res.status(500).json({ error: '点赞失败' });
  }
});

router.delete('/:slug/like', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const slug = req.params.slug;

    await prisma.$transaction(async (tx) => {
      const deleted = await tx.wikiLike.deleteMany({
        where: {
          pageSlug: slug,
          userUid: req.authUser!.uid,
        },
      });

      if (!deleted.count) {
        return;
      }

      await tx.wikiPage.update({
        where: { slug },
        data: {
          likesCount: { decrement: 1 },
        },
      });
    });

    const likesCount = await prisma.wikiLike.count({ where: { pageSlug: slug } });

    res.json({ liked: false, likesCount });
  } catch (error) {
    console.error('Unlike wiki page error:', error);
    res.status(500).json({ error: '取消点赞失败' });
  }
});

router.post('/:slug/dislike', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const slug = req.params.slug;
    const page = await prisma.wikiPage.findUnique({
      where: { slug },
      select: {
        slug: true,
        status: true,
        lastEditorUid: true,
      },
    });

    if (!page || !canViewWikiPage(page, req.authUser)) {
      res.status(404).json({ error: '页面未找到' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.wikiLike.deleteMany({
        where: { pageSlug: slug, userUid: req.authUser!.uid },
      });

      try {
        await tx.wikiDislike.create({
          data: {
            pageSlug: slug,
            userUid: req.authUser!.uid,
          },
        });
      } catch {
        // already disliked
      }

      const [likesCount, dislikesCount] = await Promise.all([
        tx.wikiLike.count({ where: { pageSlug: slug } }),
        tx.wikiDislike.count({ where: { pageSlug: slug } }),
      ]);

      await tx.wikiPage.update({
        where: { slug },
        data: { likesCount, dislikesCount },
      });
    });

    const [likesCount, dislikesCount] = await Promise.all([
      prisma.wikiLike.count({ where: { pageSlug: slug } }),
      prisma.wikiDislike.count({ where: { pageSlug: slug } }),
    ]);

    res.json({ disliked: true, dislikesCount, likesCount });
  } catch (error) {
    console.error('Dislike wiki page error:', error);
    res.status(500).json({ error: '踩失败' });
  }
});

router.delete('/:slug/dislike', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const slug = req.params.slug;

    await prisma.$transaction(async (tx) => {
      const deleted = await tx.wikiDislike.deleteMany({
        where: {
          pageSlug: slug,
          userUid: req.authUser!.uid,
        },
      });

      if (!deleted.count) {
        return;
      }

      await tx.wikiPage.update({
        where: { slug },
        data: {
          dislikesCount: { decrement: 1 },
        },
      });
    });

    const dislikesCount = await prisma.wikiDislike.count({ where: { pageSlug: slug } });

    res.json({ disliked: false, dislikesCount });
  } catch (error) {
    console.error('Undislike wiki page error:', error);
    res.status(500).json({ error: '取消踩失败' });
  }
});

router.post('/:slug/pin', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const slug = req.params.slug;

    const page = await prisma.wikiPage.findUnique({
      where: { slug },
      select: { slug: true, isPinned: true },
    });

    if (!page) {
      res.status(404).json({ error: '页面未找到' });
      return;
    }

    const updatedPage = await prisma.wikiPage.update({
      where: { slug },
      data: { isPinned: true },
    });

    res.json({ isPinned: updatedPage.isPinned });
  } catch (error) {
    console.error('Pin wiki page error:', error);
    res.status(500).json({ error: '置顶页面失败' });
  }
});

router.delete('/:slug/pin', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const slug = req.params.slug;

    const page = await prisma.wikiPage.findUnique({
      where: { slug },
      select: { slug: true, isPinned: true },
    });

    if (!page) {
      res.status(404).json({ error: '页面未找到' });
      return;
    }

    const updatedPage = await prisma.wikiPage.update({
      where: { slug },
      data: { isPinned: false },
    });

    res.json({ isPinned: updatedPage.isPinned });
  } catch (error) {
    console.error('Unpin wiki page error:', error);
    res.status(500).json({ error: '取消置顶失败' });
  }
});

router.get('/:slug/history', async (req: AuthenticatedRequest, res) => {
  try {
    const page = await prisma.wikiPage.findUnique({
      where: { slug: req.params.slug },
      select: {
        slug: true,
        status: true,
        lastEditorUid: true,
      },
    });

    if (!page) {
      res.status(404).json({ error: '页面未找到' });
      return;
    }

    if (!canViewWikiPage(page, req.authUser)) {
      res.status(404).json({ error: '页面未找到' });
      return;
    }

    const revisions = await prisma.wikiRevision.findMany({
      where: { pageSlug: req.params.slug },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      revisions: revisions.map((revision) => ({
        ...revision,
        createdAt: revision.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Fetch wiki history error:', error);
    res.status(500).json({ error: '获取历史记录失败' });
  }
});

router.post('/:slug/submit', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const slug = req.params.slug;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';

    const page = await prisma.wikiPage.findUnique({
      where: { slug },
      select: {
        slug: true,
        lastEditorUid: true,
        status: true,
      },
    });

    if (!page) {
      res.status(404).json({ error: '页面未找到' });
      return;
    }

    const isOwner = page.lastEditorUid === req.authUser!.uid;
    if (!isOwner && !isAdminRole(req.authUser!.role)) {
      res.status(403).json({ error: '无权提交该页面' });
      return;
    }

    if (isAdminRole(req.authUser!.role)) {
      const published = await prisma.wikiPage.update({
        where: { slug },
        data: {
          status: 'published',
          reviewNote: null,
          reviewedBy: req.authUser!.uid,
          reviewedAt: new Date(),
        },
      });

      await prisma.moderationLog.create({
        data: {
          targetType: 'wiki',
          targetId: slug,
          action: 'approve',
          operatorUid: req.authUser!.uid,
          note: note || null,
        },
      });

      res.json({ page: toWikiResponse(published) });
      return;
    }

    const updated = await prisma.wikiPage.update({
      where: { slug },
      data: {
        status: 'pending',
        reviewNote: note || null,
        reviewedBy: null,
        reviewedAt: null,
      },
    });

    await prisma.moderationLog.create({
      data: {
        targetType: 'wiki',
        targetId: slug,
        action: 'submit',
        operatorUid: req.authUser!.uid,
        note: note || null,
      },
    });

    res.json({ page: toWikiResponse(updated) });
  } catch (error) {
    console.error('Submit wiki review error:', error);
    res.status(500).json({ error: '提交审核失败' });
  }
});

router.post('/', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const hasTagsInPayload = Object.prototype.hasOwnProperty.call(req.body, 'tags');
    const hasRelationsInPayload = Object.prototype.hasOwnProperty.call(req.body, 'relations');
    const {
      title,
      slug,
      category,
      content,
      tags,
      relations,
      eventDate,
      status,
      locationCode,
    } = req.body as {
      title?: string;
      slug?: string;
      category?: string;
      content?: string;
      tags?: string[];
      relations?: unknown;
      eventDate?: string;
      status?: ContentStatus;
      locationCode?: string;
    };

    const pageSlug = typeof slug === 'string' ? slug.trim().toLowerCase() : '';
    const titleKey = typeof title === 'string' ? normalizeWikiTitleKey(title) : '';

    if (!titleKey || !pageSlug || !category || !content) {
      res.status(400).json({ error: '缺少必要字段' });
      return;
    }

    if (category === 'music' && req.authUser?.role === 'user') {
      res.status(403).json({ error: '只有管理员可以编辑音乐分类内容' });
      return;
    }

    const nextStatus = normalizeWikiWriteStatus(status, req.authUser!);
    const normalizedRelations = hasRelationsInPayload
      ? await normalizeWikiRelationListForWrite(relations, pageSlug)
      : [];
    const normalizedTags = hasTagsInPayload
      ? (Array.isArray(tags) ? tags : [])
      : [];

    const page = await prisma.wikiPage.create({
      data: {
        slug: pageSlug,
        title,
        titleKey,
        category,
        content,
        tags: normalizedTags,
        relations: normalizedRelations,
        eventDate: eventDate || null,
        status: nextStatus,
        reviewNote: null,
        reviewedBy: null,
        reviewedAt: null,
        lastEditorUid: req.authUser!.uid,
        locationCode: locationCode || null,
      },
    });

    const revision = await prisma.wikiRevision.create({
      data: {
        pageSlug,
        title,
        content,
        slug: pageSlug,
        category,
        tags: normalizedTags,
        relations: normalizedRelations,
        eventDate: eventDate || null,
        editorUid: req.authUser!.uid,
        editorName: req.authUser!.displayName,
      },
    });

    if (!page.mainBranchId) {
      const mainBranch = await prisma.wikiBranch.create({
        data: {
          pageSlug,
          editorUid: req.authUser!.uid,
          editorName: req.authUser!.displayName,
          status: 'merged',
          latestRevisionId: revision.id,
        },
      });
      await prisma.wikiPage.update({
        where: { slug: pageSlug },
        data: {
          mainBranchId: mainBranch.id,
          mergedAt: new Date(),
        },
      });
    }

    if (nextStatus === 'pending') {
      await prisma.moderationLog.create({
        data: {
          targetType: 'wiki',
          targetId: pageSlug,
          action: 'submit',
          operatorUid: req.authUser!.uid,
          note: null,
        },
      });
    }

    res.status(201).json({ page: toWikiResponse(page) });
  } catch (error) {
    if (sendWikiUniqueConflict(error, res)) return;
    console.error('Create wiki page error:', error);
    res.status(500).json({ error: '保存页面失败' });
  }
});

router.post('/legacy', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const hasTagsInPayload = Object.prototype.hasOwnProperty.call(req.body, 'tags');
    const hasRelationsInPayload = Object.prototype.hasOwnProperty.call(req.body, 'relations');
    const {
      title,
      slug,
      category,
      content,
      tags,
      relations,
      eventDate,
      status,
    } = req.body as {
      title?: string;
      slug?: string;
      category?: string;
      content?: string;
      tags?: string[];
      relations?: unknown;
      eventDate?: string;
      status?: ContentStatus;
    };

    const pageSlug = typeof slug === 'string' ? slug.trim().toLowerCase() : '';
    const titleKey = typeof title === 'string' ? normalizeWikiTitleKey(title) : '';

    if (!titleKey || !pageSlug || !category || !content) {
      res.status(400).json({ error: '缺少必要字段' });
      return;
    }

    if (category === 'music' && req.authUser?.role === 'user') {
      res.status(403).json({ error: '只有管理员可以编辑音乐分类内容' });
      return;
    }

    const existing = await prisma.wikiPage.findUnique({ where: { slug: pageSlug } });

    if (existing && !isAdminRole(req.authUser!.role) && existing.lastEditorUid !== req.authUser!.uid) {
      res.status(409).json({ error: '该 slug 已存在' });
      return;
    }

    const nextStatus = normalizeWikiWriteStatus(status, req.authUser!);
    const normalizedRelations = hasRelationsInPayload
      ? await normalizeWikiRelationListForWrite(relations, pageSlug)
      : serializeRelations(existing?.relations, pageSlug);
    const normalizedTags = hasTagsInPayload
      ? (Array.isArray(tags) ? tags : [])
      : serializeTags(existing?.tags);
    const page = await prisma.wikiPage.upsert({
      where: { slug: pageSlug },
      create: {
        slug: pageSlug,
        title,
        titleKey,
        category,
        content,
        tags: normalizedTags,
        relations: normalizedRelations,
        eventDate: eventDate || null,
        status: nextStatus,
        reviewNote: null,
        reviewedBy: null,
        reviewedAt: null,
        lastEditorUid: req.authUser!.uid,
      },
      update: {
        title,
        titleKey,
        category,
        content,
        tags: normalizedTags,
        relations: normalizedRelations,
        eventDate: eventDate || null,
        status: nextStatus,
        reviewNote: null,
        reviewedBy: null,
        reviewedAt: null,
        lastEditorUid: req.authUser!.uid,
      },
    });

    await prisma.wikiRevision.create({
      data: {
        pageSlug,
        title,
        content,
        slug: pageSlug,
        category,
        tags: normalizedTags,
        relations: normalizedRelations,
        eventDate: eventDate || null,
        editorUid: req.authUser!.uid,
        editorName: req.authUser!.displayName,
      },
    });

    res.status(201).json({ page: toWikiResponse(page) });
  } catch (error) {
    if (sendWikiUniqueConflict(error, res)) return;
    console.error('Create legacy wiki page error:', error);
    res.status(500).json({ error: '保存页面失败' });
  }
});

router.put('/:slug', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const hasTagsInPayload = Object.prototype.hasOwnProperty.call(req.body, 'tags');
    const hasRelationsInPayload = Object.prototype.hasOwnProperty.call(req.body, 'relations');
    const {
      title,
      category,
      content,
      tags,
      relations,
      eventDate,
      status,
      locationCode,
    } = req.body as {
      title?: string;
      category?: string;
      content?: string;
      tags?: string[];
      relations?: unknown;
      eventDate?: string;
      status?: ContentStatus;
      locationCode?: string;
    };

    const titleKey = typeof title === 'string' ? normalizeWikiTitleKey(title) : '';

    if (!titleKey || !category || !content) {
      res.status(400).json({ error: '缺少必要字段' });
      return;
    }

    const page = await prisma.wikiPage.findUnique({ where: { slug: req.params.slug } });
    if (!page) {
      res.status(404).json({ error: '页面未找到' });
      return;
    }

    if (!isAdminRole(req.authUser!.role) && page.lastEditorUid !== req.authUser!.uid) {
      res.status(403).json({ error: '无权编辑该页面' });
      return;
    }

    const nextStatus = normalizeWikiWriteStatus(status, req.authUser!);
    const normalizedRelations = hasRelationsInPayload
      ? await normalizeWikiRelationListForWrite(relations, req.params.slug)
      : serializeRelations(page.relations, page.slug);
    const normalizedTags = hasTagsInPayload ? (Array.isArray(tags) ? tags : []) : serializeTags(page.tags);
    const updated = await prisma.wikiPage.update({
      where: { slug: req.params.slug },
      data: {
        title,
        titleKey,
        category,
        content,
        tags: normalizedTags,
        relations: normalizedRelations,
        eventDate: eventDate || null,
        status: nextStatus,
        reviewNote: null,
        reviewedBy: null,
        reviewedAt: null,
        lastEditorUid: req.authUser!.uid,
        locationCode: locationCode || null,
      },
    });

    await prisma.wikiRevision.create({
      data: {
        pageSlug: req.params.slug,
        title,
        content,
        slug: req.params.slug,
        category,
        tags: normalizedTags,
        relations: normalizedRelations,
        eventDate: eventDate || null,
        editorUid: req.authUser!.uid,
        editorName: req.authUser!.displayName,
      },
    });

    res.json({ page: toWikiResponse(updated) });
  } catch (error) {
    if (sendWikiUniqueConflict(error, res)) return;
    console.error('Update wiki page error:', error);
    res.status(500).json({ error: '更新页面失败' });
  }
});

router.post('/:slug/branches', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const pageSlug = req.params.slug;
    const page = await prisma.wikiPage.findUnique({ where: { slug: pageSlug } });
    if (!page || !canViewWikiPage(page, req.authUser)) {
      res.status(404).json({ error: '页面未找到' });
      return;
    }

    const existing = await prisma.wikiBranch.findUnique({
      where: {
        pageSlug_editorUid: {
          pageSlug,
          editorUid: req.authUser!.uid,
        },
      },
      include: {
        page: { select: { slug: true, title: true, category: true } },
      },
    });
    if (existing) {
      res.json({ branch: toWikiBranchResponse(existing as WikiBranchWithPage) });
      return;
    }

    const revision = await prisma.wikiRevision.create({
      data: {
        pageSlug,
        title: page.title,
        content: page.content,
        slug: page.slug,
        category: page.category,
        tags: page.tags,
        relations: page.relations,
        eventDate: page.eventDate,
        editorUid: req.authUser!.uid,
        editorName: req.authUser!.displayName,
        isAutoSave: false,
      },
    });

    const branch = await prisma.wikiBranch.create({
      data: {
        pageSlug,
        editorUid: req.authUser!.uid,
        editorName: req.authUser!.displayName,
        status: 'draft',
        latestRevisionId: revision.id,
      },
      include: {
        page: { select: { slug: true, title: true, category: true } },
      },
    });

    await prisma.wikiRevision.update({
      where: { id: revision.id },
      data: { branchId: branch.id },
    });

    res.status(201).json({ branch: toWikiBranchResponse(branch as WikiBranchWithPage) });
  } catch (error) {
    console.error('Create wiki branch error:', error);
    res.status(500).json({ error: '创建分支失败' });
  }
});

router.get('/:slug/branches', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const page = await prisma.wikiPage.findUnique({ where: { slug: req.params.slug } });
    if (!page || !canViewWikiPage(page, req.authUser)) {
      res.status(404).json({ error: '页面未找到' });
      return;
    }

    const where = isAdminRole(req.authUser!.role)
      ? { pageSlug: req.params.slug }
      : { pageSlug: req.params.slug, OR: [{ editorUid: req.authUser!.uid }, { status: 'pending_review' as WikiBranchStatus }, { status: 'conflict' as WikiBranchStatus }] };

    const branches = await prisma.wikiBranch.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        page: { select: { slug: true, title: true, category: true } },
      },
    });

    res.json({ branches: branches.map((branch) => toWikiBranchResponse(branch as WikiBranchWithPage)) });
  } catch (error) {
    console.error('Get wiki branches error:', error);
    res.status(500).json({ error: '获取分支失败' });
  }
});

router.get('/branches/mine', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const branches = await prisma.wikiBranch.findMany({
      where: {
        editorUid: req.authUser!.uid,
        status: { in: ['draft', 'pending_review', 'conflict'] },
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        page: { select: { slug: true, title: true, category: true } },
      },
    });

    res.json({ branches: branches.map((branch) => toWikiBranchResponse(branch as WikiBranchWithPage)) });
  } catch (error) {
    console.error('Get my wiki branches error:', error);
    res.status(500).json({ error: '获取分支失败' });
  }
});

router.get('/branches/:branchId', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const branch = await prisma.wikiBranch.findUnique({
      where: { id: req.params.branchId },
      include: {
        page: true,
      },
    });
    if (!branch || !branch.page || !canViewWikiPage(branch.page, req.authUser)) {
      res.status(404).json({ error: '分支未找到' });
      return;
    }
    if (!canViewWikiBranchContent(branch, req.authUser)) {
      res.status(403).json({ error: '无权访问该分支' });
      return;
    }

    const latestRevision = branch.latestRevisionId
      ? await prisma.wikiRevision.findUnique({ where: { id: branch.latestRevisionId } })
      : null;

    res.json({
      branch: toWikiBranchResponse(branch as WikiBranchWithPage),
      latestRevision: latestRevision
        ? {
            ...latestRevision,
            tags: serializeTags(latestRevision.tags),
            relations: serializeRelations(latestRevision.relations, latestRevision.pageSlug),
            createdAt: latestRevision.createdAt.toISOString(),
          }
        : null,
    });
  } catch (error) {
    console.error('Get wiki branch error:', error);
    res.status(500).json({ error: '获取分支失败' });
  }
});

router.get('/branches/:branchId/revisions', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const branch = await prisma.wikiBranch.findUnique({
      where: { id: req.params.branchId },
      include: { page: true },
    });
    if (!branch || !branch.page || !canViewWikiPage(branch.page, req.authUser)) {
      res.status(404).json({ error: '分支未找到' });
      return;
    }
    if (!canViewWikiBranchContent(branch, req.authUser)) {
      res.status(403).json({ error: '无权查看修订历史' });
      return;
    }

    const revisions = await prisma.wikiRevision.findMany({
      where: { branchId: branch.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json({
      revisions: revisions.map((revision) => ({
        ...revision,
        tags: serializeTags(revision.tags),
        relations: serializeRelations(revision.relations, revision.pageSlug),
        createdAt: revision.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Get wiki branch revisions error:', error);
    res.status(500).json({ error: '获取分支版本失败' });
  }
});

router.post('/branches/:branchId/revisions', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const branch = await prisma.wikiBranch.findUnique({
      where: { id: req.params.branchId },
      include: { page: true },
    });
    if (!branch || !branch.page) {
      res.status(404).json({ error: '分支未找到' });
      return;
    }
    if (branch.editorUid !== req.authUser!.uid && !isAdminRole(req.authUser!.role)) {
      res.status(403).json({ error: '无权编辑该分支' });
      return;
    }

    const hasTagsInPayload = Object.prototype.hasOwnProperty.call(req.body, 'tags');
    const hasRelationsInPayload = Object.prototype.hasOwnProperty.call(req.body, 'relations');

    const {
      title,
      content,
      slug,
      category,
      tags,
      relations,
      eventDate,
      isAutoSave,
    } = req.body as {
      title?: string;
      content?: string;
      slug?: string;
      category?: string;
      tags?: string[];
      relations?: unknown;
      eventDate?: string | null;
      isAutoSave?: boolean;
    };

    if (!title || !content || !category) {
      res.status(400).json({ error: '缺少必要字段' });
      return;
    }

    const baseRevision = branch.latestRevisionId
      ? await prisma.wikiRevision.findUnique({
          where: { id: branch.latestRevisionId },
          select: { tags: true, relations: true },
        })
      : null;
    const normalizedRelations = hasRelationsInPayload
      ? await normalizeWikiRelationListForWrite(relations, branch.pageSlug)
      : serializeRelations(baseRevision?.relations ?? branch.page.relations, branch.pageSlug);
    const normalizedTags = hasTagsInPayload
      ? (Array.isArray(tags) ? tags : [])
      : serializeTags(baseRevision?.tags ?? branch.page.tags);

    const revision = await prisma.wikiRevision.create({
      data: {
        pageSlug: branch.pageSlug,
        branchId: branch.id,
        title,
        content,
        slug: (slug || branch.pageSlug).trim().toLowerCase(),
        category,
        tags: normalizedTags,
        relations: normalizedRelations,
        eventDate: eventDate || null,
        editorUid: req.authUser!.uid,
        editorName: req.authUser!.displayName,
        isAutoSave: Boolean(isAutoSave),
      },
    });

    const hasOpenPr = await prisma.wikiPullRequest.findFirst({
      where: { branchId: branch.id, status: 'open' },
      select: { id: true },
    });

    const nextBranchStatus: WikiBranchStatus = hasOpenPr ? 'pending_review' : 'draft';
    await prisma.wikiBranch.update({
      where: { id: branch.id },
      data: {
        latestRevisionId: revision.id,
        status: branch.status === 'conflict' ? 'conflict' : nextBranchStatus,
      },
    });

    res.status(201).json({
      revision: {
        ...revision,
        tags: serializeTags(revision.tags),
        relations: serializeRelations(revision.relations, revision.pageSlug),
        createdAt: revision.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Create wiki branch revision error:', error);
    res.status(500).json({ error: '保存分支版本失败' });
  }
});

router.post('/branches/:branchId/pull-request', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const branch = await prisma.wikiBranch.findUnique({
      where: { id: req.params.branchId },
      include: { page: true },
    });
    if (!branch || !branch.page) {
      res.status(404).json({ error: '分支未找到' });
      return;
    }
    if (branch.editorUid !== req.authUser!.uid && !isAdminRole(req.authUser!.role)) {
      res.status(403).json({ error: '无权提交该分支' });
      return;
    }
    if (!branch.latestRevisionId) {
      res.status(400).json({ error: '分支暂无可提交内容' });
      return;
    }

    const existingOpen = await prisma.wikiPullRequest.findFirst({
      where: { branchId: branch.id, status: 'open' },
      include: {
        branch: {
          include: {
            page: { select: { slug: true, title: true, category: true } },
          },
        },
        page: { select: { slug: true, title: true, category: true } },
      },
    });
    if (existingOpen) {
      res.json({ pullRequest: toWikiPullRequestResponse(existingOpen as WikiPullRequestWithRelations) });
      return;
    }

    const latestRevision = await prisma.wikiRevision.findUnique({ where: { id: branch.latestRevisionId } });
    if (!latestRevision) {
      res.status(400).json({ error: '分支最新版本不存在' });
      return;
    }

    const currentMainRevision = await prisma.wikiRevision.findFirst({
      where: { pageSlug: branch.pageSlug, branchId: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    const payload = req.body as { title?: string; description?: string };
    const pr = await prisma.wikiPullRequest.create({
      data: {
        branchId: branch.id,
        pageSlug: branch.pageSlug,
        title: payload.title?.trim() || latestRevision.title,
        description: payload.description?.trim() || null,
        createdByUid: req.authUser!.uid,
        createdByName: req.authUser!.displayName,
        status: 'open',
        baseRevisionId: currentMainRevision?.id || null,
      },
    });

    await prisma.wikiBranch.update({
      where: { id: branch.id },
      data: { status: 'pending_review' },
    });

    // 重新查询完整的 PR 数据，包括关系
    const prWithRelations = await prisma.wikiPullRequest.findUnique({
      where: { id: pr.id },
      include: {
        branch: {
          include: {
            page: { select: { slug: true, title: true, category: true } },
          },
        },
        page: { select: { slug: true, title: true, category: true } },
      },
    });

    res.status(201).json({ pullRequest: toWikiPullRequestResponse(prWithRelations as WikiPullRequestWithRelations) });
  } catch (error) {
    console.error('Create wiki pull request error:', error);
    res.status(500).json({ error: '提交 PR 失败' });
  }
});

router.get('/pull-requests/list', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const status = req.query.status === 'merged' || req.query.status === 'rejected' ? req.query.status : 'open';
    const where = isAdminRole(req.authUser!.role)
      ? { status: status as WikiPullRequestStatus }
      : { status: status as WikiPullRequestStatus, createdByUid: req.authUser!.uid };

    const pullRequests = await prisma.wikiPullRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        branch: {
          include: {
            page: { select: { slug: true, title: true, category: true } },
          },
        },
        page: { select: { slug: true, title: true, category: true } },
      },
      take: 200,
    });

    res.json({ pullRequests: pullRequests.map((pr) => toWikiPullRequestResponse(pr as WikiPullRequestWithRelations)) });
  } catch (error) {
    console.error('List wiki pull requests error:', error);
    res.status(500).json({ error: '获取 PR 列表失败' });
  }
});

router.get('/pull-requests/:prId', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const pr = await prisma.wikiPullRequest.findUnique({
      where: { id: req.params.prId },
      include: {
        branch: {
          include: {
            page: { select: { slug: true, title: true, category: true } },
          },
        },
        page: { select: { slug: true, title: true, category: true } },
        comments: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!pr) {
      res.status(404).json({ error: 'PR 不存在' });
      return;
    }
    if (!isAdminRole(req.authUser!.role) && pr.createdByUid !== req.authUser!.uid) {
      res.status(403).json({ error: '无权查看该 PR' });
      return;
    }

    res.json({ pullRequest: toWikiPullRequestResponse(pr as WikiPullRequestWithRelations) });
  } catch (error) {
    console.error('Get wiki pull request error:', error);
    res.status(500).json({ error: '获取 PR 失败' });
  }
});

router.get('/pull-requests/:prId/diff', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const pr = await prisma.wikiPullRequest.findUnique({
      where: { id: req.params.prId },
      include: { branch: true, page: true },
    });
    if (!pr) {
      res.status(404).json({ error: 'PR 不存在' });
      return;
    }
    if (!isAdminRole(req.authUser!.role) && pr.createdByUid !== req.authUser!.uid) {
      res.status(403).json({ error: '无权查看该 PR' });
      return;
    }

    const [branchRevision, mainRevision] = await Promise.all([
      pr.branch.latestRevisionId ? prisma.wikiRevision.findUnique({ where: { id: pr.branch.latestRevisionId } }) : null,
      prisma.wikiRevision.findFirst({ where: { pageSlug: pr.pageSlug, branchId: null }, orderBy: { createdAt: 'desc' } }),
    ]);

    res.json({
      diff: {
        base: mainRevision
          ? {
              title: mainRevision.title,
              content: mainRevision.content,
              category: mainRevision.category || pr.page.category,
              tags: serializeTags(mainRevision.tags),
              relations: serializeRelations(mainRevision.relations, pr.pageSlug),
              eventDate: mainRevision.eventDate,
            }
          : {
              title: pr.page.title,
              content: pr.page.content,
              category: pr.page.category,
              tags: serializeTags(pr.page.tags),
              relations: serializeRelations(pr.page.relations, pr.page.slug),
              eventDate: pr.page.eventDate,
            },
        head: branchRevision
          ? {
              title: branchRevision.title,
              content: branchRevision.content,
              category: branchRevision.category || pr.page.category,
              tags: serializeTags(branchRevision.tags),
              relations: serializeRelations(branchRevision.relations, pr.pageSlug),
              eventDate: branchRevision.eventDate,
            }
          : {
              title: pr.page.title,
              content: pr.page.content,
              category: pr.page.category,
              tags: serializeTags(pr.page.tags),
              relations: serializeRelations(pr.page.relations, pr.page.slug),
              eventDate: pr.page.eventDate,
            },
      },
    });
  } catch (error) {
    console.error('Get wiki pull request diff error:', error);
    res.status(500).json({ error: '获取 PR Diff 失败' });
  }
});

router.post('/pull-requests/:prId/comments', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const pr = await prisma.wikiPullRequest.findUnique({ where: { id: req.params.prId } });
    if (!pr) {
      res.status(404).json({ error: 'PR 不存在' });
      return;
    }
    if (!isAdminRole(req.authUser!.role) && pr.createdByUid !== req.authUser!.uid) {
      res.status(403).json({ error: '无权评论该 PR' });
      return;
    }

    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content) {
      res.status(400).json({ error: '评论内容不能为空' });
      return;
    }

    const comment = await prisma.wikiPullRequestComment.create({
      data: {
        prId: pr.id,
        authorUid: req.authUser!.uid,
        authorName: req.authUser!.displayName,
        content,
      },
    });

    res.status(201).json({
      comment: {
        ...comment,
        createdAt: comment.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Create wiki PR comment error:', error);
    res.status(500).json({ error: '发表评论失败' });
  }
});

router.post('/pull-requests/:prId/merge', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const pr = await prisma.wikiPullRequest.findUnique({
      where: { id: req.params.prId },
      include: {
        branch: true,
        page: true,
      },
    });
    if (!pr) {
      res.status(404).json({ error: 'PR 不存在' });
      return;
    }
    if (pr.status !== 'open') {
      res.status(400).json({ error: '该 PR 已处理' });
      return;
    }
    if (!pr.branch.latestRevisionId) {
      res.status(400).json({ error: '分支没有可合并内容' });
      return;
    }

    const [headRevision, currentMainRevision] = await Promise.all([
      prisma.wikiRevision.findUnique({ where: { id: pr.branch.latestRevisionId } }),
      prisma.wikiRevision.findFirst({ where: { pageSlug: pr.pageSlug, branchId: null }, orderBy: { createdAt: 'desc' } }),
    ]);

    if (!headRevision) {
      res.status(400).json({ error: '分支版本不存在' });
      return;
    }

    if (pr.baseRevisionId && currentMainRevision && currentMainRevision.id !== pr.baseRevisionId) {
      const conflictData = {
        reason: 'base_mismatch',
        baseRevisionId: pr.baseRevisionId,
        currentMainRevisionId: currentMainRevision.id,
        detectedAt: new Date().toISOString(),
      };
      await prisma.$transaction([
        prisma.wikiBranch.update({ where: { id: pr.branchId }, data: { status: 'conflict' } }),
        prisma.wikiPullRequest.update({ where: { id: pr.id }, data: { conflictData } }),
      ]);
      res.status(409).json({ error: '检测到冲突，请先解决冲突后再合并', conflictData });
      return;
    }

    const mergedSnapshot = await prisma.wikiRevision.create({
      data: {
        pageSlug: pr.pageSlug,
        title: headRevision.title,
        content: headRevision.content,
        slug: headRevision.slug || pr.pageSlug,
        category: headRevision.category || pr.page.category,
        tags: headRevision.tags || [],
        relations: headRevision.relations || [],
        eventDate: headRevision.eventDate || null,
        editorUid: req.authUser!.uid,
        editorName: req.authUser!.displayName,
      },
    });

    const mergedAt = new Date();
    await prisma.$transaction([
      prisma.wikiPage.update({
        where: { slug: pr.pageSlug },
        data: {
          title: mergedSnapshot.title,
          titleKey: normalizeWikiTitleKey(mergedSnapshot.title),
          content: mergedSnapshot.content,
          category: mergedSnapshot.category || pr.page.category,
          tags: mergedSnapshot.tags || [],
          relations: mergedSnapshot.relations || [],
          eventDate: mergedSnapshot.eventDate || null,
          status: 'published',
          reviewNote: null,
          reviewedBy: req.authUser!.uid,
          reviewedAt: mergedAt,
          lastEditorUid: req.authUser!.uid,
          mergedAt,
        },
      }),
      prisma.wikiBranch.update({
        where: { id: pr.branchId },
        data: {
          status: 'merged',
        },
      }),
      prisma.wikiPullRequest.update({
        where: { id: pr.id },
        data: {
          status: 'merged',
          reviewedBy: req.authUser!.uid,
          reviewedAt: mergedAt,
          mergedAt,
          conflictData: null,
        },
      }),
      prisma.moderationLog.create({
        data: {
          targetType: 'wiki',
          targetId: pr.pageSlug,
          action: 'approve',
          operatorUid: req.authUser!.uid,
          note: `Merge PR ${pr.id}`,
        },
      }),
    ]);

    const updatedPage = await prisma.wikiPage.findUnique({ where: { slug: pr.pageSlug } });
    res.json({ page: updatedPage ? toWikiResponse(updatedPage) : null });
  } catch (error) {
    if (sendWikiUniqueConflict(error, res)) return;
    console.error('Merge wiki PR error:', error);
    res.status(500).json({ error: '合并 PR 失败' });
  }
});

router.post('/pull-requests/:prId/reject', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const pr = await prisma.wikiPullRequest.findUnique({ where: { id: req.params.prId } });
    if (!pr) {
      res.status(404).json({ error: 'PR 不存在' });
      return;
    }
    if (pr.status !== 'open') {
      res.status(400).json({ error: '该 PR 已处理' });
      return;
    }

    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    const reviewedAt = new Date();
    await prisma.$transaction([
      prisma.wikiPullRequest.update({
        where: { id: pr.id },
        data: {
          status: 'rejected',
          reviewedBy: req.authUser!.uid,
          reviewedAt,
        },
      }),
      prisma.wikiBranch.update({
        where: { id: pr.branchId },
        data: { status: 'rejected' },
      }),
      prisma.moderationLog.create({
        data: {
          targetType: 'wiki',
          targetId: pr.pageSlug,
          action: 'reject',
          operatorUid: req.authUser!.uid,
          note: note || `Reject PR ${pr.id}`,
        },
      }),
    ]);

    res.json({ success: true });
  } catch (error) {
    console.error('Reject wiki PR error:', error);
    res.status(500).json({ error: '驳回 PR 失败' });
  }
});

router.post('/branches/:branchId/resolve-conflict', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const branch = await prisma.wikiBranch.findUnique({ where: { id: req.params.branchId } });
    if (!branch) {
      res.status(404).json({ error: '分支未找到' });
      return;
    }

    const openPr = await prisma.wikiPullRequest.findFirst({
      where: { branchId: branch.id, status: 'open' },
      orderBy: { createdAt: 'desc' },
    });
    if (!openPr) {
      res.status(404).json({ error: '该分支没有待处理 PR' });
      return;
    }

    const allowed = isAdminRole(req.authUser!.role) || openPr.createdByUid === req.authUser!.uid;
    if (!allowed) {
      res.status(403).json({ error: '无权解决该冲突' });
      return;
    }

    const payload = req.body as {
      title?: string;
      content?: string;
      category?: string;
      tags?: string[];
      relations?: unknown;
      eventDate?: string | null;
    };
    if (!payload.title || !payload.content || !payload.category) {
      res.status(400).json({ error: '缺少必要字段' });
      return;
    }

    const hasTagsInPayload = Object.prototype.hasOwnProperty.call(req.body, 'tags');
    const hasRelationsInPayload = Object.prototype.hasOwnProperty.call(req.body, 'relations');

    const baseRevision = branch.latestRevisionId
      ? await prisma.wikiRevision.findUnique({
          where: { id: branch.latestRevisionId },
          select: { tags: true, relations: true },
        })
      : null;

    const normalizedRelations = hasRelationsInPayload
      ? await normalizeWikiRelationListForWrite(payload.relations, branch.pageSlug)
      : serializeRelations(baseRevision?.relations, branch.pageSlug);
    const normalizedTags = hasTagsInPayload
      ? (Array.isArray(payload.tags) ? payload.tags : [])
      : serializeTags(baseRevision?.tags);

    const revision = await prisma.wikiRevision.create({
      data: {
        pageSlug: branch.pageSlug,
        branchId: branch.id,
        title: payload.title,
        content: payload.content,
        slug: branch.pageSlug,
        category: payload.category,
        tags: normalizedTags,
        relations: normalizedRelations,
        eventDate: payload.eventDate || null,
        editorUid: req.authUser!.uid,
        editorName: req.authUser!.displayName,
      },
    });

    const currentMainRevision = await prisma.wikiRevision.findFirst({
      where: { pageSlug: branch.pageSlug, branchId: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    await prisma.$transaction([
      prisma.wikiBranch.update({
        where: { id: branch.id },
        data: {
          latestRevisionId: revision.id,
          status: 'pending_review',
        },
      }),
      prisma.wikiPullRequest.update({
        where: { id: openPr.id },
        data: {
          conflictData: null,
          baseRevisionId: currentMainRevision?.id || null,
        },
      }),
    ]);

    res.json({
      revision: {
        ...revision,
        tags: serializeTags(revision.tags),
        relations: serializeRelations(revision.relations, revision.pageSlug),
        createdAt: revision.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Resolve wiki conflict error:', error);
    res.status(500).json({ error: '解决冲突失败' });
  }
});

router.post('/:slug/rollback/:revisionId', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const revision = await prisma.wikiRevision.findUnique({
      where: { id: req.params.revisionId },
    });
    if (!revision || revision.pageSlug !== req.params.slug) {
      res.status(404).json({ error: '历史版本不存在' });
      return;
    }

    const currentPage = await prisma.wikiPage.findUnique({
      where: { slug: req.params.slug },
      select: {
        slug: true,
        lastEditorUid: true,
      },
    });

    if (!currentPage) {
      res.status(404).json({ error: '页面未找到' });
      return;
    }

    if (!isAdminRole(req.authUser!.role) && currentPage.lastEditorUid !== req.authUser!.uid) {
      res.status(403).json({ error: '无权回滚该页面' });
      return;
    }

    const page = await prisma.wikiPage.update({
      where: { slug: req.params.slug },
      data: {
        title: revision.title,
        titleKey: normalizeWikiTitleKey(revision.title),
        content: revision.content,
        category: revision.category || undefined,
        tags: revision.tags || undefined,
        relations: revision.relations || undefined,
        eventDate: revision.eventDate || undefined,
        status: isAdminRole(req.authUser!.role) ? 'published' : 'pending',
        reviewNote: null,
        reviewedBy: null,
        reviewedAt: null,
        lastEditorUid: req.authUser!.uid,
      },
    });

    await prisma.moderationLog.create({
      data: {
        targetType: 'wiki',
        targetId: req.params.slug,
        action: 'rollback',
        operatorUid: req.authUser!.uid,
        note: `回滚到版本 ${req.params.revisionId}`,
      },
    });

    res.json({ page: toWikiResponse(page) });
  } catch (error) {
    if (sendWikiUniqueConflict(error, res)) return;
    console.error('Rollback wiki page error:', error);
    res.status(500).json({ error: '回滚失败' });
  }
});

router.post('/:slug/revisions', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { title, content } = req.body as {
      title?: string;
      content?: string;
    };

    if (!title || !content) {
      res.status(400).json({ error: '缺少必要字段' });
      return;
    }

    const revision = await prisma.wikiRevision.create({
      data: {
        pageSlug: req.params.slug,
        title,
        content,
        editorUid: req.authUser!.uid,
        editorName: req.authUser!.displayName,
      },
    });

    res.status(201).json({
      revision: {
        ...revision,
        createdAt: revision.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Create wiki revision error:', error);
    res.status(500).json({ error: '保存历史版本失败' });
  }
});

export function registerWikiRoutes(app: Router) {
  app.use('/api/wiki', router);
  app.use('/api/mp/wiki', mpWikiRouter);
}
