import type { Router } from 'express';
import { createRouter } from '../utils/typed-router';
import { requireAuth, requireAdmin, requireActiveUser, isAdminRole } from '../middleware/auth';
import { prisma, resolveUploadPathByUrl, softDeleteData } from '../utils';
import { isBlurhashEnabled, shouldAutoGenerate, generateBlurhashFromFile } from '../blurhashService';
import { getS3BaseUrl, getPublicConfig } from '../s3/s3Service';
import fs from 'fs';
import path from 'path';
import type { AuthenticatedRequest } from '../types';

const router = createRouter();

/**
 * Infer the correct storage type from actual URL fields.
 * The stored storageType may be stale; always derive from real data.
 */
function inferStorageType(item: {
  s3Url: string | null;
  externalUrl: string | null;
  storageType: string;
}): 'local' | 's3' | 'external' {
  if (item.s3Url) return 's3';
  if (item.externalUrl) return 'external';
  return 'local';
}

/**
 * Normalize an ImageMap record for API responses.
 * Converts dates to ISO strings and overrides storageType with inferred value.
 */
function normalizeImageMap(item: {
  id: string;
  md5: string;
  localUrl: string;
  externalUrl: string | null;
  s3Url: string | null;
  thumbnailUrl: string | null;
  storageType: string;
  blurhash: string | null;
  thumbhash: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  createdAt: Date;
}) {
  return {
    ...item,
    storageType: inferStorageType(item),
    isDeleted: Boolean(item.deletedAt),
    deletedAt: item.deletedAt ? item.deletedAt.toISOString() : null,
    deletedBy: item.deletedBy ?? null,
    createdAt: item.createdAt.toISOString(),
  };
}

// GET /api/image-maps - List image maps
router.get('/', async (req, res) => {
  try {
    const md5 = typeof req.query.md5 === 'string' ? req.query.md5 : '';

    const items = await prisma.imageMap.findMany({
      where: {
        deletedAt: null,
        ...(md5 ? { md5 } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json({
      items: items.map(normalizeImageMap),
    });
  } catch (error) {
    console.error('Fetch image maps error:', error);
    res.status(500).json({ error: '获取图片映射失败' });
  }
});

// GET /api/image-maps/export - Export image maps
router.get('/export', requireAuth, requireAdmin, async (req, res) => {
  try {
    const format = (req.query.format as string) || 'json';
    const items = await prisma.imageMap.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (format === 'csv') {
      const headers = ['id', 'md5', 'localUrl', 'externalUrl', 's3Url', 'storageType', 'createdAt'];
      const csvRows = [headers.join(',')];

      for (const item of items) {
        const row = [
          item.id,
          item.md5,
          `"${item.localUrl || ''}"`,
          `"${item.externalUrl || ''}"`,
          `"${item.s3Url || ''}"`,
          `"${inferStorageType(item)}"`,
          item.createdAt.toISOString(),
        ];
        csvRows.push(row.join(','));
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="image-maps-${Date.now()}.csv"`);
      res.send(csvRows.join('\n'));
    } else {
      res.json({
        items: items.map(normalizeImageMap),
      });
    }
  } catch (error) {
    console.error('Export image maps error:', error);
    res.status(500).json({ error: '导出图片映射失败' });
  }
});

// GET /api/image-maps/stats - Get image map statistics
router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [total, withS3, withExternal] = await Promise.all([
      prisma.imageMap.count({ where: { deletedAt: null } }),
      prisma.imageMap.count({ where: { deletedAt: null, s3Url: { not: null } } }),
      prisma.imageMap.count({ where: { deletedAt: null, externalUrl: { not: null } } }),
    ]);

    res.json({
      total,
      stats: {
        s3: withS3,
        external: withExternal,
        local: total - withS3 - withExternal,
      },
    });
  } catch (error) {
    console.error('Get image map stats error:', error);
    res.status(500).json({ error: '获取图片统计失败' });
  }
});

// POST /api/image-maps/import - Import image maps
router.post('/import', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { items, mode } = req.body as {
      items: Array<{
        id?: string;
        md5?: string;
        localUrl?: string;
        externalUrl?: string;
        s3Url?: string;
        storageType?: 'local' | 'external' | 's3';
      }>;
      mode: 'update' | 'create' | 'upsert';
    };

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: '缺少导入数据' });
      return;
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const item of items) {
      try {
        if (item.storageType === 's3' && !item.s3Url) {
          results.failed++;
          results.errors.push(`S3 存储类型需要提供 s3Url: ${JSON.stringify(item)}`);
          continue;
        }

        if (mode === 'upsert' && item.md5) {
          const existing = await prisma.imageMap.findUnique({
            where: { md5: item.md5 },
          });

          if (existing) {
            await prisma.imageMap.update({
              where: { id: existing.id },
              data: {
                ...(item.localUrl !== undefined && { localUrl: item.localUrl || null }),
                ...(item.externalUrl !== undefined && { externalUrl: item.externalUrl || null }),
                ...(item.s3Url !== undefined && { s3Url: item.s3Url || null }),
                ...(item.storageType !== undefined && { storageType: item.storageType }),
              },
            });
          } else if (item.id) {
            await prisma.imageMap.create({
              data: {
                id: item.id,
                md5: item.md5 || crypto.randomUUID(),
                ...(item.localUrl && { localUrl: item.localUrl }),
                ...(item.externalUrl && { externalUrl: item.externalUrl }),
                ...(item.s3Url && { s3Url: item.s3Url }),
                ...(item.storageType && { storageType: item.storageType }),
              },
            });
          }
          results.success++;
        } else if (mode === 'update' && item.id) {
          await prisma.imageMap.update({
            where: { id: item.id },
            data: {
              ...(item.localUrl !== undefined && { localUrl: item.localUrl || null }),
              ...(item.externalUrl !== undefined && { externalUrl: item.externalUrl || null }),
              ...(item.s3Url !== undefined && { s3Url: item.s3Url || null }),
              ...(item.storageType !== undefined && { storageType: item.storageType }),
            },
          });
          results.success++;
        } else if (mode === 'create' && item.id && item.md5) {
          await prisma.imageMap.create({
            data: {
              id: item.id,
              md5: item.md5,
              ...(item.localUrl && { localUrl: item.localUrl }),
              ...(item.externalUrl && { externalUrl: item.externalUrl }),
              ...(item.s3Url && { s3Url: item.s3Url }),
              ...(item.storageType && { storageType: item.storageType }),
            },
          });
          results.success++;
        } else {
          results.failed++;
          results.errors.push(`数据格式错误：${JSON.stringify(item)}`);
        }
      } catch (err) {
        results.failed++;
        results.errors.push(`处理失败：${JSON.stringify(item)} - ${(err as Error).message}`);
      }
    }

    res.json(results);
  } catch (error) {
    console.error('Import image maps error:', error);
    res.status(500).json({ error: '导入图片映射失败' });
  }
});

// POST /api/image-maps/refresh-all-blurhash - Refresh all blurhash
router.post('/refresh-all-blurhash', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { limit = '100' } = req.query as { limit?: string };

    const limitNum = parseInt(limit, 10) || 100;

    const imageMaps = await prisma.imageMap.findMany({
      where: {
        deletedAt: null,
        OR: [
          { blurhash: null },
          { thumbhash: null },
        ],
      },
      take: limitNum,
    });

    if (imageMaps.length === 0) {
      res.json({
        success: true,
        message: '没有需要刷新 blurhash 的图片',
        processed: 0,
      });
      return;
    }

    let processed = 0;
    let failed = 0;

    for (const imageMap of imageMaps) {
      // Prioritize localUrl for file-based blurhash generation
      const filePath = resolveUploadPathByUrl(imageMap.localUrl);

      if (!filePath) {
        continue;
      }

      try {
        const blurhash = await generateBlurhashFromFile(filePath);

        await prisma.imageMap.update({
          where: { id: imageMap.id },
          data: {
            ...(blurhash && { blurhash }),
          },
        });

        processed++;
        console.log(`[Refresh All Blurhash] Processed ${processed}/${imageMaps.length}:`, imageMap.id);
      } catch (err) {
        failed++;
        console.error(`[Refresh All Blurhash] Failed for ${imageMap.id}:`, err);
      }
    }

    res.json({
      success: true,
      processed,
      failed,
      total: imageMaps.length,
    });
  } catch (error) {
    console.error('Refresh all blurhash error:', error);
    res.status(500).json({ error: '刷新 blurhash 失败' });
  }
});

// GET /api/image-maps/:id - Get image map by ID
router.get('/:id', async (req, res) => {
  try {
    const item = await prisma.imageMap.findUnique({
      where: { id: req.params.id },
    });

    if (!item) {
      res.status(404).json({ error: '图片映射不存在' });
      return;
    }

    res.json({
      item: normalizeImageMap(item),
    });
  } catch (error) {
    console.error('Fetch image map detail error:', error);
    res.status(500).json({ error: '获取图片映射失败' });
  }
});

// POST /api/image-maps - Create image map
router.post('/', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { id, md5, localUrl, externalUrl, s3Url, storageType } = req.body as {
      id?: string;
      md5?: string;
      localUrl?: string;
      externalUrl?: string;
      s3Url?: string;
      storageType?: 'local' | 'external' | 's3';
    };

    if (!id || !md5) {
      res.status(400).json({ error: '缺少必要字段' });
      return;
    }

    let blurhash: string | undefined;
    let thumbhash: string | undefined;

    // Try to generate blurhash from local file path first
    const filePath = resolveUploadPathByUrl(localUrl);
    if (filePath && isBlurhashEnabled() && shouldAutoGenerate()) {
      try {
        console.log('[ImageMap] Auto-generating blurhash from local file:', filePath);

        blurhash = await generateBlurhashFromFile(filePath);

        if (blurhash) {
          console.log('[ImageMap] Blurhash generated:', blurhash.substring(0, 20) + '...');
        }
      } catch (hashError) {
        console.error('[ImageMap] Failed to generate blurhash from local file:', hashError);
      }
    }

    const existing = await prisma.imageMap.findUnique({
      where: { id },
      select: {
        id: true,
        md5: true,
        localUrl: true,
        s3Url: true,
        externalUrl: true,
        storageType: true,
      },
    });
    if (existing) {
      if (existing.md5 !== md5) {
        res.status(409).json({ error: '图片映射已存在且与当前图片不匹配' });
        return;
      }

      if (!isAdminRole(req.authUser?.role)) {
        res.status(403).json({ error: '需要管理员权限' });
        return;
      }

      const item = await prisma.imageMap.update({
        where: { id },
        data: {
          ...(localUrl !== undefined && { localUrl: localUrl || null }),
          ...(externalUrl !== undefined && { externalUrl: externalUrl || null }),
          ...(s3Url !== undefined && { s3Url: s3Url || null }),
          ...(storageType !== undefined && { storageType }),
          ...(blurhash !== undefined && { blurhash: blurhash || null }),
          ...(thumbhash !== undefined && { thumbhash: thumbhash || null }),
        },
      });

      res.json({
        item: {
          ...item,
          createdAt: item.createdAt.toISOString(),
        },
      });
      return;
    }

    const item = await prisma.imageMap.create({
      data: {
        id,
        md5,
        ...(localUrl && { localUrl }),
        ...(externalUrl && { externalUrl }),
        ...(s3Url && { s3Url }),
        ...(storageType && { storageType }),
        ...(blurhash && { blurhash }),
        ...(thumbhash && { thumbhash }),
      },
    });

    res.status(201).json({
      item: {
        ...item,
        createdAt: item.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Create image map error:', error);
    res.status(500).json({ error: '保存图片映射失败' });
  }
});

// PATCH /api/image-maps/:id - Update image map
router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { localUrl, externalUrl, s3Url, storageType, blurhash, thumbhash } = req.body as {
      localUrl?: string | null;
      externalUrl?: string | null;
      s3Url?: string | null;
      storageType?: 'local' | 'external' | 's3';
      blurhash?: string | null;
      thumbhash?: string | null;
    };

    const item = await prisma.imageMap.update({
      where: { id: req.params.id },
      data: {
        ...(localUrl !== undefined && { localUrl: localUrl || null }),
        ...(externalUrl !== undefined && { externalUrl: externalUrl || null }),
        ...(s3Url !== undefined && { s3Url: s3Url || null }),
        ...(storageType !== undefined && { storageType }),
        ...(blurhash !== undefined && { blurhash: blurhash || null }),
        ...(thumbhash !== undefined && { thumbhash: thumbhash || null }),
      },
    });

    res.json({
      item: normalizeImageMap(item),
    });
  } catch (error) {
    console.error('Update image map error:', error);
    res.status(500).json({ error: '更新图片映射失败' });
  }
});

// DELETE /api/image-maps/:id - Delete image map
router.delete('/:id', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const existing = await prisma.imageMap.findUnique({
      where: { id: req.params.id },
      select: { id: true, deletedAt: true },
    });

    if (!existing || existing.deletedAt) {
      res.status(404).json({ error: '图片映射不存在' });
      return;
    }

    await prisma.imageMap.update({
      where: { id: req.params.id },
      data: softDeleteData(req.authUser!.uid),
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete image map error:', error);
    res.status(500).json({ error: '删除图片映射失败' });
  }
});

// POST /api/image-maps/:id/refresh-blurhash - Refresh blurhash for specific image map
router.post('/:id/refresh-blurhash', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const imageMap = await prisma.imageMap.findUnique({
      where: { id },
    });

    if (!imageMap) {
      res.status(404).json({ error: '图片映射不存在' });
      return;
    }

    // Use localUrl to generate blurhash from local file
    const filePath = resolveUploadPathByUrl(imageMap.localUrl);

    if (!filePath) {
      res.status(400).json({ error: '没有可用的本地图片路径' });
      return;
    }

    try {
      console.log('[Refresh Blurhash] Refreshing blurhash from local file:', filePath);

      const blurhash = await generateBlurhashFromFile(filePath);

      const updatedItem = await prisma.imageMap.update({
        where: { id },
        data: {
          ...(blurhash && { blurhash }),
        },
      });

      res.json({
        success: true,
        item: normalizeImageMap(updatedItem),
      });
    } catch (hashError) {
      console.error('[Refresh Blurhash] Failed to generate blurhash:', hashError);
      res.status(500).json({ error: '生成 blurhash 失败' });
    }
  } catch (error) {
    console.error('Refresh blurhash error:', error);
    res.status(500).json({ error: '刷新 blurhash 失败' });
  }
});

// POST /api/image-maps/migrate-to-s3 - Migrate local images to S3
router.post('/migrate-to-s3', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { limit = '100' } = req.query as { limit?: string };
    const limitNum = Math.max(1, Math.min(1000, parseInt(limit, 10) || 100));

    // Check if S3 is enabled
    const s3Config = getPublicConfig();
    if (!s3Config.enabled) {
      res.status(400).json({ error: 'S3 存储未启用，请先配置 S3' });
      return;
    }

    // Query all ImageMap records where s3Url is null
    const imageMaps = await prisma.imageMap.findMany({
      where: {
        deletedAt: null,
        s3Url: null,
      },
      take: limitNum,
      orderBy: { createdAt: 'asc' },
    });

    if (imageMaps.length === 0) {
      res.json({
        success: true,
        message: '没有需要迁移到 S3 的图片',
        total: 0,
        processed: 0,
        failed: 0,
        errors: [],
      });
      return;
    }

    const total = imageMaps.length;
    const processed: number[] = [];
    const errors: string[] = [];

    for (const imageMap of imageMaps) {
      try {
        // Convert localUrl to absolute file path
        const filePath = resolveUploadPathByUrl(imageMap.localUrl);

        if (!filePath) {
          errors.push(`无法解析本地路径: ${imageMap.id} (${imageMap.localUrl})`);
          continue;
        }

        // Check if file exists
        if (!fs.existsSync(filePath)) {
          errors.push(`本地文件不存在: ${imageMap.id} (${filePath})`);
          continue;
        }

        // Read the file
        const fileBuffer = await fs.promises.readFile(filePath);

        // Generate object key from localUrl
        const relativePath = imageMap.localUrl!.slice('/uploads/'.length);
        const objectKey = `images/${relativePath}`;

        // Detect content type from extension
        const ext = path.extname(filePath).toLowerCase();
        const contentTypeMap: Record<string, string> = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.webp': 'image/webp',
          '.gif': 'image/gif',
          '.bmp': 'image/bmp',
        };
        const contentType = contentTypeMap[ext] || 'application/octet-stream';

        // Upload to S3
        const { uploadFileToS3 } = await import('../utils');
        const s3Result = await uploadFileToS3(filePath, objectKey, contentType);

        if (!s3Result.success || !s3Result.url) {
          errors.push(`S3 上传失败: ${imageMap.id} - ${s3Result.error}`);
          continue;
        }

        // Generate blurhash from local file
        let blurhash: string | undefined;
        if (isBlurhashEnabled() && shouldAutoGenerate()) {
          try {
            blurhash = await generateBlurhashFromFile(filePath);
          } catch (blurhashError) {
            console.error(`[Migrate to S3] Blurhash generation failed for ${imageMap.id}:`, blurhashError);
          }
        }

        // Update the ImageMap with s3Url and blurhash
        await prisma.imageMap.update({
          where: { id: imageMap.id },
          data: {
            s3Url: s3Result.url,
            storageType: 's3',
            ...(blurhash && { blurhash }),
          },
        });

        processed.push(processed.length + 1);
        console.log(`[Migrate to S3] Processed ${processed.length}/${total}:`, imageMap.id);
      } catch (err) {
        errors.push(`处理失败: ${imageMap.id} - ${(err as Error).message}`);
        console.error(`[Migrate to S3] Error for ${imageMap.id}:`, err);
      }
    }

    res.json({
      success: true,
      total,
      processed: processed.length,
      failed: total - processed.length,
      errors,
    });
  } catch (error) {
    console.error('Migrate to S3 error:', error);
    res.status(500).json({ error: '迁移到 S3 失败' });
  }
});

export function registerImageMapsRoutes(app: Router) {
  app.use('/api/image-maps', router);
}
