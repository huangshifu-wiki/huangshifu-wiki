import { Router } from 'express';
import { requireAuth, requireActiveUser, requireAdmin } from '../middleware/auth';
import type { AuthenticatedRequest } from '../types';
import {
  getUserPresignedUploadUrl,
  getPresignedDownloadUrl,
  getPresignedDeleteUrl,
  getPublicConfig,
} from '../s3/s3Service';

const router = Router();

router.get('/config', async (_req, res) => {
  try {
    const config = getPublicConfig();
    res.json(config);
  } catch (error) {
    console.error('[S3] 获取配置失败:', error);
    res.status(500).json({ error: '获取 S3 配置失败' });
  }
});

router.get('/presign-upload', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { filename, contentType, contentMd5, fileSize } = req.query as {
      filename?: string;
      contentType?: string;
      contentMd5?: string;
      fileSize?: string;
    };

    if (!filename) {
      res.status(400).json({ error: '缺少 filename 参数' });
      return;
    }

    const result = await getUserPresignedUploadUrl({
      userUid: req.authUser!.uid,
      filename,
      contentType,
      contentMd5,
      fileSize,
    });

    res.json(result);
  } catch (error) {
    console.error('[S3] 生成上传签名失败:', error);
    const message = error instanceof Error ? error.message : '生成上传签名失败';
    const status = message.includes('验证失败') || message.includes('必须') ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

router.get('/presign-download/:key(*)', requireAuth, async (req, res) => {
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

router.get('/presign-delete/:key(*)', requireAuth, requireAdmin, async (req, res) => {
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

export function registerS3Routes(app: Router) {
  app.use('/api/s3', router);
}
