import type { Router } from 'express'
import { createRouter } from '../utils/typed-router'
import { requireAuth, requireActiveUser, requireAdmin } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { adminBatchSongCoversSchema, validateBody } from '../schemas'
import {
  prisma,
  toSongResponse,
  fetchSongsWithRelations,
  fetchSongsWithRelationsByDocIds,
  fetchSongWithRelationsByDocId,
  normalizeMusicImportTracks,
  createOrUpdateImportedSong,
  resolveMusicPlayUrl,
  normalizeMusicExternalSourceInputs,
  parseMusicPlatform,
  parseDisplayAlbumMode,
  normalizeSongCustomPlatformLinks,
  addSongCoverFromAsset,
  addAlbumCoverFromUrl,
  resolveSongCoverUrl,
  resolveAlbumCoverUrl,
  buildAlbumTracksPayload,
  ensureDisplayRelation,
  normalizeTrackDiscPayload,
  parseInteger,
  parseBoolean,
  normalizeOptionalDateOnly,
  normalizeOptionalDurationMs,
  buildPostVisibilityWhere,
  parsePostSort,
  toPostResponse,
  canViewPost,
  applyAlbumTracksToRelations,
  enhancedCache,
  ensureTextLimit,
  deletedAtFilter,
  softDeleteData,
  allocateNumericSlug,
  isNumericSlug,
  withNumericSlugTransaction,
} from '../utils'
import { parseMusicUrl } from '../music/musicUrlParser'
import {
  getMusicResourcePreview,
  searchMusicResources,
  type MusicResourcePreview,
} from '../music/metingService'
import { cleanupUnusedMediaAssetById } from '../services/mediaAssetCleanupService'
import { deleteMusicCoverThumbnail } from '../services/musicCoverThumbnail.service'
import type { AuthenticatedRequest, ContentStatus } from '../types'
import { Prisma } from '@prisma/client'
import { CONTENT_LIMITS } from '../../lib/contentLimits'
import { formatMusicCredits, normalizeStringListInput } from '../../lib/musicCredits'

const router = createRouter()

type MusicListSortBy = 'releaseDate' | 'title' | 'artist'
type MusicListSortOrder = 'asc' | 'desc'

async function maybeAddImportedAlbumCover(albumDocId: string, coverUrl: string) {
  try {
    await addAlbumCoverFromUrl(albumDocId, coverUrl, true)
    return true
  } catch (error) {
    console.warn(`Import album cover failed for ${albumDocId}:`, error)
    return false
  }
}

function parseMusicListSortBy(value: unknown): MusicListSortBy {
  if (value === 'createdAt' || value === 'releaseDate') return 'releaseDate'
  if (value === 'title' || value === 'artist') return value
  return 'releaseDate'
}

function parseMusicListSortOrder(value: unknown): MusicListSortOrder {
  return value === 'asc' || value === 'desc' ? value : 'desc'
}

function buildReleaseDateOrderBy(
  sortOrder: MusicListSortOrder
): Prisma.MusicTrackOrderByWithRelationInput[] {
  return [
    { releaseDate: { sort: sortOrder, nulls: 'last' } },
    { createdAt: 'desc' },
    { docId: 'asc' },
  ]
}

function compareMusicListRows(
  a: { docId: string; title: string; artists: string[]; createdAt: Date },
  b: { docId: string; title: string; artists: string[]; createdAt: Date },
  sortBy: MusicListSortBy,
  sortOrder: MusicListSortOrder
) {
  const direction = sortOrder === 'asc' ? 1 : -1
  const result =
    sortBy === 'artist'
      ? formatMusicCredits(a.artists, '').localeCompare(formatMusicCredits(b.artists, ''), 'zh-CN')
      : a.title.localeCompare(b.title, 'zh-CN')

  if (result !== 0) return result * direction
  const createdAtResult = b.createdAt.getTime() - a.createdAt.getTime()
  if (createdAtResult !== 0) return createdAtResult
  return a.docId.localeCompare(b.docId)
}

async function fetchAlbumTrackPage(albumDocId: string, skip: number, limit: number) {
  const where = { albumDocId, song: { deletedAt: null } }
  const [relations, total] = await Promise.all([
    prisma.songAlbumRelation.findMany({
      where,
      select: { songDocId: true },
      orderBy: [{ discNumber: 'asc' }, { trackOrder: 'asc' }, { songDocId: 'asc' }],
      take: limit,
      skip,
    }),
    prisma.songAlbumRelation.count({ where }),
  ])
  const songDocIds = relations.map((relation) => relation.songDocId)
  return [await fetchSongsWithRelationsByDocIds(songDocIds), total] as const
}

function ensureMusicTextLimits(
  res: Parameters<typeof ensureTextLimit>[0],
  input: Record<string, unknown>
) {
  const creditFields = ['artists', 'lyricists', 'composers', 'arrangers', 'vocals']
  for (const field of creditFields) {
    const credits = normalizeStringListInput(input[field])
    if (credits.some((item) => item.length > CONTENT_LIMITS.music.artist)) {
      res
        .status(400)
        .json({ error: `${field} 单项长度不能超过 ${CONTENT_LIMITS.music.artist} 个字符` })
      return false
    }
  }

  return (
    ensureTextLimit(res, input.title, '歌曲标题', CONTENT_LIMITS.music.title) &&
    ensureTextLimit(res, input.album, '专辑名', CONTENT_LIMITS.music.album) &&
    ensureTextLimit(res, input.description, '歌曲描述', CONTENT_LIMITS.music.description) &&
    ensureTextLimit(res, input.audioUrl, '音频链接', CONTENT_LIMITS.music.audioUrl) &&
    ensureTextLimit(res, input.lyric, '歌词', CONTENT_LIMITS.music.lyric) &&
    ensureTextLimit(res, input.manualAlbumName, '手动专辑名', CONTENT_LIMITS.music.manualAlbumName)
  )
}

function normalizeNullableText(value: unknown) {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function normalizeNullableMarkdown(value: unknown) {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  return value.trim() ? value : null
}

async function deleteSongCoverById(docId: string, coverId: string) {
  const [song, cover] = await Promise.all([
    prisma.musicTrack.findUnique({ where: { docId }, select: { coverId: true } }),
    prisma.songCover.findFirst({
      where: {
        id: coverId,
        songDocId: docId,
      },
    }),
  ])

  if (!cover) return false

  await prisma.songCover.delete({ where: { id: cover.id } })
  await deleteMusicCoverThumbnail(cover.thumbnailUrl)

  if (cover.assetId) {
    await cleanupUnusedMediaAssetById(cover.assetId)
  }

  const remaining = await prisma.songCover.findMany({
    where: { songDocId: docId },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      isDefault: true,
    },
  })

  if (!remaining.length && song?.coverId === coverId) {
    await prisma.musicTrack.update({
      where: { docId },
      data: {
        coverId: null,
      },
    })
  } else if (song?.coverId === coverId || cover.isDefault) {
    const fallback = remaining.find((item) => item.isDefault) || remaining[0]
    if (fallback && song?.coverId === coverId) {
      await prisma.musicTrack.update({
        where: { docId },
        data: { coverId: fallback.id },
      })
    }
    if (fallback && !fallback.isDefault) {
      await prisma.songCover.update({
        where: { id: fallback.id },
        data: { isDefault: true },
      })
    }
  }

  return true
}

// Music list
router.get(
  '/',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const albumDocId = typeof req.query.albumDocId === 'string' ? req.query.albumDocId.trim() : ''
      const limit = parseInteger(req.query.limit, 20, { min: 1, max: 100 })
      const page = parseInteger(req.query.page, 1, { min: 1 })
      const skip = (page - 1) * limit
      const includeInstrumentals = parseBoolean(req.query.includeInstrumentals, true)
      const sortBy = parseMusicListSortBy(req.query.sortBy)
      const sortOrder = parseMusicListSortOrder(req.query.sortOrder)

      if (!req.authUser && !albumDocId) {
        const cacheKey = `music_list:${includeInstrumentals}:${page}:${limit}:${sortBy}:${sortOrder}`
        const cached = enhancedCache.get(cacheKey)
        if (cached) {
          res.json(cached)
          return
        }
      }

      let instrumentalDocIds: string[] = []
      if (!albumDocId && !includeInstrumentals) {
        const relations = await prisma.songInstrumentalRelation.findMany({
          select: { songDocId: true },
          distinct: ['songDocId'],
        })
        instrumentalDocIds = relations.map((r) => r.songDocId)
      }

      const where = albumDocId
        ? {
            deletedAt: null,
            albumRelations: {
              some: {
                albumDocId,
              },
            },
          }
        : instrumentalDocIds.length > 0
          ? { deletedAt: null, docId: { notIn: instrumentalDocIds } }
          : { deletedAt: null }

      const [songs, total] = albumDocId
        ? await fetchAlbumTrackPage(albumDocId, skip, limit)
        : sortBy === 'artist' || sortBy === 'title'
          ? await (async () => {
              const rows = await prisma.musicTrack.findMany({
                where,
                select: {
                  docId: true,
                  title: true,
                  artists: true,
                  createdAt: true,
                },
              })
              const songDocIds = rows
                .sort((a, b) => compareMusicListRows(a, b, sortBy, sortOrder))
                .slice(skip, skip + limit)
                .map((song) => song.docId)
              return [await fetchSongsWithRelationsByDocIds(songDocIds), rows.length] as const
            })()
          : await Promise.all([
              fetchSongsWithRelations(where, {
                take: limit,
                skip,
                orderBy: buildReleaseDateOrderBy(sortOrder),
              }),
              prisma.musicTrack.count({ where }),
            ])

      const favoritedMusicSet = new Set<string>()
      if (req.authUser && songs.length) {
        const favorites = await prisma.favorite.findMany({
          where: {
            userUid: req.authUser.uid,
            targetType: 'music',
            targetId: { in: songs.map((song) => song.docId) },
          },
          select: { targetId: true },
        })
        favorites.forEach((item) => favoritedMusicSet.add(item.targetId))
      }

      const result = {
        songs: songs.map((song) =>
          toSongResponse(song, {
            favoritedByMe: favoritedMusicSet.has(song.docId),
            excludeLyric: true,
            excludeDescription: true,
          })
        ),
        total,
        page,
        limit,
        hasMore: page * limit < total,
      }

      if (!req.authUser && !albumDocId) {
        const cacheKey = `music_list:${includeInstrumentals}:${page}:${limit}:${sortBy}:${sortOrder}`
        enhancedCache.set(cacheKey, result, 120)
      }

      res.json(result)
    } catch (error) {
      console.error('Fetch music error:', error)
      res.status(500).json({ error: '获取音乐失败' })
    }
  })
)

// Create music
router.post(
  '/',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>
      const title = typeof body.title === 'string' ? body.title.trim() : ''
      const normalizedArtists = normalizeStringListInput(body.artists)
      const artists = normalizedArtists.length
        ? normalizedArtists
        : normalizeStringListInput(body.artist)
      const lyricists = normalizeStringListInput(body.lyricists)
      const composers = normalizeStringListInput(body.composers)
      const arrangers = normalizeStringListInput(body.arrangers)
      const vocals = normalizeStringListInput(body.vocals)
      const album = typeof body.album === 'string' ? body.album.trim() : ''
      const audioUrl = typeof body.audioUrl === 'string' ? body.audioUrl.trim() : ''
      const lyric = typeof body.lyric === 'string' ? body.lyric : null
      const description = normalizeNullableMarkdown(body.description)
      const hasReleaseDate = Object.prototype.hasOwnProperty.call(body, 'releaseDate')
      const hasDurationMs = Object.prototype.hasOwnProperty.call(body, 'durationMs')
      const releaseDate = hasReleaseDate ? normalizeOptionalDateOnly(body.releaseDate) : null
      const durationMs = hasDurationMs ? normalizeOptionalDurationMs(body.durationMs) : null
      const sources = normalizeMusicExternalSourceInputs(body.sources)
      const customPlatformLinks = normalizeSongCustomPlatformLinks(body.customPlatformLinks)
      if (!ensureMusicTextLimits(res, body)) {
        return
      }
      if (releaseDate === undefined || durationMs === undefined) {
        res.status(400).json({ error: '发行日期或时长格式无效' })
        return
      }

      if (!title || !artists.length) {
        res.status(400).json({ error: '缺少歌曲信息' })
        return
      }

      if (sources.length) {
        const conflict = await prisma.musicExternalSource.findFirst({
          where: {
            resourceType: 'song',
            OR: sources.map((source) => ({
              platform: source.platform,
              sourceId: source.sourceId,
            })),
          },
          include: {
            song: { select: { docId: true, title: true, artists: true } },
          },
        })
        if (conflict?.song) {
          res.status(409).json({
            error: `该平台来源已被歌曲「${conflict.song.title}」使用`,
            conflict: true,
            conflictingSong: {
              docId: conflict.song.docId,
              title: conflict.song.title,
              artists: conflict.song.artists,
            },
          })
          return
        }
      }

      const song = await prisma.$transaction(async (tx) => {
        const slug = await allocateNumericSlug(tx, 'MusicTrack')
        return tx.musicTrack.create({
          data: {
            slug,
            title,
            artists,
            lyricists,
            composers,
            arrangers,
            vocals,
            album,
            audioUrl,
            lyric,
            description: description ?? null,
            releaseDate,
            durationMs,
            customPlatformLinks: customPlatformLinks.length
              ? (customPlatformLinks as unknown as Prisma.InputJsonValue)
              : undefined,
            ...(sources.length
              ? {
                  externalSources: {
                    create: sources.map((source) => ({
                      resourceType: 'song' as const,
                      platform: source.platform,
                      sourceId: source.sourceId,
                      sourceUrl: source.sourceUrl,
                      isPrimary: source.isPrimary,
                    })),
                  },
                }
              : {}),
          },
        })
      })

      const hydrated = await fetchSongWithRelationsByDocId(song.docId)
      res.status(201).json({
        song: hydrated ? toSongResponse(hydrated) : song,
      })
      enhancedCache.invalidateByPrefix('music_list:')
    } catch (error) {
      console.error('Add music error:', error)
      res.status(500).json({ error: '添加歌曲失败' })
    }
  })
)

// Parse music URL
router.post(
  '/parse-url',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : ''
      if (!rawUrl) {
        res.status(400).json({ error: '请提供音乐链接' })
        return
      }

      const parsed = parseMusicUrl(rawUrl)
      if (!parsed) {
        res.status(400).json({ error: '无法识别的音乐链接' })
        return
      }

      const preview = await getMusicResourcePreview(parsed.platform, parsed.type, parsed.id)

      res.json({
        resource: {
          ...preview,
          totalSongs: preview.songs.length,
        },
      })
    } catch (error) {
      console.error('Parse music url error:', error)
      res.status(500).json({ error: '解析音乐链接失败' })
    }
  })
)

// Import music
router.post(
  '/import',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : ''
      if (!rawUrl) {
        res.status(400).json({ error: '请提供音乐链接' })
        return
      }

      const parsed = parseMusicUrl(rawUrl)
      if (!parsed) {
        res.status(400).json({ error: '无法识别的音乐链接' })
        return
      }

      const preview = await getMusicResourcePreview(parsed.platform, parsed.type, parsed.id)
      const selectedSongIdsRaw = Array.isArray(req.body?.selectedSongIds)
        ? req.body.selectedSongIds
        : []
      const selectedSongIds = selectedSongIdsRaw
        .filter((item: unknown): item is string => typeof item === 'string')
        .map((item: string) => item.trim())
        .filter(Boolean)
      const selectedSet = selectedSongIds.length ? new Set(selectedSongIds) : null

      const tracks = normalizeMusicImportTracks(preview.songs).filter((track) => {
        if (!selectedSet) return true
        return selectedSet.has(track.sourceId)
      })

      if (!tracks.length) {
        res.status(400).json({ error: '没有可导入的歌曲' })
        return
      }

      let imported = 0
      let skipped = 0
      let failed = 0
      let linked = 0

      const importedSongs: Array<{
        songDocId: string
        trackOrder: number
        title: string
        artists: string[]
        isInstrumental?: boolean
      }> = []
      const linkedSongs: Array<{
        docId: string
        title: string
        artists: string[]
        platform: string
      }> = []

      for (let index = 0; index < tracks.length; index += 1) {
        const track = tracks[index]
        try {
          const result = await createOrUpdateImportedSong({
            platform: preview.platform,
            track,
            albumNameFallback: preview.title,
          })
          if (result.created) {
            imported += 1
          } else {
            skipped += 1
          }
          if (result.linked) {
            linked += 1
            linkedSongs.push({
              docId: result.song.docId,
              title: result.song.title,
              artists: result.song.artists,
              platform: preview.platform,
            })
          }
          importedSongs.push({
            songDocId: result.song.docId,
            trackOrder: index,
            title: result.song.title,
            artists: result.song.artists,
            isInstrumental: track.isInstrumental,
          })
        } catch (error) {
          console.error('Import track error:', error)
          failed += 1
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
              artists: item.artists,
            },
          },
        ],
      }))

      let collection: { docId: string; title: string } | null = null
      let albumListChanged = false

      if (tracksPayload.length) {
        const existingAlbumSource = await prisma.musicExternalSource.findUnique({
          where: {
            resourceType_platform_sourceId: {
              resourceType: 'album',
              platform: preview.platform,
              sourceId: preview.id,
            },
          },
          include: {
            album: true,
          },
        })
        const existingAlbum = existingAlbumSource?.album || null

        if (existingAlbum) {
          collection = {
            docId: existingAlbum.docId,
            title: existingAlbum.title,
          }
          const existingTracks = normalizeTrackDiscPayload(existingAlbum.tracks)
          const existingDocIds = new Set(
            existingTracks.flatMap((disc) => disc.songs.map((s) => s.songDocId))
          )
          const newTracks = tracksPayload.filter(
            (track) => !existingDocIds.has(track.songs[0].songDocId)
          )
          if (newTracks.length) {
            const merged = [...existingTracks, ...newTracks]
            merged.sort((a, b) => a.disc - b.disc)
            await prisma.album.update({
              where: { docId: existingAlbum.docId },
              data: {
                tracks: merged,
                updatedAt: new Date(),
              },
            })
            await applyAlbumTracksToRelations(existingAlbum.docId, merged)
            albumListChanged = true
          }
          // 增量导入时更新专辑信息
          const updateData: Record<string, unknown> = {}
          if (preview.description && !existingAlbum.description) {
            updateData.description = preview.description
          }
          if (
            preview.artist &&
            preview.artist !== '未知歌手' &&
            existingAlbum.artist === 'Various Artists'
          ) {
            updateData.artist = preview.artist
          }
          if (Object.keys(updateData).length > 0) {
            await prisma.album.update({
              where: { docId: existingAlbum.docId },
              data: updateData,
            })
            albumListChanged = true
          }
          if (preview.cover && !existingAlbum.coverId) {
            const coverAdded = await maybeAddImportedAlbumCover(existingAlbum.docId, preview.cover)
            albumListChanged = albumListChanged || coverAdded
          }
        } else {
          const createdAlbum = await withNumericSlugTransaction(
            prisma,
            'Album',
            async (tx, slug) => {
              return tx.album.create({
                data: {
                  slug,
                  title: preview.title,
                  artist: preview.artist || 'Various Artists',
                  description: preview.description || null,
                  tracks: tracksPayload,
                  externalSources: {
                    create: {
                      resourceType: 'album',
                      platform: preview.platform,
                      sourceId: preview.id,
                      sourceUrl: preview.platformUrl || null,
                      isPrimary: true,
                    },
                  },
                },
              })
            }
          )
          if (preview.cover) {
            await maybeAddImportedAlbumCover(createdAlbum.docId, preview.cover)
          }
          await applyAlbumTracksToRelations(createdAlbum.docId, tracksPayload)
          albumListChanged = true
          collection = {
            docId: createdAlbum.docId,
            title: createdAlbum.title,
          }
        }
      }

      if (albumListChanged) {
        enhancedCache.invalidateByPrefix('album_list:')
      }

      res.json({
        summary: {
          imported,
          skipped,
          failed,
        },
        linked,
        linkedSongs,
        importedSongs,
        collection: collection
          ? {
              docId: collection.docId,
              title: collection.title,
            }
          : null,
      })
    } catch (error) {
      console.error('Import music error:', error)
      res.status(500).json({ error: '导入音乐失败' })
    }
  })
)

// Legacy import routes (kept for backward compatibility)
router.post(
  '/from-netease',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.status(410).json({ error: '请使用通用导入接口 /api/music/import' })
  })
)

router.post(
  '/from-qq',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.status(410).json({ error: '请使用通用导入接口 /api/music/import' })
  })
)

router.post(
  '/from-kugou',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.status(410).json({ error: '请使用通用导入接口 /api/music/import' })
  })
)

router.post(
  '/from-baidu',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.status(410).json({ error: '请使用通用导入接口 /api/music/import' })
  })
)

router.post(
  '/from-kuwo',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.status(410).json({ error: '请使用通用导入接口 /api/music/import' })
  })
)

// Get play URL
router.get(
  '/:docId/play-url',
  asyncHandler(async (req, res) => {
    try {
      const { docId } = req.params
      const song = await fetchSongWithRelationsByDocId(docId)

      if (!song) {
        res.status(404).json({ error: '歌曲不存在' })
        return
      }

      const resolved = await resolveMusicPlayUrl(song)

      res.json({
        playUrl: resolved.playUrl,
        platform: resolved.platform,
        sourceId: resolved.sourceId,
        playable: resolved.playable,
        cached: resolved.cached,
        cacheExpiresAt: resolved.cacheExpiresAt,
      })
    } catch (error) {
      console.error('Fetch play url error:', error)
      res.status(500).json({ error: '获取播放链接失败' })
    }
  })
)

// Get instrumental targets
router.get(
  '/instrumental-targets',
  asyncHandler(async (req, res) => {
    try {
      const relations = await prisma.songInstrumentalRelation.findMany({
        select: {
          songDocId: true,
        },
        distinct: ['songDocId'],
      })
      res.json({
        docIds: relations.map((r) => r.songDocId),
      })
    } catch (error) {
      console.error('Fetch instrumental targets error:', error)
      res.status(500).json({ error: '获取伴奏列表失败' })
    }
  })
)

// Match suggestions (must be before /:docId routes to avoid being captured by :docId param)
router.get(
  '/match-suggestions',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const platform = typeof req.query.platform === 'string' ? req.query.platform.trim() : ''
      const title = typeof req.query.title === 'string' ? req.query.title.trim() : ''
      const artists = normalizeStringListInput(req.query.artists || req.query.artist)
      const artistsText = formatMusicCredits(artists, '')

      if (!platform || !title || !artistsText) {
        res.status(400).json({ error: '缺少必要参数：platform, title, artists' })
        return
      }

      const parsedPlatform = parseMusicPlatform(platform)
      if (!parsedPlatform) {
        res.status(400).json({ error: '无效的平台' })
        return
      }

      const cleanTitle = title
        .replace(/[（].*[)）]/g, '')
        .replace(/[【\[].*[]】\]/g, '')
        .trim()
      const keyword = `${cleanTitle} ${artistsText}`.trim()

      const searchResults = await searchMusicResources({
        platform: parsedPlatform,
        keyword,
        type: 'song',
        limit: 20,
      })

      const normalizedTitle = cleanTitle.toLowerCase().replace(/\s+/g, '')
      const normalizedArtists = artistsText.toLowerCase().replace(/\s+/g, '')

      const scored = searchResults
        .map((item) => {
          const itemTitleClean = item.title
            .replace(/[（].*[)）]/g, '')
            .replace(/[【\[].*[]】\]/g, '')
            .trim()
          const itemTitleNorm = itemTitleClean.toLowerCase().replace(/\s+/g, '')
          const itemArtistsNorm = formatMusicCredits(item.artists, '')
            .toLowerCase()
            .replace(/\s+/g, '')
          const titleScore = calculateSimilarity(normalizedTitle, itemTitleNorm)
          const artistScore = calculateSimilarity(normalizedArtists, itemArtistsNorm)
          const avgScore = (titleScore + artistScore) / 2
          return { ...item, score: avgScore }
        })
        .filter((item) => item.score >= 0.35)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)

      let autoSelectedIndex: number | null = null
      if (scored.length === 1 && scored[0].score >= 0.8) {
        autoSelectedIndex = 0
      } else if (
        scored.length > 1 &&
        scored[0].score >= 0.85 &&
        scored[1].score < scored[0].score - 0.15
      ) {
        autoSelectedIndex = 0
      }

      const sourceIds = scored.map((item) => item.sourceId)
      const existingSongsByPlatformId = sourceIds.length
        ? await prisma.musicExternalSource.findMany({
            where: {
              resourceType: 'song',
              platform: parsedPlatform,
              sourceId: { in: sourceIds },
            },
            include: {
              song: {
                select: {
                  docId: true,
                  title: true,
                  artists: true,
                },
              },
            },
          })
        : []

      const existingMap = new Map<string, { docId: string; title: string; artists: string[] }>()
      for (const source of existingSongsByPlatformId) {
        if (source.song) {
          existingMap.set(source.sourceId, {
            docId: source.song.docId,
            title: source.song.title,
            artists: source.song.artists,
          })
        }
      }

      const suggestions = scored.map((item, index) => {
        const existing = existingMap.get(item.sourceId)
        return {
          sourceId: item.sourceId,
          title: item.title,
          artists: item.artists,
          album: item.album,
          cover: item.picId,
          sourceUrl: item.sourceUrl,
          score: Math.round(item.score * 100),
          isAutoSelected: index === autoSelectedIndex,
          alreadyLinked: existing ? { docId: existing.docId, title: existing.title } : null,
        }
      })

      res.json({ suggestions, autoSelectedIndex })
    } catch (error) {
      console.error('Match suggestions error:', error)
      res.status(500).json({ error: '搜索匹配歌曲失败' })
    }
  })
)

// Get music by public numeric slug
router.get(
  '/:slug',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      if (!isNumericSlug(req.params.slug)) {
        res.status(404).json({ error: '歌曲不存在' })
        return
      }

      const bySlug = await prisma.musicTrack.findUnique({
        where: { slug: req.params.slug },
        select: { docId: true, deletedAt: true },
      })
      const song =
        bySlug && !bySlug.deletedAt ? await fetchSongWithRelationsByDocId(bySlug.docId) : null

      if (!song) {
        res.status(404).json({ error: '歌曲不存在' })
        return
      }

      const favoritedByMe = req.authUser
        ? Boolean(
            await prisma.favorite.findFirst({
              where: {
                userUid: req.authUser.uid,
                targetType: 'music',
                targetId: song.docId,
              },
              select: { id: true },
            })
          )
        : false

      const responseSong = toSongResponse(song, { favoritedByMe })
      res.json({ song: responseSong })
    } catch (error) {
      console.error('Fetch song detail error:', error)
      res.status(500).json({ error: '获取歌曲详情失败' })
    }
  })
)

// Delete music
router.delete(
  '/:docId',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const docId = req.params.docId
      const song = await prisma.musicTrack.findUnique({
        where: { docId },
        include: {
          covers: true,
        },
      })

      if (!song || song.deletedAt) {
        res.status(404).json({ error: '歌曲不存在' })
        return
      }

      await prisma.musicTrack.update({
        where: { docId },
        data: softDeleteData(req.authUser!.uid),
      })

      res.json({ success: true })
      enhancedCache.invalidateByPrefix('music_list:')
    } catch (error) {
      console.error('Delete music error:', error)
      res.status(500).json({ error: '删除歌曲失败' })
    }
  })
)

// Update music
router.patch(
  '/:docId',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const docId = req.params.docId
      const existing = await prisma.musicTrack.findUnique({ where: { docId } })
      if (!existing) {
        res.status(404).json({ error: '歌曲不存在' })
        return
      }

      const body = (req.body || {}) as Record<string, unknown>
      const updateData: Record<string, unknown> = {}

      if (typeof body.title === 'string') updateData.title = body.title.trim()
      if (Object.prototype.hasOwnProperty.call(body, 'artists'))
        updateData.artists = normalizeStringListInput(body.artists)
      if (Object.prototype.hasOwnProperty.call(body, 'lyricists'))
        updateData.lyricists = normalizeStringListInput(body.lyricists)
      if (Object.prototype.hasOwnProperty.call(body, 'composers'))
        updateData.composers = normalizeStringListInput(body.composers)
      if (Object.prototype.hasOwnProperty.call(body, 'arrangers'))
        updateData.arrangers = normalizeStringListInput(body.arrangers)
      if (Object.prototype.hasOwnProperty.call(body, 'vocals'))
        updateData.vocals = normalizeStringListInput(body.vocals)
      if (typeof body.album === 'string') updateData.album = body.album.trim()
      if (typeof body.audioUrl === 'string') updateData.audioUrl = body.audioUrl.trim()
      if (typeof body.lyric === 'string' || body.lyric === null) updateData.lyric = body.lyric
      if (typeof body.description === 'string' || body.description === null) {
        updateData.description = normalizeNullableMarkdown(body.description)
      }
      if (Object.prototype.hasOwnProperty.call(body, 'releaseDate')) {
        const releaseDate = normalizeOptionalDateOnly(body.releaseDate)
        if (releaseDate === undefined) {
          res.status(400).json({ error: '发行日期格式无效' })
          return
        }
        updateData.releaseDate = releaseDate
      }
      if (Object.prototype.hasOwnProperty.call(body, 'durationMs')) {
        const durationMs = normalizeOptionalDurationMs(body.durationMs)
        if (durationMs === undefined) {
          res.status(400).json({ error: '时长格式无效' })
          return
        }
        updateData.durationMs = durationMs
      }
      if (!ensureMusicTextLimits(res, body)) {
        return
      }
      if (Array.isArray(updateData.artists) && updateData.artists.length === 0) {
        res.status(400).json({ error: '请至少填写一位歌手' })
        return
      }

      const displayAlbumMode = parseDisplayAlbumMode(body.displayAlbumMode)
      if (displayAlbumMode) {
        updateData.displayAlbumMode = displayAlbumMode
        if (displayAlbumMode !== 'manual') {
          updateData.manualAlbumName = null
        }
      }
      if (typeof body.manualAlbumName === 'string') {
        updateData.manualAlbumName = body.manualAlbumName.trim()
      }
      if (Object.prototype.hasOwnProperty.call(body, 'coverAlbumDocId')) {
        const coverAlbumDocId =
          typeof body.coverAlbumDocId === 'string' ? body.coverAlbumDocId.trim() : null
        if (coverAlbumDocId) {
          const album = await prisma.album.findFirst({
            where: { docId: coverAlbumDocId, deletedAt: null },
            select: { docId: true },
          })
          if (!album) {
            res.status(400).json({ error: '封面来源专辑不存在' })
            return
          }
          updateData.coverAlbumDocId = coverAlbumDocId
          updateData.coverId = null
        } else {
          updateData.coverAlbumDocId = null
        }
      }
      if (Object.prototype.hasOwnProperty.call(body, 'customPlatformLinks')) {
        updateData.customPlatformLinks = normalizeSongCustomPlatformLinks(
          body.customPlatformLinks
        ) as unknown as Prisma.InputJsonValue
      }

      const shouldReplaceSources = Object.prototype.hasOwnProperty.call(body, 'sources')
      const sources = shouldReplaceSources ? normalizeMusicExternalSourceInputs(body.sources) : []
      if (sources.length) {
        const conflict = await prisma.musicExternalSource.findFirst({
          where: {
            resourceType: 'song',
            OR: sources.map((source) => ({
              platform: source.platform,
              sourceId: source.sourceId,
            })),
            songDocId: { not: docId },
          },
          include: {
            song: { select: { docId: true, title: true, artists: true } },
          },
        })
        if (conflict?.song) {
          res.status(409).json({
            error: `该平台来源已被歌曲「${conflict.song.title}」使用`,
            conflict: true,
            conflictingSong: {
              docId: conflict.song.docId,
              title: conflict.song.title,
              artists: conflict.song.artists,
            },
          })
          return
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.musicTrack.update({
          where: { docId },
          data: updateData,
        })
        if (shouldReplaceSources) {
          await tx.musicExternalSource.deleteMany({
            where: { resourceType: 'song', songDocId: docId },
          })
          if (sources.length) {
            await tx.musicExternalSource.createMany({
              data: sources.map((source) => ({
                resourceType: 'song',
                songDocId: docId,
                platform: source.platform,
                sourceId: source.sourceId,
                sourceUrl: source.sourceUrl,
                isPrimary: source.isPrimary,
              })),
            })
          }
        }
      })

      const song = await fetchSongWithRelationsByDocId(docId)
      if (!song) {
        res.status(404).json({ error: '歌曲不存在' })
        return
      }

      res.json({ song: toSongResponse(song) })
      enhancedCache.invalidateByPrefix('music_list:')
    } catch (error) {
      console.error('Update music error:', error)
      res.status(500).json({ error: '更新歌曲失败' })
    }
  })
)

// Get music covers
router.get(
  '/:docId/covers',
  asyncHandler(async (req, res) => {
    try {
      const song = await prisma.musicTrack.findUnique({
        where: { docId: req.params.docId },
        include: {
          covers: {
            orderBy: { sortOrder: 'asc' },
          },
        },
      })

      if (!song) {
        res.status(404).json({ error: '歌曲不存在' })
        return
      }

      res.json({
        covers: (song.covers || []).map((cover) => ({
          id: cover.id,
          assetId: cover.assetId,
          storageKey: cover.storageKey,
          url: cover.publicUrl,
          thumbnailUrl: cover.thumbnailUrl,
          isDefault: cover.isDefault,
          sortOrder: cover.sortOrder,
        })),
      })
    } catch (error) {
      console.error('Fetch song covers error:', error)
      res.status(500).json({ error: '获取歌曲封面失败' })
    }
  })
)

// Add music cover
router.post(
  '/:docId/covers',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const songDocId = req.params.docId
      const assetId = typeof req.body?.assetId === 'string' ? req.body.assetId.trim() : ''
      const isDefault = parseBoolean(req.body?.isDefault, false)

      if (!assetId) {
        res.status(400).json({ error: '缺少 assetId' })
        return
      }

      const song = await prisma.musicTrack.findUnique({ where: { docId: songDocId } })
      if (!song) {
        res.status(404).json({ error: '歌曲不存在' })
        return
      }

      const cover = await addSongCoverFromAsset(songDocId, assetId, isDefault)

      res.status(201).json({
        cover: {
          id: cover.id,
          assetId: cover.assetId,
          storageKey: cover.storageKey,
          url: cover.publicUrl,
          thumbnailUrl: cover.thumbnailUrl,
          isDefault: cover.isDefault,
          sortOrder: cover.sortOrder,
        },
      })
    } catch (error) {
      console.error('Create song cover error:', error)
      res.status(500).json({ error: '添加歌曲封面失败' })
    }
  })
)

// Delete music cover
router.delete(
  '/:docId/covers',
  requireAdmin,
  validateBody(adminBatchSongCoversSchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { docId } = req.params
      const song = await prisma.musicTrack.findUnique({
        where: { docId },
        select: { docId: true },
      })
      if (!song) {
        res.status(404).json({ error: '歌曲不存在' })
        return
      }

      let deleted = 0
      for (const coverId of req.body.coverIds as string[]) {
        if (await deleteSongCoverById(docId, coverId)) {
          deleted++
        }
      }

      if (deleted === 0) {
        res.status(404).json({ error: '封面不存在' })
        return
      }

      enhancedCache.invalidateByPrefix('music_list:')
      res.json({ success: true, deleted })
    } catch (error) {
      console.error('Batch delete song covers error:', error)
      res.status(500).json({ error: '批量删除歌曲封面失败' })
    }
  })
)

router.delete(
  '/:docId/covers/:coverId',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { docId, coverId } = req.params
      const deleted = await deleteSongCoverById(docId, coverId)
      if (!deleted) {
        res.status(404).json({ error: '封面不存在' })
        return
      }

      enhancedCache.invalidateByPrefix('music_list:')
      res.json({ success: true })
    } catch (error) {
      console.error('Delete song cover error:', error)
      res.status(500).json({ error: '删除歌曲封面失败' })
    }
  })
)

// Set default cover
router.patch(
  '/:docId/covers/:coverId/default',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { docId, coverId } = req.params
      const cover = await prisma.songCover.findFirst({
        where: {
          id: coverId,
          songDocId: docId,
        },
      })
      if (!cover) {
        res.status(404).json({ error: '封面不存在' })
        return
      }

      await prisma.songCover.updateMany({
        where: { songDocId: docId },
        data: { isDefault: false },
      })
      await prisma.songCover.update({
        where: { id: coverId },
        data: { isDefault: true },
      })
      await prisma.musicTrack.update({
        where: { docId },
        data: {
          coverId,
          coverAlbumDocId: null,
        },
      })

      res.json({ success: true })
    } catch (error) {
      console.error('Set song default cover error:', error)
      res.status(500).json({ error: '设置默认封面失败' })
    }
  })
)

// Get music albums
router.get(
  '/:docId/albums',
  asyncHandler(async (req, res) => {
    try {
      const songDocId = req.params.docId
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
      })

      const relations = ensureDisplayRelation(relationsRaw)
      const displayRelation = relations.find((relation) => relation.isDisplay)
      if (displayRelation && !relationsRaw.some((relation) => relation.isDisplay)) {
        await prisma.songAlbumRelation.update({
          where: { id: displayRelation.id },
          data: { isDisplay: true },
        })
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
            cover: resolveAlbumCoverUrl(relation.album),
          },
        })),
      })
    } catch (error) {
      console.error('Fetch song albums error:', error)
      res.status(500).json({ error: '获取歌曲关联专辑失败' })
    }
  })
)

// Add music to album
router.post(
  '/:docId/albums',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const songDocId = req.params.docId
      const albumDocId = typeof req.body?.albumDocId === 'string' ? req.body.albumDocId.trim() : ''
      const discNumber = parseInteger(req.body?.discNumber, 1, { min: 1, max: 20 })
      const trackOrder = parseInteger(req.body?.trackOrder, 0, { min: 0, max: 5000 })
      const isDisplay = parseBoolean(req.body?.isDisplay, false)

      if (!albumDocId) {
        res.status(400).json({ error: '缺少 albumDocId' })
        return
      }

      const [song, album] = await Promise.all([
        prisma.musicTrack.findUnique({ where: { docId: songDocId } }),
        prisma.album.findUnique({ where: { docId: albumDocId } }),
      ])

      if (!song || !album) {
        res.status(404).json({ error: '歌曲或专辑不存在' })
        return
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
      })

      if (isDisplay) {
        await prisma.songAlbumRelation.updateMany({
          where: {
            songDocId,
            id: { not: relation.id },
          },
          data: { isDisplay: false },
        })
      }

      const tracksFromAlbum = await prisma.songAlbumRelation.findMany({
        where: { albumDocId },
        include: {
          song: {
            select: {
              docId: true,
              title: true,
              artists: true,
            },
          },
        },
        orderBy: [{ discNumber: 'asc' }, { trackOrder: 'asc' }],
      })
      await prisma.album.update({
        where: { docId: albumDocId },
        data: {
          tracks: buildAlbumTracksPayload(tracksFromAlbum),
        },
      })

      const updatedSong = await fetchSongWithRelationsByDocId(songDocId)
      res.status(201).json({
        song: updatedSong ? toSongResponse(updatedSong) : null,
      })
    } catch (error) {
      console.error('Create song album relation error:', error)
      res.status(500).json({ error: '创建歌曲专辑关联失败' })
    }
  })
)

// Update music album relation
router.patch(
  '/:docId/albums/:albumDocId',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { docId: songDocId, albumDocId } = req.params
      const existing = await prisma.songAlbumRelation.findUnique({
        where: {
          songDocId_albumDocId: {
            songDocId,
            albumDocId,
          },
        },
      })

      if (!existing) {
        res.status(404).json({ error: '关联不存在' })
        return
      }

      const updateData: Record<string, unknown> = {}
      if (req.body?.discNumber !== undefined) {
        updateData.discNumber = parseInteger(req.body.discNumber, existing.discNumber, {
          min: 1,
          max: 20,
        })
      }
      if (req.body?.trackOrder !== undefined) {
        updateData.trackOrder = parseInteger(req.body.trackOrder, existing.trackOrder, {
          min: 0,
          max: 5000,
        })
      }
      if (req.body?.isDisplay !== undefined) {
        updateData.isDisplay = parseBoolean(req.body.isDisplay, existing.isDisplay)
      }

      const updated = await prisma.songAlbumRelation.update({
        where: { id: existing.id },
        data: updateData,
      })

      if (updated.isDisplay) {
        await prisma.songAlbumRelation.updateMany({
          where: {
            songDocId,
            id: { not: updated.id },
          },
          data: { isDisplay: false },
        })
      }

      const tracksFromAlbum = await prisma.songAlbumRelation.findMany({
        where: { albumDocId },
        include: {
          song: {
            select: {
              docId: true,
              title: true,
              artists: true,
            },
          },
        },
        orderBy: [{ discNumber: 'asc' }, { trackOrder: 'asc' }],
      })
      await prisma.album.update({
        where: { docId: albumDocId },
        data: {
          tracks: buildAlbumTracksPayload(tracksFromAlbum),
        },
      })

      const song = await fetchSongWithRelationsByDocId(songDocId)
      res.json({ song: song ? toSongResponse(song) : null })
    } catch (error) {
      console.error('Update song album relation error:', error)
      res.status(500).json({ error: '更新歌曲专辑关联失败' })
    }
  })
)

// Delete music album relation
router.delete(
  '/:docId/albums/:albumDocId',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { docId: songDocId, albumDocId } = req.params
      const existing = await prisma.songAlbumRelation.findUnique({
        where: {
          songDocId_albumDocId: {
            songDocId,
            albumDocId,
          },
        },
      })

      if (!existing) {
        res.status(404).json({ error: '关联不存在' })
        return
      }

      await prisma.songAlbumRelation.delete({ where: { id: existing.id } })

      const remaining = await prisma.songAlbumRelation.findMany({
        where: { songDocId },
        orderBy: [{ discNumber: 'asc' }, { trackOrder: 'asc' }],
      })
      if (remaining.length && !remaining.some((item) => item.isDisplay)) {
        await prisma.songAlbumRelation.update({
          where: { id: remaining[0].id },
          data: { isDisplay: true },
        })
      }

      const tracksFromAlbum = await prisma.songAlbumRelation.findMany({
        where: { albumDocId },
        include: {
          song: {
            select: {
              docId: true,
              title: true,
              artists: true,
            },
          },
        },
        orderBy: [{ discNumber: 'asc' }, { trackOrder: 'asc' }],
      })
      await prisma.album.update({
        where: { docId: albumDocId },
        data: {
          tracks: buildAlbumTracksPayload(tracksFromAlbum),
        },
      })

      const song = await fetchSongWithRelationsByDocId(songDocId)
      res.json({ song: song ? toSongResponse(song) : null })
    } catch (error) {
      console.error('Delete song album relation error:', error)
      res.status(500).json({ error: '删除歌曲专辑关联失败' })
    }
  })
)

// Get instrumentals
router.get(
  '/:docId/instrumentals',
  asyncHandler(async (req, res) => {
    try {
      const songDocId = req.params.docId
      const relations = await prisma.songInstrumentalRelation.findMany({
        where: { songDocId },
        include: {
          targetSong: {
            select: {
              docId: true,
              title: true,
              artists: true,
              coverId: true,
              coverAlbumDocId: true,
              covers: {
                orderBy: { sortOrder: 'asc' },
                select: {
                  id: true,
                  publicUrl: true,
                  thumbnailUrl: true,
                  isDefault: true,
                },
              },
              albumRelations: {
                select: {
                  album: {
                    select: {
                      docId: true,
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
              instrumentalForLinks: { select: { id: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      res.json({
        instrumentals: relations.map((relation) => ({
          id: relation.id,
          songDocId: relation.songDocId,
          instrumentalSongDocId: relation.targetSongDocId,
          instrumentalSong: {
            docId: relation.targetSong.docId,
            title: relation.targetSong.title,
            artists: relation.targetSong.artists,
            cover: resolveSongCoverUrl(relation.targetSong),
            isInstrumental: (relation.targetSong.instrumentalForLinks?.length || 0) > 0,
          },
        })),
      })
    } catch (error) {
      console.error('Fetch song instrumentals error:', error)
      res.status(500).json({ error: '获取歌曲伴奏失败' })
    }
  })
)

// Get instrumental for
router.get(
  '/:docId/instrumental-for',
  asyncHandler(async (req, res) => {
    try {
      const songDocId = req.params.docId
      const relations = await prisma.songInstrumentalRelation.findMany({
        where: { targetSongDocId: songDocId },
        include: {
          song: {
            select: {
              docId: true,
              title: true,
              artists: true,
              coverId: true,
              coverAlbumDocId: true,
              covers: {
                orderBy: { sortOrder: 'asc' },
                select: {
                  id: true,
                  publicUrl: true,
                  thumbnailUrl: true,
                  isDefault: true,
                },
              },
              albumRelations: {
                select: {
                  album: {
                    select: {
                      docId: true,
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
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      res.json({
        originals: relations.map((relation) => ({
          id: relation.id,
          songDocId: relation.songDocId,
          targetSongDocId: relation.targetSongDocId,
          song: {
            docId: relation.song.docId,
            title: relation.song.title,
            artists: relation.song.artists,
            cover: resolveSongCoverUrl(relation.song),
          },
        })),
      })
    } catch (error) {
      console.error('Fetch song instrumental for error:', error)
      res.status(500).json({ error: '获取歌曲原曲失败' })
    }
  })
)

// Add instrumental
router.post(
  '/:docId/instrumentals',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const songDocId = req.params.docId
      const instrumentalSongDocId =
        typeof req.body?.instrumentalSongDocId === 'string'
          ? req.body.instrumentalSongDocId.trim()
          : ''

      if (!instrumentalSongDocId) {
        res.status(400).json({ error: '缺少 instrumentalSongDocId' })
        return
      }

      const [song, instrumentalSong] = await Promise.all([
        prisma.musicTrack.findUnique({ where: { docId: songDocId } }),
        prisma.musicTrack.findUnique({
          where: { docId: instrumentalSongDocId },
          include: { instrumentalForLinks: { select: { id: true } } },
        }),
      ])

      if (!song || !instrumentalSong) {
        res.status(404).json({ error: '歌曲不存在' })
        return
      }

      if (!instrumentalSong.instrumentalForLinks?.length) {
        res.status(400).json({ error: '目标歌曲不是伴奏' })
        return
      }

      const existing = await prisma.songInstrumentalRelation.findFirst({
        where: {
          songDocId,
          targetSongDocId: instrumentalSongDocId,
        },
      })

      if (existing) {
        res.status(409).json({ error: '该伴奏已关联' })
        return
      }

      const relation = await prisma.songInstrumentalRelation.create({
        data: {
          songDocId,
          targetSongDocId: instrumentalSongDocId,
        },
      })

      res.status(201).json({
        relation: {
          id: relation.id,
          songDocId: relation.songDocId,
          instrumentalSongDocId: relation.targetSongDocId,
        },
      })
    } catch (error) {
      console.error('Create song instrumental relation error:', error)
      res.status(500).json({ error: '创建歌曲伴奏关联失败' })
    }
  })
)

// Delete instrumental
router.delete(
  '/:docId/instrumentals/:instrumentalSongDocId',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { docId: songDocId, instrumentalSongDocId } = req.params
      const existing = await prisma.songInstrumentalRelation.findFirst({
        where: {
          songDocId,
          targetSongDocId: instrumentalSongDocId,
        },
      })

      if (!existing) {
        res.status(404).json({ error: '关联不存在' })
        return
      }

      await prisma.songInstrumentalRelation.delete({ where: { id: existing.id } })

      res.json({ success: true })
    } catch (error) {
      console.error('Delete song instrumental relation error:', error)
      res.status(500).json({ error: '删除歌曲伴奏关联失败' })
    }
  })
)

// Custom platforms
router.patch(
  '/:docId/custom-platforms',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const docId = req.params.docId
      const song = await prisma.musicTrack.findUnique({ where: { docId } })
      if (!song) {
        res.status(404).json({ error: '歌曲不存在' })
        return
      }

      const customPlatformLinks = normalizeSongCustomPlatformLinks(req.body?.customPlatformLinks)
      await prisma.musicTrack.update({
        where: { docId },
        data: { customPlatformLinks: customPlatformLinks as unknown as Prisma.InputJsonValue },
      })

      const updated = await fetchSongWithRelationsByDocId(docId)
      res.json({ song: updated ? toSongResponse(updated) : null })
    } catch (error) {
      console.error('Update custom platforms error:', error)
      res.status(500).json({ error: '更新自定义平台失败' })
    }
  })
)

// Music posts
router.get(
  '/:docId/posts',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const docId = req.params.docId
      const limit = parseInteger(req.query.limit, 20, { min: 1, max: 100 })
      const sort = parsePostSort(req.query.sort)
      const visibilityWhere = buildPostVisibilityWhere(req.authUser)

      const where = {
        musicDocId: docId,
        ...visibilityWhere,
      }

      let orderBy: Array<Record<string, 'asc' | 'desc'>>
      if (sort === 'hot') {
        orderBy = [{ hotScore: 'desc' }, { updatedAt: 'desc' }]
      } else if (sort === 'recommended') {
        orderBy = [{ commentsCount: 'desc' }, { likesCount: 'desc' }, { updatedAt: 'desc' }]
      } else {
        orderBy = [{ updatedAt: 'desc' }]
      }

      const posts = await prisma.post.findMany({
        where,
        orderBy,
        take: limit,
      })

      const likedPostSet = new Set<string>()
      const favoritedPostSet = new Set<string>()
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
        ])
        likedPosts.forEach((item) => likedPostSet.add(item.postId))
        favoritedPosts.forEach((item) => favoritedPostSet.add(item.targetId))
      }

      res.json({
        posts: posts.map((post) => ({
          ...toPostResponse(post),
          likedByMe: likedPostSet.has(post.id),
          favoritedByMe: favoritedPostSet.has(post.id),
        })),
      })
    } catch (error) {
      console.error('Fetch music posts error:', error)
      res.status(500).json({ error: '获取音乐关联帖子失败' })
    }
  })
)

// Similarity calculation helper
function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length === 0 || b.length === 0) return 0

  const cacheKey = `music:sim:${a}::${b}`
  const cached = enhancedCache.get<number>(cacheKey)
  if (cached !== undefined) return cached

  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fa5]/g, '')
      .replace(/\s+/g, ' ')
  const na = normalize(a)
  const nb = normalize(b)

  if (na === nb) {
    enhancedCache.set(cacheKey, 1, 300)
    return 1
  }
  if (na.includes(nb) || nb.includes(na)) {
    enhancedCache.set(cacheKey, 0.85, 300)
    return 0.85
  }

  const withoutParens = (s: string) =>
    s
      .replace(/[（].*[)）]/g, '')
      .replace(/[【\[].*[]】\]/g, '')
      .trim()
  const naClean = withoutParens(na)
  const nbClean = withoutParens(nb)
  if (naClean && nbClean && (naClean.includes(nbClean) || nbClean.includes(naClean))) {
    enhancedCache.set(cacheKey, 0.9, 300)
    return 0.9
  }

  const maxLen = Math.max(na.length, nb.length)
  if (maxLen > 50) {
    const result = na.includes(nb) || nb.includes(na) ? 0.85 : 0
    enhancedCache.set(cacheKey, result, 300)
    return result
  }

  const d = Math.max(na.length, nb.length)
  let similarity = 0

  if (d <= 200) {
    similarity = levenshteinSimilarity(na, nb)
  } else {
    const aSub = na.slice(0, 50)
    const bSub = nb.slice(0, 50)
    similarity = levenshteinSimilarity(aSub, bSub)
  }

  if (na.includes(nb) || nb.includes(na)) {
    similarity = Math.max(similarity, 0.85)
  }

  enhancedCache.set(cacheKey, similarity, 300)
  return similarity
}

function levenshteinSimilarity(a: string, b: string): number {
  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }
  const distance = matrix[b.length][a.length]
  return 1 - distance / Math.max(a.length, b.length)
}

export function registerMusicRoutes(app: Router) {
  app.use('/api/music', router)
}
