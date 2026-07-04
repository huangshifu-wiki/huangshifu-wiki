import { Router } from 'express'

import { prisma } from '../prisma'
import { requireAuth, requireAdmin } from '../middleware/auth'
import { generateMusicCoverThumbnail } from '../services/musicCoverThumbnail.service'
import { adminMusicCoverThumbnailBackfillSchema, validateBody } from '../schemas'

type BackfillType = 'all' | 'song' | 'album'
type CoverType = 'song' | 'album'

interface BackfillError {
  type: CoverType
  coverId: string
  resourceId: string
  message: string
}

interface BackfillCounters {
  processed: number
  succeeded: number
  failed: number
  errors: BackfillError[]
}

interface CoverRecord {
  id: string
  storageKey: string
  resourceId: string
}

const router = Router()
const MAX_ERROR_SUMMARY = 10
const MISSING_THUMBNAIL_WHERE = { thumbnailUrl: null }

function emptyCounters(): BackfillCounters {
  return {
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function getMissingCount(type: BackfillType) {
  const counts = await Promise.all([
    type === 'all' || type === 'song'
      ? prisma.songCover.count({ where: MISSING_THUMBNAIL_WHERE })
      : Promise.resolve(0),
    type === 'all' || type === 'album'
      ? prisma.albumCover.count({ where: MISSING_THUMBNAIL_WHERE })
      : Promise.resolve(0),
  ])

  return counts[0] + counts[1]
}

async function processCoverBatch(
  type: CoverType,
  limit: number,
  loadCovers: (limit: number) => Promise<CoverRecord[]>,
  saveThumbnail: (coverId: string, thumbnailUrl: string) => Promise<unknown>
): Promise<BackfillCounters> {
  if (limit <= 0) return emptyCounters()

  const counters = emptyCounters()
  const covers = await loadCovers(limit)

  counters.processed = covers.length

  for (const cover of covers) {
    try {
      const thumbnailUrl = await generateMusicCoverThumbnail(cover.storageKey)
      if (!thumbnailUrl) {
        throw new Error('源文件不存在或无法解析')
      }

      await saveThumbnail(cover.id, thumbnailUrl)
      counters.succeeded += 1
    } catch (error) {
      counters.failed += 1
      counters.errors.push({
        type,
        coverId: cover.id,
        resourceId: cover.resourceId,
        message: getErrorMessage(error),
      })
    }
  }

  return counters
}

async function processSongCoverBatch(limit: number): Promise<BackfillCounters> {
  return processCoverBatch(
    'song',
    limit,
    async (take) => {
      const covers = await prisma.songCover.findMany({
        where: MISSING_THUMBNAIL_WHERE,
        select: { id: true, songDocId: true, storageKey: true },
        orderBy: { createdAt: 'asc' },
        take,
      })

      return covers.map((cover) => ({
        id: cover.id,
        storageKey: cover.storageKey,
        resourceId: cover.songDocId,
      }))
    },
    (coverId, thumbnailUrl) =>
      prisma.songCover.update({
        where: { id: coverId },
        data: { thumbnailUrl },
      })
  )
}

async function processAlbumCoverBatch(limit: number): Promise<BackfillCounters> {
  return processCoverBatch(
    'album',
    limit,
    async (take) => {
      const covers = await prisma.albumCover.findMany({
        where: MISSING_THUMBNAIL_WHERE,
        select: { id: true, albumDocId: true, storageKey: true },
        orderBy: { createdAt: 'asc' },
        take,
      })

      return covers.map((cover) => ({
        id: cover.id,
        storageKey: cover.storageKey,
        resourceId: cover.albumDocId,
      }))
    },
    (coverId, thumbnailUrl) =>
      prisma.albumCover.update({
        where: { id: coverId },
        data: { thumbnailUrl },
      })
  )
}

router.get('/music-cover-thumbnails/stats', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [songTotal, songMissing, albumTotal, albumMissing] = await Promise.all([
      prisma.songCover.count(),
      prisma.songCover.count({ where: MISSING_THUMBNAIL_WHERE }),
      prisma.albumCover.count(),
      prisma.albumCover.count({ where: MISSING_THUMBNAIL_WHERE }),
    ])

    res.json({
      success: true,
      data: {
        song: {
          total: songTotal,
          missing: songMissing,
        },
        album: {
          total: albumTotal,
          missing: albumMissing,
        },
        total: {
          total: songTotal + albumTotal,
          missing: songMissing + albumMissing,
        },
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Admin/MusicCoverThumbnails] Stats error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to get music cover thumbnail statistics',
    })
  }
})

router.post(
  '/music-cover-thumbnails/backfill',
  requireAuth,
  requireAdmin,
  validateBody(adminMusicCoverThumbnailBackfillSchema),
  async (req, res) => {
    const { type, batchSize } = req.body as { type: BackfillType; batchSize: number }

    try {
      let summary: BackfillCounters

      if (type === 'song') {
        summary = await processSongCoverBatch(batchSize)
      } else if (type === 'album') {
        summary = await processAlbumCoverBatch(batchSize)
      } else {
        const songSummary = await processSongCoverBatch(batchSize)
        const albumSummary = await processAlbumCoverBatch(batchSize - songSummary.processed)
        summary = {
          processed: songSummary.processed + albumSummary.processed,
          succeeded: songSummary.succeeded + albumSummary.succeeded,
          failed: songSummary.failed + albumSummary.failed,
          errors: [...songSummary.errors, ...albumSummary.errors],
        }
      }

      const remaining = await getMissingCount(type)

      res.json({
        success: true,
        data: {
          type,
          batchSize,
          processed: summary.processed,
          succeeded: summary.succeeded,
          failed: summary.failed,
          remaining,
          errors: summary.errors.slice(0, MAX_ERROR_SUMMARY),
        },
        timestamp: new Date().toISOString(),
      })
    } catch (error) {
      console.error('[Admin/MusicCoverThumbnails] Backfill error:', error)
      res.status(500).json({
        success: false,
        error: 'Failed to backfill music cover thumbnails',
      })
    }
  }
)

export { registerAdminMusicCoverThumbnailsRoutes }

function registerAdminMusicCoverThumbnailsRoutes(app: Router) {
  app.use('/api/admin', router)
}
