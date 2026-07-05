import { Prisma } from '@prisma/client'

import { CONTENT_LIMITS } from '../../lib/contentLimits'
import { normalizeStringListInput } from '../../lib/musicCredits'
import { getMusicResourcePreview, resolveCoverUrlCandidates } from '../music/metingService'
import {
  addSongCoverFromUrl,
  autoLinkInstrumental,
  enhancedCache,
  normalizeMusicExternalSourceInputs,
  normalizeOptionalDateOnly,
  normalizeOptionalDurationMs,
  normalizeSongCustomPlatformLinks,
  prisma,
  withNumericSlugTransaction,
} from '../utils'
import type { MusicPlatform, SongCustomPlatformLink } from '../types'

export type SongDuplicateAction = 'fill' | 'overwrite' | 'skip'
export type SongImportMatchType = 'source' | 'title_artist' | 'none' | 'conflict'

type SongJsonExternalSourceInput = ReturnType<typeof normalizeMusicExternalSourceInputs>[number]

export interface NormalizedSongJsonInput {
  index: number
  title: string
  artists: string[]
  lyricists: string[]
  composers: string[]
  arrangers: string[]
  vocals: string[]
  album: string
  audioUrl: string
  coverUrl: string
  lyric: string | null
  description: string | null
  releaseDate: Date | null
  durationMs: number | null
  sources: SongJsonExternalSourceInput[]
  customPlatformLinks: SongCustomPlatformLink[]
}

export interface SongImportExistingSong {
  docId: string
  title: string
  artists: string[]
  lyricists: string[]
  composers: string[]
  arrangers: string[]
  vocals: string[]
  album: string
  audioUrl: string
  lyric: string | null
  description: string | null
  releaseDate: Date | null
  durationMs: number | null
  customPlatformLinks: Prisma.JsonValue | null
  coverId: string | null
  coverAlbumDocId: string | null
  deletedAt: Date | null
  externalSources: Array<{
    id: string
    platform: MusicPlatform
    sourceId: string
    sourceUrl: string | null
    isPrimary: boolean
    songDocId: string | null
  }>
}

export interface SongImportPreviewItem {
  input: NormalizedSongJsonInput
  matchType: SongImportMatchType
  existingSong: SongImportExistingSong | null
  sourceConflicts: Array<{
    platform: MusicPlatform
    sourceId: string
    songDocId: string
    title: string
  }>
  suggestedAction: SongDuplicateAction | 'create'
  validationErrors: string[]
}

export interface SongImportPreview {
  items: SongImportPreviewItem[]
  invalidItems: SongImportPreviewItem[]
  createCount: number
  duplicateCount: number
  conflictCount: number
}

export interface SongImportResultItem {
  index: number
  title: string
  action: SongDuplicateAction | 'create' | 'invalid' | 'failed'
  songDocId: string | null
  matchType: SongImportMatchType
  error?: string
  coverError?: string
}

export interface SongImportSummary {
  created: number
  filled: number
  overwritten: number
  skipped: number
  invalid: number
  failed: number
  sourceConflicts: number
  coversAdded: number
  coverFailed: number
}

export interface SongImportExecutionResult {
  summary: SongImportSummary
  items: SongImportResultItem[]
}

export interface SongImportExecutionOptions {
  resolveCovers?: boolean
}

type RawSongRecord = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function nullableText(value: unknown) {
  if (typeof value !== 'string') return null
  return value || null
}

function normalizePlatformRecordSources(input: unknown): SongJsonExternalSourceInput[] {
  if (!Array.isArray(input)) return []

  return normalizeMusicExternalSourceInputs(
    input.filter(isRecord).map((record) => ({
      platform: record.platform,
      sourceId: record.platformId,
      sourceUrl: record.url,
    }))
  )
}

function firstPlatformRecord(record: RawSongRecord) {
  const records = Array.isArray(record.platformRecords) ? record.platformRecords : []
  return records.find(isRecord) || {}
}

function listFromRecordOrPlatformRecord(
  record: RawSongRecord,
  platformRecord: Record<string, unknown>,
  key: string
) {
  const primary = normalizeStringListInput(record[key])
  return primary.length ? primary : normalizeStringListInput(platformRecord[key])
}

function valueFromRecordOrPlatformRecord(
  record: RawSongRecord,
  platformRecord: Record<string, unknown>,
  key: string
) {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : platformRecord[key]
}

function validateLength(errors: string[], value: string | null, label: string, limit: number) {
  if (value && value.length > limit) {
    errors.push(`${label} 不能超过 ${limit} 个字符`)
  }
}

function validateCredits(errors: string[], values: string[], label: string) {
  for (const value of values) {
    if (value.length > CONTENT_LIMITS.music.artist) {
      errors.push(`${label} 单项长度不能超过 ${CONTENT_LIMITS.music.artist} 个字符`)
      return
    }
  }
}

function normalizeSongRecord(
  record: RawSongRecord,
  index: number
): {
  input: NormalizedSongJsonInput
  errors: string[]
} {
  const errors: string[] = []
  const platformRecord = firstPlatformRecord(record)
  const title = stringValue(record.title) || stringValue(platformRecord.title)
  const artists = listFromRecordOrPlatformRecord(record, platformRecord, 'artists')
  const lyricists = listFromRecordOrPlatformRecord(record, platformRecord, 'lyricists')
  const composers = listFromRecordOrPlatformRecord(record, platformRecord, 'composers')
  const arrangers = listFromRecordOrPlatformRecord(record, platformRecord, 'arrangers')
  const vocals = listFromRecordOrPlatformRecord(record, platformRecord, 'vocals')
  const album =
    stringValue(record.album) ||
    stringValue(record.albumName) ||
    stringValue(platformRecord.album) ||
    stringValue(platformRecord.albumName)
  const audioUrl = stringValue(record.audioUrl)
  const coverUrl = stringValue(record.coverUrl)
  const lyric = nullableText(record.lyric)
  const description = nullableText(record.description)
  const releaseDateValue = valueFromRecordOrPlatformRecord(record, platformRecord, 'releaseDate')
  const releaseDate =
    releaseDateValue !== undefined ? normalizeOptionalDateOnly(releaseDateValue) : null
  const durationValue = valueFromRecordOrPlatformRecord(record, platformRecord, 'durationMs')
  const durationMs = durationValue !== undefined ? normalizeOptionalDurationMs(durationValue) : null
  const explicitSources = normalizeMusicExternalSourceInputs(record.sources)
  const sources = explicitSources.length
    ? explicitSources
    : normalizePlatformRecordSources(record.platformRecords)
  const customPlatformLinks = normalizeSongCustomPlatformLinks(record.customPlatformLinks)

  if (!title) errors.push('缺少歌曲标题 title')
  if (!artists.length) errors.push('缺少歌手 artists')
  if (releaseDate === undefined) errors.push('releaseDate 必须是 YYYY-MM-DD')
  if (durationMs === undefined) errors.push('durationMs 必须是非负整数毫秒')

  validateLength(errors, title, '歌曲标题', CONTENT_LIMITS.music.title)
  validateLength(errors, album, '专辑名', CONTENT_LIMITS.music.album)
  validateLength(errors, audioUrl, '音频链接', CONTENT_LIMITS.music.audioUrl)
  validateLength(errors, coverUrl, '封面链接', CONTENT_LIMITS.url)
  validateLength(errors, lyric, '歌词', CONTENT_LIMITS.music.lyric)
  validateLength(errors, description, '歌曲描述', CONTENT_LIMITS.music.description)
  validateCredits(errors, artists, '歌手')
  validateCredits(errors, lyricists, '作词')
  validateCredits(errors, composers, '作曲')
  validateCredits(errors, arrangers, '编曲')
  validateCredits(errors, vocals, '演唱')

  for (const source of sources) {
    validateLength(errors, source.sourceId, '平台 ID', CONTENT_LIMITS.music.platformId)
    validateLength(errors, source.sourceUrl, '平台链接', CONTENT_LIMITS.url)
  }

  return {
    input: {
      index,
      title,
      artists,
      lyricists,
      composers,
      arrangers,
      vocals,
      album,
      audioUrl,
      coverUrl,
      lyric,
      description,
      releaseDate: releaseDate ?? null,
      durationMs: durationMs ?? null,
      sources,
      customPlatformLinks,
    },
    errors,
  }
}

function validateSongJsonPayload(payload: unknown): Array<{
  input: NormalizedSongJsonInput
  errors: string[]
}> {
  const rawSongs = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.songs)
      ? payload.songs
      : null

  if (!rawSongs) {
    throw new Error('JSON 顶层必须是数组，或包含 songs 数组')
  }

  return rawSongs.map((item, index) => {
    if (!isRecord(item)) {
      const normalized = normalizeSongRecord({}, index)
      normalized.errors.push(`第 ${index + 1} 条歌曲必须是对象`)
      return normalized
    }
    return normalizeSongRecord(item, index)
  })
}

async function findExistingSongForInput(input: NormalizedSongJsonInput) {
  if (input.sources.length) {
    const source = await prisma.musicExternalSource.findFirst({
      where: {
        resourceType: 'song',
        OR: input.sources.map((item) => ({
          platform: item.platform,
          sourceId: item.sourceId,
        })),
      },
      include: {
        song: {
          include: {
            externalSources: true,
          },
        },
      },
    })

    if (source?.song && !source.song.deletedAt) {
      return {
        matchType: 'source' as const,
        song: source.song as SongImportExistingSong,
      }
    }
  }

  const song = await prisma.musicTrack.findFirst({
    where: {
      AND: [
        { deletedAt: null },
        { title: { equals: input.title } },
        { artists: { equals: input.artists } },
      ],
    } as Prisma.MusicTrackWhereInput,
    include: {
      externalSources: true,
    },
  })

  if (song) {
    return {
      matchType: 'title_artist' as const,
      song: song as SongImportExistingSong,
    }
  }

  return {
    matchType: 'none' as const,
    song: null,
  }
}

async function findSourceConflicts(input: NormalizedSongJsonInput, songDocId: string | null) {
  if (!input.sources.length) return []

  const sources = await prisma.musicExternalSource.findMany({
    where: {
      resourceType: 'song',
      OR: input.sources.map((item) => ({
        platform: item.platform,
        sourceId: item.sourceId,
      })),
      ...(songDocId ? { songDocId: { not: songDocId } } : {}),
    },
    include: {
      song: {
        select: {
          docId: true,
          title: true,
        },
      },
    },
  })

  return sources
    .filter((source) => source.song)
    .map((source) => ({
      platform: source.platform as MusicPlatform,
      sourceId: source.sourceId,
      songDocId: source.song!.docId,
      title: source.song!.title,
    }))
}

export async function previewSongJsonImport(payload: unknown): Promise<SongImportPreview> {
  const normalized = validateSongJsonPayload(payload)
  const items: SongImportPreviewItem[] = []

  for (const entry of normalized) {
    if (entry.errors.length) {
      items.push({
        input: entry.input,
        matchType: 'none',
        existingSong: null,
        sourceConflicts: [],
        suggestedAction: 'skip',
        validationErrors: entry.errors,
      })
      continue
    }

    const match = await findExistingSongForInput(entry.input)
    const sourceConflicts = await findSourceConflicts(entry.input, match.song?.docId ?? null)
    const matchType = sourceConflicts.length && !match.song ? 'conflict' : match.matchType

    items.push({
      input: entry.input,
      matchType,
      existingSong: match.song,
      sourceConflicts,
      suggestedAction: match.song ? 'fill' : 'create',
      validationErrors: [],
    })
  }

  return {
    items,
    invalidItems: items.filter((item) => item.validationErrors.length),
    createCount: items.filter(
      (item) => !item.validationErrors.length && !item.existingSong && !item.sourceConflicts.length
    ).length,
    duplicateCount: items.filter((item) => item.existingSong).length,
    conflictCount: items.reduce((count, item) => count + item.sourceConflicts.length, 0),
  }
}

function hasText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0
}

function hasList(value: unknown) {
  return Array.isArray(value) && value.length > 0
}

function buildFillUpdateData(input: NormalizedSongJsonInput, existing: SongImportExistingSong) {
  const data: Prisma.MusicTrackUpdateInput = {}

  if (!hasList(existing.lyricists) && input.lyricists.length) data.lyricists = input.lyricists
  if (!hasList(existing.composers) && input.composers.length) data.composers = input.composers
  if (!hasList(existing.arrangers) && input.arrangers.length) data.arrangers = input.arrangers
  if (!hasList(existing.vocals) && input.vocals.length) data.vocals = input.vocals
  if (!hasText(existing.album) && input.album) data.album = input.album
  if (!hasText(existing.audioUrl) && input.audioUrl) data.audioUrl = input.audioUrl
  if (!hasText(existing.lyric) && input.lyric) data.lyric = input.lyric
  if (!hasText(existing.description) && input.description) data.description = input.description
  if (!existing.releaseDate && input.releaseDate) data.releaseDate = input.releaseDate
  if (existing.durationMs === null && input.durationMs !== null) data.durationMs = input.durationMs
  if (!existing.customPlatformLinks && input.customPlatformLinks.length) {
    data.customPlatformLinks = toJsonValue(input.customPlatformLinks)
  }

  return data
}

function toJsonValue(value: SongCustomPlatformLink[]) {
  return value as unknown as Prisma.InputJsonValue
}

function buildSongData(input: NormalizedSongJsonInput) {
  return {
    title: input.title,
    artists: input.artists,
    lyricists: input.lyricists,
    composers: input.composers,
    arrangers: input.arrangers,
    vocals: input.vocals,
    album: input.album,
    audioUrl: input.audioUrl,
    lyric: input.lyric,
    description: input.description,
    releaseDate: input.releaseDate,
    durationMs: input.durationMs,
    customPlatformLinks: input.customPlatformLinks.length
      ? toJsonValue(input.customPlatformLinks)
      : Prisma.JsonNull,
  }
}

function buildOverwriteData(input: NormalizedSongJsonInput) {
  return {
    ...buildSongData(input),
  } satisfies Prisma.MusicTrackUpdateInput
}

function buildCreateData(input: NormalizedSongJsonInput) {
  return {
    ...buildSongData(input),
    externalSources: input.sources.length
      ? {
          create: input.sources.map((source, index) => ({
            resourceType: 'song' as const,
            platform: source.platform,
            sourceId: source.sourceId,
            sourceUrl: source.sourceUrl,
            isPrimary:
              source.isPrimary || (!input.sources.some((item) => item.isPrimary) && index === 0),
          })),
        }
      : undefined,
  }
}

async function appendMissingSources(
  input: NormalizedSongJsonInput,
  existing: SongImportExistingSong
) {
  const existingKeys = new Set(
    existing.externalSources.map((source) => `${source.platform}:${source.sourceId}`)
  )
  const sources = input.sources.filter(
    (source) => !existingKeys.has(`${source.platform}:${source.sourceId}`)
  )

  for (const [index, source] of sources.entries()) {
    await prisma.musicExternalSource.create({
      data: {
        resourceType: 'song',
        songDocId: existing.docId,
        platform: source.platform,
        sourceId: source.sourceId,
        sourceUrl: source.sourceUrl,
        isPrimary:
          source.isPrimary ||
          (!existing.externalSources.length &&
            !sources.some((item) => item.isPrimary) &&
            index === 0),
      },
    })
  }

  return sources.length > 0
}

async function replaceSources(input: NormalizedSongJsonInput, existing: SongImportExistingSong) {
  await prisma.musicExternalSource.deleteMany({
    where: {
      resourceType: 'song',
      songDocId: existing.docId,
    },
  })

  for (const [index, source] of input.sources.entries()) {
    await prisma.musicExternalSource.create({
      data: {
        resourceType: 'song',
        songDocId: existing.docId,
        platform: source.platform,
        sourceId: source.sourceId,
        sourceUrl: source.sourceUrl,
        isPrimary:
          source.isPrimary || (!input.sources.some((item) => item.isPrimary) && index === 0),
      },
    })
  }
}

async function maybeAddCover(
  input: NormalizedSongJsonInput,
  song:
    | SongImportExistingSong
    | { docId: string; coverId?: string | null; coverAlbumDocId?: string | null },
  options: SongImportExecutionOptions = {}
) {
  if (!input.coverUrl && !options.resolveCovers) return false
  if (song.coverId || song.coverAlbumDocId) return false

  if (input.coverUrl) {
    await addSongCoverFromUrl(song.docId, input.coverUrl, true)
    return true
  }

  if (!options.resolveCovers) return false

  return addFirstAvailableCoverFromSources(song.docId, input)
}

async function addFirstAvailableCoverFromSources(
  songDocId: string,
  input: NormalizedSongJsonInput
) {
  const seen = new Set<string>()
  let lastError: unknown = null

  for (const source of input.sources) {
    try {
      const preview = await getMusicResourcePreview(source.platform, 'song', source.sourceId)
      const track = preview.songs[0]
      const coverUrls = track?.picId
        ? await resolveCoverUrlCandidates(
            source.platform,
            track.picId,
            track.cover || preview.cover
          )
        : [preview.cover]

      const uniqueCoverUrls = coverUrls.filter((coverUrl) => {
        if (!coverUrl || seen.has(coverUrl)) return false
        seen.add(coverUrl)
        return true
      })
      try {
        if (await addFirstAvailableCover(songDocId, uniqueCoverUrls)) {
          return true
        }
      } catch (error) {
        lastError = error
      }
    } catch {
      continue
    }
  }

  if (lastError) {
    throw lastError
  }

  return false
}

async function addFirstAvailableCover(songDocId: string, coverUrls: string[]) {
  let lastError: unknown = null

  for (const coverUrl of coverUrls) {
    try {
      await addSongCoverFromUrl(songDocId, coverUrl, true)
      return true
    } catch (error) {
      lastError = error
    }
  }

  if (lastError) {
    throw lastError
  }

  return false
}

function createSummary(): SongImportSummary {
  return {
    created: 0,
    filled: 0,
    overwritten: 0,
    skipped: 0,
    invalid: 0,
    failed: 0,
    sourceConflicts: 0,
    coversAdded: 0,
    coverFailed: 0,
  }
}

async function tryMaybeAddCover(
  input: NormalizedSongJsonInput,
  song:
    | SongImportExistingSong
    | { docId: string; coverId?: string | null; coverAlbumDocId?: string | null },
  summary: SongImportSummary,
  options: SongImportExecutionOptions
) {
  try {
    const changed = await maybeAddCover(input, song, options)
    if (changed) {
      summary.coversAdded += 1
    }
    return { changed, error: null as string | null }
  } catch (error) {
    summary.coverFailed += 1
    return {
      changed: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function executeSongJsonImport(
  preview: SongImportPreview,
  actions: Map<number, SongDuplicateAction>,
  options: SongImportExecutionOptions = {}
): Promise<SongImportExecutionResult> {
  const summary = createSummary()
  const results: SongImportResultItem[] = []
  let changed = false

  for (const item of preview.items) {
    summary.sourceConflicts += item.sourceConflicts.length

    if (item.validationErrors.length) {
      summary.invalid += 1
      results.push({
        index: item.input.index,
        title: item.input.title,
        action: 'invalid',
        songDocId: null,
        matchType: item.matchType,
        error: item.validationErrors.join('；'),
      })
      continue
    }

    try {
      if (!item.existingSong) {
        if (item.sourceConflicts.length) {
          summary.failed += 1
          results.push({
            index: item.input.index,
            title: item.input.title,
            action: 'failed',
            songDocId: null,
            matchType: item.matchType,
            error: '外部来源已属于其他歌曲',
          })
          continue
        }

        const song = await withNumericSlugTransaction(prisma, 'MusicTrack', async (tx, slug) => {
          return tx.musicTrack.create({
            data: {
              slug,
              ...buildCreateData(item.input),
            },
          })
        })
        const coverResult = await tryMaybeAddCover(item.input, song, summary, options)
        await autoLinkInstrumental(
          song.docId,
          item.input.title,
          item.input.artists[0] || '未知歌手'
        )
        summary.created += 1
        changed = true
        results.push({
          index: item.input.index,
          title: item.input.title,
          action: 'create',
          songDocId: song.docId,
          matchType: item.matchType,
          ...(coverResult.error ? { coverError: coverResult.error } : {}),
        })
        continue
      }

      const action = actions.get(item.input.index) ?? 'fill'
      if (action === 'skip') {
        summary.skipped += 1
        results.push({
          index: item.input.index,
          title: item.input.title,
          action,
          songDocId: item.existingSong.docId,
          matchType: item.matchType,
        })
        continue
      }

      if (item.sourceConflicts.length) {
        summary.failed += 1
        results.push({
          index: item.input.index,
          title: item.input.title,
          action: 'failed',
          songDocId: item.existingSong.docId,
          matchType: item.matchType,
          error: '外部来源已属于其他歌曲',
        })
        continue
      }

      let coverError: string | null = null
      if (action === 'overwrite') {
        await prisma.musicTrack.update({
          where: { docId: item.existingSong.docId },
          data: buildOverwriteData(item.input),
        })
        await replaceSources(item.input, item.existingSong)
        const coverResult = await tryMaybeAddCover(item.input, item.existingSong, summary, options)
        coverError = coverResult.error
        summary.overwritten += 1
      } else {
        const data = buildFillUpdateData(item.input, item.existingSong)
        const hasDataChanges = Object.keys(data).length > 0
        if (hasDataChanges) {
          await prisma.musicTrack.update({
            where: { docId: item.existingSong.docId },
            data,
          })
        }
        const sourcesChanged = await appendMissingSources(item.input, item.existingSong)
        const coverResult = await tryMaybeAddCover(item.input, item.existingSong, summary, options)
        const coverChanged = coverResult.changed
        coverError = coverResult.error
        summary.filled += 1
        changed = changed || hasDataChanges || sourcesChanged || coverChanged
      }

      if (action === 'overwrite') {
        changed = true
      }
      results.push({
        index: item.input.index,
        title: item.input.title,
        action,
        songDocId: item.existingSong.docId,
        matchType: item.matchType,
        ...(coverError ? { coverError } : {}),
      })
    } catch (error) {
      summary.failed += 1
      results.push({
        index: item.input.index,
        title: item.input.title,
        action: 'failed',
        songDocId: item.existingSong?.docId ?? null,
        matchType: item.matchType,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (changed) {
    enhancedCache.invalidateByPrefix('music_list:')
  }

  return {
    summary,
    items: results,
  }
}
