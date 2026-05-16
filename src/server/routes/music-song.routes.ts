import { Router } from 'express';
import { prisma, resolveMusicPlayUrl, toSongResponse, normalizeMusicImportTracks } from '../utils';
import {
  getMusicResourcePreview,
  resolveAudioUrl as resolveMetingAudioUrl,
  resolveLyric as resolveMetingLyric,
} from '../music/metingService';
import type { MusicTrackWithRelations } from '../types';

const router = Router();

router.get('/song/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const existing = await prisma.musicTrack.findFirst({
      where: {
        OR: [
          { id },
          { neteaseId: id },
          { tencentId: id },
          { kugouId: id },
          { baiduId: id },
          { kuwoId: id },
        ],
      },
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
    });

    if (existing) {
      const resolved = await resolveMusicPlayUrl(existing);
      const song = toSongResponse(existing as MusicTrackWithRelations);
      res.json({
        ...song,
        playUrl: resolved.playUrl || song.audioUrl,
        playMeta: {
          platform: resolved.platform,
          sourceId: resolved.sourceId,
          cached: resolved.cached,
          cacheExpiresAt: resolved.cacheExpiresAt,
          fallback: Boolean((resolved as { fallback?: boolean }).fallback),
        },
      });
      return;
    }

    const preview = await getMusicResourcePreview('netease', 'song', id);
    const track = normalizeMusicImportTracks(preview.songs)[0];
    if (!track) {
      res.status(404).json({ error: '未找到歌曲信息' });
      return;
    }

    const audioUrl = await resolveMetingAudioUrl('netease', track.urlId);
    const lyric = await resolveMetingLyric('netease', track.lyricId);

    res.json({
      docId: null,
      id: track.sourceId,
      title: track.title || preview.title,
      artist: track.artist || preview.artist,
      album: track.album || preview.title,
      cover: track.cover || preview.cover,
      audioUrl: audioUrl || '',
      playUrl: audioUrl || '',
      lyric: lyric || null,
      primaryPlatform: 'netease',
      enabledPlatform: 'netease',
      platformIds: {
        neteaseId: track.sourceId,
        tencentId: null,
        kugouId: null,
        baiduId: null,
        kuwoId: null,
      },
      customPlatformLinks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching song metadata:', error);
    res.status(500).json({ error: 'Failed to fetch song metadata' });
  }
});

export function registerMusicSongRoutes(app: Router) {
  app.use('/api/music', router);
}
