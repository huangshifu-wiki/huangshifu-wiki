import { Router } from 'express';
import { requireAuth, requireAdmin, requireActiveUser } from '../middleware/auth';
import { prisma } from '../utils';
import { enhancedCache, CACHE_KEYS } from '../utils/cache';
import {
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  getPresignedDeleteUrl,
  getPublicConfig,
  validateS3Config,
} from '../s3/s3Service';
import {
  startSyncTask,
  getLatestSyncTask,
  getSyncTask,
  cancelSyncTask,
} from '../services/imageSyncService';

const router = Router();

// GET /api/config/image-preference - Get image preference
router.get('/image-preference', async (_req, res) => {
  try {
    const cacheKey = `${CACHE_KEYS.SITE_CONFIG}:image_preference`;
    const cached = enhancedCache.get<{ strategy: string; fallback: boolean }>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const config = await prisma.siteConfig.findUnique({
      where: { key: 'image_preference' },
    });

    const preference = config?.value as {
      strategy?: 'local' | 's3' | 'external';
      fallback?: boolean;
    } || { strategy: 'local', fallback: true };

    enhancedCache.set(cacheKey, preference, 300);
    res.json(preference);
  } catch (error) {
    console.error('Get image preference error:', error);
    res.status(500).json({ error: '获取图片偏好设置失败' });
  }
});

// PATCH /api/config/image-preference - Update image preference
router.patch('/image-preference', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { strategy, fallback, autoSync = true } = req.body as {
      strategy?: 'local' | 's3' | 'external';
      fallback?: boolean;
      autoSync?: boolean;
    };

    // 获取当前配置
    const currentConfig = await prisma.siteConfig.findUnique({
      where: { key: 'image_preference' },
    });
    const currentPreference = currentConfig?.value as {
      strategy?: 'local' | 's3' | 'external';
      fallback?: boolean;
    } || { strategy: 'local', fallback: true };

    const value = {
      ...(strategy && { strategy }),
      ...(fallback !== undefined && { fallback }),
    };

    await prisma.siteConfig.upsert({
      where: { key: 'image_preference' },
      update: { value },
      create: { key: 'image_preference', value },
    });

    // 清除缓存
    enhancedCache.delete(`${CACHE_KEYS.SITE_CONFIG}:image_preference`);

    // 如果切换到 S3 或 external 策略，自动启动同步任务
    let syncTask = null;
    if (autoSync && strategy && strategy !== 'local' && strategy !== currentPreference.strategy) {
      // 检查 S3 是否启用
      if (strategy === 's3') {
        const s3Config = getPublicConfig();
        if (!s3Config.enabled) {
          console.log('[Config] S3 未启用，跳过自动同步任务');
        } else {
          try {
            syncTask = startSyncTask(strategy);
            console.log(`[Config] 存储策略切换到 ${strategy}，自动启动图片同步任务: ${syncTask.id}`);
          } catch (syncError) {
            console.error('[Config] 自动启动同步任务失败:', syncError);
            // 同步任务启动失败不影响配置更新
          }
        }
      } else {
        // external 策略直接启动
        try {
          syncTask = startSyncTask(strategy);
          console.log(`[Config] 存储策略切换到 ${strategy}，自动启动图片同步任务: ${syncTask.id}`);
        } catch (syncError) {
          console.error('[Config] 自动启动同步任务失败:', syncError);
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
    });
  } catch (error) {
    console.error('Update image preference error:', error);
    res.status(500).json({ error: '更新图片偏好设置失败' });
  }
});

// GET /api/config/image-sync - Get image sync task status
router.get('/image-sync', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { taskId } = req.query as { taskId?: string };

    let task;
    if (taskId) {
      task = getSyncTask(taskId);
    } else {
      task = getLatestSyncTask();
    }

    if (!task) {
      res.json({ task: null });
      return;
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
    });
  } catch (error) {
    console.error('Get image sync status error:', error);
    res.status(500).json({ error: '获取同步状态失败' });
  }
});

// POST /api/config/image-sync - Start image sync task manually
router.post('/image-sync', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { strategy } = req.body as { strategy?: 's3' | 'external' };

    if (!strategy || (strategy !== 's3' && strategy !== 'external')) {
      res.status(400).json({ error: '请指定有效的同步策略: s3 或 external' });
      return;
    }

    const task = startSyncTask(strategy);

    res.json({
      success: true,
      task: {
        id: task.id,
        status: task.status,
        strategy: task.strategy,
        total: task.total,
      },
    });
  } catch (error) {
    console.error('Start image sync error:', error);
    const message = error instanceof Error ? error.message : '启动同步任务失败';
    res.status(500).json({ error: message });
  }
});

// DELETE /api/config/image-sync/:taskId - Cancel image sync task
router.delete('/image-sync/:taskId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { taskId } = req.params;

    const success = cancelSyncTask(taskId);

    if (!success) {
      res.status(400).json({ error: '任务不存在或已完成/失败' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Cancel image sync error:', error);
    res.status(500).json({ error: '取消同步任务失败' });
  }
});

// GET /api/s3/config - Get S3 public config
router.get('/s3/config', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const config = getPublicConfig();
    res.json(config);
  } catch (error) {
    console.error('[S3] 获取配置失败:', error);
    res.status(500).json({ error: '获取 S3 配置失败' });
  }
});

// GET /api/s3/presign-upload - Get S3 presigned upload URL
router.get('/s3/presign-upload', requireAuth, requireActiveUser, async (req, res) => {
  try {
    const { filename, contentType, key, contentMd5, fileSize } = req.query as {
      filename?: string;
      contentType?: string;
      key?: string;
      contentMd5?: string;
      fileSize?: string;
    };

    if (!filename) {
      res.status(400).json({ error: '缺少 filename 参数' });
      return;
    }

    const objectKey = key || filename;

    const result = await getPresignedUploadUrl(objectKey, undefined, {
      contentType: contentType || 'application/octet-stream',
      contentMd5,
      fileSize: fileSize ? parseInt(fileSize) : undefined,
    });

    res.json(result);
  } catch (error) {
    console.error('[S3] 生成上传签名失败:', error);
    const message = error instanceof Error ? error.message : '生成上传签名失败';
    res.status(500).json({ error: message });
  }
});

// GET /api/s3/presign-download/:key(*) - Get S3 presigned download URL
router.get('/s3/presign-download/:key(*)', requireAuth, async (req, res) => {
  try {
    const { key } = req.params;

    if (!key) {
      res.status(400).json({ error: '缺少 key 参数' });
      return;
    }

    const url = await getPresignedDownloadUrl(key);
    res.json({ downloadUrl: url });
  } catch (error) {
    console.error('[S3] 生成下载签名失败:', error);
    const message = error instanceof Error ? error.message : '生成下载签名失败';
    res.status(500).json({ error: message });
  }
});

// GET /api/s3/presign-delete/:key(*) - Get S3 presigned delete URL
router.get('/s3/presign-delete/:key(*)', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;

    if (!key) {
      res.status(400).json({ error: '缺少 key 参数' });
      return;
    }

    const url = await getPresignedDeleteUrl(key);
    res.json({ deleteUrl: url });
  } catch (error) {
    console.error('[S3] 生成删除签名失败:', error);
    const message = error instanceof Error ? error.message : '生成删除签名失败';
    res.status(500).json({ error: message });
  }
});

export function registerConfigRoutes(app: Router) {
  app.use('/api/config', router);
}
