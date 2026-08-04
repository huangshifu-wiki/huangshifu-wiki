// 音乐平台解析、播放URL、导入、CRUD 全链路

import { Prisma } from '@prisma/client'
import type { MusicPlayableOverride } from '@prisma/client'
import { prisma, DEFAULT_MUSIC_PLATFORMS, uploadsDir } from './config'
import { runtimeConfigService } from '../services/runtimeConfig.service'
import { enhancedCache, CACHE_KEYS } from './cache'
import { parseInteger } from './parsers'
import { withNumericSlugTransaction } from './numericSlug'
import { normalizeLyricStorage } from './lyrics'
import { CONTENT_LIMITS } from '../../lib/contentLimits'
import { firstMusicCredit, normalizeStringListInput } from '../../lib/musicCredits'
import type {
  MusicPlatform,
  MusicTrackWithRelations,
  DisplayAlbumMode,
  ImportSongInput,
  SongCustomPlatformLink,
  PlayUrlCacheValue,
} from '../types'
import { parseMusicUrl, type MusicPlatform as ParsedMusicPlatform } from '../music/musicUrlParser'
import {
  getMusicResourcePreview,
  resolveAudioUrl as resolveMetingAudioUrl,
  resolveLyric as resolveMetingLyric,
  resolveCoverUrl as resolveMetingCoverUrl,
} from '../music/metingService'
import { variantGenerator } from '../services/variantGenerator'
import { resolveUploadPathByStorageKey } from '../uploadPath'
import { localizeImageUrlAsMediaAsset } from './remoteImageAsset'
import { enqueueMusicTextEmbeddingsDeferred } from '../vector/textEmbeddingSync'

export async function findMusicDocIdsByArtistPartial(
  query: string,
  take?: number,
  includeDeleted = false
) {
  if (!query) return [] as string[]
  const deletedFilter = includeDeleted ? Prisma.empty : Prisma.sql`"deletedAt" IS NULL AND`
  const limitClause = take === undefined ? Prisma.empty : Prisma.sql`LIMIT ${take}`
  const rows = await prisma.$queryRaw<Array<{ docId: string }>>(Prisma.sql`
    SELECT "docId"
    FROM "MusicTrack"
    WHERE ${deletedFilter}
      EXISTS (
        SELECT 1
        FROM unnest("artists") AS artist_name(name)
        WHERE artist_name.name ILIKE ${`%${query}%`}
      )
    ORDER BY "updatedAt" DESC
    ${limitClause}
  `)
  return rows.map((row) => row.docId)
}

// ─── 显示辅助函数 ───────────────────────────────────────────────

export function resolveSongDisplayAlbum(song: {
  displayAlbumMode: DisplayAlbumMode
  manualAlbumName: string | null
  albumRelations: Array<{
    isDisplay: boolean
    album: {
      docId: string
      title: string
    }
  }>
}) {
  if (song.displayAlbumMode === 'none') {
    return {
      mode: 'none' as const,
      albumDocId: null,
      title: '',
    }
  }

  if (song.displayAlbumMode === 'manual') {
    return {
      mode: 'manual' as const,
      albumDocId: null,
      title: song.manualAlbumName || '',
    }
  }

  const displayRelation =
    song.albumRelations.find((item) => item.isDisplay) || song.albumRelations[0] || null
  if (!displayRelation) {
    return {
      mode: 'linked' as const,
      albumDocId: null,
      title: '',
    }
  }

  return {
    mode: 'linked' as const,
    albumDocId: displayRelation.album.docId,
    title: displayRelation.album.title,
  }
}

export function resolveSongCoverUrl(song: {
  coverId: string | null
  coverAlbumDocId: string | null
  covers: Array<{
    id: string
    publicUrl: string
    thumbnailUrl?: string | null
    isDefault?: boolean
  }>
  albumRelations: Array<{
    album: {
      docId: string
      coverId: string | null
      covers: Array<{
        id: string
        publicUrl: string
        thumbnailUrl?: string | null
        isDefault?: boolean
      }>
    }
  }>
}) {
  if (song.coverAlbumDocId) {
    const relation = song.albumRelations.find((item) => item.album.docId === song.coverAlbumDocId)
    if (!relation) return ''
    return resolveAlbumCoverUrl(relation.album)
  }

  const selected = song.coverId ? song.covers.find((item) => item.id === song.coverId) : null
  return selected?.publicUrl || song.covers.find((item) => item.isDefault)?.publicUrl || ''
}

export function resolveAlbumCoverUrl(album: {
  coverId: string | null
  covers: Array<{
    id: string
    publicUrl: string
    thumbnailUrl?: string | null
    isDefault?: boolean
  }>
}) {
  const selected = album.coverId ? album.covers.find((item) => item.id === album.coverId) : null
  return selected?.publicUrl || album.covers.find((item) => item.isDefault)?.publicUrl || ''
}

export function resolveSongCoverThumbnailUrl(song: Parameters<typeof resolveSongCoverUrl>[0]) {
  if (song.coverAlbumDocId) {
    const relation = song.albumRelations.find((item) => item.album.docId === song.coverAlbumDocId)
    if (!relation) return ''
    return resolveAlbumCoverThumbnailUrl(relation.album)
  }

  const selected = song.coverId ? song.covers.find((item) => item.id === song.coverId) : null
  return (
    selected?.thumbnailUrl ||
    selected?.publicUrl ||
    song.covers.find((item) => item.isDefault)?.thumbnailUrl ||
    song.covers.find((item) => item.isDefault)?.publicUrl ||
    ''
  )
}

export function resolveAlbumCoverThumbnailUrl(album: Parameters<typeof resolveAlbumCoverUrl>[0]) {
  const selected = album.coverId ? album.covers.find((item) => item.id === album.coverId) : null
  return (
    selected?.thumbnailUrl ||
    selected?.publicUrl ||
    album.covers.find((item) => item.isDefault)?.thumbnailUrl ||
    album.covers.find((item) => item.isDefault)?.publicUrl ||
    ''
  )
}

async function enqueueMusicCoverThumbnail(
  targetType: 'songCover' | 'albumCover',
  coverId: string,
  storageKey: string
) {
  const localFilePath = resolveUploadPathByStorageKey(storageKey, uploadsDir)
  if (!localFilePath) {
    console.warn(
      `[Music] Cannot resolve cover source file for ${targetType} ${coverId}: ${storageKey}`
    )
    return
  }

  try {
    await variantGenerator.enqueue({
      targetType,
      targetId: coverId,
      localFilePath,
      priority: 'normal',
    })
  } catch (error) {
    console.error(`[Music] Enqueue cover thumbnail failed for ${targetType} ${coverId}:`, error)
  }
}

// ─── 自定义链接函数 ──────────────────────────────────────────────

export function normalizeSongCustomPlatformLinkUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  const raw = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return ''
    }
    return parsed.toString()
  } catch {
    return ''
  }
}

export function normalizeSongCustomPlatformLinks(input: unknown): SongCustomPlatformLink[] {
  if (!Array.isArray(input)) {
    return []
  }

  const deduped = new Set<string>()
  const links: SongCustomPlatformLink[] = []

  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const rawLabel =
      typeof (item as { label?: unknown }).label === 'string'
        ? (item as { label: string }).label.trim()
        : ''
    const normalizedLabel = rawLabel.slice(0, CONTENT_LIMITS.music.customPlatformLabel)
    const rawUrl =
      typeof (item as { url?: unknown }).url === 'string' ? (item as { url: string }).url : ''
    const normalizedUrl = normalizeSongCustomPlatformLinkUrl(
      rawUrl.slice(0, CONTENT_LIMITS.music.customPlatformUrl)
    )

    if (!normalizedLabel || !normalizedUrl) {
      continue
    }

    const key = `${normalizedLabel}::${normalizedUrl}`
    if (deduped.has(key)) {
      continue
    }

    deduped.add(key)
    links.push({
      label: normalizedLabel,
      url: normalizedUrl,
    })

    if (links.length >= CONTENT_LIMITS.music.customPlatformLinks) {
      break
    }
  }

  return links
}

// ─── 平台解析函数 ────────────────────────────────────────────────

export function getPlatformSourceId(
  sources: Array<{ platform: MusicPlatform; sourceId: string; isPrimary?: boolean }>,
  platform: MusicPlatform
): string {
  const source = sources.find((item) => item.platform === platform && item.sourceId.trim())
  return source?.sourceId.trim() || ''
}

export function buildPlaybackPlatformCandidates(song: {
  externalSources?: Array<{ platform: MusicPlatform; isPrimary?: boolean }>
}): MusicPlatform[] {
  const deduped = new Set<MusicPlatform>()
  const primary = song.externalSources?.find((source) => source.isPrimary)
  if (primary) {
    deduped.add(primary.platform)
  }
  for (const source of song.externalSources || []) {
    deduped.add(source.platform)
  }
  return [...deduped.values()]
}

export type DuplicateSongSourceWarning = {
  platform: MusicPlatform
  sourceId: string
  song: { docId: string; title: string; artists: string[] }
}

export type DuplicateAlbumSourceWarning = {
  platform: MusicPlatform
  sourceId: string
  album: { docId: string; title: string }
}

function externalSourceConflictWhere(
  sources: Array<{ platform: MusicPlatform; sourceId: string }>,
  excludeField: 'songDocId' | 'albumDocId',
  excludeDocId?: string
) {
  return {
    OR: sources.map((source) => ({ platform: source.platform, sourceId: source.sourceId })),
    ...(excludeDocId ? { [excludeField]: { not: excludeDocId } } : {}),
  }
}

/** 同一 platform:sourceId 可能被多首歌/专辑共享，这里每个 key 只保留第一条占用记录。 */
function firstPerPlatformSourceId<T extends { platform: MusicPlatform; sourceId: string }>(
  rows: T[]
): T[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = `${row.platform}:${row.sourceId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * 检测歌曲来源中已被其他歌曲占用的平台 id（同一 id 可被多首歌共享，这里只做提醒）。
 * 每个 platform:sourceId 只返回第一条占用记录。
 */
export async function findDuplicateSongSources(
  sources: Array<{ platform: MusicPlatform; sourceId: string }>,
  excludeSongDocId?: string
): Promise<DuplicateSongSourceWarning[]> {
  if (!sources.length) return []
  const rows = await prisma.musicExternalSource.findMany({
    where: {
      resourceType: 'song',
      // 软删除歌曲与悬空行（无歌曲）不算占用，避免提醒里出现已删除歌曲或漏报
      song: { is: { deletedAt: null } },
      ...externalSourceConflictWhere(sources, 'songDocId', excludeSongDocId),
    },
    select: {
      platform: true,
      sourceId: true,
      song: { select: { docId: true, title: true, artists: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  return firstPerPlatformSourceId(rows).flatMap((row) =>
    row.song ? [{ platform: row.platform, sourceId: row.sourceId, song: row.song }] : []
  )
}

/**
 * 检测专辑来源中已被其他专辑占用的平台 id（同一 id 可被多张专辑共享，这里只做提醒）。
 * 每个 platform:sourceId 只返回第一条占用记录。
 */
export async function findDuplicateAlbumSources(
  sources: Array<{ platform: MusicPlatform; sourceId: string }>,
  excludeAlbumDocId?: string
): Promise<DuplicateAlbumSourceWarning[]> {
  if (!sources.length) return []
  const rows = await prisma.musicExternalSource.findMany({
    where: {
      resourceType: 'album',
      // 软删除专辑与悬空行（无专辑）不算占用，避免提醒里出现已删除专辑或漏报
      album: { is: { deletedAt: null } },
      ...externalSourceConflictWhere(sources, 'albumDocId', excludeAlbumDocId),
    },
    select: {
      platform: true,
      sourceId: true,
      album: { select: { docId: true, title: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  return firstPerPlatformSourceId(rows).flatMap((row) =>
    row.album ? [{ platform: row.platform, sourceId: row.sourceId, album: row.album }] : []
  )
}

export function normalizeMusicExternalSourceInputs(value: unknown) {
  if (!Array.isArray(value)) return []
  const deduped = new Set<string>()
  const sources: Array<{
    platform: MusicPlatform
    sourceId: string
    sourceUrl: string | null
    isPrimary: boolean
  }> = []

  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const platform = record.platform as MusicPlatform
    if (!DEFAULT_MUSIC_PLATFORMS.includes(platform)) continue
    const sourceId = typeof record.sourceId === 'string' ? record.sourceId.trim() : ''
    if (!sourceId) continue

    const key = `${platform}:${sourceId}`
    if (deduped.has(key)) continue
    deduped.add(key)
    sources.push({
      platform,
      sourceId,
      sourceUrl:
        typeof record.sourceUrl === 'string' && record.sourceUrl.trim()
          ? record.sourceUrl.trim()
          : null,
      isPrimary: record.isPrimary === true,
    })
  }

  if (sources.length && !sources.some((source) => source.isPrimary)) {
    sources[0].isPrimary = true
  }

  return sources
}

// ─── 播放缓存函数 ────────────────────────────────────────────────

function isValidPlayUrl(url: string) {
  if (!url.startsWith('http')) {
    return false
  }
  // 网易云不可播放时 media/outer 会重定向到 404 页面（HTTP 200），不能作为播放地址
  if (url.includes('music.163.com/404')) {
    return false
  }
  return true
}

export function clearExpiredPlayUrlCache() {
  const prefix = `${CACHE_KEYS.MUSIC_PLAY_URL}:`
  const allKeys = enhancedCache.getNativeStats().keys as unknown as string[] | undefined
  if (!allKeys) {
    try {
      enhancedCache.delete(prefix + '__sentinel__')
    } catch {
      return
    }
    return
  }
  for (let i = 0; i < allKeys.length; i++) {
    if (allKeys[i].startsWith(prefix)) {
      enhancedCache.delete(allKeys[i])
    }
  }
}

export function getCachedPlayUrl(cacheKey: string) {
  const enhancedKey = `${CACHE_KEYS.MUSIC_PLAY_URL}:${cacheKey}`
  const cached = enhancedCache.get<PlayUrlCacheValue>(enhancedKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached
  }
  if (cached) {
    enhancedCache.delete(enhancedKey)
  }
  return null
}

export function setCachedPlayUrl(
  cacheKey: string,
  value: Omit<PlayUrlCacheValue, 'fetchedAt' | 'expiresAt'>
) {
  const now = Date.now()
  const playUrlCacheTtlMs = runtimeConfigService.getConfig().playUrlCacheTtlSeconds * 1000
  const record: PlayUrlCacheValue = {
    ...value,
    fetchedAt: now,
    expiresAt: now + playUrlCacheTtlMs,
  }

  // 写入增强缓存（限制大小）
  const enhancedKey = `${CACHE_KEYS.MUSIC_PLAY_URL}:${cacheKey}`
  enhancedCache.set(enhancedKey, record, Math.ceil(playUrlCacheTtlMs / 1000))
  return record
}

export async function resolveMusicPlayUrl(song: {
  docId: string
  audioUrl: string
  playableOverride?: MusicPlayableOverride
  externalSources: Array<{ platform: MusicPlatform; sourceId: string; isPrimary: boolean }>
}) {
  clearExpiredPlayUrlCache()

  if (song.playableOverride === 'disabled') {
    return {
      mode: 'disabled' as const,
      platform: null,
      sourceId: null,
      playUrl: '',
      cached: false,
      cacheExpiresAt: null,
      playable: false,
      errors: [],
    }
  }

  const fallbackUrl = song.audioUrl?.trim() || ''
  if (fallbackUrl) {
    return {
      mode: 'manual' as const,
      platform: null,
      sourceId: null,
      playUrl: fallbackUrl,
      cached: false,
      cacheExpiresAt: null,
      fallback: true,
      playable: true,
      errors: [],
    }
  }

  const candidates = buildPlaybackPlatformCandidates(song)
  const errors: Array<{ platform: MusicPlatform; reason: string }> = []
  // 服务器 IP 拿不到网易云地址时，记录 sourceId 供浏览器直连外链回退
  let neteaseFallbackSourceId = ''

  for (const platform of candidates) {
    const sourceId = getPlatformSourceId(song.externalSources, platform)
    if (!sourceId) {
      continue
    }

    if (platform === 'netease' && !neteaseFallbackSourceId) {
      neteaseFallbackSourceId = sourceId
    }

    // v2：网易云解析改为 https 直链后作废旧缓存（旧条目仍指向 media/outer 混合内容地址）
    const cacheKey = `v2:${song.docId}:${platform}:${sourceId}`
    const cached = getCachedPlayUrl(cacheKey)
    if (cached?.url && isValidPlayUrl(cached.url)) {
      return {
        mode: 'cache' as const,
        platform: cached.platform,
        sourceId: cached.sourceId,
        playUrl: cached.url,
        cached: true,
        cacheExpiresAt: new Date(cached.expiresAt).toISOString(),
        playable: true,
      }
    }

    try {
      const resolvedUrl = await resolveMetingAudioUrl(platform as ParsedMusicPlatform, sourceId)
      if (!resolvedUrl) {
        errors.push({ platform, reason: 'empty_url' })
        continue
      }

      const cachedRecord = setCachedPlayUrl(cacheKey, {
        platform,
        sourceId,
        url: resolvedUrl,
      })

      return {
        mode: 'resolved' as const,
        platform,
        sourceId,
        playUrl: resolvedUrl,
        cached: false,
        cacheExpiresAt: new Date(cachedRecord.expiresAt).toISOString(),
        playable: true,
      }
    } catch (error) {
      errors.push({ platform, reason: error instanceof Error ? error.message : 'resolve_failed' })
    }
  }

  // 网易云解析失败（典型：服务器 IP 被风控）时，回退到外链由浏览器直连，
  // 用用户 IP 获取播放权；不缓存，避免阻止 eapi 恢复后重新解析
  if (neteaseFallbackSourceId) {
    return {
      mode: 'outer' as const,
      platform: 'netease',
      sourceId: neteaseFallbackSourceId,
      playUrl: `https://music.163.com/song/media/outer/url?id=${neteaseFallbackSourceId}.mp3`,
      cached: false,
      cacheExpiresAt: null,
      fallback: true,
      playable: true,
      errors,
    }
  }

  return {
    mode: 'none' as const,
    platform: null,
    sourceId: null,
    playUrl: '',
    cached: false,
    cacheExpiresAt: null,
    playable: false,
    errors,
  }
}

// ─── 导入函数 ────────────────────────────────────────────────────

export function normalizeMusicImportTracks(input: unknown) {
  if (!Array.isArray(input)) {
    return [] as ImportSongInput[]
  }

  return input
    .map((item): ImportSongInput | null => {
      if (!item || typeof item !== 'object') {
        return null
      }
      const record = item as Record<string, unknown>
      const sourceId = typeof record.sourceId === 'string' ? record.sourceId.trim() : ''
      if (!sourceId) {
        return null
      }

      const normalizedArtists = normalizeStringListInput(record.artists)
      const artists = normalizedArtists.length
        ? normalizedArtists
        : normalizeStringListInput(record.artist)

      return {
        sourceId,
        title: typeof record.title === 'string' ? record.title.trim() : '',
        artists,
        album: typeof record.album === 'string' ? record.album.trim() : '',
        picId: typeof record.picId === 'string' ? record.picId.trim() : sourceId,
        urlId: typeof record.urlId === 'string' ? record.urlId.trim() : sourceId,
        lyricId: typeof record.lyricId === 'string' ? record.lyricId.trim() : sourceId,
        cover: typeof record.cover === 'string' ? record.cover.trim() : '',
        sourceUrl: typeof record.sourceUrl === 'string' ? record.sourceUrl.trim() : '',
        isInstrumental:
          typeof record.isInstrumental === 'boolean' ? record.isInstrumental : undefined,
      }
    })
    .filter((item): item is ImportSongInput => Boolean(item))
}

// ─── CRUD 函数 ───────────────────────────────────────────────────

export function buildAlbumTracksPayload(
  relations: Array<{
    songDocId: string
    trackOrder: number
    discNumber: number
    song: {
      docId: string
      title: string
      artists: string[]
    }
  }>
) {
  const byDisc = new Map<
    number,
    Array<{
      songDocId: string
      trackOrder: number
      song: { docId: string; title: string; artists: string[] }
    }>
  >()

  relations.forEach((relation) => {
    const disc = relation.discNumber > 0 ? relation.discNumber : 1
    if (!byDisc.has(disc)) {
      byDisc.set(disc, [])
    }
    byDisc.get(disc)!.push({
      songDocId: relation.songDocId,
      trackOrder: relation.trackOrder,
      song: relation.song,
    })
  })

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
    }))
}

/** applyAlbumTracksToRelations 接受的 tracks 参数类型（与 normalizeTrackDiscPayload 返回值一致） */
export type AlbumTrackDiscPayload = Array<{
  disc: number
  name: string
  songs: Array<{ songDocId: string; trackOrder: number }>
}>

export async function applyAlbumTracksToRelations(
  albumDocId: string,
  tracks: AlbumTrackDiscPayload
) {
  const existingRelations = await prisma.songAlbumRelation.findMany({
    where: { albumDocId },
    select: { songDocId: true, isDisplay: true },
  })
  const existingDisplayBySongDocId = new Map(
    existingRelations.map((relation) => [relation.songDocId, relation.isDisplay])
  )
  const createRows: Array<{
    songDocId: string
    albumDocId: string
    discNumber: number
    trackOrder: number
    isDisplay: boolean
  }> = []

  tracks.forEach((discEntry) => {
    discEntry.songs.forEach((songEntry) => {
      createRows.push({
        songDocId: songEntry.songDocId,
        albumDocId,
        discNumber: discEntry.disc,
        trackOrder: songEntry.trackOrder,
        isDisplay: existingDisplayBySongDocId.get(songEntry.songDocId) ?? false,
      })
    })
  })

  await prisma.$transaction([
    prisma.songAlbumRelation.deleteMany({ where: { albumDocId } }),
    ...(createRows.length
      ? [prisma.songAlbumRelation.createMany({ data: createRows, skipDuplicates: true })]
      : []),
  ])
}

export async function addSongCoverFromAsset(
  songDocId: string,
  assetId: string,
  markDefault = false
) {
  const asset = await prisma.mediaAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      storageKey: true,
      publicUrl: true,
      status: true,
    },
  })

  if (!asset || asset.status !== 'ready') {
    throw new Error('媒体资源不存在或不可用')
  }

  const currentCount = await prisma.songCover.count({ where: { songDocId } })

  const cover = await prisma.$transaction(async (tx) => {
    const cover = await tx.songCover.create({
      data: {
        songDocId,
        assetId: asset.id,
        storageKey: asset.storageKey,
        publicUrl: asset.publicUrl,
        sortOrder: currentCount,
        isDefault: markDefault,
      },
    })

    if (markDefault) {
      await tx.songCover.updateMany({
        where: {
          songDocId,
          id: { not: cover.id },
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
      })
      await tx.musicTrack.update({
        where: { docId: songDocId },
        data: {
          coverId: cover.id,
          coverAlbumDocId: null,
        },
      })
    }

    return cover
  })

  await enqueueMusicCoverThumbnail('songCover', cover.id, asset.storageKey)

  return cover
}

export async function addSongCoverFromUrl(
  songDocId: string,
  publicUrl: string,
  markDefault = false
) {
  const url = publicUrl.trim()
  if (!url) return null
  const asset = await localizeImageUrlAsMediaAsset(url, {
    namespace: 'music-covers/songs',
    fallbackName: `${songDocId}.jpg`,
  })
  return addSongCoverFromAsset(songDocId, asset.assetId, markDefault)
}

export async function addAlbumCoverFromAsset(
  albumDocId: string,
  assetId: string,
  markDefault = false
) {
  const asset = await prisma.mediaAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      storageKey: true,
      publicUrl: true,
      status: true,
    },
  })

  if (!asset || asset.status !== 'ready') {
    throw new Error('媒体资源不存在或不可用')
  }

  const currentCount = await prisma.albumCover.count({ where: { albumDocId } })

  const cover = await prisma.$transaction(async (tx) => {
    const cover = await tx.albumCover.create({
      data: {
        albumDocId,
        assetId: asset.id,
        storageKey: asset.storageKey,
        publicUrl: asset.publicUrl,
        sortOrder: currentCount,
        isDefault: markDefault,
      },
    })

    if (markDefault) {
      await tx.albumCover.updateMany({
        where: {
          albumDocId,
          id: { not: cover.id },
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
      })
      await tx.album.update({
        where: { docId: albumDocId },
        data: {
          coverId: cover.id,
        },
      })
    }

    return cover
  })

  await enqueueMusicCoverThumbnail('albumCover', cover.id, asset.storageKey)

  return cover
}

export async function addAlbumCoverFromUrl(
  albumDocId: string,
  publicUrl: string,
  markDefault = false
) {
  const url = publicUrl.trim()
  if (!url) return null
  const asset = await localizeImageUrlAsMediaAsset(url, {
    namespace: 'music-covers/albums',
    fallbackName: `${albumDocId}.jpg`,
  })
  return addAlbumCoverFromAsset(albumDocId, asset.assetId, markDefault)
}

async function maybeAddImportedSongCover(songDocId: string, coverUrl: string, markDefault = true) {
  try {
    await addSongCoverFromUrl(songDocId, coverUrl, markDefault)
    return true
  } catch (error) {
    console.warn(`Import song cover failed for ${songDocId}:`, error)
    return false
  }
}

export async function createOrUpdateImportedSong(params: {
  platform: MusicPlatform
  track: ImportSongInput
  albumNameFallback?: string
}) {
  const { platform, track, albumNameFallback } = params
  const platformId = track.sourceId

  const existingSources = await prisma.musicExternalSource.findMany({
    where: {
      resourceType: 'song',
      platform,
      sourceId: platformId,
      // 软删除歌曲不再占用 id，避免重复导入无限新建；悬空行（无歌曲）一并排除
      song: { is: { deletedAt: null } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      song: true,
    },
  })

  // 同一 id 可被多首歌共享：仅当恰好一个活歌曲占用时合并导入数据，
  // 多个占用者或没有占用者时新建，避免覆写已人工整理的歌曲；
  // where 已过滤软删除，这里再留一道防御
  const existingSong =
    existingSources.length === 1 && !existingSources[0].song?.deletedAt
      ? existingSources[0].song
      : null

  if (existingSong) {
    const fallbackTitle = `未命名歌曲 ${track.sourceId}`
    const title = track.title || fallbackTitle
    const artists = track.artists.length ? track.artists : ['未知歌手']
    const album = track.album || albumNameFallback || '未知专辑'

    const [resolvedCoverRaw, resolvedAudioUrlRaw, resolvedLyricRaw] = await Promise.all([
      resolveMetingCoverUrl(platform as ParsedMusicPlatform, track.picId, track.cover),
      resolveMetingAudioUrl(platform as ParsedMusicPlatform, track.urlId),
      resolveMetingLyric(platform as ParsedMusicPlatform, track.lyricId),
    ])
    const resolvedCover = resolvedCoverRaw || track.cover
    const resolvedAudioUrl = resolvedAudioUrlRaw || ''
    const resolvedLyric = resolvedLyricRaw || ''

    const lyricUpdate = resolvedLyric
      ? normalizeLyricStorage({ lyric: resolvedLyric, lyricSource: platform }).data
      : {}
    const song = await prisma.musicTrack.update({
      where: { docId: existingSong.docId },
      data: {
        title,
        artists,
        album,
        audioUrl: resolvedAudioUrl || '',
        ...lyricUpdate,
        description: existingSong.description ?? null,
      },
    })
    if (resolvedCover && !existingSong.coverId && !existingSong.coverAlbumDocId) {
      await maybeAddImportedSongCover(song.docId, resolvedCover, true)
    }
    enqueueMusicTextEmbeddingsDeferred(prisma, [song.docId])
    return {
      song,
      created: false,
      linked: false,
    }
  }

  const fallbackTitle = `未命名歌曲 ${track.sourceId}`
  const title = track.title || fallbackTitle
  const artists = track.artists.length ? track.artists : ['未知歌手']
  const primaryArtist = firstMusicCredit(artists, '未知歌手')
  const album = track.album || albumNameFallback || '未知专辑'

  const existingByTitleArtist = await prisma.musicTrack.findFirst({
    where: {
      AND: [{ deletedAt: null }, { title: { equals: title } }, { artists: { equals: artists } }],
    } as Prisma.MusicTrackWhereInput,
    include: {
      externalSources: true,
    },
  })

  const [resolvedCoverRaw, resolvedAudioUrlRaw, resolvedLyricRaw] = await Promise.all([
    resolveMetingCoverUrl(platform as ParsedMusicPlatform, track.picId, track.cover),
    resolveMetingAudioUrl(platform as ParsedMusicPlatform, track.urlId),
    resolveMetingLyric(platform as ParsedMusicPlatform, track.lyricId),
  ])
  const resolvedCover = resolvedCoverRaw || track.cover
  const resolvedAudioUrl = resolvedAudioUrlRaw || ''
  const resolvedLyric = resolvedLyricRaw || ''
  const lyricStorage = normalizeLyricStorage({ lyric: resolvedLyric, lyricSource: platform })
  const lyricUpdate = resolvedLyric ? lyricStorage.data : {}

  if (existingByTitleArtist) {
    const updatedSong = await prisma.musicTrack.update({
      where: { docId: existingByTitleArtist.docId },
      data: {
        title,
        artists,
        album,
        audioUrl: resolvedAudioUrl || '',
        ...lyricUpdate,
        description: existingByTitleArtist.description ?? null,
      },
    })
    if (resolvedCover && !existingByTitleArtist.coverId && !existingByTitleArtist.coverAlbumDocId) {
      await maybeAddImportedSongCover(updatedSong.docId, resolvedCover, true)
    }
    await prisma.musicExternalSource.create({
      data: {
        resourceType: 'song',
        songDocId: updatedSong.docId,
        platform,
        sourceId: platformId,
        sourceUrl: track.sourceUrl || null,
        isPrimary: !existingByTitleArtist.externalSources.length,
      },
    })
    enqueueMusicTextEmbeddingsDeferred(prisma, [updatedSong.docId])
    return {
      song: updatedSong,
      created: false,
      linked: true,
      linkedFrom: {
        docId: existingByTitleArtist.docId,
        title: existingByTitleArtist.title,
        artists: existingByTitleArtist.artists,
      },
    }
  }

  const song = await withNumericSlugTransaction(prisma, 'MusicTrack', async (tx, slug) => {
    return tx.musicTrack.create({
      data: {
        slug,
        title,
        artists,
        album,
        audioUrl: resolvedAudioUrl || '',
        ...lyricStorage.data,
        description: null,
        externalSources: {
          create: {
            resourceType: 'song',
            platform,
            sourceId: platformId,
            sourceUrl: track.sourceUrl || null,
            isPrimary: true,
          },
        },
      },
    })
  })
  if (resolvedCover) {
    await maybeAddImportedSongCover(song.docId, resolvedCover, true)
  }

  await autoLinkInstrumental(song.docId, title, primaryArtist, track.isInstrumental)
  enqueueMusicTextEmbeddingsDeferred(prisma, [song.docId])

  return {
    song,
    created: true,
    linked: false,
  }
}

export async function autoLinkInstrumental(
  songDocId: string,
  title: string,
  artist: string,
  isInstrumentalFromAPI?: boolean
): Promise<void> {
  const instrumentalPatterns = [
    /\(伴奏\)/,
    /（伴奏）/,
    /-伴奏/,
    /\s+伴奏$/,
    /伴奏版$/,
    /inst\.?$/i,
    /instrumental$/i,
  ]

  const isInstrumental =
    isInstrumentalFromAPI || instrumentalPatterns.some((pattern) => pattern.test(title))
  if (!isInstrumental) return

  let originalTitle = title
  if (!isInstrumentalFromAPI) {
    originalTitle = title
      .replace(/\(伴奏\)/, '')
      .replace(/（伴奏）/, '')
      .replace(/-伴奏/, '')
      .replace(/伴奏版$/, '')
      .replace(/inst\.?$/i, '')
      .replace(/instrumental$/i, '')
      .trim()
  }

  if (!originalTitle) return

  const originalSong = await prisma.musicTrack.findFirst({
    where: {
      deletedAt: null,
      title: originalTitle,
      artists: { has: artist },
      docId: { not: songDocId },
    },
  })

  if (!originalSong) return

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
  })
}

export async function fetchSongsWithRelations(
  where?: Record<string, unknown>,
  pagination?: {
    take?: number
    skip?: number
    orderBy?:
      | Prisma.MusicTrackOrderByWithRelationInput
      | Prisma.MusicTrackOrderByWithRelationInput[]
  }
) {
  const songs = await prisma.musicTrack.findMany({
    where: {
      deletedAt: null,
      ...(where || {}),
    },
    include: {
      covers: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          publicUrl: true,
          thumbnailUrl: true,
          isDefault: true,
          sortOrder: true,
        },
      },
      albumRelations: {
        include: {
          album: {
            select: {
              docId: true,
              slug: true,
              title: true,
              artist: true,
              releaseDate: true,
              coverId: true,
              covers: {
                orderBy: { sortOrder: 'asc' },
                select: {
                  id: true,
                  publicUrl: true,
                  thumbnailUrl: true,
                  isDefault: true,
                },
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
      externalSources: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
    },
    orderBy: pagination?.orderBy || { createdAt: 'desc' },
    ...(pagination?.take !== undefined ? { take: pagination.take } : {}),
    ...(pagination?.skip !== undefined ? { skip: pagination.skip } : {}),
  })
  return songs as MusicTrackWithRelations[]
}

export async function fetchSongsWithRelationsByDocIds(songDocIds: string[]) {
  if (!songDocIds.length) return []

  const songs = await fetchSongsWithRelations({ docId: { in: songDocIds } })
  const order = new Map(songDocIds.map((docId, index) => [docId, index]))
  return songs.sort((a, b) => (order.get(a.docId) ?? 0) - (order.get(b.docId) ?? 0))
}

export async function fetchSongWithRelationsByDocId(songDocId: string) {
  const song = await prisma.musicTrack.findFirst({
    where: { docId: songDocId, deletedAt: null },
    include: {
      covers: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          publicUrl: true,
          thumbnailUrl: true,
          isDefault: true,
          sortOrder: true,
        },
      },
      albumRelations: {
        include: {
          album: {
            select: {
              docId: true,
              slug: true,
              title: true,
              artist: true,
              releaseDate: true,
              coverId: true,
              covers: {
                orderBy: { sortOrder: 'asc' },
                select: {
                  id: true,
                  publicUrl: true,
                  thumbnailUrl: true,
                  isDefault: true,
                },
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
      externalSources: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
    },
  })
  return song as unknown as MusicTrackWithRelations | null
}

export function ensureDisplayRelation<T extends { isDisplay: boolean }>(relations: T[]): T[] {
  const hasDisplay = relations.some((relation) => relation.isDisplay)
  if (hasDisplay || !relations.length) {
    return relations
  }
  return relations.map((relation, index) => ({
    ...relation,
    isDisplay: index === 0,
  }))
}
