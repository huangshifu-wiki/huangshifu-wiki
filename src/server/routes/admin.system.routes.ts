/**
 * 管理后台 API - 磁盘监控与系统管理
 *
 * 功能：
 * 1. 磁盘状态查询
 * 2. 动态修改告警阈值（用户核心需求）
 * 3. 手动触发检查
 * 4. 变体清理管理
 * 5. 批量变体重建
 */

import { Router } from 'express'
import { prisma } from '../prisma'
import {
  requireAuth,
  requireAdmin,
  requireSuperAdmin,
  AuthenticatedRequest,
} from '../middleware/auth'
import { applyRateLimitConfig } from '../middleware/rateLimiter'
import { diskMonitor } from '../services/diskMonitor.service'
import { variantGenerator } from '../services/variantGenerator'
import { cloudSyncService } from '../services/cloudSyncService'
import {
  RateLimitConfigValidationError,
  rateLimitConfigService,
} from '../services/rateLimitConfig.service'

const router = Router()

// ============================================================================
// 请求限流 API（支持动态配置）
// ============================================================================

router.get('/rate-limits/config', requireAuth, requireSuperAdmin, async (_req, res) => {
  try {
    res.json({
      success: true,
      data: rateLimitConfigService.getConfig(),
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Admin/RateLimit] Error getting config:', error)
    res.status(500).json({ success: false, error: '获取请求限流配置失败' })
  }
})

router.patch(
  '/rate-limits/config',
  requireAuth,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res) => {
    try {
      const config = await rateLimitConfigService.updateConfig(req.body)
      applyRateLimitConfig(config)

      console.log(`[Admin/RateLimit] Config updated by super admin: ${req.authUser?.uid}`)

      res.json({
        success: true,
        data: config,
        timestamp: new Date().toISOString(),
      })
    } catch (error) {
      if (error instanceof RateLimitConfigValidationError) {
        res.status(400).json({ success: false, error: error.message })
        return
      }

      console.error('[Admin/RateLimit] Error updating config:', error)
      res.status(500).json({ success: false, error: '更新请求限流配置失败' })
    }
  }
)

router.post('/rate-limits/config/reset', requireAuth, requireSuperAdmin, async (_req, res) => {
  try {
    const config = await rateLimitConfigService.resetConfig()
    applyRateLimitConfig(config)

    res.json({
      success: true,
      data: config,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Admin/RateLimit] Error resetting config:', error)
    res.status(500).json({ success: false, error: '重置请求限流配置失败' })
  }
})

// ============================================================================
// 📊 磁盘监控 API（支持动态配置）
// ============================================================================

/**
 * GET /api/admin/disk/status - 获取当前磁盘状态
 */
router.get('/disk/status', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const status = await diskMonitor.checkDiskSpace()

    res.json({
      success: true,
      data: status,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Admin/Disk] Error getting status:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to get disk status',
    })
  }
})

/**
 * GET /api/admin/disk/config - 获取当前监控配置
 */
router.get('/disk/config', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const config = diskMonitor.getConfig()

    res.json({
      success: true,
      data: config,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Admin/Disk] Error getting config:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to get disk monitor configuration',
    })
  }
})

/**
 * PUT /api/admin/disk/config - ⭐ 更新监控配置（核心功能：后台修改阈值）
 *
 * 请求体示例：
 * {
 *   "warningThresholdGB": 100,    // 可选：警告阈值（GB），默认 50
 *   "criticalThresholdGB": 30,    // 可选：严重警告阈值（GB），默认 20
 *   "checkIntervalMs": 600000,    // 可选：检查间隔（毫秒），默认 300000 (5分钟)
 *   "uploadsMinFreeMB": 1024      // 可选：上传最小空闲空间（MB），默认 500
 * }
 */
router.put('/disk/config', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const newConfig = req.body

    // 参数验证
    if (typeof newConfig !== 'object' || newConfig === null) {
      return res.status(400).json({
        success: false,
        error: 'Request body must be a JSON object',
      })
    }

    // 验证各字段类型和范围
    const validationErrors: string[] = []

    if ('warningThresholdGB' in newConfig) {
      if (typeof newConfig.warningThresholdGB !== 'number' || newConfig.warningThresholdGB <= 0) {
        validationErrors.push('warningThresholdGB must be a positive number')
      }
    }

    if ('criticalThresholdGB' in newConfig) {
      if (typeof newConfig.criticalThresholdGB !== 'number' || newConfig.criticalThresholdGB <= 0) {
        validationErrors.push('criticalThresholdGB must be a positive number')
      }
    }

    if ('checkIntervalMs' in newConfig) {
      if (typeof newConfig.checkIntervalMs !== 'number' || newConfig.checkIntervalMs < 60000) {
        validationErrors.push('checkIntervalMs must be >= 60000 (1 minute)')
      }
    }

    if ('uploadsMinFreeMB' in newConfig) {
      if (typeof newConfig.uploadsMinFreeMB !== 'number' || newConfig.uploadsMinFreeMB < 10) {
        validationErrors.push('uploadsMinFreeMB must be >= 10 MB')
      }
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validationErrors,
      })
    }

    // 业务逻辑验证：critical 必须小于 warning
    if (
      newConfig.warningThresholdGB &&
      newConfig.criticalThresholdGB &&
      newConfig.criticalThresholdGB >= newConfig.warningThresholdGB
    ) {
      return res.status(400).json({
        success: false,
        error: 'criticalThresholdGB must be less than warningThresholdGB',
      })
    }

    // 更新配置（会自动保存到数据库并生效）
    const updatedConfig = await diskMonitor.updateConfig(newConfig)

    console.log(`[Admin/Disk] 🔧 Config updated by admin: ${req.authUser?.uid}`, updatedConfig)

    res.json({
      success: true,
      message: 'Disk monitor configuration updated successfully',
      data: updatedConfig,
      previousConfig: diskMonitor.getConfig(), // 实际上已经是更新后的了
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Admin/Disk] Error updating config:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to update disk monitor configuration',
    })
  }
})

/**
 * POST /api/admin/disk/config/reset - 重置为默认配置
 */
router.post('/disk/config/reset', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const defaultConfig = await diskMonitor.resetConfig()

    res.json({
      success: true,
      message: 'Configuration reset to defaults',
      data: defaultConfig,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Admin/Disk] Error resetting config:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to reset configuration',
    })
  }
})

/**
 * POST /api/admin/disk/check - 手动触发磁盘检查
 */
router.post('/disk/check', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const status = await diskMonitor.manualCheck()

    res.json({
      success: true,
      message: 'Manual disk check completed',
      data: status,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Admin/Disk] Error in manual check:', error)
    res.status(500).json({
      success: false,
      error: 'Manual disk check failed',
    })
  }
})

/**
 * POST /api/admin/disk/monitor/stop - 停止监控（维护用）
 */
router.post('/disk/monitor/stop', requireAuth, requireAdmin, async (_req, res) => {
  try {
    diskMonitor.stopMonitoring()

    res.json({
      success: true,
      message: 'Disk monitoring stopped',
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to stop monitoring',
    })
  }
})

/**
 * POST /api/admin/disk/monitor/resume - 恢复监控
 */
router.post('/disk/monitor/resume', requireAuth, requireAdmin, async (_req, res) => {
  try {
    diskMonitor.resumeMonitoring()

    res.json({
      success: true,
      message: 'Disk monitoring resumed',
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to resume monitoring',
    })
  }
})

// ============================================================================
// 🖼️ 变体生成器 API
// ============================================================================

/**
 * GET /api/admin/variants/stats - 获取变体生成统计
 */
router.get('/variants/stats', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const stats = variantGenerator.getQueueStats()

    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get variant generator stats',
    })
  }
})

// ============================================================================
// ☁️ 云端同步 API
// ============================================================================

/**
 * GET /api/admin/cloud-sync/stats - 获取云端同步统计
 */
router.get('/cloud-sync/stats', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const stats = cloudSyncService.getQueueStats()

    res.json({
      success: true,
      data: stats,
      lskyProAvailable: cloudSyncService.isLskyProAvailable(),
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get cloud sync stats',
    })
  }
})

// ============================================================================
// 📈 系统健康检查仪表盘
// ============================================================================

/**
 * GET /api/admin/system/dashboard - 系统总览仪表盘
 */
router.get('/system/dashboard', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [diskStatus, variantStats, cloudSyncStats] = await Promise.all([
      diskMonitor.getStatus() || diskMonitor.manualCheck(),
      Promise.resolve(variantGenerator.getQueueStats()),
      Promise.resolve(cloudSyncService.getQueueStats()),
    ])

    res.json({
      success: true,
      data: {
        disk: {
          ...diskStatus,
          config: diskMonitor.getConfig(),
        },
        variants: variantStats,
        cloudSync: {
          ...cloudSyncStats,
          lskyProAvailable: cloudSyncService.isLskyProAvailable(),
        },
        serverTime: new Date().toISOString(),
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Admin/Dashboard] Error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to get system dashboard',
    })
  }
})

export { registerAdminSystemRoutes }

function registerAdminSystemRoutes(app: Router) {
  app.use('/api/admin', router)
}
