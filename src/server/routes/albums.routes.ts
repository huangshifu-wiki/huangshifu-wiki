import { Router } from 'express';
import { requireAdmin } from '../middleware/auth';
import {
  prisma,
  toAlbumResponse,
  toSongResponse,
  toPostResponse,
  addAlbumCoverFromAsset,
  safeDeleteUploadFileByStorageKey,
  buildPostVisibilityWhere,
  parsePostSort,
  parseMusicPlatform,
  parseMusicCollectionType,
  normalizeTrackDiscPayload,
  parseInteger,
  parseBoolean,
  applyAlbumTracksToRelations,
  enhancedCache,
} from '../utils';
import type { AuthenticatedRequest } from '../types';
import type { AlbumCover } from '@prisma/client';

const router = Router();

// Albums list
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const platform = parseMusicPlatform(req.query.platform);
    const resourceType = parseMusicCollectionType(req.query.resourceType);
    const limit = parseInteger(req.query.limit, 20, { min: 1, max: 100 });
    const page = parseInteger(req.query.page, 1, { min: 1 });
    const skip = (page - 1) * limit;

    const where = {
      ...(platform ? { platform } : {}),
      ...(resourceType ? { resourceType } : {}),
    };

    if (!req.authUser) {
      const cacheKey = `album_list:${platform || 'all'}:${resourceType || 'all'}:${page}:${limit}`;
      const cached = enhancedCache.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }
    }

    const [albums, total] = await Promise.all([
      prisma.album.findMany({
        where,
        select: {
          docId: true,
          id: true,
          resourceType: true,
          platform: true,
          sourceId: true,
          title: true,
          artist: true,
          cover: true,
          description: true,
          platformUrl: true,
          defaultCoverSource: true,
          createdAt: true,
          updatedAt: true,
          covers: {
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true,
              publicUrl: true,
              isDefault: true,
              sortOrder: true,
            },
          },
          _count: {
            select: { songRelations: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      prisma.album.count({ where }),
    ]);

    const result = {
      albums: albums.map((album) => ({
        docId: album.docId,
        id: album.id,
        resourceType: album.resourceType,
        platform: album.platform,
        sourceId: album.sourceId,
        title: album.title,
        artist: album.artist,
        cover: album.cover,
        description: album.description,
        platformUrl: album.platformUrl,
        defaultCoverSource: album.defaultCoverSource,
        covers: album.covers.map((cover) => ({
          id: cover.id,
          url: cover.publicUrl,
          isDefault: cover.isDefault,
          sortOrder: cover.sortOrder,
        })),
        trackCount: album._count.songRelations,
        createdAt: album.createdAt.toISOString(),
        updatedAt: album.updatedAt.toISOString(),
      })),
      total,
      page,
      limit,
      hasMore: page * limit < total,
    };

    if (!req.authUser) {
      const cacheKey = `album_list:${platform || 'all'}:${resourceType || 'all'}:${page}:${limit}`;
      enhancedCache.set(cacheKey, result, 120);
    }

    res.json(result);
  } catch (error) {
    console.error('Fetch albums error:', error);
    res.status(500).json({ error: '获取专辑失败' });
  }
});

// Get album by ID
router.get('/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const identifier = req.params.id;
    let album = await prisma.album.findUnique({
      where: { docId: identifier },
      include: {
        covers: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!album) {
      album = await prisma.album.findUnique({
        where: { id: identifier },
        include: {
          covers: {
            orderBy: { sortOrder: 'asc' },
          },
        },
      });
    }

    if (!album) {
      res.status(404).json({ error: '专辑不存在' });
      return;
    }

    const relations = await prisma.songAlbumRelation.findMany({
      where: { albumDocId: album.docId },
      include: {
        song: {
          include: {
            covers: {
              orderBy: { sortOrder: 'asc' },
            },
            albumRelations: {
              include: {
                album: {
                  include: {
                    covers: {
                      orderBy: { sortOrder: 'asc' },
                    },
                  },
                },
              },
              orderBy: [{ discNumber: 'asc' }, { trackOrder: 'asc' }],
            },
          },
        },
      },
      orderBy: [{ discNumber: 'asc' }, { trackOrder: 'asc' }],
    });

    const favoritedMusicSet = new Set<string>();
    if (req.authUser && relations.length) {
      const favorites = await prisma.favorite.findMany({
        where: {
          userUid: req.authUser.uid,
          targetType: 'music',
          targetId: { in: relations.map((item) => item.songDocId) },
        },
        select: { targetId: true },
      });
      favorites.forEach((item) => favoritedMusicSet.add(item.targetId));
    }

    const tracks = relations.map((relation) => ({
      ...toSongResponse(relation.song, { favoritedByMe: favoritedMusicSet.has(relation.songDocId) }),
      trackOrder: relation.trackOrder,
      discNumber: relation.discNumber,
    }));

    const albumResponse = toAlbumResponse({
      ...album,
      songRelations: relations,
    });

    const coverFromDefault = (() => {
      const source = typeof album.defaultCoverSource === 'string' ? album.defaultCoverSource.trim() : '';
      if (!source) return '';
      if (source === 'old_cover') return album.cover || '';
      if (source.startsWith('album_cover:')) {
        const id = source.slice('album_cover:'.length);
        const matched = (album.covers || []).find((cover) => cover.id === id);
        return matched?.publicUrl || '';
      }
      return '';
    })();

    res.json({
      album: {
        ...albumResponse,
        id: album.docId,
        cover: coverFromDefault || album.cover,
        tracks,
        discs: normalizeTrackDiscPayload(album.tracks),
      },
    });
  } catch (error) {
    console.error('Fetch album detail error:', error);
    res.status(500).json({ error: '获取专辑详情失败' });
  }
});

// Get album posts
router.get('/:id/posts', async (req: AuthenticatedRequest, res) => {
  try {
    const docId = req.params.id;
    const limit = parseInteger(req.query.limit, 20, { min: 1, max: 100 });
    const sort = parsePostSort(req.query.sort);
    const visibilityWhere = buildPostVisibilityWhere(req.authUser);

    const where = {
      albumDocId: docId,
      ...visibilityWhere,
    };

    let orderBy: Array<Record<string, 'asc' | 'desc'>>;
    if (sort === 'hot') {
      orderBy = [{ hotScore: 'desc' }, { updatedAt: 'desc' }];
    } else if (sort === 'recommended') {
      orderBy = [{ commentsCount: 'desc' }, { likesCount: 'desc' }, { updatedAt: 'desc' }];
    } else {
      orderBy = [{ updatedAt: 'desc' }];
    }

    const posts = await prisma.post.findMany({
      where,
      orderBy,
      take: limit,
    });

    const likedPostSet = new Set<string>();
    const favoritedPostSet = new Set<string>();
    if (req.authUser && posts.length) {
      const [likedPosts, favoritedPosts] = await Promise.all([
        prisma.postLike.findMany({
          where: {
            userUid: req.authUser.uid,
            postId: { in: posts.map((item) => item.id) },
          },
          select: { postId: true },
        }),
        prisma.favorite.findMany({
          where: {
            userUid: req.authUser.uid,
            targetType: 'post',
            targetId: { in: posts.map((item) => item.id) },
          },
          select: { targetId: true },
        }),
      ]);
      likedPosts.forEach((item) => likedPostSet.add(item.postId));
      favoritedPosts.forEach((item) => favoritedPostSet.add(item.targetId));
    }

    res.json({
      posts: posts.map((post) => ({
        ...toPostResponse(post),
        likedByMe: likedPostSet.has(post.id),
        favoritedByMe: favoritedPostSet.has(post.id),
      })),
    });
  } catch (error) {
    console.error('Fetch album posts error:', error);
    res.status(500).json({ error: '获取专辑关联帖子失败' });
  }
});

// Create album
router.post('/', requireAdmin, async (req, res) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const artist = typeof body.artist === 'string' ? body.artist.trim() : '';
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    const sourceId = typeof body.sourceId === 'string' ? body.sourceId.trim() : id;
    const platform = parseMusicPlatform(body.platform) || 'netease';
    const resourceType = parseMusicCollectionType(body.resourceType) || 'album';
    const description = typeof body.description === 'string' ? body.description.trim() : null;
    const platformUrl = typeof body.platformUrl === 'string' ? body.platformUrl.trim() : null;
    const cover = typeof body.cover === 'string' ? body.cover.trim() : '';
    const tracks = normalizeTrackDiscPayload(body.tracks);

    if (!title || !artist) {
      res.status(400).json({ error: '缺少专辑信息' });
      return;
    }

    const finalSourceId = sourceId || id || `${Date.now()}`;
    const finalId = id || `${platform}_${resourceType}_${finalSourceId}`;

    const existing = await prisma.album.findUnique({ where: { id: finalId } });
    if (existing) {
      res.status(409).json({ error: '专辑已存在' });
      return;
    }

    const created = await prisma.album.create({
      data: {
        id: finalId,
        resourceType,
        platform,
        sourceId: finalSourceId,
        title,
        artist,
        description,
        platformUrl,
        cover,
        tracks,
      },
      include: {
        covers: {
          orderBy: { sortOrder: 'asc' },
        },
        songRelations: {
          include: {
            song: {
              select: {
                docId: true,
                id: true,
                title: true,
                artist: true,
                cover: true,
              },
            },
          },
        },
      },
    });

    if (tracks.length) {
      await applyAlbumTracksToRelations(created.docId, tracks);
    }

    res.status(201).json({
      album: toAlbumResponse(created),
    });
    enhancedCache.invalidateByPrefix('album_list:');
  } catch (error) {
    console.error('Create album error:', error);
    res.status(500).json({ error: '创建专辑失败' });
  }
});

// Update album
router.patch('/:docId', requireAdmin, async (req, res) => {
  try {
    const docId = req.params.docId;
    const existing = await prisma.album.findUnique({ where: { docId } });
    if (!existing) {
      res.status(404).json({ error: '专辑不存在' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const updateData: Record<string, unknown> = {};

    if (typeof body.title === 'string') updateData.title = body.title.trim();
    if (typeof body.artist === 'string') updateData.artist = body.artist.trim();
    if (typeof body.description === 'string' || body.description === null) updateData.description = body.description;
    if (typeof body.platformUrl === 'string' || body.platformUrl === null) updateData.platformUrl = body.platformUrl;
    if (typeof body.cover === 'string') updateData.cover = body.cover.trim();

    const platform = parseMusicPlatform(body.platform);
    if (platform) updateData.platform = platform;
    const resourceType = parseMusicCollectionType(body.resourceType);
    if (resourceType) updateData.resourceType = resourceType;
    if (typeof body.sourceId === 'string') updateData.sourceId = body.sourceId.trim();
    if (typeof body.defaultCoverSource === 'string' || body.defaultCoverSource === null) {
      updateData.defaultCoverSource = body.defaultCoverSource;
    }

    if (body.tracks !== undefined) {
      const normalizedTracks = normalizeTrackDiscPayload(body.tracks);
      updateData.tracks = normalizedTracks;
      await applyAlbumTracksToRelations(docId, normalizedTracks);
    }

    const updated = await prisma.album.update({
      where: { docId },
      data: updateData,
      include: {
        covers: {
          orderBy: { sortOrder: 'asc' },
        },
        songRelations: {
          include: {
            song: {
              select: {
                docId: true,
                id: true,
                title: true,
                artist: true,
                cover: true,
              },
            },
          },
          orderBy: [{ discNumber: 'asc' }, { trackOrder: 'asc' }],
        },
      },
    });

    res.json({ album: toAlbumResponse(updated) });
    enhancedCache.invalidateByPrefix('album_list:');
  } catch (error) {
    console.error('Update album error:', error);
    res.status(500).json({ error: '更新专辑失败' });
  }
});

// Delete album
router.delete('/:docId', requireAdmin, async (req, res) => {
  try {
    const docId = req.params.docId;
    const album = await prisma.album.findUnique({
      where: { docId },
      include: {
        covers: true,
      },
    });
    if (!album) {
      res.status(404).json({ error: '专辑不存在' });
      return;
    }

    const relations = await prisma.songAlbumRelation.findMany({ where: { albumDocId: docId } });
    const songDocIds = relations.map((item) => item.songDocId);

    await prisma.songAlbumRelation.deleteMany({ where: { albumDocId: docId } });

    const coverSources = (album.covers || []).map((cover) => `album_cover:${cover.id}`);
    if (coverSources.length) {
      await prisma.musicTrack.updateMany({
        where: {
          docId: { in: songDocIds },
          defaultCoverSource: { in: coverSources },
        },
        data: {
          defaultCoverSource: null,
        },
      });
    }

    for (const cover of album.covers || []) {
      if (cover.assetId) {
        const [songLinked, albumLinked, galleryLinked] = await Promise.all([
          prisma.songCover.count({ where: { assetId: cover.assetId } }),
          prisma.albumCover.count({ where: { assetId: cover.assetId, id: { not: cover.id } } }),
          prisma.galleryImage.count({ where: { assetId: cover.assetId } }),
        ]);
        if (songLinked + albumLinked + galleryLinked === 0) {
          const asset = await prisma.mediaAsset.findUnique({ where: { id: cover.assetId } });
          if (asset) {
            await safeDeleteUploadFileByStorageKey(asset.storageKey);
            await prisma.mediaAsset.update({
              where: { id: asset.id },
              data: { status: 'deleted' },
            });
          }
        }
      } else {
        await safeDeleteUploadFileByStorageKey(cover.storageKey);
      }
    }

    await prisma.albumCover.deleteMany({ where: { albumDocId: docId } });
    await prisma.album.delete({ where: { docId } });

    if (songDocIds.length) {
      const songs = await prisma.songAlbumRelation.findMany({
        where: { songDocId: { in: songDocIds } },
      });
      const groupedBySong = new Map<string, Array<{ id: string; isDisplay: boolean }>>();
      for (const relation of songs) {
        if (!groupedBySong.has(relation.songDocId)) {
          groupedBySong.set(relation.songDocId, []);
        }
        groupedBySong.get(relation.songDocId)!.push({ id: relation.id, isDisplay: relation.isDisplay });
      }
      for (const [, relationList] of groupedBySong.entries()) {
        if (!relationList.some((relation) => relation.isDisplay) && relationList[0]) {
          await prisma.songAlbumRelation.update({
            where: { id: relationList[0].id },
            data: { isDisplay: true },
          });
        }
      }
    }

    res.json({ success: true });
    enhancedCache.invalidateByPrefix('album_list:');
  } catch (error) {
    console.error('Delete album error:', error);
    res.status(500).json({ error: '删除专辑失败' });
  }
});

// Get album covers
router.get('/:docId/covers', async (req, res) => {
  try {
    const album = await prisma.album.findUnique({
      where: { docId: req.params.docId },
      include: {
        covers: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!album) {
      res.status(404).json({ error: '专辑不存在' });
      return;
    }

    res.json({
      covers: (album.covers || []).map((cover) => ({
        id: cover.id,
        assetId: cover.assetId,
        storageKey: cover.storageKey,
        url: cover.publicUrl,
        isDefault: cover.isDefault,
        sortOrder: cover.sortOrder,
      })),
    });
  } catch (error) {
    console.error('Fetch album covers error:', error);
    res.status(500).json({ error: '获取专辑封面失败' });
  }
});

// Add album cover
router.post('/:docId/covers', requireAdmin, async (req, res) => {
  try {
    const albumDocId = req.params.docId;
    const assetId = typeof req.body?.assetId === 'string' ? req.body.assetId.trim() : '';
    const isDefault = parseBoolean(req.body?.isDefault, false);

    if (!assetId) {
      res.status(400).json({ error: '缺少 assetId' });
      return;
    }

    const album = await prisma.album.findUnique({ where: { docId: albumDocId } });
    if (!album) {
      res.status(404).json({ error: '专辑不存在' });
      return;
    }

    const cover = await addAlbumCoverFromAsset(albumDocId, assetId, isDefault);
    if (isDefault) {
      await prisma.album.update({
        where: { docId: albumDocId },
        data: {
          cover: cover.publicUrl,
        },
      });
    }

    res.status(201).json({
      cover: {
        id: cover.id,
        assetId: cover.assetId,
        storageKey: cover.storageKey,
        url: cover.publicUrl,
        isDefault: cover.isDefault,
        sortOrder: cover.sortOrder,
      },
    });
  } catch (error) {
    console.error('Create album cover error:', error);
    res.status(500).json({ error: '添加专辑封面失败' });
  }
});

// Delete album cover
router.delete('/:docId/covers/:coverId', requireAdmin, async (req, res) => {
  try {
    const { docId: albumDocId, coverId } = req.params;
    const cover = await prisma.albumCover.findFirst({
      where: {
        id: coverId,
        albumDocId,
      },
    });

    if (!cover) {
      res.status(404).json({ error: '封面不存在' });
      return;
    }

    await prisma.albumCover.delete({ where: { id: cover.id } });

    if (cover.assetId) {
      const [songLinked, albumLinked, galleryLinked] = await Promise.all([
        prisma.songCover.count({ where: { assetId: cover.assetId } }),
        prisma.albumCover.count({ where: { assetId: cover.assetId } }),
        prisma.galleryImage.count({ where: { assetId: cover.assetId } }),
      ]);
      if (songLinked + albumLinked + galleryLinked === 0) {
        const asset = await prisma.mediaAsset.findUnique({ where: { id: cover.assetId } });
        if (asset) {
          await safeDeleteUploadFileByStorageKey(asset.storageKey);
          await prisma.mediaAsset.update({
            where: { id: asset.id },
            data: { status: 'deleted' },
          });
        }
      }
    }

    const remaining = await prisma.albumCover.findMany({
      where: { albumDocId },
      orderBy: { sortOrder: 'asc' },
    });

    if (!remaining.length) {
      await prisma.album.update({
        where: { docId: albumDocId },
        data: {
          defaultCoverSource: 'old_cover',
        },
      });
    } else {
      const hasDefault = remaining.some((item) => item.isDefault);
      const first = remaining[0];
      if (!hasDefault) {
        await prisma.albumCover.update({
          where: { id: first.id },
          data: { isDefault: true },
        });
        await prisma.album.update({
          where: { docId: albumDocId },
          data: {
            defaultCoverSource: `album_cover:${first.id}`,
            cover: first.publicUrl,
          },
        });
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete album cover error:', error);
    res.status(500).json({ error: '删除专辑封面失败' });
  }
});

// Set default album cover
router.patch('/:docId/covers/:coverId/default', requireAdmin, async (req, res) => {
  try {
    const { docId: albumDocId, coverId } = req.params;
    const cover = await prisma.albumCover.findFirst({
      where: {
        id: coverId,
        albumDocId,
      },
    });
    if (!cover) {
      res.status(404).json({ error: '封面不存在' });
      return;
    }

    await prisma.albumCover.updateMany({
      where: { albumDocId },
      data: { isDefault: false },
    });
    await prisma.albumCover.update({
      where: { id: coverId },
      data: { isDefault: true },
    });
    await prisma.album.update({
      where: { docId: albumDocId },
      data: {
        defaultCoverSource: `album_cover:${coverId}`,
        cover: cover.publicUrl,
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Set album default cover error:', error);
    res.status(500).json({ error: '设置默认封面失败' });
  }
});

// Sync album covers to songs
router.post('/:docId/sync-covers-to-songs', requireAdmin, async (req, res) => {
  try {
    const albumDocId = req.params.docId;
    const coverId = typeof req.body?.coverId === 'string' ? req.body.coverId.trim() : '';
    const songDocIdsRaw = Array.isArray(req.body?.songDocIds) ? req.body.songDocIds : [];
    const songDocIds = songDocIdsRaw
      .filter((item: unknown): item is string => typeof item === 'string')
      .map((item: string) => item.trim())
      .filter(Boolean);

    const album = await prisma.album.findUnique({
      where: { docId: albumDocId },
      include: {
        covers: true,
      },
    });
    if (!album) {
      res.status(404).json({ error: '专辑不存在' });
      return;
    }

    let selectedCover: AlbumCover | null = null;
    if (coverId) {
      selectedCover = album.covers.find((item) => item.id === coverId) || null;
    }
    if (!selectedCover) {
      selectedCover = album.covers.find((item) => item.isDefault) || album.covers[0] || null;
    }
    if (!selectedCover) {
      res.status(400).json({ error: '专辑没有可同步的封面' });
      return;
    }

    const relations = await prisma.songAlbumRelation.findMany({
      where: {
        albumDocId,
        ...(songDocIds.length ? { songDocId: { in: songDocIds } } : {}),
      },
      select: {
        songDocId: true,
      },
    });

    const targetSongDocIds = relations.map((item) => item.songDocId);
    if (!targetSongDocIds.length) {
      res.status(400).json({ error: '没有可同步的歌曲' });
      return;
    }

    await prisma.musicTrack.updateMany({
      where: {
        docId: { in: targetSongDocIds },
      },
      data: {
        cover: selectedCover.publicUrl,
        defaultCoverSource: `album_cover:${selectedCover.id}`,
      },
    });

    res.json({
      success: true,
      syncedCount: targetSongDocIds.length,
      cover: {
        id: selectedCover.id,
        url: selectedCover.publicUrl,
      },
    });
  } catch (error) {
    console.error('Sync album covers error:', error);
    res.status(500).json({ error: '同步专辑封面失败' });
  }
});

// Create album disc
router.post('/:docId/discs', requireAdmin, async (req, res) => {
  try {
    const docId = req.params.docId;
    const album = await prisma.album.findUnique({ where: { docId } });
    if (!album) {
      res.status(404).json({ error: '专辑不存在' });
      return;
    }

    const tracks = normalizeTrackDiscPayload(album.tracks);
    const requestedDisc = parseInteger(req.body?.discNumber, 0, { min: 1, max: 20 });
    const nextDisc = requestedDisc || (tracks.length ? tracks[tracks.length - 1].disc + 1 : 1);
    if (tracks.some((item) => item.disc === nextDisc)) {
      res.status(400).json({ error: 'Disc 已存在' });
      return;
    }

    const discName = typeof req.body?.name === 'string' && req.body.name.trim()
      ? req.body.name.trim()
      : `Disc ${nextDisc}`;
    tracks.push({
      disc: nextDisc,
      name: discName,
      songs: [],
    });
    tracks.sort((a, b) => a.disc - b.disc);

    await prisma.album.update({
      where: { docId },
      data: {
        tracks,
      },
    });

    res.status(201).json({
      disc: {
        disc: nextDisc,
        name: discName,
      },
    });
  } catch (error) {
    console.error('Create album disc error:', error);
    res.status(500).json({ error: '新增 Disc 失败' });
  }
});

// Delete album disc
router.delete('/:docId/discs/:discNumber', requireAdmin, async (req, res) => {
  try {
    const docId = req.params.docId;
    const discNumber = parseInteger(req.params.discNumber, 0, { min: 1, max: 20 });
    if (!discNumber) {
      res.status(400).json({ error: 'Disc 参数无效' });
      return;
    }

    const album = await prisma.album.findUnique({ where: { docId } });
    if (!album) {
      res.status(404).json({ error: '专辑不存在' });
      return;
    }

    const tracks = normalizeTrackDiscPayload(album.tracks);
    const target = tracks.find((item) => item.disc === discNumber);
    if (!target) {
      res.status(404).json({ error: 'Disc 不存在' });
      return;
    }
    if (target.songs.length) {
      res.status(400).json({ error: 'Disc 下仍有歌曲，无法删除' });
      return;
    }

    const nextTracks = tracks.filter((item) => item.disc !== discNumber);
    await prisma.album.update({
      where: { docId },
      data: {
        tracks: nextTracks,
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete album disc error:', error);
    res.status(500).json({ error: '删除 Disc 失败' });
  }
});

// Reorder album tracks
router.patch('/:docId/tracks/reorder', requireAdmin, async (req, res) => {
  try {
    const docId = req.params.docId;
    const album = await prisma.album.findUnique({ where: { docId } });
    if (!album) {
      res.status(404).json({ error: '专辑不存在' });
      return;
    }

    const tracks = normalizeTrackDiscPayload(req.body?.tracks);
    await prisma.album.update({
      where: { docId },
      data: {
        tracks,
      },
    });
    await applyAlbumTracksToRelations(docId, tracks);

    res.json({ success: true });
  } catch (error) {
    console.error('Reorder album tracks error:', error);
    res.status(500).json({ error: '重排专辑曲目失败' });
  }
});

// Sync display to songs
router.post('/:docId/sync-display-to-songs', requireAdmin, async (req, res) => {
  try {
    const albumDocId = req.params.docId;
    const relationRows = await prisma.songAlbumRelation.findMany({
      where: { albumDocId },
      orderBy: [{ discNumber: 'asc' }, { trackOrder: 'asc' }],
    });

    if (!relationRows.length) {
      res.json({ success: true, updated: 0 });
      return;
    }

    const songDocIdsRaw = Array.isArray(req.body?.songDocIds) ? req.body.songDocIds : [];
    const selectedSongDocIds = songDocIdsRaw
      .filter((item: unknown): item is string => typeof item === 'string')
      .map((item: string) => item.trim())
      .filter(Boolean);

    const targetSongDocIds = selectedSongDocIds.length
      ? relationRows
        .map((item) => item.songDocId)
        .filter((id: string) => selectedSongDocIds.includes(id))
      : relationRows.map((item) => item.songDocId);

    if (!targetSongDocIds.length) {
      res.json({ success: true, updated: 0 });
      return;
    }

    await prisma.songAlbumRelation.updateMany({
      where: {
        songDocId: { in: targetSongDocIds },
      },
      data: {
        isDisplay: false,
      },
    });

    for (const songDocId of targetSongDocIds) {
      await prisma.songAlbumRelation.updateMany({
        where: {
          songDocId,
          albumDocId,
        },
        data: {
          isDisplay: true,
        },
      });
    }

    await prisma.musicTrack.updateMany({
      where: { docId: { in: targetSongDocIds } },
      data: {
        displayAlbumMode: 'linked',
      },
    });

    res.json({ success: true, updated: targetSongDocIds.length });
  } catch (error) {
    console.error('Sync display album info error:', error);
    res.status(500).json({ error: '同步展示专辑失败' });
  }
});

export function registerAlbumsRoutes(app: Router) {
  app.use('/api/albums', router);
}
