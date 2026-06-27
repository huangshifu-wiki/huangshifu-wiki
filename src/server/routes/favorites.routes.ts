import type { Router } from 'express';
import { createRouter } from '../utils/typed-router';
import { requireAuth, requireActiveUser } from '../middleware/auth';
import {
  prisma,
  parseFavoriteType,
  canViewWikiPage,
  canViewPost,
  canViewGallery,
  toWikiResponse,
  toPostResponse,
  toGalleryResponse,
} from '../utils';
import type { AuthenticatedRequest } from '../types';

const router = createRouter();

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
    const galleryIds = favorites.filter((item) => item.targetType === 'gallery').map((item) => item.targetId);

    const [wikiPages, posts, songs, galleries] = await Promise.all([
      wikiIds.length
        ? prisma.wikiPage.findMany({
            where: { slug: { in: wikiIds }, deletedAt: null },
            include: {
              lastEditor: { select: { displayName: true } },
              location: true,
            },
          })
        : Promise.resolve([]),
      postIds.length
        ? prisma.post.findMany({ where: { id: { in: postIds }, deletedAt: null } })
        : Promise.resolve([]),
      musicIds.length
        ? prisma.musicTrack.findMany({ where: { docId: { in: musicIds }, deletedAt: null } })
        : Promise.resolve([]),
      galleryIds.length
        ? prisma.gallery.findMany({
            where: { id: { in: galleryIds }, deletedAt: null },
            include: {
              images: {
                include: {
                  asset: true,
                },
                orderBy: { sortOrder: 'asc' },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    const wikiMap = new Map(wikiPages.map((item) => [item.slug, item]));
    const postMap = new Map(posts.map((item) => [item.id, item]));
    const songMap = new Map(songs.map((item) => [item.docId, item]));
    const galleryMap = new Map(galleries.map((item) => [item.id, item]));

    const items = (
      await Promise.all(
        favorites.map(async (favorite) => {
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

          if (favorite.targetType === 'gallery') {
            const gallery = galleryMap.get(favorite.targetId);
            if (!gallery || !canViewGallery(gallery, req.authUser)) return null;
            return {
              ...base,
              target: await toGalleryResponse(gallery),
            };
          }

          return null;
        })
      )
    ).filter(Boolean);

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
          deletedAt: true,
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
          deletedAt: true,
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
        select: { docId: true, deletedAt: true },
      });
      if (!song || song.deletedAt) {
        res.status(404).json({ error: '目标不存在' });
        return;
      }
    }

    if (targetType === 'gallery') {
      const gallery = await prisma.gallery.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          status: true,
          published: true,
          authorUid: true,
          deletedAt: true,
        },
      });
      if (!gallery || !canViewGallery(gallery, req.authUser)) {
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

    if (targetType === 'gallery') {
      const count = await prisma.favorite.count({
        where: {
          targetType,
          targetId,
        },
      });
      await prisma.gallery.update({
        where: { id: targetId },
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

    if (targetType === 'gallery') {
      const count = await prisma.favorite.count({
        where: {
          targetType,
          targetId,
        },
      });
      await prisma.gallery.update({
        where: { id: targetId },
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
