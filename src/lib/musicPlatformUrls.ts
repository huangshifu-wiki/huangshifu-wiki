import type { Platform } from '../types/common'

const MUSIC_PLATFORM_LABELS = {
  netease: '网易云音乐',
  tencent: 'QQ 音乐',
  kugou: '酷狗音乐',
  baidu: '百度音乐',
  kuwo: '酷我音乐',
} as const satisfies Record<Platform, string>

export const MUSIC_PLATFORM_OPTIONS = (
  Object.entries(MUSIC_PLATFORM_LABELS) as [Platform, string][]
).map(([value, label]) => ({ value, label }))

export const getMusicPlatformLabel = (platform: Platform) => MUSIC_PLATFORM_LABELS[platform]

export const isMusicPlatform = (value: string): value is Platform =>
  Object.hasOwn(MUSIC_PLATFORM_LABELS, value)

export function getPlatformExternalUrl(platform: string, id: string): string | null {
  if (!id || !id.trim()) return null
  switch (platform) {
    case 'netease':
      return `https://music.163.com/song?id=${id}`
    case 'tencent':
      return `https://y.qq.com/n/ryqq/songDetail/${id}`
    case 'kugou':
      return `https://www.kugou.com/song/#hash=${id}`
    case 'baidu':
      return `https://music.91q.com/#/song/${id}`
    case 'kuwo':
      return `https://www.kuwo.cn/play_detail/${id}`
    default:
      return null
  }
}
