import type { MusicCover } from '../types/api'

export function buildMusicCoverGallery(
  resource:
    | {
        docId: string
        title: string
        cover?: string | null
        coverThumbnail?: string | null
        covers?: readonly MusicCover[]
      }
    | null
    | undefined
) {
  const images: Array<{ id: string; url: string; originalUrl: string; name: string }> = []
  if (!resource) return { images, initialIndex: 0 }
  const seen = new Set<string>()
  for (const cover of resource.covers ?? []) {
    if (!cover.url || seen.has(cover.url)) continue
    seen.add(cover.url)
    images.push({
      id: cover.id,
      url: cover.thumbnailUrl || cover.url,
      originalUrl: cover.url,
      name: `${resource.title} 封面`,
    })
  }
  const current = resource.cover || resource.coverThumbnail || ''
  const index = images.findIndex((image) => image.originalUrl === current)
  // 当前封面可能继承自专辑，不在歌曲自身封面列表中。
  if (current && index < 0)
    images.unshift({
      id: `${resource.docId}-cover`,
      url: resource.coverThumbnail || current,
      originalUrl: current,
      name: `${resource.title} 封面`,
    })
  return { images, initialIndex: Math.max(0, index) }
}
