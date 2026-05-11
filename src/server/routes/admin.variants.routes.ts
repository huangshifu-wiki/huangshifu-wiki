/**
 * 管理后台 API - 变体管理
 * 
 * 功能：
 * 1. 孤儿文件清理
 * 2. 失败变体清理
 * 3. 批量变体重建
 * 4. 清理统计
 */

import { Router } from 'express';
import { prisma } from '../prisma';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { variantCleanup, CleanupTrigger } from '../services/variantCleanup.service';
import { variantGenerator } from '../services/variantGenerator';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', '..', 'uploads');
const router = Router();

// ============================================================================
// 🧹 变体清理 API
// ============================================================================

/**
 * POST /api/admin/variants/cleanup/orphaned - 清理孤儿文件
 */
router.post('/cleanup/orphaned', requireAuth, requireAdmin, async (_req, res) => {
  try {
    console.log('[Admin/Variants] Starting orphaned variants cleanup...');
    
    const result = await variantCleanup.cleanupOrphanedVariants();
    
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
    });
  } catch (error) {
    console.error('[Admin/Variants] Orphaned cleanup error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cleanup orphaned variants',
    });
  }
});

/**
 * POST /api/admin/variants/cleanup/failed - 清理失败残留
 */
router.post('/cleanup/failed', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const result = await variantCleanup.cleanupFailedVariants();
    
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
    });
  } catch (error) {
    console.error('[Admin/Variants] Failed cleanup error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cleanup failed variants',
    });
  }
});

/**
 * POST /api/admin/variants/cleanup/all - 全量清理（孤儿 + 失败）
 */
router.post('/cleanup/all', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const results = await variantCleanup.batchCleanup([
      CleanupTrigger.SCHEDULED,
      CleanupTrigger.ON_FAILURE,
    ]);

    let totalFreedBytes = 0;
    let totalDeleted = 0;
    let totalErrors = 0;

    results.forEach((result) => {
      totalFreedBytes += result.totalFreedBytes;
      totalDeleted += result.deletedFiles.length;
      totalErrors += result.errors.length;
    });

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
    });
  } catch (error) {
    console.error('[Admin/Variants] Full cleanup error:', error);
    res.status(500).json({
      success: false,
      error: 'Full cleanup failed',
    });
  }
});

// ============================================================================
// 🔄 批量变体重建 API
// ============================================================================

interface RebuildRequest {
  scope?: 'all' | 'failed' | 'missing' | 'outdated';
  batchSize?: number;
  dryRun?: boolean;
  force?: boolean;
}

interface RebuildResponse {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  summary: {
    totalScanned: number;
    queuedForRebuild: number;
    skipped: number;
    errors: number;
  };
  estimatedTimeSeconds?: number;
}

/**
 * POST /api/admin/images/rebuild-all-variants - 批量重建图片变体
 * 
 * 查询参数：
 * - scope: all | failed | missing | outdated (默认 missing)
 * - batchSize: 每批处理数量 (默认 50)
 * - dryRun: 试运行，不实际执行 (默认 false)
 * - force: 强制重建，忽略已有变体 (默认 false)
 */
router.post('/rebuild-all-variants', requireAuth, requireAdmin, async (
  req: AuthenticatedRequest, 
  res
) => {
  try {
    const {
      scope = 'missing',
      batchSize = 50,
      dryRun = false,
      force = false,
    } = req.body as RebuildRequest;

    if (!['all', 'failed', 'missing', 'outdated'].includes(scope)) {
      return res.status(400).json({
        success: false,
        error: `Invalid scope: ${scope}. Must be one of: all, failed, missing, outdated`,
      });
    }

    console.log(
      `[Admin] Starting variant rebuild: scope=${scope}, ` +
      `batchSize=${batchSize}, dryRun=${dryRun}, force=${force}`
    );

    // 构建查询条件
    let whereClause: any = {};
    
    switch (scope) {
      case 'all':
        if (!force) {
          whereClause.variantStatus = { not: 'completed' };
        }
        break;
        
      case 'failed':
        whereClause.variantStatus = 'failed';
        break;
        
      case 'missing':
        whereClause.OR = [
          { thumbnailUrl: null },
          { mediumUrl: null },
          { largeUrl: null },
          { variantStatus: 'pending' },
        ];
        break;
        
      case 'outdated':
        whereClause.variantStatus = 'completed';
        // TODO: 需要增加 generatedAt 字段才能支持此功能
        break;
    }

    // 查询符合条件的记录总数
    const totalCount = await prisma.imageMap.count({ where: whereClause });
    
    if (totalCount === 0) {
      return res.json({
        jobId: `dry-run-${Date.now()}`,
        status: 'completed' as const,
        summary: {
          totalScanned: 0,
          queuedForRebuild: 0,
          skipped: 0,
          errors: 0,
        },
        message: 'No images need to be rebuilt',
        timestamp: new Date().toISOString(),
      });
    }

    // 分批查询并入队
    let processedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (let offset = 0; offset < totalCount; offset += batchSize) {
      const batch = await prisma.imageMap.findMany({
        where: whereClause,
        take: batchSize,
        skip: offset,
        select: {
          id: true,
          localUrl: true,
          variantStatus: true,
        },
      });

      for (const imageMap of batch) {
        try {
          if (dryRun) {
            processedCount++;
            continue;
          }

          const localFilePath = urlToAbsolutePath(imageMap.localUrl);
          
          try {
            await fs.promises.access(localFilePath, fs.constants.R_OK);
          } catch {
            console.warn(`[Admin] Skipping ${imageMap.id}: source file not found`);
            skippedCount++;
            continue;
          }

          await variantGenerator.enqueue({
            imageMapId: imageMap.id,
            localFilePath,
            priority: 'low',
          });

          processedCount++;
        } catch (error) {
          console.error(`[Admin] Error queuing ${imageMap.id}:`, error);
          errorCount++;
        }
      }
    }

    const response: RebuildResponse = {
      jobId: `rebuild-${Date.now()}`,
      status: dryRun ? 'completed' : 'queued',
      summary: {
        totalScanned: totalCount,
        queuedForRebuild: processedCount,
        skipped: skippedCount,
        errors: errorCount,
      },
    };

    if (!dryRun && processedCount > 0) {
      response.estimatedTimeSeconds = Math.ceil(
        processedCount * 2 / variantGenerator.getMaxConcurrent()
      );
    }

    console.log(
      `[Admin] Variant rebuild initiated: ` +
      `${processedCount} images queued, ${skippedCount} skipped, ${errorCount} errors`
    );

    res.status(200).json({
      success: true,
      ...response,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Admin] Variant rebuild failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initiate variant rebuild',
    });
  }
});

/**
 * GET /api/admin/images/rebuild-status/:jobId - 查询重建状态（简化版）
 */
router.get('/rebuild-status/:jobId', requireAuth, requireAdmin, (req, res) => {
  const { jobId } = req.params;
  
  const stats = variantGenerator.getQueueStats();
  
  res.json({
    success: true,
    jobId,
    status: stats.processingCount > 0 ? 'processing' : 'completed',
    queueLength: stats.queueLength,
    processingCount: stats.processingCount,
    completedToday: stats.completedToday,
    failedToday: stats.failedToday,
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// 📊 变体统计 API
// ============================================================================

/**
 * GET /api/admin/variants/cleanup/stats - 获取清理统计信息
 */
router.get('/cleanup/stats', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [totalImages, failedImages, completedImages] = await Promise.all([
      prisma.imageMap.count(),
      prisma.imageMap.count({ where: { variantStatus: 'failed' }}),
      prisma.imageMap.count({ where: { variantStatus: 'completed' }}),
    ]);

    let orphanedCount = 0;
    
    try {
      const variantsBaseDir = path.join(uploadsDir, 'variants');
      const entries = await fs.promises.readdir(variantsBaseDir, { withFileTypes: true });
      const subDirs = entries.filter(d => d.isDirectory()).map(d => d.name);

      for (const dir of subDirs) {
        const existsInDB = await prisma.imageMap.count({
          where: { id: dir },
        });

        if (existsInDB === 0) {
          orphanedCount++;
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
    });
  } catch (error) {
    console.error('[Admin/Variants] Stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get variant statistics',
    });
  }
});

// ============================================================================
// 工具函数
// ============================================================================

function urlToAbsolutePath(url: string): string {
  const relativePath = url.replace(/^\/uploads\//, '');
  return path.join(uploadsDir, relativePath);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export { registerAdminVariantsRoutes };

function registerAdminVariantsRoutes(app: Router) {
  app.use('/api/admin', router);
}
