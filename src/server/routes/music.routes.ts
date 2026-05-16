import { Router } from 'express';
import { requireAuth, requireActiveUser, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import {
  prisma,
  toSongResponse,
  fetchSongsWithRelations,
  fetchSongWithRelationsByDocId,
  normalizeMusicImportTracks,
  createOrUpdateImportedSong,
  getPlatformSourceField,
  parseMusicPlatform,
  parseDisplayAlbumMode,
  normalizeSongCustomPlatformLinks,
  addSongCoverFromAsset,
  safeDeleteUploadFileByStorageKey,
  safeDeleteUploadFileByUrl,
  buildAlbumTracksPayload,
  ensureDisplayRelation,
  normalizeTrackDiscPayload,
  parseInteger,
  parseBoolean,
  buildPostVisibilityWhere,
  parsePostSort,
  toPostResponse,
  canViewPost,
  applyAlbumTracksToRelations,
} from '../utils';
import { parseMusicUrl } from '../music/musicUrlParser';
import { getMusicResourcePreview, searchMusicResources, type MusicResourcePreview } from '../music/metingService';
import type { AuthenticatedRequest, MusicPlatform, ContentStatus } from '../types';
import { Prisma } from '@prisma/client';

const router = Router();

// Music list
router.get('/', asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const albumDocId = typeof req.query.albumDocId === 'string' ? req.query.albumDocId.trim() : '';
    const limit = parseInteger(req.query.limit, 20, { min: 1, max: 100 });
    const page = parseInteger(req.query.page, 1, { min: 1 });
    const skip = (page - 1) * limit;
    const includeInstrumentals = parseBoolean(req.query.includeInstrumentals, true);

    let instrumentalDocIds: string[] = [];
    if (!includeInstrumentals) {
      const relations = await prisma.songInstrumentalRelation.findMany({
        select: { songDocId: true },
        distinct: ['songDocId'],
      });
      instrumentalDocIds = relations.map((r) => r.songDocId);
    }

    const where = albumDocId
      ? {
          albumRelations: {
            some: {
              albumDocId,
            },
          },
        }
      : instrumentalDocIds.length > 0
        ? { docId: { notIn: instrumentalDocIds } }
        : undefined;

    const [songs, total] = await Promise.all([
      fetchSongsWithRelations(where, { take: limit, skip }),
      prisma.musicTrack.count({ where }),
    ]);

    const favoritedMusicSet = new Set<string>();
    if (req.authUser && songs.length) {
      const favorites = await prisma.favorite.findMany({
        where: {
          userUid: req.authUser.uid,
          targetType: 'music',
          targetId: { in: songs.map((song) => song.docId) },
        },
        select: { targetId: true },
      });
      favorites.forEach((item) => favoritedMusicSet.add(item.targetId));
    }

    res.json({
      songs: songs.map((song) => toSongResponse(song, { favoritedByMe: favoritedMusicSet.has(song.docId), excludeLyric: true })),
      total,
      page,
      limit,
      hasMore: page * limit < total,
    });
  } catch (error) {
    console.error('Fetch music error:', error);
    res.status(500).json({ error: '获取音乐失败' });
  }
}));

// Create music
router.post('/', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const artist = typeof body.artist === 'string' ? body.artist.trim() : '';
    const album = typeof body.album === 'string' ? body.album.trim() : '';
    const cover = typeof body.cover === 'string' ? body.cover.trim() : '';
    const audioUrl = typeof body.audioUrl === 'string' ? body.audioUrl.trim() : '';
    const lyric = typeof body.lyric === 'string' ? body.lyric : null;
    const primaryPlatform = parseMusicPlatform(body.primaryPlatform || body.platform) || 'netease';
    const enabledPlatform = parseMusicPlatform(body.enabledPlatform) || primaryPlatform;

    if (!id || !title || !artist) {
      res.status(400).json({ error: '缺少歌曲信息' });
      return;
    }

    const existing = await prisma.musicTrack.findUnique({ where: { id } });
    if (existing) {
      res.status(409).json({ error: '该歌曲已存在' });
      return;
    }

    const sourceField = getPlatformSourceField(primaryPlatform);
    const song = await prisma.musicTrack.create({
      data: {
        id,
        title,
        artist,
        album,
        cover,
        audioUrl,
        lyric,
        primaryPlatform,
        enabledPlatform,
        [sourceField]: id,
        addedBy: req.authUser!.uid,
      },
    });

    const hydrated = await fetchSongWithRelationsByDocId(song.docId);
    res.status(201).json({
      song: hydrated ? toSongResponse(hydrated) : song,
    });
  } catch (error) {
    console.error('Add music error:', error);
    res.status(500).json({ error: '添加歌曲失败' });
  }
}));

// Parse music URL
router.post('/parse-url', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!rawUrl) {
      res.status(400).json({ error: '请提供音乐链接' });
      return;
    }

    const parsed = parseMusicUrl(rawUrl);
    if (!parsed) {
      res.status(400).json({ error: '无法识别的音乐链接' });
      return;
    }

    const preview = await getMusicResourcePreview(parsed.platform, parsed.type, parsed.id);

    res.json({
      resource: {
        ...preview,
        totalSongs: preview.songs.length,
      },
    });
  } catch (error) {
    console.error('Parse music url error:', error);
    res.status(500).json({ error: '解析音乐链接失败' });
  }
}));

// Import music
router.post('/import', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!rawUrl) {
      res.status(400).json({ error: '请提供音乐链接' });
      return;
    }

    const parsed = parseMusicUrl(rawUrl);
    if (!parsed) {
      res.status(400).json({ error: '无法识别的音乐链接' });
      return;
    }

    const preview = await getMusicResourcePreview(parsed.platform, parsed.type, parsed.id);
    const selectedSongIdsRaw = Array.isArray(req.body?.selectedSongIds) ? req.body.selectedSongIds : [];
    const selectedSongIds = selectedSongIdsRaw
      .filter((item: unknown): item is string => typeof item === 'string')
      .map((item: string) => item.trim())
      .filter(Boolean);
    const selectedSet = selectedSongIds.length ? new Set(selectedSongIds) : null;

    const tracks = normalizeMusicImportTracks(preview.songs).filter((track) => {
      if (!selectedSet) return true;
      return selectedSet.has(track.sourceId);
    });

    if (!tracks.length) {
      res.status(400).json({ error: '没有可导入的歌曲' });
      return;
    }

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    let linked = 0;

    const importedSongs: Array<{ songDocId: string; trackOrder: number; title: string; artist: string; isInstrumental?: boolean }> = [];
    const linkedSongs: Array<{ docId: string; title: string; artist: string; platform: string }> = [];

    for (let index = 0; index < tracks.length; index += 1) {
      const track = tracks[index];
      try {
        const result = await createOrUpdateImportedSong({
          platform: preview.platform,
          track,
          userUid: req.authUser!.uid,
          albumNameFallback: preview.title,
        });
        if (result.created) {
          imported += 1;
        } else {
          skipped += 1;
        }
        if (result.linked) {
          linked += 1;
          linkedSongs.push({
            docId: result.song.docId,
            title: result.song.title,
            artist: result.song.artist,
            platform: preview.platform,
          });
        }
        importedSongs.push({
          songDocId: result.song.docId,
          trackOrder: index,
          title: result.song.title,
          artist: result.song.artist,
          isInstrumental: track.isInstrumental,
        });
      } catch (error) {
        console.error('Import track error:', error);
        failed += 1;
      }
    }

    const tracksPayload = importedSongs.map((item, index) => ({
      disc: 1,
      name: 'Disc 1',
      songs: [
        {
          songDocId: item.songDocId,
          trackOrder: index,
          song: {
            docId: item.songDocId,
            title: item.title,
            artist: item.artist,
            cover: '',
            id: item.songDocId,
          },
        },
      ],
    }));

    if (tracksPayload.length) {
      const existingAlbum = await prisma.album.findFirst({
        where: {
          platform: preview.platform,
          sourceId: preview.id,
        },
      });

      if (existingAlbum) {
        const existingTracks = normalizeTrackDiscPayload(existingAlbum.tracks);
        const existingDocIds = new Set(existingTracks.flatMap((disc) => disc.songs.map((s) => s.songDocId)));
        const newTracks = tracksPayload.filter((track) => !existingDocIds.has(track.songs[0].songDocId));
        if (newTracks.length) {
          const merged = [...existingTracks, ...newTracks];
          merged.sort((a, b) => a.disc - b.disc);
          await prisma.album.update({
            where: { docId: existingAlbum.docId },
            data: {
              tracks: merged,
              updatedAt: new Date(),
            },
          });
          await applyAlbumTracksToRelations(existingAlbum.docId, merged);
        }
        // 增量导入时更新专辑信息（封面、描述等）
        const updateData: Record<string, unknown> = {};
        if (preview.cover && !existingAlbum.cover) {
          updateData.cover = preview.cover;
        }
        if (preview.description && !existingAlbum.description) {
          updateData.description = preview.description;
        }
        if (preview.platformUrl && !existingAlbum.platformUrl) {
          updateData.platformUrl = preview.platformUrl;
        }
        if (preview.artist && preview.artist !== '未知歌手' && existingAlbum.artist === 'Various Artists') {
          updateData.artist = preview.artist;
        }
        if (Object.keys(updateData).length > 0) {
          await prisma.album.update({
            where: { docId: existingAlbum.docId },
            data: updateData,
          });
        }
      } else {
        const albumId = `${preview.platform}_${preview.type}_${preview.id}`;
        const resourceType = preview.type === 'song' ? 'album' : preview.type;
        const createdAlbum = await prisma.album.create({
          data: {
            id: albumId,
            docId: albumId,
            platform: preview.platform,
            resourceType,
            sourceId: preview.id,
            title: preview.title,
            artist: preview.artist || 'Various Artists',
            cover: preview.cover || '',
            tracks: tracksPayload,
          },
        });
        await applyAlbumTracksToRelations(createdAlbum.docId, tracksPayload);
      }
    }

    const album = await prisma.album.findFirst({
      where: {
        platform: preview.platform,
        sourceId: preview.id,
      },
      select: {
        docId: true,
        title: true,
        resourceType: true,
      },
    });

    res.json({
      summary: {
        imported,
        skipped,
        failed,
      },
      linked,
      linkedSongs,
      importedSongs,
      collection: album ? {
        docId: album.docId,
        title: album.title,
        resourceType: album.resourceType,
      } : null,
    });
  } catch (error) {
    console.error('Import music error:', error);
    res.status(500).json({ error: '导入音乐失败' });
  }
}));

// Legacy import routes (kept for backward compatibility)
router.post('/from-netease', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  res.status(410).json({ error: '请使用通用导入接口 /api/music/import' });
}));

router.post('/from-qq', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  res.status(410).json({ error: '请使用通用导入接口 /api/music/import' });
}));

router.post('/from-kugou', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  res.status(410).json({ error: '请使用通用导入接口 /api/music/import' });
}));

router.post('/from-baidu', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  res.status(410).json({ error: '请使用通用导入接口 /api/music/import' });
}));

router.post('/from-kuwo', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  res.status(410).json({ error: '请使用通用导入接口 /api/music/import' });
}));

// Get play URL
router.get('/:docId/play-url', asyncHandler(async (req, res) => {
  try {
    const { docId } = req.params;
    const platform = typeof req.query.platform === 'string' ? req.query.platform.trim() : '';

    const song = await prisma.musicTrack.findUnique({
      where: { docId },
      select: {
        docId: true,
        id: true,
        primaryPlatform: true,
        enabledPlatform: true,
        neteaseId: true,
        tencentId: true,
        kugouId: true,
        baiduId: true,
        kuwoId: true,
      },
    });

    if (!song) {
      res.status(404).json({ error: '歌曲不存在' });
      return;
    }

    const targetPlatform = platform || song.primaryPlatform;
    const sourceId = (() => {
      switch (targetPlatform) {
        case 'netease':
          return song.neteaseId || song.id;
        case 'tencent':
          return song.tencentId || song.id;
        case 'kugou':
          return song.kugouId || song.id;
        case 'baidu':
          return song.baiduId || song.id;
        case 'kuwo':
          return song.kuwoId || song.id;
        default:
          return song.id;
      }
    })();

    res.json({
      playUrl: `/api/music/play/${targetPlatform}/${sourceId}`,
      platform: targetPlatform,
      sourceId,
    });
  } catch (error) {
    console.error('Fetch play url error:', error);
    res.status(500).json({ error: '获取播放链接失败' });
  }
}));

// Get instrumental targets
router.get('/instrumental-targets', asyncHandler(async (req, res) => {
  try {
    const relations = await prisma.songInstrumentalRelation.findMany({
      select: {
        songDocId: true,
      },
      distinct: ['songDocId'],
    });
    res.json({
      docIds: relations.map((r) => r.songDocId),
    });
  } catch (error) {
    console.error('Fetch instrumental targets error:', error);
    res.status(500).json({ error: '获取伴奏列表失败' });
  }
}));

// Get music by docId
router.get('/:docId', asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const identifier = req.params.docId;
    let song = await fetchSongWithRelationsByDocId(identifier);

    if (!song) {
      const matched = await prisma.musicTrack.findFirst({
        where: {
          OR: [
            { id: identifier },
            { neteaseId: identifier },
            { tencentId: identifier },
            { kugouId: identifier },
            { baiduId: identifier },
            { kuwoId: identifier },
          ],
        },
        select: { docId: true },
      });

      if (matched?.docId) {
        song = await fetchSongWithRelationsByDocId(matched.docId);
      }
    }

    if (!song) {
      res.status(404).json({ error: '歌曲不存在' });
      return;
    }

    const favoritedByMe = req.authUser
      ? Boolean(await prisma.favorite.findFirst({
          where: {
            userUid: req.authUser.uid,
            targetType: 'music',
            targetId: song.docId,
          },
          select: { id: true },
        }))
      : false;

    const responseSong = toSongResponse(song, { favoritedByMe });
    res.json({ song: responseSong });
  } catch (error) {
    console.error('Fetch song detail error:', error);
    res.status(500).json({ error: '获取歌曲详情失败' });
  }
}));

// Delete music
router.delete('/:docId', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const docId = req.params.docId;
    const song = await prisma.musicTrack.findUnique({
      where: { docId },
      include: {
        covers: true,
      },
    });

    if (!song) {
      res.status(404).json({ error: '歌曲不存在' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.songInstrumentalRelation.deleteMany({
        where: {
          OR: [{ songDocId: docId }, { targetSongDocId: docId }],
        },
      });

      await tx.songAlbumRelation.deleteMany({ where: { songDocId: docId } });

      for (const cover of song.covers || []) {
        if (cover.assetId) {
          const [songLinked, albumLinked, galleryLinked] = await Promise.all([
            tx.songCover.count({ where: { assetId: cover.assetId, id: { not: cover.id } } }),
            tx.albumCover.count({ where: { assetId: cover.assetId } }),
            tx.galleryImage.count({ where: { assetId: cover.assetId } }),
          ]);
          if (songLinked + albumLinked + galleryLinked === 0) {
            const asset = await tx.mediaAsset.findUnique({ where: { id: cover.assetId } });
            if (asset) {
              await safeDeleteUploadFileByStorageKey(asset.storageKey);
              await tx.mediaAsset.update({
                where: { id: asset.id },
                data: { status: 'deleted' },
              });
            }
          }
        } else {
          await safeDeleteUploadFileByUrl(cover.publicUrl);
        }
      }

      await tx.songCover.deleteMany({ where: { songDocId: docId } });
      await tx.musicTrack.delete({ where: { docId } });
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete music error:', error);
    res.status(500).json({ error: '删除歌曲失败' });
  }
}));

// Update music
router.patch('/:docId', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const docId = req.params.docId;
    const existing = await prisma.musicTrack.findUnique({ where: { docId } });
    if (!existing) {
      res.status(404).json({ error: '歌曲不存在' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const updateData: Record<string, unknown> = {};

    if (typeof body.title === 'string') updateData.title = body.title.trim();
    if (typeof body.artist === 'string') updateData.artist = body.artist.trim();
    if (typeof body.album === 'string') updateData.album = body.album.trim();
    if (typeof body.cover === 'string') updateData.cover = body.cover.trim();
    if (typeof body.audioUrl === 'string') updateData.audioUrl = body.audioUrl.trim();
    if (typeof body.lyric === 'string' || body.lyric === null) updateData.lyric = body.lyric;

    const primaryPlatform = parseMusicPlatform(body.primaryPlatform);
    if (primaryPlatform) updateData.primaryPlatform = primaryPlatform;
    const enabledPlatform = parseMusicPlatform(body.enabledPlatform);
    if (enabledPlatform) updateData.enabledPlatform = enabledPlatform;

    const displayAlbumMode = parseDisplayAlbumMode(body.displayAlbumMode);
    if (displayAlbumMode) {
      updateData.displayAlbumMode = displayAlbumMode;
      if (displayAlbumMode !== 'manual') {
        updateData.manualAlbumName = null;
      }
    }
    if (typeof body.manualAlbumName === 'string') {
      updateData.manualAlbumName = body.manualAlbumName.trim();
    }
    if (typeof body.defaultCoverSource === 'string' || body.defaultCoverSource === null) {
      updateData.defaultCoverSource = body.defaultCoverSource;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'customPlatformLinks')) {
      updateData.customPlatformLinks = normalizeSongCustomPlatformLinks(body.customPlatformLinks) as unknown as Prisma.InputJsonValue;
    }

    const neteaseId = typeof body.neteaseId === 'string' ? body.neteaseId.trim() : '';
    const tencentId = typeof body.tencentId === 'string' ? body.tencentId.trim() : '';
    const kugouId = typeof body.kugouId === 'string' ? body.kugouId.trim() : '';
    const baiduId = typeof body.baiduId === 'string' ? body.baiduId.trim() : '';
    const kuwoId = typeof body.kuwoId === 'string' ? body.kuwoId.trim() : '';
    if (neteaseId) updateData.neteaseId = neteaseId;
    if (tencentId) updateData.tencentId = tencentId;
    if (kugouId) updateData.kugouId = kugouId;
    if (baiduId) updateData.baiduId = baiduId;
    if (kuwoId) updateData.kuwoId = kuwoId;

    const platformIdFields: Array<{ field: 'neteaseId' | 'tencentId' | 'kugouId' | 'baiduId' | 'kuwoId'; value: string }> = [];
    if (neteaseId) platformIdFields.push({ field: 'neteaseId', value: neteaseId });
    if (tencentId) platformIdFields.push({ field: 'tencentId', value: tencentId });
    if (kugouId) platformIdFields.push({ field: 'kugouId', value: kugouId });
    if (baiduId) platformIdFields.push({ field: 'baiduId', value: baiduId });
    if (kuwoId) platformIdFields.push({ field: 'kuwoId', value: kuwoId });

    if (platformIdFields.length > 0) {
      for (const { field, value } of platformIdFields) {
        if (!value) continue;
        const conflict = await prisma.musicTrack.findFirst({
          where: {
            docId: { not: docId },
            [field]: value,
          },
          select: { docId: true, title: true, artist: true },
        });
        if (conflict) {
          res.status(409).json({
            error: `该平台ID 已被歌曲「${conflict.title}」使用`,
            conflict: true,
            conflictingSong: {
              docId: conflict.docId,
              title: conflict.title,
              artist: conflict.artist,
            },
          });
          return;
        }
      }
    }

    await prisma.musicTrack.update({
      where: { docId },
      data: updateData,
    });

    const song = await fetchSongWithRelationsByDocId(docId);
    if (!song) {
      res.status(404).json({ error: '歌曲不存在' });
      return;
    }

    res.json({ song: toSongResponse(song) });
  } catch (error) {
    console.error('Update music error:', error);
    res.status(500).json({ error: '更新歌曲失败' });
  }
}));

// Match suggestions
router.get('/match-suggestions', asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const platform = typeof req.query.platform === 'string' ? req.query.platform.trim() : '';
    const title = typeof req.query.title === 'string' ? req.query.title.trim() : '';
    const artist = typeof req.query.artist === 'string' ? req.query.artist.trim() : '';
    const docId = typeof req.query.docId === 'string' ? req.query.docId.trim() : '';

    if (!platform || !title || !artist) {
      res.status(400).json({ error: '缺少必要参数：platform, title, artist' });
      return;
    }

    const validPlatforms = ['netease', 'tencent', 'kugou', 'baidu', 'kuwo'];
    if (!validPlatforms.includes(platform)) {
      res.status(400).json({ error: '无效的平台' });
      return;
    }

    const cleanTitle = title.replace(/[（].*[)）]/g, '').replace(/[【\[].*[]】\]/g, '').trim();
    const keyword = `${cleanTitle} ${artist}`.trim();

    const searchResults = await searchMusicResources({
      platform: platform as MusicPlatform,
      keyword,
      type: 'song',
      limit: 20,
    });

    const normalizedTitle = cleanTitle.toLowerCase().replace(/\s+/g, '');
    const normalizedArtist = artist.toLowerCase().replace(/\s+/g, '');

    const scored = searchResults
      .map((item) => {
        const itemTitleClean = item.title.replace(/[（].*[)）]/g, '').replace(/[【\[].*[]】\]/g, '').trim();
        const itemTitleNorm = itemTitleClean.toLowerCase().replace(/\s+/g, '');
        const itemArtistNorm = item.artist.toLowerCase().replace(/\s+/g, '');
        const titleScore = calculateSimilarity(normalizedTitle, itemTitleNorm);
        const artistScore = calculateSimilarity(normalizedArtist, itemArtistNorm);
        const avgScore = (titleScore + artistScore) / 2;
        return { ...item, score: avgScore };
      })
      .filter((item) => item.score >= 0.35)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    let autoSelectedIndex: number | null = null;
    if (scored.length === 1 && scored[0].score >= 0.8) {
      autoSelectedIndex = 0;
    } else if (scored.length > 1 && scored[0].score >= 0.85 && scored[1].score < scored[0].score - 0.15) {
      autoSelectedIndex = 0;
    }

    const existingSongsByPlatformId = await prisma.musicTrack.findMany({
      where: {
        OR: scored.map((item) => {
          const field = getPlatformSourceField(platform as MusicPlatform);
          return { [field]: item.sourceId };
        }) as Prisma.MusicTrackWhereInput[],
      },
      select: { docId: true, id: true, title: true, artist: true },
    });

    const existingMap = new Map<string, { docId: string; title: string; artist: string }>();
    for (const s of existingSongsByPlatformId) {
      existingMap.set(s.id, { docId: s.docId, title: s.title, artist: s.artist });
    }

    const suggestions = scored.map((item, index) => {
      const existing = existingMap.get(item.sourceId);
      return {
        sourceId: item.sourceId,
        title: item.title,
        artist: item.artist,
        album: item.album,
        cover: item.picId,
        sourceUrl: item.sourceUrl,
        score: Math.round(item.score * 100),
        isAutoSelected: index === autoSelectedIndex,
        alreadyLinked: existing ? { docId: existing.docId, title: existing.title } : null,
      };
    });

    res.json({ suggestions, autoSelectedIndex });
  } catch (error) {
    console.error('Match suggestions error:', error);
    res.status(500).json({ error: '搜索匹配歌曲失败' });
  }
}));

// Get music covers
router.get('/:docId/covers', asyncHandler(async (req, res) => {
  try {
    const song = await prisma.musicTrack.findUnique({
      where: { docId: req.params.docId },
      include: {
        covers: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!song) {
      res.status(404).json({ error: '歌曲不存在' });
      return;
    }

    res.json({
      covers: (song.covers || []).map((cover) => ({
        id: cover.id,
        assetId: cover.assetId,
        storageKey: cover.storageKey,
        url: cover.publicUrl,
        isDefault: cover.isDefault,
        sortOrder: cover.sortOrder,
      })),
    });
  } catch (error) {
    console.error('Fetch song covers error:', error);
    res.status(500).json({ error: '获取歌曲封面失败' });
  }
}));

// Add music cover
router.post('/:docId/covers', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const songDocId = req.params.docId;
    const assetId = typeof req.body?.assetId === 'string' ? req.body.assetId.trim() : '';
    const isDefault = parseBoolean(req.body?.isDefault, false);

    if (!assetId) {
      res.status(400).json({ error: '缺少 assetId' });
      return;
    }

    const song = await prisma.musicTrack.findUnique({ where: { docId: songDocId } });
    if (!song) {
      res.status(404).json({ error: '歌曲不存在' });
      return;
    }

    const cover = await addSongCoverFromAsset(songDocId, assetId, isDefault);
    if (isDefault) {
      await prisma.musicTrack.update({
        where: { docId: songDocId },
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
    console.error('Create song cover error:', error);
    res.status(500).json({ error: '添加歌曲封面失败' });
  }
}));

// Delete music cover
router.delete('/:docId/covers/:coverId', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const { docId, coverId } = req.params;
    const cover = await prisma.songCover.findFirst({
      where: {
        id: coverId,
        songDocId: docId,
      },
    });

    if (!cover) {
      res.status(404).json({ error: '封面不存在' });
      return;
    }

    await prisma.songCover.delete({ where: { id: cover.id } });

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

    const remaining = await prisma.songCover.findMany({
      where: { songDocId: docId },
      orderBy: { sortOrder: 'asc' },
    });

    if (!remaining.length) {
      await prisma.musicTrack.update({
        where: { docId },
        data: {
          defaultCoverSource: null,
          cover: '',
        },
      });
    } else {
      const hasDefault = remaining.some((item) => item.isDefault);
      const first = remaining[0];
      if (!hasDefault) {
        await prisma.songCover.update({
          where: { id: first.id },
          data: { isDefault: true },
        });
        await prisma.musicTrack.update({
          where: { docId },
          data: {
            defaultCoverSource: `song_cover:${first.id}`,
            cover: first.publicUrl,
          },
        });
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete song cover error:', error);
    res.status(500).json({ error: '删除歌曲封面失败' });
  }
}));

// Set default cover
router.patch('/:docId/covers/:coverId/default', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const { docId, coverId } = req.params;
    const cover = await prisma.songCover.findFirst({
      where: {
        id: coverId,
        songDocId: docId,
      },
    });
    if (!cover) {
      res.status(404).json({ error: '封面不存在' });
      return;
    }

    await prisma.songCover.updateMany({
      where: { songDocId: docId },
      data: { isDefault: false },
    });
    await prisma.songCover.update({
      where: { id: coverId },
      data: { isDefault: true },
    });
    await prisma.musicTrack.update({
      where: { docId },
      data: {
        defaultCoverSource: `song_cover:${coverId}`,
        cover: cover.publicUrl,
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Set song default cover error:', error);
    res.status(500).json({ error: '设置默认封面失败' });
  }
}));

// Get music albums
router.get('/:docId/albums', asyncHandler(async (req, res) => {
  try {
    const songDocId = req.params.docId;
    const relationsRaw = await prisma.songAlbumRelation.findMany({
      where: { songDocId },
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
    });

    const relations = ensureDisplayRelation(relationsRaw);
    for (const relation of relations) {
      await prisma.songAlbumRelation.update({
        where: { id: relation.id },
        data: { isDisplay: relation.isDisplay },
      });
    }

    res.json({
      relations: relations.map((relation) => ({
        id: relation.id,
        songDocId: relation.songDocId,
        albumDocId: relation.albumDocId,
        discNumber: relation.discNumber,
        trackOrder: relation.trackOrder,
        isDisplay: relation.isDisplay,
        album: {
          docId: relation.album.docId,
          title: relation.album.title,
          artist: relation.album.artist,
          cover: relation.album.cover,
          defaultCoverSource: relation.album.defaultCoverSource,
        },
      })),
    });
  } catch (error) {
    console.error('Fetch song albums error:', error);
    res.status(500).json({ error: '获取歌曲关联专辑失败' });
  }
}));

// Add music to album
router.post('/:docId/albums', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const songDocId = req.params.docId;
    const albumDocId = typeof req.body?.albumDocId === 'string' ? req.body.albumDocId.trim() : '';
    const discNumber = parseInteger(req.body?.discNumber, 1, { min: 1, max: 20 });
    const trackOrder = parseInteger(req.body?.trackOrder, 0, { min: 0, max: 5000 });
    const isDisplay = parseBoolean(req.body?.isDisplay, false);

    if (!albumDocId) {
      res.status(400).json({ error: '缺少 albumDocId' });
      return;
    }

    const [song, album] = await Promise.all([
      prisma.musicTrack.findUnique({ where: { docId: songDocId } }),
      prisma.album.findUnique({ where: { docId: albumDocId } }),
    ]);

    if (!song || !album) {
      res.status(404).json({ error: '歌曲或专辑不存在' });
      return;
    }

    const relation = await prisma.songAlbumRelation.upsert({
      where: {
        songDocId_albumDocId: {
          songDocId,
          albumDocId,
        },
      },
      create: {
        songDocId,
        albumDocId,
        discNumber,
        trackOrder,
        isDisplay,
      },
      update: {
        discNumber,
        trackOrder,
        isDisplay,
      },
    });

    if (isDisplay) {
      await prisma.songAlbumRelation.updateMany({
        where: {
          songDocId,
          id: { not: relation.id },
        },
        data: { isDisplay: false },
      });
    }

    const tracksFromAlbum = await prisma.songAlbumRelation.findMany({
      where: { albumDocId },
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
    });
    await prisma.album.update({
      where: { docId: albumDocId },
      data: {
        tracks: buildAlbumTracksPayload(tracksFromAlbum),
      },
    });

    const updatedSong = await fetchSongWithRelationsByDocId(songDocId);
    res.status(201).json({
      song: updatedSong ? toSongResponse(updatedSong) : null,
    });
  } catch (error) {
    console.error('Create song album relation error:', error);
    res.status(500).json({ error: '创建歌曲专辑关联失败' });
  }
}));

// Update music album relation
router.patch('/:docId/albums/:albumDocId', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const { docId: songDocId, albumDocId } = req.params;
    const existing = await prisma.songAlbumRelation.findUnique({
      where: {
        songDocId_albumDocId: {
          songDocId,
          albumDocId,
        },
      },
    });

    if (!existing) {
      res.status(404).json({ error: '关联不存在' });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (req.body?.discNumber !== undefined) {
      updateData.discNumber = parseInteger(req.body.discNumber, existing.discNumber, { min: 1, max: 20 });
    }
    if (req.body?.trackOrder !== undefined) {
      updateData.trackOrder = parseInteger(req.body.trackOrder, existing.trackOrder, { min: 0, max: 5000 });
    }
    if (req.body?.isDisplay !== undefined) {
      updateData.isDisplay = parseBoolean(req.body.isDisplay, existing.isDisplay);
    }

    const updated = await prisma.songAlbumRelation.update({
      where: { id: existing.id },
      data: updateData,
    });

    if (updated.isDisplay) {
      await prisma.songAlbumRelation.updateMany({
        where: {
          songDocId,
          id: { not: updated.id },
        },
        data: { isDisplay: false },
      });
    }

    const tracksFromAlbum = await prisma.songAlbumRelation.findMany({
      where: { albumDocId },
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
    });
    await prisma.album.update({
      where: { docId: albumDocId },
      data: {
        tracks: buildAlbumTracksPayload(tracksFromAlbum),
      },
    });

    const song = await fetchSongWithRelationsByDocId(songDocId);
    res.json({ song: song ? toSongResponse(song) : null });
  } catch (error) {
    console.error('Update song album relation error:', error);
    res.status(500).json({ error: '更新歌曲专辑关联失败' });
  }
}));

// Delete music album relation
router.delete('/:docId/albums/:albumDocId', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const { docId: songDocId, albumDocId } = req.params;
    const existing = await prisma.songAlbumRelation.findUnique({
      where: {
        songDocId_albumDocId: {
          songDocId,
          albumDocId,
        },
      },
    });

    if (!existing) {
      res.status(404).json({ error: '关联不存在' });
      return;
    }

    await prisma.songAlbumRelation.delete({ where: { id: existing.id } });

    const remaining = await prisma.songAlbumRelation.findMany({
      where: { songDocId },
      orderBy: [{ discNumber: 'asc' }, { trackOrder: 'asc' }],
    });
    if (remaining.length && !remaining.some((item) => item.isDisplay)) {
      await prisma.songAlbumRelation.update({
        where: { id: remaining[0].id },
        data: { isDisplay: true },
      });
    }

    const tracksFromAlbum = await prisma.songAlbumRelation.findMany({
      where: { albumDocId },
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
    });
    await prisma.album.update({
      where: { docId: albumDocId },
      data: {
        tracks: buildAlbumTracksPayload(tracksFromAlbum),
      },
    });

    const song = await fetchSongWithRelationsByDocId(songDocId);
    res.json({ song: song ? toSongResponse(song) : null });
  } catch (error) {
    console.error('Delete song album relation error:', error);
    res.status(500).json({ error: '删除歌曲专辑关联失败' });
  }
}));

// Get instrumentals
router.get('/:docId/instrumentals', asyncHandler(async (req, res) => {
  try {
    const songDocId = req.params.docId;
    const relations = await prisma.songInstrumentalRelation.findMany({
      where: { songDocId },
      include: {
        targetSong: {
          select: {
            docId: true,
            id: true,
            title: true,
            artist: true,
            cover: true,
            instrumentalForLinks: { select: { id: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      instrumentals: relations.map((relation) => ({
        id: relation.id,
        songDocId: relation.songDocId,
        instrumentalSongDocId: relation.targetSongDocId,
        instrumentalSong: {
          docId: relation.targetSong.docId,
          id: relation.targetSong.id,
          title: relation.targetSong.title,
          artist: relation.targetSong.artist,
          cover: relation.targetSong.cover,
          isInstrumental: (relation.targetSong.instrumentalForLinks?.length || 0) > 0,
        },
      })),
    });
  } catch (error) {
    console.error('Fetch song instrumentals error:', error);
    res.status(500).json({ error: '获取歌曲伴奏失败' });
  }
}));

// Get instrumental for
router.get('/:docId/instrumental-for', asyncHandler(async (req, res) => {
  try {
    const songDocId = req.params.docId;
    const relations = await prisma.songInstrumentalRelation.findMany({
      where: { targetSongDocId: songDocId },
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
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      originals: relations.map((relation) => ({
        id: relation.id,
        songDocId: relation.songDocId,
        targetSongDocId: relation.targetSongDocId,
        song: {
          docId: relation.song.docId,
          id: relation.song.id,
          title: relation.song.title,
          artist: relation.song.artist,
          cover: relation.song.cover,
        },
      })),
    });
  } catch (error) {
    console.error('Fetch song instrumental for error:', error);
    res.status(500).json({ error: '获取歌曲原曲失败' });
  }
}));

// Add instrumental
router.post('/:docId/instrumentals', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const songDocId = req.params.docId;
    const instrumentalSongDocId = typeof req.body?.instrumentalSongDocId === 'string' ? req.body.instrumentalSongDocId.trim() : '';

    if (!instrumentalSongDocId) {
      res.status(400).json({ error: '缺少 instrumentalSongDocId' });
      return;
    }

    const [song, instrumentalSong] = await Promise.all([
      prisma.musicTrack.findUnique({ where: { docId: songDocId } }),
      prisma.musicTrack.findUnique({
        where: { docId: instrumentalSongDocId },
        include: { instrumentalForLinks: { select: { id: true } } },
      }),
    ]);

    if (!song || !instrumentalSong) {
      res.status(404).json({ error: '歌曲不存在' });
      return;
    }

    if (!(instrumentalSong.instrumentalForLinks?.length)) {
      res.status(400).json({ error: '目标歌曲不是伴奏' });
      return;
    }

    const existing = await prisma.songInstrumentalRelation.findFirst({
      where: {
        songDocId,
        targetSongDocId: instrumentalSongDocId,
      },
    });

    if (existing) {
      res.status(409).json({ error: '该伴奏已关联' });
      return;
    }

    const relation = await prisma.songInstrumentalRelation.create({
      data: {
        songDocId,
        targetSongDocId: instrumentalSongDocId,
      },
    });

    res.status(201).json({
      relation: {
        id: relation.id,
        songDocId: relation.songDocId,
        instrumentalSongDocId: relation.targetSongDocId,
      },
    });
  } catch (error) {
    console.error('Create song instrumental relation error:', error);
    res.status(500).json({ error: '创建歌曲伴奏关联失败' });
  }
}));

// Delete instrumental
router.delete('/:docId/instrumentals/:instrumentalSongDocId', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const { docId: songDocId, instrumentalSongDocId } = req.params;
    const existing = await prisma.songInstrumentalRelation.findFirst({
      where: {
        songDocId,
        targetSongDocId: instrumentalSongDocId,
      },
    });

    if (!existing) {
      res.status(404).json({ error: '关联不存在' });
      return;
    }

    await prisma.songInstrumentalRelation.delete({ where: { id: existing.id } });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete song instrumental relation error:', error);
    res.status(500).json({ error: '删除歌曲伴奏关联失败' });
  }
}));

// Custom platforms
router.patch('/:docId/custom-platforms', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const docId = req.params.docId;
    const song = await prisma.musicTrack.findUnique({ where: { docId } });
    if (!song) {
      res.status(404).json({ error: '歌曲不存在' });
      return;
    }

    const customPlatformLinks = normalizeSongCustomPlatformLinks(req.body?.customPlatformLinks);
    await prisma.musicTrack.update({
      where: { docId },
      data: { customPlatformLinks: customPlatformLinks as unknown as Prisma.InputJsonValue },
    });

    const updated = await fetchSongWithRelationsByDocId(docId);
    res.json({ song: updated ? toSongResponse(updated) : null });
  } catch (error) {
    console.error('Update custom platforms error:', error);
    res.status(500).json({ error: '更新自定义平台失败' });
  }
}));

// Music posts
router.get('/:docId/posts', asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const docId = req.params.docId;
    const limit = parseInteger(req.query.limit, 20, { min: 1, max: 100 });
    const sort = parsePostSort(req.query.sort);
    const visibilityWhere = buildPostVisibilityWhere(req.authUser);

    const where = {
      musicDocId: docId,
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
    console.error('Fetch music posts error:', error);
    res.status(500).json({ error: '获取音乐关联帖子失败' });
  }
}));

// Similarity calculation helper
function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s\u4e00-\u9fa5]/g, '').replace(/\s+/g, ' ');
  const na = normalize(a);
  const nb = normalize(b);

  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;

  const withoutParens = (s: string) => s.replace(/[（].*[)）]/g, '').replace(/[【\[].*[]】\]/g, '').trim();
  const naClean = withoutParens(na);
  const nbClean = withoutParens(nb);
  if (naClean && nbClean && (naClean.includes(nbClean) || nbClean.includes(naClean))) {
    return 0.9;
  }

  const maxLen = Math.max(na.length, nb.length);
  if (maxLen > 50) {
    return na.includes(nb) || nb.includes(na) ? 0.85 : 0;
  }

  const d = Math.max(na.length, nb.length);
  let similarity = 0;

  if (d <= 200) {
    similarity = levenshteinSimilarity(na, nb);
  } else {
    const aSub = na.slice(0, 50);
    const bSub = nb.slice(0, 50);
    similarity = levenshteinSimilarity(aSub, bSub);
  }

  if (na.includes(nb) || nb.includes(na)) {
    similarity = Math.max(similarity, 0.85);
  }

  return similarity;
}

function levenshteinSimilarity(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }
  const distance = matrix[b.length][a.length];
  return 1 - distance / Math.max(a.length, b.length);
}

export function registerMusicRoutes(app: Router) {
  app.use('/api/music', router);
}
