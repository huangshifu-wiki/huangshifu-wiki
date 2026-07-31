/**
 * 管理后台 API - 变体管理
 *
 * 功能：
 * 1. 孤儿文件清理
 * 2. 失败变体清理
 * 3. 批量变体重建
 * 4. 清理统计
 */

import { Router } from 'express'
import { prisma } from '../prisma'
import { requireAuth, requireAdmin, AuthenticatedRequest } from '../middleware/auth'
import { variantCleanup, CleanupTrigger } from '../services/variantCleanup.service'
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

// ============================================================================
// 🧹 变体清理 API
// ============================================================================

/**
 * POST /api/admin/variants/cleanup/orphaned - 清理孤儿文件
 */
router.post('/cleanup/orphaned', requireAuth, requireAdmin, async (_req, res) => {
  try {
    console.log('[Admin/Variants] Starting orphaned variants cleanup...')

    const result = await variantCleanup.cleanupOrphanedVariants()

    res.json({
      success: result.success,
      message: 'Orphaned variants cleanup completed',
      data: {
        freedSpace: result.totalFreedBytes,
        freedSpaceFormatted: result.totalFreedFormatted,
        deletedCount: result.deletedFiles.length,
        errorsCount: result.errors.length,
        executionTimeMs: result.executionTimeMs,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Admin/Variants] Orphaned cleanup error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to cleanup orphaned variants',
    })
  }
})

/**
 * POST /api/admin/variants/cleanup/failed - 清理失败残留
 */
router.post('/cleanup/failed', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const result = await variantCleanup.cleanupFailedVariants()

    res.json({
      success: result.success,
      message: 'Failed variants cleanup completed',
      data: {
        freedSpace: result.totalFreedBytes,
        freedSpaceFormatted: result.totalFreedFormatted,
        deletedCount: result.deletedFiles.length,
        errorsCount: result.errors.length,
        executionTimeMs: result.executionTimeMs,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Admin/Variants] Failed cleanup error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to cleanup failed variants',
    })
  }
})

/**
 * POST /api/admin/variants/cleanup/all - 全量清理（孤儿 + 失败）
 */
router.post('/cleanup/all', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const results = await variantCleanup.batchCleanup([
      CleanupTrigger.SCHEDULED,
      CleanupTrigger.ON_FAILURE,
    ])

    let totalFreedBytes = 0
    let totalDeleted = 0
    let totalErrors = 0

    results.forEach((result) => {
      totalFreedBytes += result.totalFreedBytes
      totalDeleted += result.deletedFiles.length
      totalErrors += result.errors.length
    })

    res.json({
      success: true,
      message: 'Full cleanup completed',
      data: {
        totalFreedBytes,
        totalFreedFormatted: formatBytes(totalFreedBytes),
        totalDeletedFiles: totalDeleted,
        totalErrors,
        details: Object.fromEntries(results),
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Admin/Variants] Full cleanup error:', error)
    res.status(500).json({
      success: false,
      error: 'Full cleanup failed',
    })
  }
})

// ============================================================================
// 🔄 批量变体重建 API
// ============================================================================

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
      if (!force) {
        whereClause.variantStatus = { not: 'completed' }
      }
      break

    case 'failed':
      whereClause.variantStatus = 'failed'
      break

    case 'missing':
      whereClause.OR = [{ thumbnailUrl: null }, { variantStatus: 'pending' }]
      break

    case 'outdated':
      whereClause.variantStatus = 'completed'
      // TODO: 需要增加 generatedAt 字段才能支持此功能
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
): Promise<{
  totalScanned: number
  queuedForRebuild: number
  skipped: number
  errors: number
}> {
  const baseWhere = type === 'imageMap' ? { deletedAt: null } : {}
  const whereClause = { ...baseWhere, ...buildVariantWhereClause(scope, force) }

  if (type === 'imageMap') {
    return queueImageMapRebuild(whereClause, batchSize, dryRun)
  }
  return queueCoverRebuild(type, whereClause, batchSize, dryRun)
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

  let processedCount = 0
  let skippedCount = 0
  let errorCount = 0

  for (let offset = 0; offset < totalCount; offset += batchSize) {
    const batch = await prisma.imageMap.findMany({
      where: whereClause,
      take: batchSize,
      skip: offset,
      select: { id: true, localUrl: true },
    })

    for (const record of batch) {
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

        await variantGenerator.enqueue({
          targetType: 'imageMap',
          targetId: record.id,
          localFilePath,
          priority: 'low',
        })

        processedCount++
      } catch (error) {
        console.error(`[Admin] Error queuing imageMap:${record.id}:`, error)
        errorCount++
      }
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

  let processedCount = 0
  let skippedCount = 0
  let errorCount = 0

  for (let offset = 0; offset < totalCount; offset += batchSize) {
    const batch =
      type === 'songCover'
        ? await prisma.songCover.findMany({
            where: whereClause,
            take: batchSize,
            skip: offset,
            select: { id: true, storageKey: true },
          })
        : await prisma.albumCover.findMany({
            where: whereClause,
            take: batchSize,
            skip: offset,
            select: { id: true, storageKey: true },
          })

    for (const record of batch) {
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

        await variantGenerator.enqueue({
          targetType: type,
          targetId: record.id,
          localFilePath,
          priority: 'low',
        })

        processedCount++
      } catch (error) {
        console.error(`[Admin] Error queuing ${type}:${record.id}:`, error)
        errorCount++
      }
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
          jobId: `dry-run-${Date.now()}`,
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
    status: stats.processingCount > 0 ? 'processing' : 'completed',
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
      prisma.imageMap.count({ where: { deletedAt: null, variantStatus: 'completed' } }),
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export { registerAdminVariantsRoutes }

function registerAdminVariantsRoutes(app: Router) {
  app.use('/api/admin', router)
}
