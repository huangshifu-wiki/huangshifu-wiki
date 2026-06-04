import { Router } from 'express';
import { requireAuth, requireActiveUser } from '../middleware/auth';
import {
  prisma,
  parseFavoriteType,
  canViewWikiPage,
  canViewPost,
  toWikiResponse,
  toPostResponse,
} from '../utils';
import type { AuthenticatedRequest } from '../types';

const router = Router();

// List user favorites
router.get('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const rawType = req.query.type;
    const requestedType = parseFavoriteType(rawType);
    if (rawType !== undefined && rawType !== null && rawType !== '' && !requestedType) {
      res.status(400).json({ error: '无效收藏类型' });
      return;
    }
    const favorites = await prisma.favorite.findMany({
      where: {
        userUid: req.authUser!.uid,
        ...(requestedType ? { targetType: requestedType } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const wikiIds = favorites.filter((item) => item.targetType === 'wiki').map((item) => item.targetId);
    const postIds = favorites.filter((item) => item.targetType === 'post').map((item) => item.targetId);
    const musicIds = favorites.filter((item) => item.targetType === 'music').map((item) => item.targetId);

    const [wikiPages, posts, songs] = await Promise.all([
      wikiIds.length
        ? prisma.wikiPage.findMany({
            where: { slug: { in: wikiIds } },
            include: {
              lastEditor: { select: { displayName: true } },
              location: true,
            },
          })
        : Promise.resolve([]),
      postIds.length
        ? prisma.post.findMany({ where: { id: { in: postIds } } })
        : Promise.resolve([]),
      musicIds.length
        ? prisma.musicTrack.findMany({ where: { docId: { in: musicIds } } })
        : Promise.resolve([]),
    ]);

    const wikiMap = new Map(wikiPages.map((item) => [item.slug, item]));
    const postMap = new Map(posts.map((item) => [item.id, item]));
    const songMap = new Map(songs.map((item) => [item.docId, item]));

    const items = favorites
      .map((favorite) => {
        const base = {
          id: favorite.id,
          targetType: favorite.targetType,
          targetId: favorite.targetId,
          createdAt: favorite.createdAt.toISOString(),
        };

        if (favorite.targetType === 'wiki') {
          const page = wikiMap.get(favorite.targetId);
          if (!page || !canViewWikiPage(page, req.authUser)) return null;
          return {
            ...base,
            target: toWikiResponse(page),
          };
        }

        if (favorite.targetType === 'post') {
          const post = postMap.get(favorite.targetId);
          if (!post || !canViewPost(post, req.authUser)) return null;
          return {
            ...base,
            target: toPostResponse(post),
          };
        }

        if (favorite.targetType === 'music') {
          const song = songMap.get(favorite.targetId);
          if (!song) return null;
          return {
            ...base,
            target: {
              ...song,
              createdAt: song.createdAt.toISOString(),
              updatedAt: song.updatedAt.toISOString(),
            },
          };
        }

        return null;
      })
      .filter(Boolean);

    res.json({ favorites: items });
  } catch (error) {
    console.error('Fetch favorites error:', error);
    res.status(500).json({ error: '获取收藏列表失败' });
  }
});

// Add favorite
router.post('/', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const targetType = parseFavoriteType(req.body?.targetType);
    const targetId = typeof req.body?.targetId === 'string' ? req.body.targetId.trim() : '';

    if (!targetType || !targetId) {
      res.status(400).json({ error: '缺少必要字段' });
      return;
    }

    if (targetType === 'wiki') {
      const page = await prisma.wikiPage.findUnique({
        where: { slug: targetId },
        select: {
          slug: true,
          status: true,
          lastEditorUid: true,
        },
      });
      if (!page || !canViewWikiPage(page, req.authUser)) {
        res.status(404).json({ error: '目标不存在' });
        return;
      }
    }

    if (targetType === 'post') {
      const post = await prisma.post.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          status: true,
          authorUid: true,
        },
      });
      if (!post || !canViewPost(post, req.authUser)) {
        res.status(404).json({ error: '目标不存在' });
        return;
      }
    }

    if (targetType === 'music') {
      const song = await prisma.musicTrack.findUnique({
        where: { docId: targetId },
        select: { docId: true },
      });
      if (!song) {
        res.status(404).json({ error: '目标不存在' });
        return;
      }
    }

    await prisma.favorite.upsert({
      where: {
        userUid_targetType_targetId: {
          userUid: req.authUser!.uid,
          targetType,
          targetId,
        },
      },
      update: {},
      create: {
        userUid: req.authUser!.uid,
        targetType,
        targetId,
      },
    });

    if (targetType === 'wiki') {
      const count = await prisma.favorite.count({
        where: {
          targetType,
          targetId,
        },
      });
      await prisma.wikiPage.update({
        where: { slug: targetId },
        data: { favoritesCount: count },
      });
    }

    res.status(201).json({ favorited: true });
  } catch (error) {
    console.error('Create favorite error:', error);
    res.status(500).json({ error: '收藏失败' });
  }
});

// Remove favorite
router.delete('/:type/:id', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const targetType = parseFavoriteType(req.params.type);
    const targetId = req.params.id;

    if (!targetType || !targetId) {
      res.status(400).json({ error: '参数错误' });
      return;
    }

    await prisma.favorite.deleteMany({
      where: {
        userUid: req.authUser!.uid,
        targetType,
        targetId,
      },
    });

    if (targetType === 'wiki') {
      const count = await prisma.favorite.count({
        where: {
          targetType,
          targetId,
        },
      });
      await prisma.wikiPage.update({
        where: { slug: targetId },
        data: { favoritesCount: count },
      }).catch(() => undefined);
    }

    res.json({ favorited: false });
  } catch (error) {
    console.error('Delete favorite error:', error);
    res.status(500).json({ error: '取消收藏失败' });
  }
});

export function registerFavoritesRoutes(app: Router) {
  app.use('/api/favorites', router);
}
