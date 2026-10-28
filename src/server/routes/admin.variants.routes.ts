/**
 * 管理后台 API - 变体管理
 *
 * 功能：
 * 1. 批量变体重建
 * 2. 变体统计
 */

import { Router } from 'express'
import { prisma } from '../prisma'
import { requireAuth, requireAdmin, AuthenticatedRequest } from '../middleware/auth'
import { variantGenerator } from '../services/variantGenerator'
import { resolveUploadPathByStorageKey } from '../uploadPath'
import { resolveUploadPathByUrl } from '../utils'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const uploadsDir = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', '..', 'uploads')
const router = Router()

interface RebuildRequest {
  type?: 'imageMap' | 'songCover' | 'albumCover' | 'all'
  scope?: 'all' | 'failed' | 'missing' | 'outdated'
  batchSize?: number
  dryRun?: boolean
  force?: boolean
}

interface RebuildResponse {
  jobId: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  summary: {
    totalScanned: number
    queuedForRebuild: number
    skipped: number
    errors: number
  }
  estimatedTimeSeconds?: number
}

const REBUILD_TYPES = ['imageMap', 'songCover', 'albumCover'] as const
type RebuildTargetType = (typeof REBUILD_TYPES)[number]

function buildVariantWhereClause(scope: string, force: boolean): Record<string, unknown> {
  const whereClause: Record<string, unknown> = {}
  switch (scope) {
    case 'all':
      whereClause.variantStatus = force ? { not: 'processing' } : { in: ['pending', 'failed'] }
      break
    case 'failed':
      whereClause.variantStatus = 'failed'
      break
    case 'missing':
      whereClause.AND = [
        { NOT: { variantStatus: 'processing' } },
        { OR: [{ thumbnailUrl: null }, { variantStatus: 'pending' }] },
      ]
      break
    case 'outdated':
      whereClause.variantStatus = 'completed'
      break
  }
  return whereClause
}

async function queueRebuildForType(
  type: RebuildTargetType,
  scope: string,
  batchSize: number,
  dryRun: boolean,
  force: boolean
): Promise<{ totalScanned: number; queuedForRebuild: number; skipped: number; errors: number }> {
  const whereClause = {
    ...(type === 'imageMap' ? { deletedAt: null } : {}),
    ...buildVariantWhereClause(scope, force),
  }
  return type === 'imageMap'
    ? queueImageMapRebuild(whereClause, batchSize, dryRun)
    : queueCoverRebuild(type, whereClause, batchSize, dryRun)
}

async function queueImageMapRebuild(
  whereClause: Record<string, unknown>,
  batchSize: number,
  dryRun: boolean
): Promise<{
  totalScanned: number
  queuedForRebuild: number
  skipped: number
  errors: number
}> {
  const totalCount = await prisma.imageMap.count({ where: whereClause })

  // 第一遍：纯读取快照。入队后消费者会立刻把记录改为 processing，
  // 若在分页期间边查边入队，offset 分页会因结果集变化漏掉记录。
  const records: Array<{ id: string; localUrl: string | null }> = []
  for (let offset = 0; offset < totalCount; offset += batchSize) {
    const batch = await prisma.imageMap.findMany({
      where: whereClause,
      orderBy: { id: 'asc' },
      take: batchSize,
      skip: offset,
      select: { id: true, localUrl: true },
    })
    records.push(...batch)
  }

  let processedCount = 0
  let skippedCount = 0
  let errorCount = 0

  // 第二遍：基于快照入队（重复任务由 taskKey 去重兜底）
  for (const record of records) {
    try {
      if (dryRun) {
        processedCount++
        continue
      }

      const localFilePath = resolveUploadPathByUrl(record.localUrl)

      if (!localFilePath) {
        console.warn(`[Admin] Skipping imageMap:${record.id}: source file path is invalid`)
        skippedCount++
        continue
      }

      try {
        await fs.promises.access(localFilePath, fs.constants.R_OK)
      } catch {
        console.warn(`[Admin] Skipping imageMap:${record.id}: source file not found`)
        skippedCount++
        continue
      }

      const accepted = await variantGenerator.enqueue({
        targetType: 'imageMap',
        targetId: record.id,
        localFilePath,
        priority: 'low',
      })

      if (accepted) processedCount++
      else skippedCount++
    } catch (error) {
      console.error(`[Admin] Error queuing imageMap:${record.id}:`, error)
      errorCount++
    }
  }

  return {
    totalScanned: totalCount,
    queuedForRebuild: processedCount,
    skipped: skippedCount,
    errors: errorCount,
  }
}

async function queueCoverRebuild(
  type: 'songCover' | 'albumCover',
  whereClause: Record<string, unknown>,
  batchSize: number,
  dryRun: boolean
): Promise<{
  totalScanned: number
  queuedForRebuild: number
  skipped: number
  errors: number
}> {
  const totalCount =
    type === 'songCover'
      ? await prisma.songCover.count({ where: whereClause })
      : await prisma.albumCover.count({ where: whereClause })

  // 第一遍：纯读取快照（同 queueImageMapRebuild，避免 offset 分页漏记录）
  const records: Array<{ id: string; storageKey: string | null }> = []
  for (let offset = 0; offset < totalCount; offset += batchSize) {
    const batch =
      type === 'songCover'
        ? await prisma.songCover.findMany({
            where: whereClause,
            orderBy: { id: 'asc' },
            take: batchSize,
            skip: offset,
            select: { id: true, storageKey: true },
          })
        : await prisma.albumCover.findMany({
            where: whereClause,
            orderBy: { id: 'asc' },
            take: batchSize,
            skip: offset,
            select: { id: true, storageKey: true },
          })
    records.push(...batch)
  }

  let processedCount = 0
  let skippedCount = 0
  let errorCount = 0

  // 第二遍：基于快照入队
  for (const record of records) {
    try {
      if (dryRun) {
        processedCount++
        continue
      }

      const localFilePath = resolveUploadPathByStorageKey(record.storageKey, uploadsDir)

      if (!localFilePath) {
        console.warn(`[Admin] Skipping ${type}:${record.id}: source file path is invalid`)
        skippedCount++
        continue
      }

      try {
        await fs.promises.access(localFilePath, fs.constants.R_OK)
      } catch {
        console.warn(`[Admin] Skipping ${type}:${record.id}: source file not found`)
        skippedCount++
        continue
      }

      const accepted = await variantGenerator.enqueue({
        targetType: type,
        targetId: record.id,
        localFilePath,
        priority: 'low',
      })

      if (accepted) processedCount++
      else skippedCount++
    } catch (error) {
      console.error(`[Admin] Error queuing ${type}:${record.id}:`, error)
      errorCount++
    }
  }

  return {
    totalScanned: totalCount,
    queuedForRebuild: processedCount,
    skipped: skippedCount,
    errors: errorCount,
  }
}

/**
 * POST /api/admin/images/rebuild-all-variants - 批量重建变体
 *
 * 查询参数：
 * - type: imageMap | songCover | albumCover | all (默认 imageMap)
 * - scope: all | failed | missing | outdated (默认 missing)
 * - batchSize: 每批处理数量 (默认 50)
 * - dryRun: 试运行，不实际执行 (默认 false)
 * - force: 强制重建，忽略已有变体 (默认 false)
 */
router.post(
  '/rebuild-all-variants',
  requireAuth,
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    try {
      const {
        type = 'imageMap',
        scope = 'missing',
        batchSize = 50,
        dryRun = false,
        force = false,
      } = req.body as RebuildRequest

      if (![...REBUILD_TYPES, 'all'].includes(type)) {
        return res.status(400).json({
          success: false,
          error: `Invalid type: ${type}. Must be one of: imageMap, songCover, albumCover, all`,
        })
      }

      if (!['all', 'failed', 'missing', 'outdated'].includes(scope)) {
        return res.status(400).json({
          success: false,
          error: `Invalid scope: ${scope}. Must be one of: all, failed, missing, outdated`,
        })
      }
      if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
        return res.status(400).json({
          success: false,
          error: 'batchSize must be an integer between 1 and 1000',
        })
      }

      if (typeof dryRun !== 'boolean' || typeof force !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'dryRun and force must be boolean values',
        })
      }

      console.log(
        `[Admin] Starting variant rebuild: type=${type}, scope=${scope}, ` +
          `batchSize=${batchSize}, dryRun=${dryRun}, force=${force}`
      )

      const targetTypes: RebuildTargetType[] = type === 'all' ? [...REBUILD_TYPES] : [type]

      let totalScanned = 0
      let queuedForRebuild = 0
      let skipped = 0
      let errors = 0

      for (const targetType of targetTypes) {
        const summary = await queueRebuildForType(targetType, scope, batchSize, dryRun, force)
        totalScanned += summary.totalScanned
        queuedForRebuild += summary.queuedForRebuild
        skipped += summary.skipped
        errors += summary.errors
      }

      if (totalScanned === 0) {
        return res.json({
          success: true,
          jobId: `${dryRun ? 'dry-run' : 'rebuild'}-${Date.now()}`,
          status: 'completed' as const,
          summary: {
            totalScanned: 0,
            queuedForRebuild: 0,
            skipped: 0,
            errors: 0,
          },
          message: 'No records need to be rebuilt',
          timestamp: new Date().toISOString(),
        })
      }

      const response: RebuildResponse = {
        jobId: `rebuild-${Date.now()}`,
        status: dryRun ? 'completed' : 'queued',
        summary: {
          totalScanned,
          queuedForRebuild,
          skipped,
          errors,
        },
      }

      if (!dryRun && queuedForRebuild > 0) {
        response.estimatedTimeSeconds = Math.ceil(
          (queuedForRebuild * 2) / variantGenerator.getMaxConcurrent()
        )
      }

      console.log(
        `[Admin] Variant rebuild initiated: ` +
          `${queuedForRebuild} tasks queued, ${skipped} skipped, ${errors} errors`
      )

      res.status(200).json({
        success: true,
        ...response,
        timestamp: new Date().toISOString(),
      })
    } catch (error) {
      console.error('[Admin] Variant rebuild failed:', error)
      res.status(500).json({
        success: false,
        error: 'Failed to initiate variant rebuild',
      })
    }
  }
)

/**
 * GET /api/admin/images/rebuild-status/:jobId - 查询重建状态（简化版）
 */
router.get('/rebuild-status/:jobId', requireAuth, requireAdmin, (req, res) => {
  const { jobId } = req.params

  const stats = variantGenerator.getQueueStats()

  res.json({
    success: true,
    jobId,
    status:
      stats.processingCount > 0 ? 'processing' : stats.queueLength > 0 ? 'queued' : 'completed',
    queueLength: stats.queueLength,
    processingCount: stats.processingCount,
    completedToday: stats.completedToday,
    failedToday: stats.failedToday,
    timestamp: new Date().toISOString(),
  })
})

// ============================================================================
// 📊 变体统计 API
// ============================================================================

/**
 * GET /api/admin/variants/cleanup/stats - 获取清理统计信息
 */
router.get('/cleanup/stats', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [totalImages, failedImages, completedImages] = await Promise.all([
      prisma.imageMap.count({ where: { deletedAt: null } }),
      prisma.imageMap.count({ where: { deletedAt: null, variantStatus: 'failed' } }),
      prisma.imageMap.count({
        where: { deletedAt: null, variantStatus: 'completed', thumbnailUrl: { not: null } },
      }),
    ])

    let orphanedCount = 0

    try {
      const variantsBaseDir = path.join(uploadsDir, 'variants')
      const entries = await fs.promises.readdir(variantsBaseDir, { withFileTypes: true })
      const subDirs = entries.filter((d) => d.isDirectory()).map((d) => d.name)

      for (const dir of subDirs) {
        const existsInDB = await prisma.imageMap.count({
          where: { id: dir },
        })

        if (existsInDB === 0) {
          orphanedCount++
        }
      }
    } catch {
      // variants 目录不存在
    }

    res.json({
      success: true,
      data: {
        totalImages,
        completedVariants: completedImages,
        failedVariants: failedImages,
        pendingOrProcessing: totalImages - completedImages - failedImages,
        estimatedOrphanedDirectories: orphanedCount,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Admin/Variants] Stats error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to get variant statistics',
    })
  }
})

// ============================================================================
// 工具函数
// ============================================================================

export { registerAdminVariantsRoutes }

function registerAdminVariantsRoutes(app: Router) {
  app.use('/api/admin', router)
}
