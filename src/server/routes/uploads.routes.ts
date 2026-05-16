import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../prisma';
import { requireAuth, requireActiveUser } from '../middleware/auth';
import type { AuthenticatedRequest } from '../types';
import { asyncHandler } from '../middleware/asyncHandler';
import { uploadLimiter } from '../middleware/rateLimiter';
import {
  createUploadSessionExpiresAt,
  isUploadSessionExpired,
  getUploadFileStorageKey,
  buildUploadPublicUrl,
  validateUploadedImage,
  uploadFileToS3,
  uploadToSuperbed,
  deleteFromSuperbed,
  safeDeleteUploadFileByStorageKey,
  logger,
} from '../utils';
import { isBlurhashEnabled, shouldAutoGenerate, generateBlurhashFromFile } from '../blurhashService';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// uploads.routes.ts 在 src/server/routes/ 下，向上3级到项目根目录
const uploadsDir = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', '..', 'uploads');

const router = Router();

// 配置 multer 用于处理文件上传
// 使用与 validateUploadedImage 一致的扩展名 + MIME 白名单（JPG/PNG/WEBP/GIF/BMP），
// 拒绝 SVG/AVIF/HEIC 等可能携带脚本或服务端不支持的格式。
const ALLOWED_UPLOAD_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (_req, file, cb) => {
      // 使用随机文件名，避免中文和特殊字符问题
      const ext = path.extname(file.originalname).toLowerCase();
      const randomName = `${crypto.randomUUID()}${ext}`;
      cb(null, randomName);
    },
  }),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext) || !ALLOWED_UPLOAD_MIME_TYPES.has(mime)) {
      cb(new Error('仅支持 JPG、PNG、WEBP、GIF、BMP 图片上传'));
      return;
    }
    cb(null, true);
  },
});

/**
 * POST /api/uploads/sessions - 创建上传会话
 */
router.post('/sessions', requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const session = await prisma.uploadSession.create({
      data: {
        ownerUid: req.authUser!.uid,
        status: 'open',
        expiresAt: createUploadSessionExpiresAt(),
      },
    });

    res.status(201).json({
      session: {
        id: session.id,
        ownerUid: session.ownerUid,
        status: session.status,
        expiresAt: session.expiresAt.toISOString(),
        uploadedFiles: session.uploadedFiles,
      },
    });
  } catch (error) {
    console.error('Create upload session error:', error);
    res.status(500).json({ error: '创建上传会话失败' });
  }
}));

/**
 * GET /api/uploads/sessions/:sessionId - 获取会话状态
 */
router.get('/sessions/:sessionId', requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const { sessionId } = req.params;

    const session = await prisma.uploadSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      res.status(404).json({ error: '上传会话不存在' });
      return;
    }

    if (session.ownerUid !== req.authUser!.uid) {
      res.status(403).json({ error: '无权访问该会话' });
      return;
    }

    // 检查会话是否过期
    let status = session.status;
    if (status !== 'finalized' && isUploadSessionExpired(session.expiresAt)) {
      status = 'expired';
      await prisma.uploadSession.update({
        where: { id: session.id },
        data: { status: 'expired' },
      });
    }

    res.json({
      session: {
        id: session.id,
        ownerUid: session.ownerUid,
        status,
        expiresAt: session.expiresAt.toISOString(),
        uploadedFiles: session.uploadedFiles,
      },
    });
  } catch (error) {
    console.error('Get upload session error:', error);
    res.status(500).json({ error: '获取上传会话失败' });
  }
}));

/**
 * POST /api/uploads/sessions/:sessionId/files - 上传文件到会话
 */
router.post(
  '/sessions/:sessionId/files',
  requireAuth,
  requireActiveUser,
  uploadLimiter,
  upload.single('file'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { sessionId } = req.params;
      const { tripleStorage } = req.query as { tripleStorage?: string };
      const file = req.file;

      if (!file) {
        res.status(400).json({ error: '请上传文件' });
        return;
      }

      // 验证会话
      const session = await prisma.uploadSession.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          ownerUid: true,
          status: true,
          expiresAt: true,
        },
      });

      if (!session) {
        res.status(404).json({ error: '上传会话不存在' });
        return;
      }

      if (session.ownerUid !== req.authUser!.uid) {
        res.status(403).json({ error: '无权访问该会话' });
        return;
      }

      if (session.status === 'expired' || isUploadSessionExpired(session.expiresAt)) {
        if (session.status !== 'expired') {
          await prisma.uploadSession.update({
            where: { id: session.id },
            data: { status: 'expired' },
          });
        }
        res.status(410).json({ error: '上传会话已过期，请重新创建会话' });
        return;
      }

      if (session.status !== 'open') {
        res.status(400).json({ error: '会话状态不正确' });
        return;
      }

      // 验证图片
      const { mimeType } = await validateUploadedImage(file);

      // 获取存储策略
      const useTripleStorage = tripleStorage === 'true';
      const preferenceConfig = await prisma.siteConfig.findUnique({
        where: { key: 'image_preference' },
      });
      const preference = preferenceConfig?.value as { strategy?: 'local' | 's3' | 'external' } || {
        strategy: 'local',
      };

      // 创建媒体资源记录
      const storageKey = getUploadFileStorageKey(file);
      const publicUrl = buildUploadPublicUrl(storageKey);

      const asset = await prisma.mediaAsset.create({
        data: {
          ownerUid: req.authUser!.uid,
          storageKey,
          publicUrl,
          fileName: file.originalname,
          mimeType,
          sizeBytes: file.size,
          status: 'ready',
        },
      });

      // 始终创建 ImageMap 记录，用于统一图片管理
      const imageId = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      const imageMd5 = crypto.createHash('md5').update(fs.readFileSync(file.path)).digest('hex');
      await prisma.imageMap.create({
        data: {
          id: imageId,
          md5: imageMd5, // 使用唯一值避免冲突
          localUrl: publicUrl,
          s3Url: null,
          externalUrl: null,
          storageType: 'local',
        },
      });

      // 更新会话的上传文件计数
      await prisma.uploadSession.update({
        where: { id: session.id },
        data: {
          uploadedFiles: {
            increment: 1,
          },
        },
      });

      // 构建响应
      const response: {
        asset: {
          id: string;
          fileName: string;
          mimeType: string;
          sizeBytes: number;
          publicUrl: string;
          storageKey: string;
        };
        tripleStorage?: {
          localUrl: string;
          s3Url?: string;
          externalUrl?: string;
        };
      } = {
        asset: {
          id: asset.id,
          fileName: file.originalname,
          mimeType,
          sizeBytes: file.size,
          publicUrl,
          storageKey,
        },
      };

      // 处理三重存储
      if (useTripleStorage) {
        const localUrl = publicUrl;
        let s3Url: string | undefined;
        let externalUrl: string | undefined;

        // 上传到 S3
        if (preference.strategy === 's3' || preference.strategy === 'external') {
          try {
            const filePath = path.join(uploadsDir, file.filename);
            const s3Result = await uploadFileToS3(filePath, storageKey, mimeType);
            if (s3Result.success && s3Result.url) {
              s3Url = s3Result.url;

              let blurhash: string | undefined;
              if (isBlurhashEnabled() && shouldAutoGenerate()) {
                try {
                  const absolutePath = path.join(uploadsDir, file.filename);
                  blurhash = await generateBlurhashFromFile(absolutePath);
                  if (blurhash) {
                    console.log('[Upload] Blurhash generated for S3 upload:', blurhash.substring(0, 20) + '...');
                  }
                } catch (blurhashError) {
                  console.error('[Upload] Failed to generate blurhash:', blurhashError);
                }
              }

              // 更新 ImageMap 记录
              try {
                await prisma.imageMap.update({
                  where: { id: imageId },
                  data: {
                    s3Url,
                    ...(blurhash && { blurhash }),
                    storageType: preference.strategy,
                  },
                });
              } catch (imageMapError) {
                console.error('Update ImageMap failed:', imageMapError);
              }
            }
          } catch (s3Error) {
            console.error('Upload to S3 failed:', s3Error);
          }
        }

        // 上传到外部图床 (Superbed)
        if (preference.strategy === 'external') {
          const superbedToken = process.env.SUPERBED_API_TOKEN || '';
          
          if (!superbedToken) {
            console.warn('[Upload] Superbed API Token not configured, skipping external upload');
          } else {
            try {
              const filePath = path.join(uploadsDir, file.filename);
              const superbedResult = await uploadToSuperbed(
                filePath,
                file.originalname,
                mimeType,
                superbedToken,
              );
              if (superbedResult.success && superbedResult.url) {
                externalUrl = superbedResult.url;
              }
            } catch (externalError) {
              console.error('Upload to Superbed failed:', externalError);
            }
          }
        }

        // 如果 S3 上传失败或未执行，确保更新 ImageMap 的基本信息
        if (!s3Url) {
          try {
            await prisma.imageMap.update({
              where: { id: imageId },
              data: {
                ...(externalUrl && { externalUrl }),
                storageType: preference.strategy,
              },
            });
          } catch (imageMapError) {
            console.error('Update ImageMap failed:', imageMapError);
          }
        }

        response.tripleStorage = {
          localUrl,
          s3Url,
          externalUrl,
        };
      }

      res.status(201).json(response);
    } catch (error) {
      console.error('Upload file to session error:', error);

      // 清理上传的文件
      if (req.file) {
        await safeDeleteUploadFileByStorageKey(req.file.filename).catch((err) => logger.debug({ err }, 'Temp file cleanup failed'));
      }

      const message = error instanceof Error ? error.message : '上传文件失败';
      if (message.includes('图片') || message.includes('文件') || message.includes('超过')) {
        res.status(400).json({ error: message });
        return;
      }
      res.status(500).json({ error: '上传文件失败' });
    }
  }
));

/**
 * POST /api/uploads/sessions/:sessionId/finalize - 完成上传会话
 */
router.post('/sessions/:sessionId/finalize', requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const { sessionId } = req.params;

    const session = await prisma.uploadSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      res.status(404).json({ error: '上传会话不存在' });
      return;
    }

    if (session.ownerUid !== req.authUser!.uid) {
      res.status(403).json({ error: '无权操作该会话' });
      return;
    }

    if (session.status === 'expired' || isUploadSessionExpired(session.expiresAt)) {
      if (session.status !== 'expired') {
        await prisma.uploadSession.update({
          where: { id: session.id },
          data: { status: 'expired' },
        });
      }
      res.status(410).json({ error: '上传会话已过期' });
      return;
    }

    // 更新会话状态为 finalized
    await prisma.uploadSession.update({
      where: { id: session.id },
      data: { status: 'finalized' },
    });

    res.json({
      session: {
        id: session.id,
        status: 'finalized',
        uploadedFiles: session.uploadedFiles,
      },
    });
  } catch (error) {
    console.error('Finalize upload session error:', error);
    res.status(500).json({ error: '完成上传会话失败' });
  }
}));

/**
 * DELETE /api/uploads/sessions/:sessionId - 删除/取消上传会话
 */
router.delete('/sessions/:sessionId', requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const { sessionId } = req.params;

    const session = await prisma.uploadSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      res.status(404).json({ error: '上传会话不存在' });
      return;
    }

    if (session.ownerUid !== req.authUser!.uid) {
      res.status(403).json({ error: '无权操作该会话' });
      return;
    }

    // 删除会话（级联删除关联的媒体资源）
    await prisma.uploadSession.delete({
      where: { id: session.id },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete upload session error:', error);
    res.status(500).json({ error: '删除上传会话失败' });
  }
}));

/**
 * DELETE /api/uploads/superbed - 从 Superbed 删除图片
 * Body: { imageIds: string[] }
 */
router.delete('/superbed', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const { imageIds } = req.body as { imageIds?: string[] };

    if (!imageIds || !Array.isArray(imageIds) || imageIds.length === 0) {
      res.status(400).json({ error: '请提供要删除的图片 ID 列表' });
      return;
    }

    if (imageIds.length > 1000) {
      res.status(400).json({ error: '每次最多删除 1000 张图片' });
      return;
    }

    const superbedToken = process.env.SUPERBED_API_TOKEN || '';
    if (!superbedToken) {
      res.status(400).json({ error: 'Superbed API Token 未配置' });
      return;
    }

    const result = await deleteFromSuperbed(imageIds, superbedToken);

    if (result.success) {
      res.json({ success: true, deletedCount: imageIds.length });
    } else {
      res.status(500).json({ error: result.error || '删除图片失败' });
    }
  } catch (error) {
    console.error('Delete from Superbed error:', error);
    res.status(500).json({ error: '删除图片失败' });
  }
}));

export function registerUploadRoutes(app: Router) {
  app.use('/api/uploads', router);
}
