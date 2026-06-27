export type MusicPlatform = 'netease' | 'tencent' | 'kugou' | 'baidu' | 'kuwo';

export type MusicResourceType = 'song' | 'album' | 'playlist';

export interface ParsedMusicUrl {
  platform: MusicPlatform;
  type: MusicResourceType;
  id: string;
  normalizedUrl: string;
}

const PLATFORM_URL_PATTERNS: Array<{
  platform: MusicPlatform;
  type: MusicResourceType;
  patterns: RegExp[];
}> = [
  {
    platform: 'netease',
    type: 'song',
    patterns: [
      /music\.163\.com\/#\/song\?id=([a-z0-9_-]+)/i,
      /music\.163\.com\/song\?id=([a-z0-9_-]+)/i,
      /y\.music\.163\.com\/m\/song\?id=([a-z0-9_-]+)/i,
    ],
  },
  {
    platform: 'netease',
    type: 'album',
    patterns: [
      /music\.163\.com\/#\/album\?id=([a-z0-9_-]+)/i,
      /music\.163\.com\/album\?id=([a-z0-9_-]+)/i,
    ],
  },
  {
    platform: 'netease',
    type: 'playlist',
    patterns: [
      /music\.163\.com\/#\/playlist\?id=([a-z0-9_-]+)/i,
      /music\.163\.com\/playlist\?id=([a-z0-9_-]+)/i,
    ],
  },
  {
    platform: 'tencent',
    type: 'song',
    patterns: [
      /y\.qq\.com\/n\/ryqq\/songdetail\/([a-z0-9_-]+)/i,
      /y\.qq\.com\/n\/yqq\/song\/([a-z0-9_-]+)/i,
    ],
  },
  {
    platform: 'tencent',
    type: 'album',
    patterns: [
      /y\.qq\.com\/n\/ryqq\/albumdetail\/([a-z0-9_-]+)/i,
    ],
  },
  {
    platform: 'tencent',
    type: 'playlist',
    patterns: [
      /y\.qq\.com\/n\/ryqq\/playlist\/([a-z0-9_-]+)/i,
      /y\.qq\.com\/n\/ryqq\/playlistdetail\/([a-z0-9_-]+)/i,
      /y\.qq\.com\/n\/ryqq\/songlist\/([a-z0-9_-]+)/i,
    ],
  },
  {
    platform: 'kugou',
    type: 'song',
    patterns: [
      /kugou\.com\/song\/#hash=([a-z0-9_-]+)/i,
      /kugou\.com\/song\/([a-z0-9_-]+)/i,
      /kugou\.com\/\S*[?&]hash=([a-z0-9_-]+)/i,
    ],
  },
  {
    platform: 'kugou',
    type: 'album',
    patterns: [
      /kugou\.com\/album\/([a-z0-9_-]+)/i,
    ],
  },
  {
    platform: 'kugou',
    type: 'playlist',
    patterns: [
      /kugou\.com\/songlist\/([a-z0-9_-]+)/i,
      /kugou\.com\/special\/single\/([a-z0-9_-]+)/i,
    ],
  },
  {
    platform: 'baidu',
    type: 'song',
    patterns: [
      /music\.baidu\.com\/song\/([a-z0-9_-]+)/i,
    ],
  },
  {
    platform: 'baidu',
    type: 'album',
    patterns: [
      /music\.baidu\.com\/album\/([a-z0-9_-]+)/i,
    ],
  },
  {
    platform: 'baidu',
    type: 'playlist',
    patterns: [
      /music\.baidu\.com\/songlist\/([a-z0-9_-]+)/i,
    ],
  },
  {
    platform: 'kuwo',
    type: 'song',
    patterns: [
      /kuwo\.cn\/song_detail\/([a-z0-9_-]+)/i,
    ],
  },
  {
    platform: 'kuwo',
    type: 'album',
    patterns: [
      /kuwo\.cn\/album_detail\/([a-z0-9_-]+)/i,
    ],
  },
  {
    platform: 'kuwo',
    type: 'playlist',
    patterns: [
      /kuwo\.cn\/playlist_detail\/([a-z0-9_-]+)/i,
      /kuwo\.cn\/play_detail\/([a-z0-9_-]+)/i,
    ],
  },
];

function normalizeUrlInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function sanitizeResourceId(value: string) {
  return value.trim().replace(/[?#&].*$/, '');
}

export function buildPlatformResourceUrl(platform: MusicPlatform, type: MusicResourceType, id: string) {
  const safeId = encodeURIComponent(id);

  if (platform === 'netease') {
    return `https://music.163.com/#/${type}?id=${safeId}`;
  }
  if (platform === 'tencent') {
    if (type === 'song') return `https://y.qq.com/n/ryqq/songDetail/${safeId}`;
    if (type === 'album') return `https://y.qq.com/n/ryqq/albumDetail/${safeId}`;
    return `https://y.qq.com/n/ryqq/playlist/${safeId}`;
  }
  if (platform === 'kugou') {
    if (type === 'song') return `https://www.kugou.com/song/#hash=${safeId}`;
    if (type === 'album') return `https://www.kugou.com/album/${safeId}.html`;
    return `https://www.kugou.com/songlist/${safeId}`;
  }
  if (platform === 'baidu') {
    if (type === 'song') return `https://music.baidu.com/song/${safeId}`;
    if (type === 'album') return `https://music.baidu.com/album/${safeId}`;
    return `https://music.baidu.com/songlist/${safeId}`;
  }
  if (type === 'song') return `https://www.kuwo.cn/song_detail/${safeId}`;
  if (type === 'album') return `https://www.kuwo.cn/album_detail/${safeId}`;
  return `https://www.kuwo.cn/playlist_detail/${safeId}`;
}

export function parseMusicUrl(rawUrl: string): ParsedMusicUrl | null {
  const normalized = normalizeUrlInput(rawUrl);
  if (!normalized) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(normalized);
  } catch {
    return null;
  }
  for (const rule of PLATFORM_URL_PATTERNS) {
    for (const pattern of rule.patterns) {
      const matched = decoded.match(pattern);
      if (!matched?.[1]) {
        continue;
      }
      const id = sanitizeResourceId(matched[1]);
      if (!id) {
        continue;
      }

      return {
        platform: rule.platform,
        type: rule.type,
        id,
        normalizedUrl: buildPlatformResourceUrl(rule.platform, rule.type, id),
      };
    }
  }

  return null;
}
