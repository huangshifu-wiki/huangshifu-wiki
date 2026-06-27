import { Router } from 'express'
import { requireAuth, requireAdmin, requireActiveUser, requireSuperAdmin } from '../middleware/auth'
import type { AuthenticatedRequest } from '../types'
import {
  prisma,
  GALLERY_ADMIN_ONLY,
  getEmailVerificationConfig,
  setEmailVerificationConfig,
  toEmailVerificationPublicConfig,
  toEmailVerificationAdminConfig,
  isSemanticSearchEnabled,
} from '../utils'
import { enhancedCache, CACHE_KEYS } from '../utils/cache'
import {
  getUserPresignedUploadUrl,
  getPresignedDownloadUrl,
  getPresignedDeleteUrl,
  getPublicConfig,
  validateS3Config,
} from '../s3/s3Service'
import {
  startSyncTask,
  getLatestSyncTask,
  getSyncTask,
  cancelSyncTask,
} from '../services/imageSyncService'

const router = Router()

// GET /api/config/gallery-access - Get gallery write access mode
router.get('/gallery-access', async (_req, res) => {
  try {
    res.json({ adminOnly: GALLERY_ADMIN_ONLY })
  } catch (error) {
    console.error('Get gallery access mode error:', error)
    res.status(500).json({ error: '获取图集权限配置失败' })
  }
})

// GET /api/config/features - Get public runtime feature flags
router.get('/features', async (_req, res) => {
  res.json({
    semanticSearch: isSemanticSearchEnabled(),
  })
})

// GET /api/config/email-verification - Get email verification feature config
router.get('/email-verification', async (_req, res) => {
  try {
    const config = await getEmailVerificationConfig()
    res.json(toEmailVerificationPublicConfig(config))
  } catch (error) {
    console.error('Get email verification config error:', error)
    res.status(500).json({ error: '获取邮箱验证配置失败' })
  }
})

// GET /api/config/email-verification/admin - Get full email verification config
router.get('/email-verification/admin', requireAuth, requireSuperAdmin, async (_req, res) => {
  try {
    const config = await getEmailVerificationConfig()
    res.json(toEmailVerificationAdminConfig(config))
  } catch (error) {
    console.error('Get email verification admin config error:', error)
    res.status(500).json({ error: '获取邮箱验证配置失败' })
  }
})

// PATCH /api/config/email-verification - Update email verification feature config
router.patch('/email-verification', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>
    const {
      enabled,
      publicBaseUrl,
      tokenTtlMinutes,
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpUser,
      smtpFrom,
      smtpPass,
      clearSmtpPass,
    } = body

    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled 必须是布尔值' })
      return
    }

    if (typeof smtpSecure !== 'boolean') {
      res.status(400).json({ error: 'smtpSecure 必须是布尔值' })
      return
    }

    const normalizedPublicBaseUrl = typeof publicBaseUrl === 'string' ? publicBaseUrl.trim() : ''
    const normalizedSmtpHost = typeof smtpHost === 'string' ? smtpHost.trim() : ''
    const normalizedSmtpFrom = typeof smtpFrom === 'string' ? smtpFrom.trim() : ''
    const normalizedSmtpUser = typeof smtpUser === 'string' ? smtpUser.trim() : ''
    const normalizedTokenTtlMinutes = Number(tokenTtlMinutes)
    const normalizedSmtpPort = Number(smtpPort)

    if (
      !Number.isInteger(normalizedTokenTtlMinutes) ||
      normalizedTokenTtlMinutes < 5 ||
      normalizedTokenTtlMinutes > 10080
    ) {
      res.status(400).json({ error: '验证链接有效期必须是 5 到 10080 分钟之间的整数' })
      return
    }

    if (
      !Number.isInteger(normalizedSmtpPort) ||
      normalizedSmtpPort < 1 ||
      normalizedSmtpPort > 65535
    ) {
      res.status(400).json({ error: 'SMTP 端口必须是 1 到 65535 之间的整数' })
      return
    }

    if (normalizedPublicBaseUrl) {
      try {
        const parsedBaseUrl = new URL(normalizedPublicBaseUrl)
        if (parsedBaseUrl.protocol !== 'http:' && parsedBaseUrl.protocol !== 'https:') {
          res.status(400).json({ error: '站点公网地址必须使用 http 或 https' })
          return
        }
      } catch {
        res.status(400).json({ error: '站点公网地址格式无效' })
        return
      }
    }

    if (enabled && (!normalizedPublicBaseUrl || !normalizedSmtpHost || !normalizedSmtpFrom)) {
      res.status(400).json({ error: '启用邮箱验证前请配置站点公网地址、SMTP Host 和发件人' })
      return
    }

    const config = await setEmailVerificationConfig({
      enabled,
      publicBaseUrl: normalizedPublicBaseUrl,
      tokenTtlMinutes: normalizedTokenTtlMinutes,
      smtpHost: normalizedSmtpHost,
      smtpPort: normalizedSmtpPort,
      smtpSecure,
      smtpUser: normalizedSmtpUser,
      smtpFrom: normalizedSmtpFrom,
      ...(typeof smtpPass === 'string' && smtpPass ? { smtpPass } : {}),
      ...(clearSmtpPass === true ? { smtpPass: '' } : {}),
    })
    res.json({ success: true, config: toEmailVerificationAdminConfig(config) })
  } catch (error) {
    console.error('Update email verification config error:', error)
    res.status(500).json({ error: '更新邮箱验证配置失败' })
  }
})

// GET /api/config/image-preference - Get image preference
router.get('/image-preference', async (_req, res) => {
  try {
    const cacheKey = `${CACHE_KEYS.SITE_CONFIG}:image_preference`
    const cached = enhancedCache.get<{ strategy: string; fallback: boolean }>(cacheKey)
    if (cached) {
      res.json(cached)
      return
    }

    const config = await prisma.siteConfig.findUnique({
      where: { key: 'image_preference' },
    })

    const preference = (config?.value as {
      strategy?: 'local' | 's3' | 'external'
      fallback?: boolean
    }) || { strategy: 'local', fallback: true }

    enhancedCache.set(cacheKey, preference, 300)
    res.json(preference)
  } catch (error) {
    console.error('Get image preference error:', error)
    res.status(500).json({ error: '获取图片偏好设置失败' })
  }
})

// PATCH /api/config/image-preference - Update image preference
router.patch('/image-preference', requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      strategy,
      fallback,
      autoSync = true,
    } = req.body as {
      strategy?: 'local' | 's3' | 'external'
      fallback?: boolean
      autoSync?: boolean
    }

    // 获取当前配置
    const currentConfig = await prisma.siteConfig.findUnique({
      where: { key: 'image_preference' },
    })
    const currentPreference = (currentConfig?.value as {
      strategy?: 'local' | 's3' | 'external'
      fallback?: boolean
    }) || { strategy: 'local', fallback: true }

    const value = {
      ...(strategy && { strategy }),
      ...(fallback !== undefined && { fallback }),
    }

    await prisma.siteConfig.upsert({
      where: { key: 'image_preference' },
      update: { value },
      create: { key: 'image_preference', value },
    })

    // 清除缓存
    enhancedCache.delete(`${CACHE_KEYS.SITE_CONFIG}:image_preference`)

    // 如果切换到 S3 或 external 策略，自动启动同步任务
    let syncTask = null
    if (autoSync && strategy && strategy !== 'local' && strategy !== currentPreference.strategy) {
      // 检查 S3 是否启用
      if (strategy === 's3') {
        const s3Config = getPublicConfig()
        if (!s3Config.enabled) {
          console.log('[Config] S3 未启用，跳过自动同步任务')
        } else {
          try {
            syncTask = startSyncTask(strategy)
            console.log(`[Config] 存储策略切换到 ${strategy}，自动启动图片同步任务: ${syncTask.id}`)
          } catch (syncError) {
            console.error('[Config] 自动启动同步任务失败:', syncError)
            // 同步任务启动失败不影响配置更新
          }
        }
      } else {
        // external 策略直接启动
        try {
          syncTask = startSyncTask(strategy)
          console.log(`[Config] 存储策略切换到 ${strategy}，自动启动图片同步任务: ${syncTask.id}`)
        } catch (syncError) {
          console.error('[Config] 自动启动同步任务失败:', syncError)
          // 同步任务启动失败不影响配置更新
        }
      }
    }

    res.json({
      success: true,
      preference: value,
      syncTask: syncTask
        ? {
            id: syncTask.id,
            status: syncTask.status,
            strategy: syncTask.strategy,
            total: syncTask.total,
          }
        : null,
    })
  } catch (error) {
    console.error('Update image preference error:', error)
    res.status(500).json({ error: '更新图片偏好设置失败' })
  }
})

// GET /api/config/image-sync - Get image sync task status
router.get('/image-sync', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { taskId } = req.query as { taskId?: string }

    let task
    if (taskId) {
      task = getSyncTask(taskId)
    } else {
      task = getLatestSyncTask()
    }

    if (!task) {
      res.json({ task: null })
      return
    }

    res.json({
      task: {
        id: task.id,
        status: task.status,
        strategy: task.strategy,
        total: task.total,
        processed: task.processed,
        succeeded: task.succeeded,
        failed: task.failed,
        errors: task.errors.slice(0, 20), // 只返回前20个错误
        startedAt: task.startedAt.toISOString(),
        completedAt: task.completedAt?.toISOString(),
        progress: task.total > 0 ? Math.round((task.processed / task.total) * 100) : 0,
      },
    })
  } catch (error) {
    console.error('Get image sync status error:', error)
    res.status(500).json({ error: '获取同步状态失败' })
  }
})

// POST /api/config/image-sync - Start image sync task manually
router.post('/image-sync', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { strategy } = req.body as { strategy?: 's3' | 'external' }

    if (!strategy || (strategy !== 's3' && strategy !== 'external')) {
      res.status(400).json({ error: '请指定有效的同步策略: s3 或 external' })
      return
    }

    const task = startSyncTask(strategy)

    res.json({
      success: true,
      task: {
        id: task.id,
        status: task.status,
        strategy: task.strategy,
        total: task.total,
      },
    })
  } catch (error) {
    console.error('Start image sync error:', error)
    const message = error instanceof Error ? error.message : '启动同步任务失败'
    res.status(500).json({ error: message })
  }
})

// DELETE /api/config/image-sync/:taskId - Cancel image sync task
router.delete('/image-sync/:taskId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { taskId } = req.params

    const success = cancelSyncTask(taskId)

    if (!success) {
      res.status(400).json({ error: '任务不存在或已完成/失败' })
      return
    }

    res.json({ success: true })
  } catch (error) {
    console.error('Cancel image sync error:', error)
    res.status(500).json({ error: '取消同步任务失败' })
  }
})

// GET /api/s3/config - Get S3 public config
router.get('/s3/config', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const config = getPublicConfig()
    res.json(config)
  } catch (error) {
    console.error('[S3] 获取配置失败:', error)
    res.status(500).json({ error: '获取 S3 配置失败' })
  }
})

// GET /api/s3/presign-upload - Get S3 presigned upload URL
router.get('/s3/presign-upload', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { filename, contentType, contentMd5, fileSize } = req.query as {
      filename?: string
      contentType?: string
      contentMd5?: string
      fileSize?: string
    }

    if (!filename) {
      res.status(400).json({ error: '缺少 filename 参数' })
      return
    }

    const result = await getUserPresignedUploadUrl({
      userUid: req.authUser!.uid,
      filename,
      contentType,
      contentMd5,
      fileSize,
    })

    res.json(result)
  } catch (error) {
    console.error('[S3] 生成上传签名失败:', error)
    const message = error instanceof Error ? error.message : '生成上传签名失败'
    const status = message.includes('验证失败') || message.includes('必须') ? 400 : 500
    res.status(status).json({ error: message })
  }
})

// GET /api/s3/presign-download/:key(*) - Get S3 presigned download URL
router.get('/s3/presign-download/:key(*)', requireAuth, async (req, res) => {
  try {
    const { key } = req.params

    if (!key) {
      res.status(400).json({ error: '缺少 key 参数' })
      return
    }

    const url = await getPresignedDownloadUrl(key)
    res.json({ downloadUrl: url })
  } catch (error) {
    console.error('[S3] 生成下载签名失败:', error)
    const message = error instanceof Error ? error.message : '生成下载签名失败'
    res.status(500).json({ error: message })
  }
})

// GET /api/s3/presign-delete/:key(*) - Get S3 presigned delete URL
router.get('/s3/presign-delete/:key(*)', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { key } = req.params

    if (!key) {
      res.status(400).json({ error: '缺少 key 参数' })
      return
    }

    const url = await getPresignedDeleteUrl(key)
    res.json({ deleteUrl: url })
  } catch (error) {
    console.error('[S3] 生成删除签名失败:', error)
    const message = error instanceof Error ? error.message : '生成删除签名失败'
    res.status(500).json({ error: message })
  }
})

export function registerConfigRoutes(app: Router) {
  app.use('/api/config', router)
}
