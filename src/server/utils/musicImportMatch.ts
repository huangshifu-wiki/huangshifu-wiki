import { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import type { MusicPlatform } from '../types'
import type { MusicImportTrack } from '../music/metingService'
import { formatMusicCredits, normalizeStringListInput } from '../../lib/musicCredits'
import { formatTime } from '../../lib/formatUtils'
import { normalizeOptionalDateOnlyString } from './parsers'

export type SongImportMatchStatus = 'new' | 'identical' | 'fillable' | 'conflict'
export type SongImportDiffFieldStatus = 'same' | 'fill' | 'conflict'

export interface SongImportFieldDiff {
  field:
    | 'title'
    | 'artists'
    | 'album'
    | 'externalSource'
    | 'cover'
    | 'duration'
    | 'releaseDate'
    | 'lyric'
  label: string
  status: SongImportDiffFieldStatus
  existingValue: string | null
  incomingValue: string | null
}

export interface SongImportExistingSongSummary {
  docId: string
  slug: string
  title: string
  artists: string[]
  album: string
  hasCover: boolean
  hasLyric: boolean
  durationMs: number | null
  releaseDate: string | null
  externalSources: Array<{ platform: string; sourceId: string }>
}

export interface SongImportMatchResult {
  status: SongImportMatchStatus
  matchType: 'source' | 'title_artist' | 'none'
  existingSong: SongImportExistingSongSummary | null
  diffs: SongImportFieldDiff[]
}

export interface SongImportMatchSummary {
  newCount: number
  fillableCount: number
  conflictCount: number
  identicalCount: number
}

export type MusicImportTrackWithMeta = MusicImportTrack & {
  durationMs?: number | null
  releaseDate?: string | null
  lyric?: string | null
}

function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function formatDurationSec(ms: number | null | undefined): string | null {
  if (ms == null || isNaN(ms) || ms <= 0) return null
  return formatTime(Math.round(ms / 1000)).padStart(5, '0')
}

function normalizeDateStr(date: Date | string | null | undefined): string | null {
  if (!date) return null
  if (date instanceof Date) {
    if (isNaN(date.getTime())) return null
    return date.toISOString().slice(0, 10)
  }
  return normalizeOptionalDateOnlyString(date) ?? null
}

type ExistingSongRecord = {
  docId: string
  slug: string
  title: string
  artists: string[]
  album: string
  coverId: string | null
  coverAlbumDocId: string | null
  lyric: string | null
  durationMs: number | null
  releaseDate: Date | string | null
  externalSources: Array<{ platform: string; sourceId: string }>
}

function summarizeExistingSong(song: ExistingSongRecord): SongImportExistingSongSummary {
  return {
    docId: song.docId,
    slug: song.slug,
    title: song.title,
    artists: song.artists,
    album: song.album,
    hasCover: Boolean(song.coverId || song.coverAlbumDocId),
    hasLyric: Boolean(song.lyric?.trim()),
    durationMs: song.durationMs,
    releaseDate: normalizeDateStr(song.releaseDate),
    externalSources: song.externalSources,
  }
}

function titleArtistKey(title: string, artists: string[]): string {
  return `${normalizeText(title)}:::${normalizeStringListInput(artists).join(':::')}`
}

export function diffImportTrackWithExisting(params: {
  platform: MusicPlatform
  track: MusicImportTrackWithMeta
  existingSong: SongImportExistingSongSummary | null
  matchType: 'source' | 'title_artist' | 'none'
  albumFallback?: string
}): SongImportMatchResult {
  const { platform, track, existingSong, matchType, albumFallback } = params

  if (!existingSong || matchType === 'none') {
    return {
      status: 'new',
      matchType: 'none',
      existingSong: null,
      diffs: [],
    }
  }

  const diffs: SongImportFieldDiff[] = []

  // 1. 标题
  const existingTitle = normalizeText(existingSong.title)
  const incomingTitle = normalizeText(track.title) || `未命名歌曲 ${track.sourceId}`
  const titleSame = existingTitle === incomingTitle
  diffs.push({
    field: 'title',
    label: '歌曲标题',
    status: titleSame ? 'same' : 'conflict',
    existingValue: existingTitle || null,
    incomingValue: incomingTitle || null,
  })

  // 2. 歌手
  const existingArtistsList = normalizeStringListInput(existingSong.artists)
  const incomingArtistsList = normalizeStringListInput(track.artists)
  const existingArtistsStr = formatMusicCredits(existingArtistsList, '未知歌手')
  const incomingArtistsStr = formatMusicCredits(incomingArtistsList, '未知歌手')
  const artistsSame =
    existingArtistsList.length === incomingArtistsList.length &&
    existingArtistsList.every((artist, idx) => artist === incomingArtistsList[idx])
  diffs.push({
    field: 'artists',
    label: '演唱歌手',
    status: artistsSame ? 'same' : 'conflict',
    existingValue: existingArtistsStr,
    incomingValue: incomingArtistsStr,
  })

  // 3. 专辑
  const existingAlbum = normalizeText(existingSong.album)
  const incomingAlbum = normalizeText(track.album) || normalizeText(albumFallback)
  let albumStatus: SongImportDiffFieldStatus = 'same'
  if (!existingAlbum && incomingAlbum) {
    albumStatus = 'fill'
  } else if (existingAlbum && incomingAlbum && existingAlbum !== incomingAlbum) {
    albumStatus = 'conflict'
  }
  diffs.push({
    field: 'album',
    label: '所属专辑',
    status: albumStatus,
    existingValue: existingAlbum || '(空)',
    incomingValue: incomingAlbum || '(空)',
  })

  // 4. 平台外链绑定
  const alreadyBound = existingSong.externalSources.some(
    (source) => source.platform === platform && source.sourceId === track.sourceId
  )
  const incomingSourceStr = `${platform}: ${track.sourceId}`
  diffs.push({
    field: 'externalSource',
    label: '平台外链',
    status: alreadyBound ? 'same' : 'fill',
    existingValue: alreadyBound ? `已绑定 (${incomingSourceStr})` : '未绑定当前平台',
    incomingValue: incomingSourceStr,
  })

  // 5. 封面
  const incomingHasCover = Boolean(track.cover)
  let coverStatus: SongImportDiffFieldStatus = 'same'
  if (!existingSong.hasCover && incomingHasCover) {
    coverStatus = 'fill'
  }
  diffs.push({
    field: 'cover',
    label: '歌曲封面',
    status: coverStatus,
    existingValue: existingSong.hasCover ? '已有独立或专辑封面' : '暂无封面',
    incomingValue: incomingHasCover ? '平台抓取封面' : '无封面',
  })

  // 6. 时长
  const existingDurationMs = existingSong.durationMs
  const incomingDurationMs = track.durationMs
  let durationStatus: SongImportDiffFieldStatus = 'same'
  if (
    existingDurationMs != null &&
    incomingDurationMs != null &&
    existingDurationMs > 0 &&
    incomingDurationMs > 0
  ) {
    const diffSec = Math.abs(existingDurationMs - incomingDurationMs) / 1000
    if (diffSec > 5) {
      durationStatus = 'conflict'
    }
  } else if (existingDurationMs == null && incomingDurationMs != null && incomingDurationMs > 0) {
    durationStatus = 'fill'
  }
  diffs.push({
    field: 'duration',
    label: '歌曲时长',
    status: durationStatus,
    existingValue: formatDurationSec(existingDurationMs) || '(未记录)',
    incomingValue: formatDurationSec(incomingDurationMs) || '(未提供)',
  })

  // 7. 发行时间
  const existingReleaseDate = normalizeDateStr(existingSong.releaseDate)
  const incomingReleaseDate = normalizeDateStr(track.releaseDate)
  let releaseDateStatus: SongImportDiffFieldStatus = 'same'
  if (!existingReleaseDate && incomingReleaseDate) {
    releaseDateStatus = 'fill'
  } else if (
    existingReleaseDate &&
    incomingReleaseDate &&
    existingReleaseDate !== incomingReleaseDate
  ) {
    releaseDateStatus = 'conflict'
  }
  diffs.push({
    field: 'releaseDate',
    label: '发行时间',
    status: releaseDateStatus,
    existingValue: existingReleaseDate || '(未记录)',
    incomingValue: incomingReleaseDate || '(未提供)',
  })

  const incomingHasLyric = Boolean(track.lyric)
  let lyricStatus: SongImportDiffFieldStatus = 'same'
  if (!existingSong.hasLyric && incomingHasLyric) {
    lyricStatus = 'fill'
  }
  diffs.push({
    field: 'lyric',
    label: '歌词',
    status: lyricStatus,
    existingValue: existingSong.hasLyric ? '已有歌词' : '暂无歌词',
    incomingValue: incomingHasLyric ? '平台提供歌词' : '无歌词',
  })

  // 判定总体状态
  let status: SongImportMatchStatus = 'identical'
  if (diffs.some((diff) => diff.status === 'conflict')) {
    status = 'conflict'
  } else if (diffs.some((diff) => diff.status === 'fill')) {
    status = 'fillable'
  }

  return {
    status,
    matchType,
    existingSong,
    diffs,
  }
}

export async function batchMatchAndDiffImportTracks(params: {
  platform: MusicPlatform
  tracks: MusicImportTrackWithMeta[]
  albumFallback?: string
}): Promise<{
  matches: SongImportMatchResult[]
  summary: SongImportMatchSummary
}> {
  const { platform, tracks, albumFallback } = params
  if (!tracks.length) {
    return {
      matches: [],
      summary: { newCount: 0, fillableCount: 0, conflictCount: 0, identicalCount: 0 },
    }
  }

  const sourceIds = [...new Set(tracks.map((t) => t.sourceId).filter(Boolean))]

  // 第一步：根据 platform + sourceId 批量查找已绑定的歌曲
  const existingSources = sourceIds.length
    ? await prisma.musicExternalSource.findMany({
        where: {
          resourceType: 'song',
          platform,
          sourceId: { in: sourceIds },
          song: { is: { deletedAt: null } },
        },
        include: {
          song: {
            include: {
              externalSources: {
                where: { resourceType: 'song' },
                select: { platform: true, sourceId: true },
              },
            },
          },
        },
      })
    : []

  // sourceId -> Song Map（仅当恰好一个活歌曲占用时）
  const sourceToSongMap = new Map<string, SongImportExistingSongSummary>()
  const sourceCountMap = new Map<string, number>()
  for (const es of existingSources) {
    sourceCountMap.set(es.sourceId, (sourceCountMap.get(es.sourceId) || 0) + 1)
  }
  for (const es of existingSources) {
    if (sourceCountMap.get(es.sourceId) === 1 && es.song && !es.song.deletedAt) {
      sourceToSongMap.set(es.sourceId, summarizeExistingSong(es.song))
    }
  }

  // 第二步：对于未通过 sourceId 匹配到的歌曲，尝试用 title + artists 匹配
  const unmatchedTracks = tracks.filter((track) => !sourceToSongMap.has(track.sourceId))

  const titleArtistToSongMap = new Map<string, SongImportExistingSongSummary>()
  if (unmatchedTracks.length > 0) {
    const orConditions: Prisma.MusicTrackWhereInput[] = []
    for (const track of unmatchedTracks) {
      const title = normalizeText(track.title)
      const artists = normalizeStringListInput(track.artists)
      if (title) {
        orConditions.push({
          title: { equals: title },
          artists: { equals: artists },
        })
      }
    }

    if (orConditions.length > 0) {
      const existingSongs = await prisma.musicTrack.findMany({
        where: {
          deletedAt: null,
          OR: orConditions,
        },
        include: {
          externalSources: {
            where: { resourceType: 'song' },
            select: { platform: true, sourceId: true },
          },
        },
      })

      for (const song of existingSongs) {
        const key = titleArtistKey(song.title, song.artists)
        if (!titleArtistToSongMap.has(key)) {
          titleArtistToSongMap.set(key, summarizeExistingSong(song))
        }
      }
    }
  }

  // 第三步：为每个 track 计算 Diff 与汇总状态
  const matches: SongImportMatchResult[] = []
  let newCount = 0
  let fillableCount = 0
  let conflictCount = 0
  let identicalCount = 0

  for (const track of tracks) {
    let existingSong: SongImportExistingSongSummary | null = null
    let matchType: 'source' | 'title_artist' | 'none' = 'none'

    if (sourceToSongMap.has(track.sourceId)) {
      existingSong = sourceToSongMap.get(track.sourceId)!
      matchType = 'source'
    } else {
      const key = titleArtistKey(track.title, track.artists)
      if (titleArtistToSongMap.has(key)) {
        existingSong = titleArtistToSongMap.get(key)!
        matchType = 'title_artist'
      }
    }

    const matchResult = diffImportTrackWithExisting({
      platform,
      track,
      existingSong,
      matchType,
      albumFallback,
    })

    if (matchResult.status === 'new') newCount += 1
    else if (matchResult.status === 'fillable') fillableCount += 1
    else if (matchResult.status === 'conflict') conflictCount += 1
    else if (matchResult.status === 'identical') identicalCount += 1

    matches.push(matchResult)
  }

  return {
    matches,
    summary: {
      newCount,
      fillableCount,
      conflictCount,
      identicalCount,
    },
  }
}
