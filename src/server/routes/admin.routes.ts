import { Router, type Request, type Response } from 'express';
import {
  requireAdmin,
  requireSuperAdmin,
  requireAuth,
  requireActiveUser,
  isAdminRole,
} from '../middleware/auth';
import type { ApiUser } from '../types';

type AuthenticatedRequest = Request & { authUser?: ApiUser };
import {
  prisma,
  toWikiResponse,
  toPostResponse,
  toGalleryResponse,
  toUserResponse,
  toEditLockResponse,
  toMusicResponse,
  parseContentStatus,
  normalizeModerationTargetType,
  createNotification,
  safeDeleteUploadFileByStorageKey,
  safeDeleteUploadFileByUrl,
  parseDatabaseUrl,
  verifyBackupPassword,
  sanitizeFilename,
  formatFileSize,
  cleanupOldBackups,
  encryptBuffer,
  decryptBuffer,
  logger,
} from '../utils';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import archiver from 'archiver';
import { scanAllWikiLinks, getWikiPageLinks, previewLinkUpdate, batchUpdateWikiLinks, switchWikiStorage } from '../wiki/markdownLinkUpdater';
import { isSensitiveWord, containsSensitive } from '../../lib/sensitiveWordFilter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

const execFileAsync = promisify(execFile);

const backupsDir = path.join(__dirname, '..', '..', '..', 'backups');
fs.mkdirSync(backupsDir, { recursive: true });

const BACKUP_PASSWORD = process.env.BACKUP_PASSWORD || '';

async function handleBackupList(_req: Request, res: Response) {
  try {
    const allFiles = await fs.promises.readdir(backupsDir);
    const files = allFiles.filter((f) => f.startsWith('backup_') && f.endsWith('.zip'));
    const results = [];
    for (const f of files) {
      const filePath = path.join(backupsDir, f);
      const stat = await fs.promises.stat(filePath);
      results.push({ filename: f, size: stat.size, sizeFormatted: formatFileSize(stat.size), createdAt: stat.mtime.toISOString() });
    }
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ backups: results });
  } catch (error) {
    logger.error({ err: error }, 'List backups error');
    res.status(500).json({ error: '获取备份列表失败' });
  }
}

async function handleBackupDelete(req: AuthenticatedRequest, res: Response) {
  try {
    const { password } = req.query as { password?: string };
    const filename = req.params.filename;
    const normalized = path.normalize(filename);

    if (!BACKUP_PASSWORD) {
      res.status(500).json({ error: '未配置 BACKUP_PASSWORD 环境变量' });
      return;
    }

    if (!password || !verifyBackupPassword(password)) {
      res.status(401).json({ error: '备份密码错误' });
      return;
    }

    if (normalized.includes('..') || !sanitizeFilename(filename)) {
      res.status(400).json({ error: '无效的文件名' });
      return;
    }

    const filePath = path.join(backupsDir, filename);
    try {
      await fs.promises.access(filePath);
    } catch {
      res.status(404).json({ error: '备份文件不存在' });
      return;
    }

    await fs.promises.unlink(filePath);
    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Delete backup error');
    res.status(500).json({ error: '删除备份失败' });
  }
}
const BACKUP_RETAIN_COUNT = Math.max(1, Number(process.env.BACKUP_RETAIN_COUNT || 20));

const uploadBackup = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, backupsDir);
    },
    filename: (_req, file, cb) => {
      cb(null, `restore_${Date.now()}_${file.originalname}`);
    },
  }),
});

async function handleReviewAction(
  targetType: 'wiki' | 'post',
  targetId: string,
  action: 'approve' | 'reject',
  reqAuthUser: { uid: string; role: string },
  note: string,
) {
  const reviewedAt = new Date();
  const rejectNote = action === 'reject' ? (note || '内容未通过审核') : note || null;

  if (targetType === 'wiki') {
    const page = await prisma.wikiPage.update({
      where: { slug: targetId },
      data: {
        status: action === 'approve' ? 'published' : 'rejected',
        reviewNote: action === 'approve' ? (note || null) : rejectNote,
        reviewedBy: reqAuthUser.uid,
        reviewedAt,
      },
    });

    await prisma.moderationLog.create({
      data: { targetType: 'wiki', targetId, action, operatorUid: reqAuthUser.uid, note: action === 'approve' ? note || null : rejectNote },
    });

    if (page.lastEditorUid && page.lastEditorUid !== reqAuthUser.uid) {
      await createNotification(page.lastEditorUid, 'review_result', { approved: action === 'approve', targetType: 'wiki', targetId, title: page.title, note: action === 'approve' ? note || null : rejectNote });
    }

    return { item: { ...toWikiResponse(page), sensitiveWords: containsSensitive(page.content || '') }, targetType };
  }

  const post = await prisma.post.update({
    where: { id: targetId },
    data: { status: action === 'approve' ? 'published' : 'rejected', reviewNote: action === 'approve' ? (note || null) : rejectNote, reviewedBy: reqAuthUser.uid, reviewedAt },
  });

  await prisma.moderationLog.create({ data: { targetType: 'post', targetId, action, operatorUid: reqAuthUser.uid, note: action === 'approve' ? note || null : rejectNote } });

  if (post.authorUid && post.authorUid !== reqAuthUser.uid) {
    await createNotification(post.authorUid, 'review_result', { approved: action === 'approve', targetType: 'post', targetId, title: post.title, note: action === 'approve' ? note || null : rejectNote });
  }

  return { item: action === 'approve' ? { ...toPostResponse(post), sensitiveWords: containsSensitive(post.content || '') } : toPostResponse(post), targetType };
}

/**
 * ====================
 * Review Queue Routes
 * ====================
 */

// GET /api/admin/review-queue - Get review queue items
router.get('/review-queue', requireAdmin, async (req, res) => {
  try {
    const type = normalizeModerationTargetType(req.query.type);
    const status = parseContentStatus(req.query.status) || 'pending';

    if (!type) {
      res.status(400).json({ error: 'type 必须为 wiki 或 posts' });
      return;
    }

    if (type === 'wiki') {
      const items = await prisma.wikiPage.findMany({
        where: { status },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      });
      res.json({ type, status, items: items.map(toWikiResponse) });
      return;
    }

    const items = await prisma.post.findMany({
      where: { status },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    res.json({ type: 'posts', status, items: items.map(toPostResponse) });
  } catch (error) {
    logger.error({ err: error }, 'Fetch review queue error');
    res.status(500).json({ error: '获取审核队列失败' });
  }
});

// PUT /api/admin/review-queue/:id/approve - Approve a review item
router.put('/review-queue/:id/approve', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const targetType = normalizeModerationTargetType(req.body.type) || 'wiki';
    const targetId = req.params.id;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    const reqAuthUser = req.authUser!;

    if (!targetType) {
      res.status(400).json({ error: '无效审核类型' });
      return;
    }

    const result = await handleReviewAction(targetType, targetId, 'approve', reqAuthUser, note);
    res.json(result);
  } catch (error) {
    logger.error({ err: error }, 'Approve review item error');
    res.status(500).json({ error: '审核通过失败' });
  }
});

// PUT /api/admin/review-queue/:id/reject - Reject a review item
router.put('/review-queue/:id/reject', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const targetType = normalizeModerationTargetType(req.body.type) || 'wiki';
    const targetId = req.params.id;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    const reqAuthUser = req.authUser!;

    if (!targetType) {
      res.status(400).json({ error: '无效审核类型' });
      return;
    }

    const result = await handleReviewAction(targetType, targetId, 'reject', reqAuthUser, note);
    res.json(result);
  } catch (error) {
    logger.error({ err: error }, 'Reject review item error');
    res.status(500).json({ error: '驳回失败' });
  }
});

// POST /api/admin/review/:type/:id/:action - Legacy compatible route
// Redirects to PUT /api/admin/review-queue/:id/:action
router.post('/review/:type/:id/:action', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { type, id, action } = req.params;
    const { note } = req.body;

    if (action !== 'approve' && action !== 'reject') {
      res.status(400).json({ error: '无效的操作' });
      return;
    }

    const targetType = normalizeModerationTargetType(type);
    if (!targetType) {
      res.status(400).json({ error: '无效的类型' });
      return;
    }

    const result = await handleReviewAction(targetType, id, action, req.authUser!, typeof req.body?.note === 'string' ? req.body.note.trim() : '');
    res.json(result);
  } catch (error) {
    logger.error({ err: error }, 'Review action error');
    res.status(500).json({ error: '审核操作失败' });
  }
});

/**
 * ==========================
 * Sensitive Words Management
 * ==========================
 */

// GET /api/admin/sensitive-words - Check if a word is sensitive
router.get('/sensitive-words', requireAdmin, async (req, res) => {
  try {
    const { word } = req.query as { word?: string };
    if (!word) {
      res.status(400).json({ error: '请提供要检查的词语' });
      return;
    }
    const isSensitive = isSensitiveWord(word);
    res.json({ word, isSensitive });
  } catch (error) {
    logger.error({ err: error }, 'Check sensitive word error');
    res.status(500).json({ error: '检查敏感词失败' });
  }
});

// POST /api/admin/sensitive-words - Add sensitive word (placeholder - requires file system write)
router.post('/sensitive-words', requireSuperAdmin, async (req, res) => {
  try {
    const { word } = req.body as { word?: string };
    if (!word || typeof word !== 'string') {
      res.status(400).json({ error: '请提供要添加的敏感词' });
      return;
    }
    
    // Note: This is a placeholder. Actual implementation would require
    // writing to the sensitive-words.txt file which needs special handling
    res.status(501).json({ 
      error: '敏感词管理需要通过文件系统操作，请手动编辑 public/sensitive-words/words.txt 文件',
      hint: '将敏感词添加到 public/sensitive-words/words.txt 文件中，每行一个词'
    });
  } catch (error) {
    logger.error({ err: error }, 'Add sensitive word error');
    res.status(500).json({ error: '添加敏感词失败' });
  }
});

// DELETE /api/admin/sensitive-words/:id - Remove sensitive word (placeholder)
router.delete('/sensitive-words/:id', requireSuperAdmin, async (req, res) => {
  try {
    const word = req.params.id;
    if (!word) {
      res.status(400).json({ error: '请提供要删除的敏感词' });
      return;
    }
    
    // Note: This is a placeholder. Actual implementation would require
    // writing to the sensitive-words.txt file which needs special handling
    res.status(501).json({ 
      error: '敏感词管理需要通过文件系统操作，请手动编辑 public/sensitive-words/words.txt 文件',
      hint: '从 public/sensitive-words/words.txt 文件中删除该敏感词'
    });
  } catch (error) {
    logger.error({ err: error }, 'Remove sensitive word error');
    res.status(500).json({ error: '删除敏感词失败' });
  }
});

/**
 * ==========================
 * Lock Management Routes
 * ==========================
 */

// GET /api/admin/locks - Get all edit locks
router.get('/locks', requireAdmin, async (_req, res) => {
  try {
    const locks = await prisma.editLock.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      take: 200,
    });

    res.json({ locks: locks.map(toEditLockResponse) });
  } catch (error) {
    logger.error({ err: error }, 'Fetch edit locks error');
    res.status(500).json({ error: '获取编辑锁列表失败' });
  }
});

// POST /api/admin/locks - Create/edit lock (generic endpoint)
router.post('/locks', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    await prisma.editLock.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });

    const collection = req.body?.collection;
    const recordId = req.body?.recordId;
    
    if (!collection || !recordId) {
      res.status(400).json({ error: '缺少有效的锁定目标' });
      return;
    }

    const ttlMinutes = 15;
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    const force = false;

    const existing = await prisma.editLock.findUnique({
      where: {
        collection_recordId: {
          collection,
          recordId,
        },
      },
    });

    if (existing && existing.userId !== req.authUser!.uid) {
      const isExpired = existing.expiresAt.getTime() <= Date.now();
      if (!isExpired && !(force && isAdminRole(req.authUser!.role))) {
        res.status(409).json({
          error: '该记录正在被其他用户编辑',
          lock: toEditLockResponse(existing),
        });
        return;
      }

      const takenOver = await prisma.editLock.update({
        where: { id: existing.id },
        data: {
          userId: req.authUser!.uid,
          username: req.authUser!.displayName,
          expiresAt,
        },
      });

      res.json({ lock: toEditLockResponse(takenOver), acquired: true, takeover: true });
      return;
    }

    if (existing && existing.userId === req.authUser!.uid) {
      const renewed = await prisma.editLock.update({
        where: { id: existing.id },
        data: {
          username: req.authUser!.displayName,
          expiresAt,
        },
      });
      res.json({ lock: toEditLockResponse(renewed), acquired: true, renewed: true });
      return;
    }

    const created = await prisma.editLock.create({
      data: {
        collection,
        recordId,
        userId: req.authUser!.uid,
        username: req.authUser!.displayName,
        expiresAt,
      },
    });

    res.status(201).json({ lock: toEditLockResponse(created), acquired: true });
  } catch (error) {
    logger.error({ err: error }, 'Acquire edit lock error');
    res.status(500).json({ error: '申请编辑锁失败' });
  }
});

// DELETE /api/admin/locks/:id - Delete lock by ID
router.delete('/locks/:id', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const lock = await prisma.editLock.findUnique({ where: { id: req.params.id } });
    if (!lock) {
      res.json({ success: true });
      return;
    }

    const canManage = lock.userId === req.authUser!.uid || isAdminRole(req.authUser!.role);
    if (!canManage) {
      res.status(403).json({ error: '无权限释放该编辑锁' });
      return;
    }

    await prisma.editLock.delete({ where: { id: lock.id } });
    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Release edit lock error');
    res.status(500).json({ error: '释放编辑锁失败' });
  }
});

/**
 * ==========================
 * Moderation Logs
 * ==========================
 */

// GET /api/admin/moderation_logs - Get moderation logs
router.get('/moderation_logs', requireAdmin, async (_req, res) => {
  try {
    const logs = await prisma.moderationLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        operator: {
          select: { uid: true, displayName: true, email: true },
        },
      },
    });

    res.json({
      logs: logs.map(log => ({
        id: log.id,
        targetType: log.targetType,
        targetId: log.targetId,
        action: log.action,
        operatorUid: log.operatorUid,
        operatorName: log.operator.displayName || log.operator.email || 'Unknown',
        note: log.note,
        createdAt: log.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    logger.error({ err: error }, 'Fetch moderation logs error');
    res.status(500).json({ error: '获取操作日志失败' });
  }
});

// GET /api/admin/ban_logs - Get ban logs
router.get('/ban_logs', requireAdmin, async (_req, res) => {
  try {
    const logs = await prisma.userBanLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        target: {
          select: { uid: true, displayName: true, email: true },
        },
        operator: {
          select: { uid: true, displayName: true, email: true },
        },
      },
    });

    res.json({
      logs: logs.map(log => ({
        id: log.id,
        targetUid: log.targetUid,
        targetName: log.target.displayName || log.target.email || 'Unknown',
        action: log.action,
        operatorUid: log.operatorUid,
        operatorName: log.operator.displayName || log.operator.email || 'Unknown',
        note: log.note,
        createdAt: log.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    logger.error({ err: error }, 'Fetch ban logs error');
    res.status(500).json({ error: '获取封禁日志失败' });
  }
});

/**
 * ==========================
 * Batch Operations Routes
 * ==========================
 */

// POST /api/admin/batch-delete-posts - Batch delete posts
router.post('/batch-delete-posts', requireAdmin, async (req, res) => {
  try {
    const postIds = Array.isArray(req.body?.postIds) ? req.body.postIds : [];
    if (!postIds.length) {
      res.status(400).json({ error: '请选择要删除的帖子' });
      return;
    }

    await prisma.post.deleteMany({
      where: { id: { in: postIds } },
    });

    res.json({ deleted: postIds.length });
  } catch (error) {
    logger.error({ err: error }, 'Batch delete posts error');
    res.status(500).json({ error: '批量删除帖子失败' });
  }
});

// POST /api/admin/batch-delete-galleries - Batch delete galleries
router.post('/batch-delete-galleries', requireAdmin, async (req, res) => {
  try {
    const galleryIds = Array.isArray(req.body?.galleryIds) ? req.body.galleryIds : [];
    if (!galleryIds.length) {
      res.status(400).json({ error: '请选择要删除的图集' });
      return;
    }

    let deleted = 0;
    for (const galleryId of galleryIds) {
      const gallery = await prisma.gallery.findUnique({
        where: { id: galleryId },
        include: { images: true },
      });
      if (!gallery) continue;

      await prisma.gallery.delete({ where: { id: galleryId } });

      await Promise.all(
        gallery.images.map(async (image) => {
          if (image.assetId) {
            const linked = await prisma.galleryImage.count({ where: { assetId: image.assetId } });
            if (linked === 0) {
              const asset = await prisma.mediaAsset.findUnique({ where: { id: image.assetId } });
              if (asset) {
                await safeDeleteUploadFileByStorageKey(asset.storageKey);
                await prisma.mediaAsset.update({
                  where: { id: asset.id },
                  data: { status: 'deleted' },
                });
              }
            }
          } else {
            await safeDeleteUploadFileByUrl(image.url);
          }
        }),
      );
      deleted++;
    }

    res.json({ deleted });
  } catch (error) {
    logger.error({ err: error }, 'Batch delete galleries error');
    res.status(500).json({ error: '批量删除图集失败' });
  }
});

// POST /api/admin/batch-delete-comments - Batch delete comments
router.post('/batch-delete-comments', requireAdmin, async (req, res) => {
  try {
    const commentIds = Array.isArray(req.body?.commentIds) ? req.body.commentIds : [];
    if (!commentIds.length) {
      res.status(400).json({ error: '请选择要删除的评论' });
      return;
    }

    await prisma.postComment.deleteMany({
      where: { id: { in: commentIds } },
    });

    res.json({ deleted: commentIds.length });
  } catch (error) {
    logger.error({ err: error }, 'Batch delete comments error');
    res.status(500).json({ error: '批量删除评论失败' });
  }
});

/**
 * ==========================
 * Wiki-links Management
 * ==========================
 */

// GET /api/admin/wiki-links - Get all wiki-links (scan)
router.get('/wiki-links/scan', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const result = await scanAllWikiLinks();
    res.json(result);
  } catch (error) {
    logger.error({ err: error }, 'Scan wiki links error');
    res.status(500).json({ error: '扫描 Wiki 链接失败' });
  }
});

// GET /api/admin/wiki-links/:slug - Get wiki page links
router.get('/wiki-links/:slug', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { slug } = req.params;
    const result = await getWikiPageLinks(slug);
    res.json(result);
  } catch (error) {
    logger.error({ err: error }, 'Get wiki page links error');
    const message = error instanceof Error ? error.message : '获取 Wiki 页面链接失败';
    res.status(500).json({ error: message });
  }
});

// PUT /api/admin/wiki-links/:id - Update wiki link (preview)
router.put('/wiki-links/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { mappings, slugs } = req.body as {
      mappings: Array<{ oldUrl: string; newUrl: string; useRegex?: boolean }>;
      slugs?: string[];
    };

    if (!mappings || !Array.isArray(mappings) || mappings.length === 0) {
      res.status(400).json({ error: '请提供链接映射规则' });
      return;
    }

    const result = await previewLinkUpdate(mappings, { specificSlugs: slugs });
    res.json(result);
  } catch (error) {
    logger.error({ err: error }, 'Preview link update error');
    res.status(500).json({ error: '预览链接更新失败' });
  }
});

// POST /api/admin/wiki-links/update - Batch update wiki links
router.post('/wiki-links/update', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { mappings, dryRun } = req.body as {
      mappings: Array<{ oldUrl: string; newUrl: string; useRegex?: boolean }>;
      dryRun?: boolean;
    };

    if (!mappings || !Array.isArray(mappings) || mappings.length === 0) {
      res.status(400).json({ error: '请提供链接映射规则' });
      return;
    }

    const result = await batchUpdateWikiLinks(mappings, { dryRun });
    res.json(result);
  } catch (error) {
    logger.error({ err: error }, 'Batch update wiki links error');
    res.status(500).json({ error: '批量更新链接失败' });
  }
});

// POST /api/admin/wiki-links/switch-storage - Switch wiki storage strategy
router.post('/wiki-links/switch-storage', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { fromStorage, toStorage, config, dryRun } = req.body as {
      fromStorage: 'local' | 's3' | 'external';
      toStorage: 'local' | 's3' | 'external';
      config: {
        localBaseUrl?: string;
        s3BaseUrl?: string;
        externalBaseUrl?: string;
      };
      dryRun?: boolean;
    };

    if (!fromStorage || !toStorage) {
      res.status(400).json({ error: '请提供源存储和目标存储' });
      return;
    }

    if (fromStorage === toStorage) {
      res.status(400).json({ error: '源存储和目标存储不能相同' });
      return;
    }

    const result = await switchWikiStorage(fromStorage, toStorage, config, { dryRun });
    res.json(result);
  } catch (error) {
    logger.error({ err: error }, 'Switch wiki storage error');
    res.status(500).json({ error: '切换存储策略失败' });
  }
});

// POST /api/admin/wiki-links/sync-with-imagemap - Sync wiki links with ImageMap
router.post('/wiki-links/sync-with-imagemap', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { dryRun } = req.body as { dryRun?: boolean };

    const imageMaps = await prisma.imageMap.findMany({});
    if (imageMaps.length === 0) {
      res.json({ message: 'ImageMap 为空，无需同步', result: null });
      return;
    }

    const mappings = imageMaps
      .filter(im => im.localUrl && im.externalUrl && im.localUrl !== im.externalUrl)
      .map(im => ({
        oldUrl: im.localUrl!,
        newUrl: im.externalUrl!,
        useRegex: false,
      }));

    if (mappings.length === 0) {
      res.json({ message: '没有需要同步的链接', result: null });
      return;
    }

    const result = await batchUpdateWikiLinks(mappings, { dryRun });
    res.json({ message: dryRun ? '预览同步完成' : '同步完成', result });
  } catch (error) {
    logger.error({ err: error }, 'Sync wiki links with ImageMap error');
    res.status(500).json({ error: '同步 ImageMap 失败' });
  }
});

/**
 * ==========================
 * Backup Management Routes
 * ==========================
 */

// POST /api/admin/backup/create - Create backup
router.post('/backup/create', requireSuperAdmin, async (req, res) => {
  try {
    const { password } = req.body as { password?: string };
    const backupPassword = password || BACKUP_PASSWORD;

    if (!backupPassword) {
      res.status(400).json({ error: '请提供备份密码' });
      return;
    }

    const dbConfig = parseDatabaseUrl(process.env.DATABASE_URL || '');
    if (!dbConfig) {
      res.status(500).json({ error: 'DATABASE_URL 格式无效' });
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sqlFilename = `backup_${timestamp}.sql`;
    const sqlFilePath = path.join(backupsDir, sqlFilename);
    const zipFilename = `backup_${timestamp}.zip`;
    const zipFilePath = path.join(backupsDir, zipFilename);

    const pgDumpArgs = [
      '-h', dbConfig.host,
      '-p', dbConfig.port,
      '-U', dbConfig.user,
      '-d', dbConfig.database,
      '--no-owner',
      '--no-privileges',
      '--clean',
      '--if-exists',
      '--exclude-table-data=ImageEmbedding',
      '--exclude-table-data=_prisma_migrations',
      '-f', sqlFilePath,
    ];

    const pgDumpEnv = { ...process.env, PGPASSWORD: dbConfig.password };

    await execFileAsync('pg_dump', pgDumpArgs, { env: pgDumpEnv, timeout: 300000 });

    const sqlContent = await fs.promises.readFile(sqlFilePath);
    await fs.promises.unlink(sqlFilePath);

    const encryptedContent = encryptBuffer(sqlContent, backupPassword);

    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipFilePath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve());
      archive.on('error', (err) => reject(err));

      archive.pipe(output);
      archive.append(encryptedContent, { name: sqlFilename });
      archive.finalize();
    });

    const stat = await fs.promises.stat(zipFilePath);

    await cleanupOldBackups();

    res.json({
      backup: {
        filename: zipFilename,
        size: stat.size,
        sizeFormatted: formatFileSize(stat.size),
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Create backup error');
    res.status(500).json({ error: '创建备份失败：' + (error instanceof Error ? error.message : String(error)) });
  }
});

// GET /api/admin/backup/list - List backups (frontend compatible)
router.get('/backup/list', requireSuperAdmin, async (_req, res) => {
  try {
    const files = (await fs.promises.readdir(backupsDir))
      .filter((f) => f.startsWith('backup_') && f.endsWith('.zip'));
    const mapped = (await Promise.all(
      files.map(async (f) => {
        const filePath = path.join(backupsDir, f);
        const stat = await fs.promises.stat(filePath);
        return {
          filename: f,
          size: stat.size,
          sizeFormatted: formatFileSize(stat.size),
          createdAt: stat.mtime.toISOString(),
        };
      }),
    ))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json({ backups: mapped });
  } catch (error) {
    logger.error({ err: error }, 'List backups error');
  }
});

// GET /api/admin/backup/:filename/download - Download backup
router.get('/backup/:filename/download', requireSuperAdmin, async (req, res) => {
  try {
    const filename = req.params.filename;
    const normalized = path.normalize(filename);

    if (normalized.includes('..') || !sanitizeFilename(filename)) {
      res.status(400).json({ error: '无效的文件名' });
      return;
    }

    const filePath = path.join(backupsDir, filename);
    try {
      await fs.promises.access(filePath);
    } catch {
      res.status(404).json({ error: '备份文件不存在' });
      return;
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    logger.error({ err: error }, 'Download backup error');
    res.status(500).json({ error: '下载备份失败' });
  }
});

// POST /api/admin/backup/restore - Restore backup
router.post('/backup/restore', requireSuperAdmin, uploadBackup.single('file'), async (req, res) => {
  try {
    const { password } = req.body as { password?: string };
    const file = req.file;

    if (!BACKUP_PASSWORD) {
      res.status(500).json({ error: '未配置 BACKUP_PASSWORD 环境变量' });
      return;
    }

    if (!password || !verifyBackupPassword(password)) {
      res.status(401).json({ error: '备份密码错误' });
      return;
    }

    if (!file) {
      res.status(400).json({ error: '请上传备份文件' });
      return;
    }

    const dbConfig = parseDatabaseUrl(process.env.DATABASE_URL || '');
    if (!dbConfig) {
      res.status(500).json({ error: 'DATABASE_URL 格式无效' });
      return;
    }

    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip(file.path);
    const zipEntries = zip.getEntries();

    const sqlEntry = zipEntries.find((e) => e.entryName.endsWith('.sql'));
    if (!sqlEntry) {
      await fs.promises.unlink(file.path);
      res.status(400).json({ error: '备份文件中未找到 SQL 数据' });
      return;
    }

    const encryptedContent = sqlEntry.getData();

    let sqlContent: Buffer;
    try {
      sqlContent = decryptBuffer(encryptedContent, password);
    } catch {
      await fs.promises.unlink(file.path);
      res.status(401).json({ error: '备份密码错误或文件已损坏' });
      return;
    }

    const sqlContentStr = sqlContent.toString('utf-8');
    if (!sqlContentStr.includes('PostgreSQL database dump') && !sqlContentStr.includes('pg_dump')) {
      await fs.promises.unlink(file.path);
      res.status(400).json({ error: '备份文件格式无效' });
      return;
    }

    const tempSqlPath = path.join(backupsDir, `restore_${Date.now()}.sql`);
    await fs.promises.writeFile(tempSqlPath, sqlContent);

    try {
      const psqlArgs = [
        '-h', dbConfig.host,
        '-p', dbConfig.port,
        '-U', dbConfig.user,
        '-d', dbConfig.database,
        '--single-transaction',
        '-v', 'ON_ERROR_STOP=1',
        '-f', tempSqlPath,
      ];
      const psqlEnv = { ...process.env, PGPASSWORD: dbConfig.password };

      await execFileAsync('psql', psqlArgs, { env: psqlEnv, timeout: 600000 });
    } finally {
      await fs.promises.unlink(tempSqlPath).catch(() => {});
      await fs.promises.unlink(file.path).catch(() => {});
    }

    res.json({ success: true, message: '数据库恢复成功' });
  } catch (error) {
    logger.error({ err: error }, 'Restore backup error');
    if (req.file) {
      try { await fs.promises.access(req.file.path); } catch { /* already gone */ }
      await fs.promises.unlink(req.file.path).catch(() => {});
    }
    res.status(500).json({ error: '恢复数据库失败: ' + (error instanceof Error ? error.message : String(error)) });
  }
});

// GET /api/admin/backups - List backups
router.get('/backups', requireSuperAdmin, async (_req, res) => {
  try {
    const files = (await fs.promises.readdir(backupsDir))
      .filter((f) => f.startsWith('backup_') && f.endsWith('.zip'));
    const mapped = (await Promise.all(
      files.map(async (f) => {
        const filePath = path.join(backupsDir, f);
        const stat = await fs.promises.stat(filePath);
        return {
          filename: f,
          size: stat.size,
          sizeFormatted: formatFileSize(stat.size),
          createdAt: stat.mtime.toISOString(),
        };
      }),
    ))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json({ backups: mapped });
  } catch (error) {
    logger.error({ err: error }, 'List backups error');
    res.status(500).json({ error: '获取备份列表失败' });
  }
});

// DELETE /api/admin/backup/:filename - Delete backup (legacy compatible)
router.delete('/backup/:filename', requireSuperAdmin, async (req, res) => {
  try {
    const { password } = req.query as { password?: string };
    const filename = req.params.filename;
    const normalized = path.normalize(filename);

    if (!BACKUP_PASSWORD) {
      res.status(500).json({ error: '未配置 BACKUP_PASSWORD 环境变量' });
      return;
    }

    if (!password || !verifyBackupPassword(password)) {
      res.status(401).json({ error: '备份密码错误' });
      return;
    }

    if (normalized.includes('..') || !sanitizeFilename(filename)) {
      res.status(400).json({ error: '无效的文件名' });
      return;
    }

    const filePath = path.join(backupsDir, filename);
    try {
      await fs.promises.access(filePath);
    } catch {
      res.status(404).json({ error: '备份文件不存在' });
      return;
    }

    await fs.promises.unlink(filePath);
    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Delete backup error');
    res.status(500).json({ error: '删除备份失败' });
  }
});

// DELETE /api/admin/backups/:filename - Delete backup
router.delete('/backups/:filename', requireSuperAdmin, async (req, res) => {
  try {
    const { password } = req.query as { password?: string };
    const filename = req.params.filename;
    const normalized = path.normalize(filename);

    if (!BACKUP_PASSWORD) {
      res.status(500).json({ error: '未配置 BACKUP_PASSWORD 环境变量' });
      return;
    }

    if (!password || !verifyBackupPassword(password)) {
      res.status(401).json({ error: '备份密码错误' });
      return;
    }

    if (normalized.includes('..') || !sanitizeFilename(filename)) {
      res.status(400).json({ error: '无效的文件名' });
      return;
    }

    const filePath = path.join(backupsDir, filename);
    try {
      await fs.promises.access(filePath);
    } catch {
      res.status(404).json({ error: '备份文件不存在' });
      return;
    }

    await fs.promises.unlink(filePath);
    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Delete backup error');
    res.status(500).json({ error: '删除备份失败' });
  }
});

/**
 * ==========================
 * Admin Panel Stats & Data
 * ==========================
 */

// GET /api/admin/stats - Get admin panel statistics
router.get('/stats', requireAdmin, async (_req, res) => {
  try {
    const [
      wikiCount,
      postCount,
      galleryCount,
      userCount,
      musicCount,
    ] = await Promise.all([
      prisma.wikiPage.count(),
      prisma.post.count(),
      prisma.gallery.count(),
      prisma.user.count(),
      prisma.musicTrack.count(),
    ]);

    res.json({
      stats: {
        wiki: wikiCount,
        posts: postCount,
        galleries: galleryCount,
        users: userCount,
        music: musicCount,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Fetch admin stats error');
    res.status(500).json({ error: '获取统计数据失败' });
  }
});

// GET /api/admin/:tab - Get admin data by tab
router.get('/:tab', requireAdmin, async (req, res) => {
  try {
    const tab = req.params.tab;

    if (tab === 'wiki') {
      const data = await prisma.wikiPage.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 100,
      });
      res.json({ data: data.map(toWikiResponse) });
      return;
    }

    if (tab === 'posts') {
      const data = await prisma.post.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 100,
      });
      res.json({ data: data.map(toPostResponse) });
      return;
    }

    if (tab === 'galleries') {
      const data = await prisma.gallery.findMany({
        include: {
          images: {
            include: {
              asset: true,
            },
            orderBy: { sortOrder: 'asc' },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      });
      res.json({ data: await Promise.all(data.map(g => toGalleryResponse(g))) });
      return;
    }

    if (tab === 'users') {
      const data = await prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          uid: true,
          email: true,
          displayName: true,
          photoURL: true,
          role: true,
          status: true,
          banReason: true,
          bannedAt: true,
          level: true,
          bio: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      res.json({ data: data.map(toUserResponse) });
      return;
    }

    if (tab === 'locks') {
      await prisma.editLock.deleteMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
        },
      });

      const data = await prisma.editLock.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      res.json({ data: data.map(toEditLockResponse) });
      return;
    }

    if (tab === 'music') {
      const data = await prisma.musicTrack.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 100,
      });
      res.json({ data: data.map(toMusicResponse) });
      return;
    }

    if (tab === 'announcements') {
      const data = await prisma.announcement.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      res.json({ data });
      return;
    }

    if (tab === 'sections') {
      const data = await prisma.section.findMany({
        orderBy: { order: 'asc' },
        take: 100,
      });
      res.json({ data });
      return;
    }

    res.status(400).json({ error: '未知数据类型' });
  } catch (error) {
    logger.error({ err: error }, 'Fetch admin data error');
    res.status(500).json({ error: '获取管理数据失败' });
  }
});

// GET /api/admin/:tab/:id - Get admin item by ID
router.get('/:tab/:id', requireAdmin, async (req, res) => {
  try {
    const tab = req.params.tab;
    const id = req.params.id;

    if (tab === 'wiki') {
      const item = await prisma.wikiPage.findUnique({ where: { id } });
      if (!item) {
        res.status(404).json({ error: '记录不存在' });
        return;
      }
      res.json({ item: toWikiResponse(item) });
      return;
    }

    if (tab === 'posts') {
      const item = await prisma.post.findUnique({ where: { id } });
      if (!item) {
        res.status(404).json({ error: '记录不存在' });
        return;
      }
      res.json({ item: toPostResponse(item) });
      return;
    }

    if (tab === 'galleries') {
      const item = await prisma.gallery.findUnique({
        where: { id },
        include: {
          images: {
            include: {
              asset: true,
            },
            orderBy: { sortOrder: 'asc' },
          },
        },
      });
      if (!item) {
        res.status(404).json({ error: '记录不存在' });
        return;
      }
      res.json({ item: await toGalleryResponse(item) });
      return;
    }

    if (tab === 'users') {
      const item = await prisma.user.findUnique({
        where: { uid: id },
        select: {
          uid: true,
          email: true,
          displayName: true,
          photoURL: true,
          role: true,
          status: true,
          banReason: true,
          bannedAt: true,
          level: true,
          bio: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!item) {
        res.status(404).json({ error: '记录不存在' });
        return;
      }
      res.json({ item: toUserResponse(item) });
      return;
    }

    if (tab === 'locks') {
      const item = await prisma.editLock.findUnique({ where: { id } });
      if (!item) {
        res.status(404).json({ error: '记录不存在' });
        return;
      }
      res.json({ item: toEditLockResponse(item) });
      return;
    }

    res.status(400).json({ error: '未知数据类型' });
  } catch (error) {
    logger.error({ err: error }, 'Fetch admin item error');
    res.status(500).json({ error: '获取详情失败' });
  }
});

// DELETE /api/admin/:tab/:id - Delete admin item
router.delete('/:tab/:id', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const tab = req.params.tab;
    const id = req.params.id;

    if (tab === 'wiki') {
      await prisma.wikiPage.delete({ where: { id } });
      res.json({ success: true });
      return;
    }
    if (tab === 'posts') {
      await prisma.post.delete({ where: { id } });
      res.json({ success: true });
      return;
    }
    if (tab === 'galleries') {
      const gallery = await prisma.gallery.findUnique({
        where: { id },
        include: { images: true },
      });
      if (!gallery) {
        res.status(404).json({ error: '图集不存在' });
        return;
      }
      await prisma.gallery.delete({ where: { id } });

      await Promise.all(
        gallery.images.map(async (image) => {
          if (image.assetId) {
            const linked = await prisma.galleryImage.count({ where: { assetId: image.assetId } });
            if (linked === 0) {
              const asset = await prisma.mediaAsset.findUnique({ where: { id: image.assetId } });
              if (asset) {
                await safeDeleteUploadFileByStorageKey(asset.storageKey);
                await prisma.mediaAsset.update({
                  where: { id: asset.id },
                  data: { status: 'deleted' },
                });
              }
            }
          } else {
            await safeDeleteUploadFileByUrl(image.url);
          }
        }),
      );
      res.json({ success: true });
      return;
    }
    if (tab === 'users') {
      const currentUser = req.authUser;
      if (currentUser?.uid === id) {
        res.status(400).json({ error: '不能删除自己' });
        return;
      }
      await prisma.user.delete({ where: { uid: id } });
      res.json({ success: true });
      return;
    }
    if (tab === 'locks') {
      await prisma.editLock.delete({ where: { id } });
      res.json({ success: true });
      return;
    }

    res.status(400).json({ error: '未知删除类型' });
  } catch (error) {
    logger.error({ err: error }, 'Delete admin data error');
    res.status(500).json({ error: '删除失败' });
  }
});

export { registerAdminRoutes };

function registerAdminRoutes(app: Router) {
  app.use('/api/admin', router);
}
