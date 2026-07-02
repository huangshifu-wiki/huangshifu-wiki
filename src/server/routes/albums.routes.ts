import type { Router } from 'express'
import { createRouter } from '../utils/typed-router'
import { requireAdmin } from '../middleware/auth'
import { adminBatchAlbumCoversSchema, validateBody } from '../schemas'
import {
  prisma,
  toAlbumResponse,
  toSongResponse,
  toPostResponse,
  addAlbumCoverFromAsset,
  buildPostVisibilityWhere,
  parsePostSort,
  parseMusicPlatform,
  normalizeTrackDiscPayload,
  parseInteger,
  parseBoolean,
  normalizeOptionalDateOnly,
  applyAlbumTracksToRelations,
  normalizeMusicExternalSourceInputs,
  enhancedCache,
  ensureTextLimit,
  softDeleteData,
} from '../utils'
import { cleanupUnusedMediaAssetById } from '../services/mediaAssetCleanupService'
import type { AuthenticatedRequest } from '../types'
import { CONTENT_LIMITS } from '../../lib/contentLimits'

const router = createRouter()

function ensureAlbumTextLimits(
  res: Parameters<typeof ensureTextLimit>[0],
  input: Record<string, unknown>
) {
  return (
    ensureTextLimit(res, input.title, '专辑标题', CONTENT_LIMITS.album.title) &&
    ensureTextLimit(res, input.artist, '艺人', CONTENT_LIMITS.album.artist) &&
    ensureTextLimit(res, input.description, '专辑描述', CONTENT_LIMITS.album.description) &&
    ensureTextLimit(res, input.name, 'Disc 名称', CONTENT_LIMITS.album.discName)
  )
}

async function deleteAlbumCoverById(albumDocId: string, coverId: string) {
  const [album, cover] = await Promise.all([
    prisma.album.findUnique({ where: { docId: albumDocId }, select: { coverId: true } }),
    prisma.albumCover.findFirst({
      where: {
        id: coverId,
        albumDocId,
      },
    }),
  ])

  if (!cover) return false

  await prisma.albumCover.delete({ where: { id: cover.id } })

  if (cover.assetId) {
    await cleanupUnusedMediaAssetById(cover.assetId)
  }

  const remaining = await prisma.albumCover.findMany({
    where: { albumDocId },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      isDefault: true,
    },
  })

  if (!remaining.length && album?.coverId === coverId) {
    await prisma.album.update({
      where: { docId: albumDocId },
      data: { coverId: null },
    })
  } else if (album?.coverId === coverId || cover.isDefault) {
    const fallback = remaining.find((item) => item.isDefault) || remaining[0]
    if (fallback && album?.coverId === coverId) {
      await prisma.album.update({
        where: { docId: albumDocId },
        data: { coverId: fallback.id },
      })
    }
    if (fallback && !fallback.isDefault) {
      await prisma.albumCover.update({
        where: { id: fallback.id },
        data: { isDefault: true },
      })
    }
  }

  return true
}

// Albums list
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const platform = parseMusicPlatform(req.query.platform)
    const limit = parseInteger(req.query.limit, 20, { min: 1, max: 100 })
    const page = parseInteger(req.query.page, 1, { min: 1 })
    const skip = (page - 1) * limit

    const where = {
      deletedAt: null,
      ...(platform ? { externalSources: { some: { platform } } } : {}),
    }

    if (!req.authUser) {
      const cacheKey = `album_list:${platform || 'all'}:${page}:${limit}`
      const cached = enhancedCache.get(cacheKey)
      if (cached) {
        res.json(cached)
        return
      }
    }

    const [albums, total] = await Promise.all([
      prisma.album.findMany({
        where,
        select: {
          docId: true,
          title: true,
          artist: true,
          description: true,
          coverId: true,
          releaseDate: true,
          createdAt: true,
          updatedAt: true,
          covers: {
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true,
              publicUrl: true,
              isDefault: true,
              sortOrder: true,
            },
          },
          externalSources: {
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          },
          _count: {
            select: { songRelations: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      prisma.album.count({ where }),
    ])

    const result = {
      albums: albums.map((album) => ({
        ...toAlbumResponse(album),
        trackCount: album._count.songRelations,
      })),
      total,
      page,
      limit,
      hasMore: page * limit < total,
    }

    if (!req.authUser) {
      const cacheKey = `album_list:${platform || 'all'}:${page}:${limit}`
      enhancedCache.set(cacheKey, result, 120)
    }

    res.json(result)
  } catch (error) {
    console.error('Fetch albums error:', error)
    res.status(500).json({ error: '获取专辑失败' })
  }
})

// Get album by ID
router.get('/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const identifier = req.params.id
    let album = await prisma.album.findUnique({
      where: { docId: identifier },
      include: {
        covers: {
          orderBy: { sortOrder: 'asc' },
        },
        externalSources: {
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
      },
    })

    if (!album || album.deletedAt) {
      res.status(404).json({ error: '专辑不存在' })
      return
    }

    const relations = await prisma.songAlbumRelation.findMany({
      where: { albumDocId: album.docId },
      include: {
        song: {
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
            externalSources: {
              orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
            },
          },
        },
      },
      orderBy: [{ discNumber: 'asc' }, { trackOrder: 'asc' }],
    })

    const favoritedMusicSet = new Set<string>()
    if (req.authUser && relations.length) {
      const favorites = await prisma.favorite.findMany({
        where: {
          userUid: req.authUser.uid,
          targetType: 'music',
          targetId: { in: relations.map((item) => item.songDocId) },
        },
        select: { targetId: true },
      })
      favorites.forEach((item) => favoritedMusicSet.add(item.targetId))
    }

    const tracks = relations.map((relation) => ({
      ...toSongResponse(relation.song, {
        favoritedByMe: favoritedMusicSet.has(relation.songDocId),
        excludeDescription: true,
      }),
      trackOrder: relation.trackOrder,
      discNumber: relation.discNumber,
    }))

    const albumResponse = toAlbumResponse({
      ...album,
      songRelations: relations,
    })

    res.json({
      album: {
        ...albumResponse,
        id: album.docId,
        tracks,
        discs: normalizeTrackDiscPayload(album.tracks),
      },
    })
  } catch (error) {
    console.error('Fetch album detail error:', error)
    res.status(500).json({ error: '获取专辑详情失败' })
  }
})

// Get album posts
router.get('/:id/posts', async (req: AuthenticatedRequest, res) => {
  try {
    const docId = req.params.id
    const limit = parseInteger(req.query.limit, 20, { min: 1, max: 100 })
    const sort = parsePostSort(req.query.sort)
    const visibilityWhere = buildPostVisibilityWhere(req.authUser)

    const where = {
      albumDocId: docId,
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
    console.error('Fetch album posts error:', error)
    res.status(500).json({ error: '获取专辑关联帖子失败' })
  }
})

// Create album
router.post('/', requireAdmin, async (req, res) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const artist = typeof body.artist === 'string' ? body.artist.trim() : ''
    const description = typeof body.description === 'string' ? body.description.trim() : null
    const hasReleaseDate = Object.prototype.hasOwnProperty.call(body, 'releaseDate')
    const releaseDate = hasReleaseDate ? normalizeOptionalDateOnly(body.releaseDate) : null
    const tracks = normalizeTrackDiscPayload(body.tracks)
    const sources = normalizeMusicExternalSourceInputs(body.sources)
    if (!ensureAlbumTextLimits(res, body)) {
      return
    }
    if (releaseDate === undefined) {
      res.status(400).json({ error: '发行日期格式无效' })
      return
    }

    if (!title || !artist) {
      res.status(400).json({ error: '缺少专辑信息' })
      return
    }

    if (sources.length) {
      const existingSource = await prisma.musicExternalSource.findFirst({
        where: {
          resourceType: 'album',
          OR: sources.map((source) => ({
            platform: source.platform,
            sourceId: source.sourceId,
          })),
        },
      })
      if (existingSource) {
        res.status(409).json({ error: '专辑来源已存在' })
        return
      }
    }

    const created = await prisma.album.create({
      data: {
        title,
        artist,
        description,
        releaseDate,
        tracks,
        ...(sources.length
          ? {
              externalSources: {
                create: sources.map((source) => ({
                  resourceType: 'album' as const,
                  platform: source.platform,
                  sourceId: source.sourceId,
                  sourceUrl: source.sourceUrl,
                  isPrimary: source.isPrimary,
                })),
              },
            }
          : {}),
      },
      include: {
        covers: {
          orderBy: { sortOrder: 'asc' },
        },
        externalSources: {
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
        songRelations: {
          include: {
            song: {
              select: {
                docId: true,
                title: true,
                artists: true,
                coverId: true,
                coverAlbumDocId: true,
                covers: { orderBy: { sortOrder: 'asc' } },
                albumRelations: {
                  include: {
                    album: { include: { covers: { orderBy: { sortOrder: 'asc' } } } },
                  },
                },
              },
            },
          },
        },
      },
    })

    if (tracks.length) {
      await applyAlbumTracksToRelations(created.docId, tracks)
    }

    res.status(201).json({
      album: toAlbumResponse(created),
    })
    enhancedCache.invalidateByPrefix('album_list:')
  } catch (error) {
    console.error('Create album error:', error)
    res.status(500).json({ error: '创建专辑失败' })
  }
})

// Update album
router.patch('/:docId', requireAdmin, async (req, res) => {
  try {
    const docId = req.params.docId
    const existing = await prisma.album.findUnique({ where: { docId } })
    if (!existing || existing.deletedAt) {
      res.status(404).json({ error: '专辑不存在' })
      return
    }

    const body = (req.body || {}) as Record<string, unknown>
    const updateData: Record<string, unknown> = {}

    if (typeof body.title === 'string') updateData.title = body.title.trim()
    if (typeof body.artist === 'string') updateData.artist = body.artist.trim()
    if (typeof body.description === 'string' || body.description === null)
      updateData.description = body.description
    if (Object.prototype.hasOwnProperty.call(body, 'releaseDate')) {
      const releaseDate = normalizeOptionalDateOnly(body.releaseDate)
      if (releaseDate === undefined) {
        res.status(400).json({ error: '发行日期格式无效' })
        return
      }
      updateData.releaseDate = releaseDate
    }
    if (!ensureAlbumTextLimits(res, body)) {
      return
    }

    if (body.tracks !== undefined) {
      const normalizedTracks = normalizeTrackDiscPayload(body.tracks)
      updateData.tracks = normalizedTracks
      await applyAlbumTracksToRelations(docId, normalizedTracks)
    }

    const shouldReplaceSources = Object.prototype.hasOwnProperty.call(body, 'sources')
    const sources = shouldReplaceSources ? normalizeMusicExternalSourceInputs(body.sources) : []
    if (sources.length) {
      const conflict = await prisma.musicExternalSource.findFirst({
        where: {
          resourceType: 'album',
          OR: sources.map((source) => ({
            platform: source.platform,
            sourceId: source.sourceId,
          })),
          albumDocId: { not: docId },
        },
      })
      if (conflict) {
        res.status(409).json({ error: '专辑来源已存在' })
        return
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.album.update({
        where: { docId },
        data: updateData,
      })
      if (shouldReplaceSources) {
        await tx.musicExternalSource.deleteMany({
          where: { resourceType: 'album', albumDocId: docId },
        })
        if (sources.length) {
          await tx.musicExternalSource.createMany({
            data: sources.map((source) => ({
              resourceType: 'album',
              albumDocId: docId,
              platform: source.platform,
              sourceId: source.sourceId,
              sourceUrl: source.sourceUrl,
              isPrimary: source.isPrimary,
            })),
          })
        }
      }
    })

    const updated = await prisma.album.findUniqueOrThrow({
      where: { docId },
      include: {
        covers: {
          orderBy: { sortOrder: 'asc' },
        },
        externalSources: {
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
        songRelations: {
          include: {
            song: {
              select: {
                docId: true,
                title: true,
                artists: true,
                coverId: true,
                coverAlbumDocId: true,
                covers: { orderBy: { sortOrder: 'asc' } },
                albumRelations: {
                  include: {
                    album: { include: { covers: { orderBy: { sortOrder: 'asc' } } } },
                  },
                },
              },
            },
          },
          orderBy: [{ discNumber: 'asc' }, { trackOrder: 'asc' }],
        },
      },
    })

    res.json({ album: toAlbumResponse(updated) })
    enhancedCache.invalidateByPrefix('album_list:')
  } catch (error) {
    console.error('Update album error:', error)
    res.status(500).json({ error: '更新专辑失败' })
  }
})

// Delete album
router.delete('/:docId', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const docId = req.params.docId
    const album = await prisma.album.findUnique({
      where: { docId },
      include: {
        covers: true,
      },
    })
    if (!album || album.deletedAt) {
      res.status(404).json({ error: '专辑不存在' })
      return
    }

    await prisma.album.update({
      where: { docId },
      data: softDeleteData(req.authUser!.uid),
    })

    res.json({ success: true })
    enhancedCache.invalidateByPrefix('album_list:')
  } catch (error) {
    console.error('Delete album error:', error)
    res.status(500).json({ error: '删除专辑失败' })
  }
})

// Get album covers
router.get('/:docId/covers', async (req, res) => {
  try {
    const album = await prisma.album.findUnique({
      where: { docId: req.params.docId },
      include: {
        covers: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    if (!album) {
      res.status(404).json({ error: '专辑不存在' })
      return
    }

    res.json({
      covers: (album.covers || []).map((cover) => ({
        id: cover.id,
        assetId: cover.assetId,
        storageKey: cover.storageKey,
        url: cover.publicUrl,
        isDefault: cover.isDefault,
        sortOrder: cover.sortOrder,
      })),
    })
  } catch (error) {
    console.error('Fetch album covers error:', error)
    res.status(500).json({ error: '获取专辑封面失败' })
  }
})

// Add album cover
router.post('/:docId/covers', requireAdmin, async (req, res) => {
  try {
    const albumDocId = req.params.docId
    const assetId = typeof req.body?.assetId === 'string' ? req.body.assetId.trim() : ''
    const isDefault = parseBoolean(req.body?.isDefault, false)

    if (!assetId) {
      res.status(400).json({ error: '缺少 assetId' })
      return
    }

    const album = await prisma.album.findUnique({ where: { docId: albumDocId } })
    if (!album) {
      res.status(404).json({ error: '专辑不存在' })
      return
    }

    const cover = await addAlbumCoverFromAsset(albumDocId, assetId, isDefault)

    res.status(201).json({
      cover: {
        id: cover.id,
        assetId: cover.assetId,
        storageKey: cover.storageKey,
        url: cover.publicUrl,
        isDefault: cover.isDefault,
        sortOrder: cover.sortOrder,
      },
    })
  } catch (error) {
    console.error('Create album cover error:', error)
    res.status(500).json({ error: '添加专辑封面失败' })
  }
})

// Delete album cover
router.delete(
  '/:docId/covers',
  requireAdmin,
  validateBody(adminBatchAlbumCoversSchema),
  async (req, res) => {
    try {
      const albumDocId = req.params.docId
      const album = await prisma.album.findUnique({
        where: { docId: albumDocId },
        select: { docId: true },
      })
      if (!album) {
        res.status(404).json({ error: '专辑不存在' })
        return
      }

      let deleted = 0
      for (const coverId of req.body.coverIds as string[]) {
        if (await deleteAlbumCoverById(albumDocId, coverId)) {
          deleted++
        }
      }

      if (deleted === 0) {
        res.status(404).json({ error: '封面不存在' })
        return
      }

      enhancedCache.invalidateByPrefix('album_list:')
      enhancedCache.invalidateByPrefix('music_list:')
      res.json({ success: true, deleted })
    } catch (error) {
      console.error('Batch delete album covers error:', error)
      res.status(500).json({ error: '批量删除专辑封面失败' })
    }
  }
)

router.delete('/:docId/covers/:coverId', requireAdmin, async (req, res) => {
  try {
    const { docId: albumDocId, coverId } = req.params
    const deleted = await deleteAlbumCoverById(albumDocId, coverId)
    if (!deleted) {
      res.status(404).json({ error: '封面不存在' })
      return
    }

    enhancedCache.invalidateByPrefix('album_list:')
    enhancedCache.invalidateByPrefix('music_list:')
    res.json({ success: true })
  } catch (error) {
    console.error('Delete album cover error:', error)
    res.status(500).json({ error: '删除专辑封面失败' })
  }
})

// Set default album cover
router.patch('/:docId/covers/:coverId/default', requireAdmin, async (req, res) => {
  try {
    const { docId: albumDocId, coverId } = req.params
    const cover = await prisma.albumCover.findFirst({
      where: {
        id: coverId,
        albumDocId,
      },
    })
    if (!cover) {
      res.status(404).json({ error: '封面不存在' })
      return
    }

    await prisma.albumCover.updateMany({
      where: { albumDocId },
      data: { isDefault: false },
    })
    await prisma.albumCover.update({
      where: { id: coverId },
      data: { isDefault: true },
    })
    await prisma.album.update({
      where: { docId: albumDocId },
      data: { coverId },
    })

    res.json({ success: true })
  } catch (error) {
    console.error('Set album default cover error:', error)
    res.status(500).json({ error: '设置默认封面失败' })
  }
})

// Sync album covers to songs
router.post('/:docId/sync-covers-to-songs', requireAdmin, async (req, res) => {
  try {
    const albumDocId = req.params.docId
    const songDocIdsRaw = Array.isArray(req.body?.songDocIds) ? req.body.songDocIds : []
    const songDocIds = songDocIdsRaw
      .filter((item: unknown): item is string => typeof item === 'string')
      .map((item: string) => item.trim())
      .filter(Boolean)

    const album = await prisma.album.findUnique({
      where: { docId: albumDocId },
      include: {
        covers: true,
      },
    })
    if (!album) {
      res.status(404).json({ error: '专辑不存在' })
      return
    }

    const hasDisplayCover = Boolean(
      album.covers.find((item) => item.id === album.coverId) ||
      album.covers.find((item) => item.isDefault) ||
      album.covers[0]
    )
    if (!hasDisplayCover) {
      res.status(400).json({ error: '专辑没有可同步的封面' })
      return
    }

    const relations = await prisma.songAlbumRelation.findMany({
      where: {
        albumDocId,
        ...(songDocIds.length ? { songDocId: { in: songDocIds } } : {}),
      },
      select: {
        songDocId: true,
      },
    })

    const targetSongDocIds = relations.map((item) => item.songDocId)
    if (!targetSongDocIds.length) {
      res.status(400).json({ error: '没有可同步的歌曲' })
      return
    }

    await prisma.musicTrack.updateMany({
      where: {
        docId: { in: targetSongDocIds },
      },
      data: {
        coverId: null,
        coverAlbumDocId: albumDocId,
      },
    })

    res.json({
      success: true,
      syncedCount: targetSongDocIds.length,
    })
  } catch (error) {
    console.error('Sync album covers error:', error)
    res.status(500).json({ error: '同步专辑封面失败' })
  }
})

// Create album disc
router.post('/:docId/discs', requireAdmin, async (req, res) => {
  try {
    const docId = req.params.docId
    const album = await prisma.album.findUnique({ where: { docId } })
    if (!album) {
      res.status(404).json({ error: '专辑不存在' })
      return
    }

    const tracks = normalizeTrackDiscPayload(album.tracks)
    const requestedDisc = parseInteger(req.body?.discNumber, 0, { min: 1, max: 20 })
    const nextDisc = requestedDisc || (tracks.length ? tracks[tracks.length - 1].disc + 1 : 1)
    if (tracks.some((item) => item.disc === nextDisc)) {
      res.status(400).json({ error: 'Disc 已存在' })
      return
    }

    const discName =
      typeof req.body?.name === 'string' && req.body.name.trim()
        ? req.body.name.trim()
        : `Disc ${nextDisc}`
    if (!ensureTextLimit(res, discName, 'Disc 名称', CONTENT_LIMITS.album.discName)) {
      return
    }
    tracks.push({
      disc: nextDisc,
      name: discName,
      songs: [],
    })
    tracks.sort((a, b) => a.disc - b.disc)

    await prisma.album.update({
      where: { docId },
      data: {
        tracks,
      },
    })

    res.status(201).json({
      disc: {
        disc: nextDisc,
        name: discName,
      },
    })
  } catch (error) {
    console.error('Create album disc error:', error)
    res.status(500).json({ error: '新增 Disc 失败' })
  }
})

// Delete album disc
router.delete('/:docId/discs/:discNumber', requireAdmin, async (req, res) => {
  try {
    const docId = req.params.docId
    const discNumber = parseInteger(req.params.discNumber, 0, { min: 1, max: 20 })
    if (!discNumber) {
      res.status(400).json({ error: 'Disc 参数无效' })
      return
    }

    const album = await prisma.album.findUnique({ where: { docId } })
    if (!album) {
      res.status(404).json({ error: '专辑不存在' })
      return
    }

    const tracks = normalizeTrackDiscPayload(album.tracks)
    const target = tracks.find((item) => item.disc === discNumber)
    if (!target) {
      res.status(404).json({ error: 'Disc 不存在' })
      return
    }
    if (target.songs.length) {
      res.status(400).json({ error: 'Disc 下仍有歌曲，无法删除' })
      return
    }

    const nextTracks = tracks.filter((item) => item.disc !== discNumber)
    await prisma.album.update({
      where: { docId },
      data: {
        tracks: nextTracks,
      },
    })

    res.json({ success: true })
  } catch (error) {
    console.error('Delete album disc error:', error)
    res.status(500).json({ error: '删除 Disc 失败' })
  }
})

// Reorder album tracks
router.patch('/:docId/tracks/reorder', requireAdmin, async (req, res) => {
  try {
    const docId = req.params.docId
    const album = await prisma.album.findUnique({ where: { docId } })
    if (!album) {
      res.status(404).json({ error: '专辑不存在' })
      return
    }

    const tracks = normalizeTrackDiscPayload(req.body?.tracks)
    await prisma.album.update({
      where: { docId },
      data: {
        tracks,
      },
    })
    await applyAlbumTracksToRelations(docId, tracks)

    res.json({ success: true })
  } catch (error) {
    console.error('Reorder album tracks error:', error)
    res.status(500).json({ error: '重排专辑曲目失败' })
  }
})

// Sync display to songs
router.post('/:docId/sync-display-to-songs', requireAdmin, async (req, res) => {
  try {
    const albumDocId = req.params.docId
    const relationRows = await prisma.songAlbumRelation.findMany({
      where: { albumDocId },
      orderBy: [{ discNumber: 'asc' }, { trackOrder: 'asc' }],
    })

    if (!relationRows.length) {
      res.json({ success: true, updated: 0 })
      return
    }

    const songDocIdsRaw = Array.isArray(req.body?.songDocIds) ? req.body.songDocIds : []
    const selectedSongDocIds = songDocIdsRaw
      .filter((item: unknown): item is string => typeof item === 'string')
      .map((item: string) => item.trim())
      .filter(Boolean)

    const targetSongDocIds = selectedSongDocIds.length
      ? relationRows
          .map((item) => item.songDocId)
          .filter((id: string) => selectedSongDocIds.includes(id))
      : relationRows.map((item) => item.songDocId)

    if (!targetSongDocIds.length) {
      res.json({ success: true, updated: 0 })
      return
    }

    await prisma.songAlbumRelation.updateMany({
      where: {
        songDocId: { in: targetSongDocIds },
      },
      data: {
        isDisplay: false,
      },
    })

    for (const songDocId of targetSongDocIds) {
      await prisma.songAlbumRelation.updateMany({
        where: {
          songDocId,
          albumDocId,
        },
        data: {
          isDisplay: true,
        },
      })
    }

    await prisma.musicTrack.updateMany({
      where: { docId: { in: targetSongDocIds } },
      data: {
        displayAlbumMode: 'linked',
      },
    })

    res.json({ success: true, updated: targetSongDocIds.length })
  } catch (error) {
    console.error('Sync display album info error:', error)
    res.status(500).json({ error: '同步展示专辑失败' })
  }
})

export function registerAlbumsRoutes(app: Router) {
  app.use('/api/albums', router)
}
