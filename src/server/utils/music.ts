// 音乐平台解析、播放URL、导入、CRUD 全链路

import { Prisma } from '@prisma/client';
import {
  prisma,
  PLAY_URL_CACHE_TTL_MS,
  DEFAULT_MUSIC_PLATFORMS,
} from './config';
import { enhancedCache, CACHE_KEYS } from './cache';
import { parseInteger } from './parsers';
import type {
  MusicPlatform,
  MusicTrackWithRelations,
  DisplayAlbumMode,
  ImportSongInput,
  SongCustomPlatformLink,
  PlayUrlCacheValue,
} from '../types';
import {
  parseMusicUrl,
  type MusicPlatform as ParsedMusicPlatform,
} from '../music/musicUrlParser';
import {
  getMusicResourcePreview,
  resolveAudioUrl as resolveMetingAudioUrl,
  resolveLyric as resolveMetingLyric,
  resolveCoverUrl as resolveMetingCoverUrl,
} from '../music/metingService';

// ─── 显示辅助函数 ───────────────────────────────────────────────

export function resolveSongDisplayAlbum(song: {
  displayAlbumMode: DisplayAlbumMode;
  manualAlbumName: string | null;
  albumRelations: Array<{
    isDisplay: boolean;
    album: {
      docId: string;
      title: string;
    };
  }>;
}) {
  if (song.displayAlbumMode === 'none') {
    return {
      mode: 'none' as const,
      albumDocId: null,
      title: '',
    };
  }

  if (song.displayAlbumMode === 'manual') {
    return {
      mode: 'manual' as const,
      albumDocId: null,
      title: song.manualAlbumName || '',
    };
  }

  const displayRelation = song.albumRelations.find((item) => item.isDisplay) || song.albumRelations[0] || null;
  if (!displayRelation) {
    return {
      mode: 'linked' as const,
      albumDocId: null,
      title: '',
    };
  }

  return {
    mode: 'linked' as const,
    albumDocId: displayRelation.album.docId,
    title: displayRelation.album.title,
  };
}

export function resolveSongCoverUrl(song: Pick<MusicTrackWithRelations, 'cover' | 'defaultCoverSource' | 'covers' | 'albumRelations'>) {
  const source = (song.defaultCoverSource || '').trim();
  if (!source || source === 'old_cover') {
    return song.cover || '';
  }

  if (source.startsWith('song_cover:')) {
    const coverId = source.slice('song_cover:'.length);
    const matched = song.covers.find((item) => item.id === coverId);
    return matched?.publicUrl || song.cover || '';
  }

  if (source.startsWith('album_cover:')) {
    const coverId = source.slice('album_cover:'.length);
    for (const relation of song.albumRelations) {
      const matched = relation.album.covers.find((item) => item.id === coverId);
      if (matched?.publicUrl) {
        return matched.publicUrl;
      }
    }
    return song.cover || '';
  }

  return song.cover || '';
}

// ─── 自定义链接函数 ──────────────────────────────────────────────

export function normalizeSongCustomPlatformLinkUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const raw = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

export function normalizeSongCustomPlatformLinks(input: unknown): SongCustomPlatformLink[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const deduped = new Set<string>();
  const links: SongCustomPlatformLink[] = [];

  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const rawLabel = typeof (item as { label?: unknown }).label === 'string'
      ? (item as { label: string }).label.trim()
      : '';
    const normalizedLabel = rawLabel.slice(0, 30);
    const rawUrl = typeof (item as { url?: unknown }).url === 'string'
      ? (item as { url: string }).url
      : '';
    const normalizedUrl = normalizeSongCustomPlatformLinkUrl(rawUrl);

    if (!normalizedLabel || !normalizedUrl) {
      continue;
    }

    const key = `${normalizedLabel}::${normalizedUrl}`;
    if (deduped.has(key)) {
      continue;
    }

    deduped.add(key);
    links.push({
      label: normalizedLabel,
      url: normalizedUrl,
    });

    if (links.length >= 10) {
      break;
    }
  }

  return links;
}

// ─── 平台解析函数 ────────────────────────────────────────────────

export function getPlatformSourceId(song: {
  neteaseId?: string | null;
  tencentId?: string | null;
  kugouId?: string | null;
  baiduId?: string | null;
  kuwoId?: string | null;
  id?: string | null;
}, platform: MusicPlatform): string {
  if (platform === 'netease') return song.neteaseId?.trim() || '';
  if (platform === 'tencent') return song.tencentId?.trim() || '';
  if (platform === 'kugou') return song.kugouId?.trim() || '';
  if (platform === 'baidu') return song.baiduId?.trim() || '';
  if (platform === 'kuwo') return song.kuwoId?.trim() || '';
  return song.id?.trim() || '';
}

export function getPlatformSourceField(platform: MusicPlatform):
  | 'neteaseId'
  | 'tencentId'
  | 'kugouId'
  | 'baiduId'
  | 'kuwoId' {
  if (platform === 'netease') return 'neteaseId';
  if (platform === 'tencent') return 'tencentId';
  if (platform === 'kugou') return 'kugouId';
  if (platform === 'baidu') return 'baiduId';
  return 'kuwoId';
}

export function buildPlaybackPlatformCandidates(song: {
  enabledPlatform?: MusicPlatform | null;
  primaryPlatform?: MusicPlatform | null;
}): MusicPlatform[] {
  const preferred = song.enabledPlatform || song.primaryPlatform || null;
  const deduped = new Set<MusicPlatform>();
  if (preferred) {
    deduped.add(preferred);
  }
  DEFAULT_MUSIC_PLATFORMS.forEach((platform) => deduped.add(platform));
  return [...deduped.values()];
}

// ─── 播放缓存函数 ────────────────────────────────────────────────

export function clearExpiredPlayUrlCache() {
  const prefix = `${CACHE_KEYS.MUSIC_PLAY_URL}:`;
  const allKeys = enhancedCache.getNativeStats().keys as unknown as string[] | undefined;
  if (!allKeys) {
    try { enhancedCache.delete(prefix + '__sentinel__'); } catch { return; }
    return;
  }
  for (let i = 0; i < allKeys.length; i++) {
    if (allKeys[i].startsWith(prefix)) {
      enhancedCache.delete(allKeys[i]);
    }
  }
}

export function getCachedPlayUrl(cacheKey: string) {
  const enhancedKey = `${CACHE_KEYS.MUSIC_PLAY_URL}:${cacheKey}`;
  const cached = enhancedCache.get<PlayUrlCacheValue>(enhancedKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }
  if (cached) {
    enhancedCache.delete(enhancedKey);
  }
  return null;
}

export function setCachedPlayUrl(cacheKey: string, value: Omit<PlayUrlCacheValue, 'fetchedAt' | 'expiresAt'>) {
  const now = Date.now();
  const record: PlayUrlCacheValue = {
    ...value,
    fetchedAt: now,
    expiresAt: now + PLAY_URL_CACHE_TTL_MS,
  };

  // 写入增强缓存（限制大小）
  const enhancedKey = `${CACHE_KEYS.MUSIC_PLAY_URL}:${cacheKey}`;
  enhancedCache.set(enhancedKey, record, Math.ceil(PLAY_URL_CACHE_TTL_MS / 1000));
  return record;
}

export async function resolveMusicPlayUrl(song: {
  docId: string;
  id: string;
  audioUrl: string;
  primaryPlatform: MusicPlatform;
  enabledPlatform: MusicPlatform | null;
  neteaseId: string | null;
  tencentId: string | null;
  kugouId: string | null;
  baiduId: string | null;
  kuwoId: string | null;
}) {
  clearExpiredPlayUrlCache();

  const candidates = buildPlaybackPlatformCandidates(song);
  const errors: Array<{ platform: MusicPlatform; reason: string }> = [];

  for (const platform of candidates) {
    const sourceId = getPlatformSourceId(song, platform);
    if (!sourceId) {
      continue;
    }

    const cacheKey = `${song.docId}:${platform}:${sourceId}`;
    const cached = getCachedPlayUrl(cacheKey);
    if (cached?.url) {
      return {
        platform: cached.platform,
        sourceId: cached.sourceId,
        playUrl: cached.url,
        cached: true,
        cacheExpiresAt: new Date(cached.expiresAt).toISOString(),
      };
    }

    try {
      const resolvedUrl = await resolveMetingAudioUrl(platform as ParsedMusicPlatform, sourceId);
      if (!resolvedUrl) {
        errors.push({ platform, reason: 'empty_url' });
        continue;
      }

      const cachedRecord = setCachedPlayUrl(cacheKey, {
        platform,
        sourceId,
        url: resolvedUrl,
      });

      return {
        platform,
        sourceId,
        playUrl: resolvedUrl,
        cached: false,
        cacheExpiresAt: new Date(cachedRecord.expiresAt).toISOString(),
      };
    } catch (error) {
      errors.push({ platform, reason: error instanceof Error ? error.message : 'resolve_failed' });
    }
  }

  const fallbackUrl = song.audioUrl?.trim() || '';
  if (fallbackUrl) {
    return {
      platform: song.primaryPlatform,
      sourceId: song.id,
      playUrl: fallbackUrl,
      cached: false,
      cacheExpiresAt: null,
      fallback: true,
      errors,
    };
  }

  return {
    platform: song.primaryPlatform,
    sourceId: song.id,
    playUrl: '',
    cached: false,
    cacheExpiresAt: null,
    errors,
  };
}

// ─── 导入函数 ────────────────────────────────────────────────────

export function normalizeMusicImportTracks(input: unknown) {
  if (!Array.isArray(input)) {
    return [] as ImportSongInput[];
  }

  return input
    .map((item): ImportSongInput | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const record = item as Record<string, unknown>;
      const sourceId = typeof record.sourceId === 'string' ? record.sourceId.trim() : '';
      if (!sourceId) {
        return null;
      }

      return {
        sourceId,
        title: typeof record.title === 'string' ? record.title.trim() : '',
        artist: typeof record.artist === 'string' ? record.artist.trim() : '',
        album: typeof record.album === 'string' ? record.album.trim() : '',
        picId: typeof record.picId === 'string' ? record.picId.trim() : sourceId,
        urlId: typeof record.urlId === 'string' ? record.urlId.trim() : sourceId,
        lyricId: typeof record.lyricId === 'string' ? record.lyricId.trim() : sourceId,
        cover: typeof record.cover === 'string' ? record.cover.trim() : '',
        sourceUrl: typeof record.sourceUrl === 'string' ? record.sourceUrl.trim() : '',
        isInstrumental: typeof record.isInstrumental === 'boolean' ? record.isInstrumental : undefined,
      };
    })
    .filter((item): item is ImportSongInput => Boolean(item));
}

// ─── CRUD 函数 ───────────────────────────────────────────────────

export function buildAlbumTracksPayload(relations: Array<{
  songDocId: string;
  trackOrder: number;
  discNumber: number;
  song: {
    docId: string;
    title: string;
    artist: string;
    cover: string;
    id: string;
  };
}>) {
  const byDisc = new Map<number, Array<{ songDocId: string; trackOrder: number; song: { docId: string; title: string; artist: string; cover: string; id: string } }>>();

  relations.forEach((relation) => {
    const disc = relation.discNumber > 0 ? relation.discNumber : 1;
    if (!byDisc.has(disc)) {
      byDisc.set(disc, []);
    }
    byDisc.get(disc)!.push({
      songDocId: relation.songDocId,
      trackOrder: relation.trackOrder,
      song: relation.song,
    });
  });

  return [...byDisc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([disc, songs]) => ({
      disc,
      name: `Disc ${disc}`,
      songs: songs
        .sort((a, b) => a.trackOrder - b.trackOrder)
        .map((entry) => ({
          songDocId: entry.songDocId,
          trackOrder: entry.trackOrder,
          song: entry.song,
        })),
    }));
}

/** applyAlbumTracksToRelations 接受的 tracks 参数类型（与 normalizeTrackDiscPayload 返回值一致） */
export type AlbumTrackDiscPayload = Array<{
  disc: number;
  name: string;
  songs: Array<{ songDocId: string; trackOrder: number }>;
}>;

export async function applyAlbumTracksToRelations(albumDocId: string, tracks: AlbumTrackDiscPayload) {
  const createRows: Array<{
    songDocId: string;
    albumDocId: string;
    discNumber: number;
    trackOrder: number;
    isDisplay: boolean;
  }> = [];

  tracks.forEach((discEntry) => {
    discEntry.songs.forEach((songEntry) => {
      createRows.push({
        songDocId: songEntry.songDocId,
        albumDocId,
        discNumber: discEntry.disc,
        trackOrder: songEntry.trackOrder,
        isDisplay: false,
      });
    });
  });

  await prisma.$transaction([
    prisma.songAlbumRelation.deleteMany({ where: { albumDocId } }),
    ...(createRows.length
      ? [prisma.songAlbumRelation.createMany({ data: createRows, skipDuplicates: true })]
      : []),
  ]);
}

export async function addSongCoverFromAsset(songDocId: string, assetId: string, markDefault = false) {
  const asset = await prisma.mediaAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      storageKey: true,
      publicUrl: true,
      status: true,
    },
  });

  if (!asset || asset.status !== 'ready') {
    throw new Error('媒体资源不存在或不可用');
  }

  const currentCount = await prisma.songCover.count({ where: { songDocId } });

  const cover = await prisma.songCover.create({
    data: {
      songDocId,
      assetId: asset.id,
      storageKey: asset.storageKey,
      publicUrl: asset.publicUrl,
      sortOrder: currentCount,
      isDefault: markDefault,
    },
  });

  if (markDefault) {
    await prisma.songCover.updateMany({
      where: {
        songDocId,
        id: { not: cover.id },
      },
      data: {
        isDefault: false,
      },
    });
    await prisma.musicTrack.update({
      where: { docId: songDocId },
      data: {
        defaultCoverSource: `song_cover:${cover.id}`,
      },
    });
  }

  return cover;
}

export async function addAlbumCoverFromAsset(albumDocId: string, assetId: string, markDefault = false) {
  const asset = await prisma.mediaAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      storageKey: true,
      publicUrl: true,
      status: true,
    },
  });

  if (!asset || asset.status !== 'ready') {
    throw new Error('媒体资源不存在或不可用');
  }

  const currentCount = await prisma.albumCover.count({ where: { albumDocId } });

  const cover = await prisma.albumCover.create({
    data: {
      albumDocId,
      assetId: asset.id,
      storageKey: asset.storageKey,
      publicUrl: asset.publicUrl,
      sortOrder: currentCount,
      isDefault: markDefault,
    },
  });

  if (markDefault) {
    await prisma.albumCover.updateMany({
      where: {
        albumDocId,
        id: { not: cover.id },
      },
      data: {
        isDefault: false,
      },
    });
    await prisma.album.update({
      where: { docId: albumDocId },
      data: {
        defaultCoverSource: `album_cover:${cover.id}`,
      },
    });
  }

  return cover;
}

export async function createOrUpdateImportedSong(params: {
  platform: MusicPlatform;
  track: ImportSongInput;
  userUid: string;
  albumNameFallback?: string;
}) {
  const { platform, track, userUid, albumNameFallback } = params;
  const sourceField = getPlatformSourceField(platform);
  const platformId = track.sourceId;

  const existingByPlatformId = await prisma.musicTrack.findFirst({
    where: {
      OR: [
        { [sourceField]: platformId },
        { id: track.sourceId },
      ] as Prisma.MusicTrackWhereInput[],
    },
  });

  if (existingByPlatformId) {
    const fallbackTitle = `未命名歌曲 ${track.sourceId}`;
    const title = track.title || fallbackTitle;
    const artist = track.artist || '未知歌手';
    const album = track.album || albumNameFallback || '未知专辑';

    const resolvedCover = (await resolveMetingCoverUrl(platform as ParsedMusicPlatform, track.picId, track.cover)) || track.cover;
    const resolvedAudioUrl = (await resolveMetingAudioUrl(platform as ParsedMusicPlatform, track.urlId)) || '';
    const resolvedLyric = (await resolveMetingLyric(platform as ParsedMusicPlatform, track.lyricId)) || '';

    const song = await prisma.musicTrack.update({
      where: { docId: existingByPlatformId.docId },
      data: {
        id: existingByPlatformId.id || track.sourceId,
        title,
        artist,
        album,
        cover: resolvedCover || '',
        audioUrl: resolvedAudioUrl || '',
        lyric: resolvedLyric || null,
        primaryPlatform: platform,
        enabledPlatform: platform,
        [sourceField]: platformId,
      },
    });
    return {
      song,
      created: false,
      linked: false,
    };
  }

  const fallbackTitle = `未命名歌曲 ${track.sourceId}`;
  const title = track.title || fallbackTitle;
  const artist = track.artist || '未知歌手';
  const album = track.album || albumNameFallback || '未知专辑';

  const existingByTitleArtist = await prisma.musicTrack.findFirst({
    where: {
      AND: [
        { title: { equals: title } },
        { artist: { equals: artist } },
        {
          OR: [
            { neteaseId: { not: null } },
            { tencentId: { not: null } },
            { kugouId: { not: null } },
            { baiduId: { not: null } },
            { kuwoId: { not: null } },
          ],
        },
      ],
    } as Prisma.MusicTrackWhereInput,
  });

  const resolvedCover = (await resolveMetingCoverUrl(platform as ParsedMusicPlatform, track.picId, track.cover)) || track.cover;
  const resolvedAudioUrl = (await resolveMetingAudioUrl(platform as ParsedMusicPlatform, track.urlId)) || '';
  const resolvedLyric = (await resolveMetingLyric(platform as ParsedMusicPlatform, track.lyricId)) || '';

  if (existingByTitleArtist) {
    const conflictPlatformId = (existingByTitleArtist as unknown as Record<string, string | null>)[sourceField];
    if (conflictPlatformId) {
      const song = await prisma.musicTrack.create({
        data: {
          id: track.sourceId,
          title,
          artist,
          album,
          cover: resolvedCover || '',
          audioUrl: resolvedAudioUrl || '',
          lyric: resolvedLyric || null,
          primaryPlatform: platform,
          enabledPlatform: platform,
          [sourceField]: platformId,
          addedBy: userUid,
        },
      });
      return {
        song,
        created: true,
        linked: false,
      };
    }

    const updatedSong = await prisma.musicTrack.update({
      where: { docId: existingByTitleArtist.docId },
      data: {
        id: existingByTitleArtist.id || track.sourceId,
        title,
        artist,
        album,
        cover: resolvedCover || '',
        audioUrl: resolvedAudioUrl || '',
        lyric: resolvedLyric || null,
        primaryPlatform: platform,
        enabledPlatform: platform,
        [sourceField]: platformId,
      },
    });
    return {
      song: updatedSong,
      created: false,
      linked: true,
      linkedFrom: {
        docId: existingByTitleArtist.docId,
        title: existingByTitleArtist.title,
        artist: existingByTitleArtist.artist,
      },
    };
  }

  const song = await prisma.musicTrack.create({
    data: {
      id: track.sourceId,
      title,
      artist,
      album,
      cover: resolvedCover || '',
      audioUrl: resolvedAudioUrl || '',
      lyric: resolvedLyric || null,
      primaryPlatform: platform,
      enabledPlatform: platform,
      [sourceField]: platformId,
      addedBy: userUid,
    },
  });

  await autoLinkInstrumental(song.docId, title, artist, track.isInstrumental);

  return {
    song,
    created: true,
    linked: false,
  };
}

export async function autoLinkInstrumental(
  songDocId: string,
  title: string,
  artist: string,
  isInstrumentalFromAPI?: boolean,
): Promise<void> {
  const instrumentalPatterns = [
    /\(伴奏\)/,
    /（伴奏）/,
    /-伴奏/,
    /\s+伴奏$/,
    /伴奏版$/,
    /inst\.?$/i,
    /instrumental$/i,
  ];

  const isInstrumental = isInstrumentalFromAPI || instrumentalPatterns.some((pattern) => pattern.test(title));
  if (!isInstrumental) return;

  let originalTitle = title;
  if (!isInstrumentalFromAPI) {
    originalTitle = title
      .replace(/\(伴奏\)/, '')
      .replace(/（伴奏）/, '')
      .replace(/-伴奏/, '')
      .replace(/伴奏版$/, '')
      .replace(/inst\.?$/i, '')
      .replace(/instrumental$/i, '')
      .trim();
  }

  if (!originalTitle) return;

  const originalSong = await prisma.musicTrack.findFirst({
    where: {
      title: originalTitle,
      artist: artist,
      docId: { not: songDocId },
    },
  });

  if (!originalSong) return;

  await prisma.songInstrumentalRelation.upsert({
    where: {
      songDocId_targetSongDocId: {
        songDocId: songDocId,
        targetSongDocId: originalSong.docId,
      },
    },
    update: {},
    create: {
      songDocId: songDocId,
      targetSongDocId: originalSong.docId,
    },
  });
}

export async function fetchSongsWithRelations(
  where?: Record<string, unknown>,
  pagination?: { take?: number; skip?: number },
) {
  const songs = await prisma.musicTrack.findMany({
    where,
    include: {
      covers: {
        orderBy: { sortOrder: 'asc' },
      },
      albumRelations: {
        include: {
          album: {
            select: {
              docId: true,
              title: true,
              artist: true,
              cover: true,
              defaultCoverSource: true,
              covers: {
                orderBy: { sortOrder: 'asc' },
              },
            },
          },
        },
        orderBy: [{ discNumber: 'asc' }, { trackOrder: 'asc' }],
      },
      instrumentalLinks: {
        select: {
          targetSongDocId: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    ...(pagination?.take !== undefined ? { take: pagination.take } : {}),
    ...(pagination?.skip !== undefined ? { skip: pagination.skip } : {}),
  });
  return songs as MusicTrackWithRelations[];
}

export async function fetchSongWithRelationsByDocId(songDocId: string) {
  const song = await prisma.musicTrack.findUnique({
    where: { docId: songDocId },
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
      instrumentalLinks: {
        select: {
          targetSongDocId: true,
        },
      },
    },
  });
  return song as unknown as MusicTrackWithRelations | null;
}

export function ensureDisplayRelation<T extends { isDisplay: boolean }>(relations: T[]): T[] {
  const hasDisplay = relations.some((relation) => relation.isDisplay);
  if (hasDisplay || !relations.length) {
    return relations;
  }
  return relations.map((relation, index) => ({
    ...relation,
    isDisplay: index === 0,
  }));
}
