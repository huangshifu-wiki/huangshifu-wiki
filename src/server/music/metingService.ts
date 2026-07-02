import Meting from '@meting/core'

import { formatMusicCredits, normalizeStringListInput } from '../../lib/musicCredits'
import {
  buildPlatformResourceUrl,
  type MusicPlatform,
  type MusicResourceType,
} from './musicUrlParser'

type MetingTrackRaw = {
  id?: string | number
  name?: string
  artist?: string[] | string
  album?: string
  pic_id?: string | number
  url_id?: string | number
  lyric_id?: string | number
  source?: string
  type?: number
}

export interface MusicImportTrack {
  sourceId: string
  title: string
  artists: string[]
  album: string
  picId: string
  urlId: string
  lyricId: string
  cover: string
  sourceUrl: string
  isInstrumental?: boolean
}

export interface MusicResourcePreview {
  platform: MusicPlatform
  type: MusicResourceType
  id: string
  title: string
  artist: string
  cover: string
  description: string
  platformUrl: string
  songs: MusicImportTrack[]
}

export interface MusicSearchItem {
  sourceId: string
  title: string
  artists: string[]
  album: string
  picId: string
  sourceUrl: string
}

function createClient(platform: MusicPlatform, formatted = true) {
  const client = new Meting(platform)
  client.format(formatted)
  return client
}

const METING_API_TIMEOUT_MS = 5000
const COVER_PROBE_TIMEOUT_MS = 3000
const TENCENT_COVER_SIZES = [3543, 3000, 1500, 1000, 800, 500, 300]

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Meting API timeout')), ms)
    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

function ensureString(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  return ''
}

function parseJsonSafe<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function toArray(value: unknown) {
  if (Array.isArray(value)) {
    return value
  }
  if (value && typeof value === 'object') {
    return [value]
  }
  return []
}

function normalizeText(value: unknown, fallback = '') {
  if (typeof value !== 'string') {
    return fallback
  }
  // Remove backticks that may wrap the URL from Meting API response
  const normalized = value.trim().replace(/^`+|`+$/g, '')
  return normalized || fallback
}

function normalizeImageUrl(value: unknown, fallback = '') {
  const url = normalizeText(value, fallback)
  if (!url) {
    return url
  }
  // Upgrade HTTP to HTTPS to avoid Mixed Content warnings
  return url.replace(/^http:\/\//i, 'https://')
}

function normalizeArtist(value: unknown, fallback = '未知歌手') {
  return formatMusicCredits(value, fallback)
}

function normalizeArtists(value: unknown, fallback = '未知歌手') {
  const artists = normalizeStringListInput(value)
  return artists.length ? artists : [fallback]
}

function normalizeId(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  if (typeof value === 'string') {
    const normalized = value.trim()
    return normalized || ''
  }
  return ''
}

async function runFormattedList(
  platform: MusicPlatform,
  runner: (client: Meting) => Promise<string>
) {
  const client = createClient(platform, true)
  const raw = ensureString(await withTimeout(runner(client), METING_API_TIMEOUT_MS))
  const parsed = parseJsonSafe<unknown>(raw, [])
  return toArray(parsed) as MetingTrackRaw[]
}

async function runRawValue(platform: MusicPlatform, runner: (client: Meting) => Promise<string>) {
  const client = createClient(platform, false)
  const raw = ensureString(await withTimeout(runner(client), METING_API_TIMEOUT_MS))
  return parseJsonSafe<unknown>(raw, {})
}

async function resolvePicById(platform: MusicPlatform, picId: string, fallback = '') {
  const candidates = await resolvePicCandidatesById(platform, picId, fallback)
  if (platform === 'tencent') {
    return (await firstReachableImageUrl(candidates)) || candidates[0] || fallback
  }
  return candidates[0] || fallback
}

async function resolvePicCandidatesById(platform: MusicPlatform, picId: string, fallback = '') {
  if (!picId) {
    return fallback ? [fallback] : []
  }

  if (platform === 'tencent') {
    const urls = TENCENT_COVER_SIZES.map((size) =>
      normalizeImageUrl(
        `https://y.gtimg.cn/music/photo_new/T002R${size}x${size}M000${picId}.jpg?max_age=2592000`
      )
    )
    return uniqueImageUrls([...urls, fallback])
  }

  try {
    const client = createClient(platform, true)
    const raw = ensureString(await withTimeout(client.pic(picId, 3543), METING_API_TIMEOUT_MS))
    const parsed = parseJsonSafe<unknown>(raw, {})
    if (Array.isArray(parsed)) {
      const urls = parsed
        .map((item) => normalizeImageUrl((item as { url?: string } | undefined)?.url))
        .filter(Boolean)
      return uniqueImageUrls([...urls, fallback])
    }
    if (parsed && typeof parsed === 'object') {
      return uniqueImageUrls([normalizeImageUrl((parsed as { url?: string }).url), fallback])
    }
  } catch {
    return fallback ? [fallback] : []
  }

  return fallback ? [fallback] : []
}

function uniqueImageUrls(urls: string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const url of urls) {
    const normalized = normalizeImageUrl(url)
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized)
      result.push(normalized)
    }
  }
  return result
}

async function firstReachableImageUrl(urls: string[]) {
  for (const url of urls) {
    if (await isImageUrlReachable(url)) {
      return url
    }
  }
  return ''
}

async function isImageUrlReachable(url: string) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(COVER_PROBE_TIMEOUT_MS),
    })
    if (response.ok) return true
    if (response.status === 404) return false
  } catch {
    // Some image CDNs reject HEAD but allow GET.
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(COVER_PROBE_TIMEOUT_MS),
    })
    await response.body?.cancel()
    return response.ok
  } catch {
    return false
  }
}

function normalizeTrack(platform: MusicPlatform, track: MetingTrackRaw): MusicImportTrack | null {
  const sourceId = normalizeId(track.id)
  if (!sourceId) {
    return null
  }

  const title = normalizeText(track.name, `未命名歌曲 ${sourceId}`)
  const artists = normalizeArtists(track.artist)
  const album = normalizeText(track.album, '未知专辑')
  const picId = normalizeId(track.pic_id) || sourceId
  const urlId = normalizeId(track.url_id) || sourceId
  const lyricId = normalizeId(track.lyric_id) || sourceId

  const isInstrumental = track.type === 1

  return {
    sourceId,
    title,
    artists,
    album,
    picId,
    urlId,
    lyricId,
    cover: '',
    sourceUrl: buildPlatformResourceUrl(platform, 'song', sourceId),
    isInstrumental,
  }
}

async function enrichTrackCovers(platform: MusicPlatform, tracks: MusicImportTrack[]) {
  const resolved: MusicImportTrack[] = []
  for (const track of tracks) {
    const cover = await resolvePicById(platform, track.picId, track.cover)
    resolved.push({
      ...track,
      cover,
    })
  }
  return resolved
}

function uniqueTracksBySourceId(tracks: MusicImportTrack[]) {
  const deduped = new Map<string, MusicImportTrack>()
  tracks.forEach((track) => {
    if (!deduped.has(track.sourceId)) {
      deduped.set(track.sourceId, track)
    }
  })
  return [...deduped.values()]
}

function normalizePreviewMeta(value: unknown) {
  if (!value || typeof value !== 'object') {
    return {
      title: '',
      artist: '',
      cover: '',
      description: '',
    }
  }

  const record = value as Record<string, unknown>
  return {
    title:
      normalizeText(record.title) ||
      normalizeText(record.name) ||
      normalizeText((record.album as Record<string, unknown> | undefined)?.name),
    artist:
      normalizeArtist(record.artist, '') ||
      normalizeArtist((record.creator as Record<string, unknown> | undefined)?.nickname, ''),
    cover:
      normalizeImageUrl(record.cover) ||
      normalizeImageUrl(record.coverImgUrl) ||
      normalizeImageUrl((record.album as Record<string, unknown> | undefined)?.picUrl) ||
      normalizeImageUrl((record.album as Record<string, unknown> | undefined)?.blurPicUrl),
    description: normalizeText(record.description) || normalizeText(record.briefDesc),
  }
}

function fallbackPreviewTitle(type: MusicResourceType, id: string) {
  if (type === 'album') {
    return `专辑 ${id}`
  }
  if (type === 'playlist') {
    return `歌单 ${id}`
  }
  return `歌曲 ${id}`
}

function mapSearchTypeToMeting(type: MusicResourceType | 'artist') {
  if (type === 'song') return 1
  if (type === 'album') return 10
  if (type === 'artist') return 100
  return 1000
}

export async function searchMusicResources(options: {
  platform: MusicPlatform
  keyword: string
  type: MusicResourceType | 'artist'
  page?: number
  limit?: number
}) {
  const client = createClient(options.platform, true)
  const raw = ensureString(
    await withTimeout(
      client.search(options.keyword, {
        type: mapSearchTypeToMeting(options.type),
        page: options.page || 1,
        limit: options.limit || 20,
      }),
      METING_API_TIMEOUT_MS
    )
  )
  const parsed = parseJsonSafe<unknown>(raw, [])
  const list = toArray(parsed) as MetingTrackRaw[]

  const items: MusicSearchItem[] = list
    .map((item) => {
      const sourceId = normalizeId(item.id)
      if (!sourceId) {
        return null
      }
      const title = normalizeText(item.name, sourceId)
      const artists = normalizeArtists(item.artist, '未知歌手')
      const album = normalizeText(item.album, '')
      const picId = normalizeId(item.pic_id) || sourceId

      return {
        sourceId,
        title,
        artists,
        album,
        picId,
        sourceUrl: buildPlatformResourceUrl(
          options.platform,
          options.type === 'artist' ? 'song' : options.type,
          sourceId
        ),
      }
    })
    .filter((item): item is MusicSearchItem => Boolean(item))

  return items
}

export async function getMusicResourcePreview(
  platform: MusicPlatform,
  type: MusicResourceType,
  id: string
): Promise<MusicResourcePreview> {
  if (type === 'song') {
    const songs = await runFormattedList(platform, (client) => client.song(id))
    const normalizedTrack = normalizeTrack(platform, songs[0] || { id })
    if (!normalizedTrack) {
      throw new Error('未找到可导入的歌曲')
    }
    const cover = await resolvePicById(platform, normalizedTrack.picId, normalizedTrack.cover)

    return {
      platform,
      type,
      id,
      title: normalizedTrack.title,
      artist: formatMusicCredits(normalizedTrack.artists, '未知歌手'),
      cover,
      description: '',
      platformUrl: buildPlatformResourceUrl(platform, type, id),
      songs: [
        {
          ...normalizedTrack,
          cover,
        },
      ],
    }
  }

  const formattedTracks = await runFormattedList(platform, (client) =>
    type === 'album' ? client.album(id) : client.playlist(id)
  )
  const normalized = uniqueTracksBySourceId(
    formattedTracks
      .map((track) => normalizeTrack(platform, track))
      .filter((track): track is MusicImportTrack => Boolean(track))
  )

  if (!normalized.length) {
    throw new Error(type === 'album' ? '专辑暂无可导入歌曲' : '歌单暂无可导入歌曲')
  }

  const withCover = await enrichTrackCovers(platform, normalized)

  let title = ''
  let artist = ''
  let cover = ''
  let description = ''

  try {
    const raw = await runRawValue(platform, (client) =>
      type === 'album' ? client.album(id) : client.playlist(id)
    )

    const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const albumMeta = normalizePreviewMeta(record.album)
    const playlistMeta = normalizePreviewMeta(record.playlist)
    const topMeta = normalizePreviewMeta(record)

    title = albumMeta.title || playlistMeta.title || topMeta.title
    artist = albumMeta.artist || playlistMeta.artist || topMeta.artist
    cover = albumMeta.cover || playlistMeta.cover || topMeta.cover
    description = albumMeta.description || playlistMeta.description || topMeta.description
  } catch {
    title = ''
  }

  if (!title) {
    title = withCover[0]?.album || fallbackPreviewTitle(type, id)
  }
  if (!artist) {
    artist = formatMusicCredits(withCover[0]?.artists, '未知歌手')
  }
  if (!cover) {
    cover = withCover[0]?.cover || ''
  }

  return {
    platform,
    type,
    id,
    title,
    artist,
    cover,
    description,
    platformUrl: buildPlatformResourceUrl(platform, type, id),
    songs: withCover,
  }
}

function extractSingleFieldAsString(payload: unknown, field: string) {
  if (!payload || typeof payload !== 'object') {
    return ''
  }
  if (Array.isArray(payload)) {
    return extractSingleFieldAsString(payload[0], field)
  }

  const record = payload as Record<string, unknown>
  const value = record[field]
  if (typeof value === 'string') {
    return value.trim()
  }
  return ''
}

export async function resolveAudioUrl(platform: MusicPlatform, urlId: string) {
  if (!urlId) {
    return ''
  }

  if (platform === 'netease') {
    return `https://music.163.com/song/media/outer/url?id=${urlId}.mp3`
  }

  try {
    const client = createClient(platform, true)
    const raw = ensureString(await withTimeout(client.url(urlId, 320), METING_API_TIMEOUT_MS))
    const parsed = parseJsonSafe<unknown>(raw, {})
    return extractSingleFieldAsString(parsed, 'url')
  } catch {
    return ''
  }
}

export async function resolveLyric(platform: MusicPlatform, lyricId: string) {
  if (!lyricId) {
    return ''
  }
  try {
    const client = createClient(platform, true)
    const raw = ensureString(await withTimeout(client.lyric(lyricId), METING_API_TIMEOUT_MS))
    const parsed = parseJsonSafe<unknown>(raw, {})
    return extractSingleFieldAsString(parsed, 'lyric')
  } catch {
    return ''
  }
}

export async function resolveCoverUrl(platform: MusicPlatform, picId: string, fallback = '') {
  return resolvePicById(platform, picId, fallback)
}

export async function resolveCoverUrlCandidates(
  platform: MusicPlatform,
  picId: string,
  fallback = ''
) {
  return resolvePicCandidatesById(platform, picId, fallback)
}
