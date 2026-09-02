import type { Router } from 'express'
import { createRouter } from '../utils/typed-router'
import { Prisma } from '@prisma/client'
import { requireAuth, requireAdmin } from '../middleware/auth'
import {
  prisma,
  resolveUploadPathByUrl,
  softDeleteData,
  parsePagination,
  createPaginationMeta,
} from '../utils'
import { isBlurhashEnabled, shouldAutoGenerate, generateBlurhashFromFile } from '../blurhashService'
import { getPublicConfig } from '../s3/s3Service'
import fs from 'fs'
import path from 'path'
import type { AuthenticatedRequest } from '../types'
import {
  collectMediaReferences,
  ensureImageMapStorage,
  getMediaRetiredAt,
  isMediaReferenced,
  MediaAssetRequestError,
} from '../services/mediaAssetService'

const router = createRouter()

/**
 * Infer the correct storage type from actual URL fields.
 * The stored storageType may be stale; always derive from real data.
 */
function inferStorageType(item: {
  localUrl: string
  s3Url: string | null
  externalUrl: string | null
  storageType: string
}): 'local' | 's3' | 'external' {
  if (item.storageType === 'external' && item.externalUrl) return 'external'
  if (item.storageType === 's3' && item.s3Url) return 's3'
  if (item.storageType === 'local' && item.localUrl) return 'local'
  if (item.s3Url) return 's3'
  if (item.externalUrl) return 'external'
  return 'local'
}

/**
 * Normalize an ImageMap record for API responses.
 * Converts dates to ISO strings and overrides storageType with inferred value.
 */
function normalizeImageMap(item: {
  id: string
  md5: string
  localUrl: string
  externalUrl: string | null
  s3Url: string | null
  thumbnailUrl: string | null
  storageType: string
  blurhash: string | null
  thumbhash: string | null
  deletedAt?: Date | null
  deletedBy?: string | null
  createdAt: Date
}) {
  return {
    ...item,
    storageType: inferStorageType(item),
    isDeleted: Boolean(item.deletedAt),
    deletedAt: item.deletedAt ? item.deletedAt.toISOString() : null,
    deletedBy: item.deletedBy ?? null,
    createdAt: item.createdAt.toISOString(),
  }
}

// GET /api/image-maps - List image maps
router.get('/', async (req, res) => {
  try {
    const md5 = typeof req.query.md5 === 'string' ? req.query.md5 : ''
    const { limit, page, offset: skip } = parsePagination(req.query)
    const where = {
      deletedAt: null,
      ...(md5 ? { md5 } : {}),
    }
    const [items, total] = await Promise.all([
      prisma.imageMap.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      prisma.imageMap.count({ where }),
    ])

    res.json({
      items: items.map(normalizeImageMap),
      ...createPaginationMeta(total, page, limit, items.length),
    })
  } catch (error) {
    console.error('Fetch image maps error:', error)
    res.status(500).json({ error: '获取图片映射失败' })
  }
})

// GET /api/image-maps/export - Export image maps
router.get('/export', requireAuth, requireAdmin, async (req, res) => {
  try {
    const format = (req.query.format as string) || 'json'
    const items = await prisma.imageMap.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    })

    if (format === 'csv') {
      const headers = ['id', 'md5', 'localUrl', 'externalUrl', 's3Url', 'storageType', 'createdAt']
      const csvRows = [headers.join(',')]

      for (const item of items) {
        const row = [
          item.id,
          item.md5,
          `"${item.localUrl || ''}"`,
          `"${item.externalUrl || ''}"`,
          `"${item.s3Url || ''}"`,
          `"${inferStorageType(item)}"`,
          item.createdAt.toISOString(),
        ]
        csvRows.push(row.join(','))
      }

      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', `attachment; filename="image-maps-${Date.now()}.csv"`)
      res.send(csvRows.join('\n'))
    } else {
      res.json({
        items: items.map(normalizeImageMap),
      })
    }
  } catch (error) {
    console.error('Export image maps error:', error)
    res.status(500).json({ error: '导出图片映射失败' })
  }
})

// GET /api/image-maps/stats - Get image map statistics
router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [total, withS3, withExternal] = await Promise.all([
      prisma.imageMap.count({ where: { deletedAt: null } }),
      prisma.imageMap.count({ where: { deletedAt: null, s3Url: { not: null } } }),
      prisma.imageMap.count({ where: { deletedAt: null, externalUrl: { not: null } } }),
    ])

    res.json({
      total,
      stats: {
        s3: withS3,
        external: withExternal,
        local: total - withS3 - withExternal,
      },
    })
  } catch (error) {
    console.error('Get image map stats error:', error)
    res.status(500).json({ error: '获取图片统计失败' })
  }
})

// POST /api/image-maps/import - Import image maps
router.post('/import', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { items, mode } = req.body as {
      items?: Array<{
        id?: string
        md5?: string
        localUrl?: string
        externalUrl?: string
        s3Url?: string
        storageType?: 'local' | 'external' | 's3'
      }>
      mode?: 'update' | 'create' | 'upsert'
    }
    if (!Array.isArray(items) || !items.length || !mode) {
      res.status(400).json({ error: '缺少导入数据或模式' })
      return
    }

    const results = { success: 0, failed: 0, errors: [] as string[] }
    for (const item of items) {
      try {
        const md5 = item.md5?.toLowerCase()
        if (!md5 || !/^[a-f0-9]{32}$/.test(md5)) {
          throw new Error('md5 必须是 32 位十六进制字符串')
        }
        if (typeof item.localUrl !== 'string' || !item.localUrl.trim()) {
          throw new Error('localUrl 不能为空')
        }
        if (item.storageType === 's3' && !item.s3Url) throw new Error('S3 存储类型需要提供 s3Url')
        if (item.storageType === 'external' && !item.externalUrl) {
          throw new Error('外部存储类型需要提供 externalUrl')
        }
        if (mode !== 'upsert' && !item.id) throw new Error('该模式需要提供 id')

        if (mode === 'create') {
          const conflict = await prisma.imageMap.findFirst({
            where: { OR: [{ id: item.id }, { md5 }] },
            select: { id: true },
          })
          if (conflict) throw new Error(`create 冲突：${conflict.id}`)
          await prisma.imageMap.create({
            data: {
              id: item.id!,
              md5,
              localUrl: item.localUrl.trim(),
              externalUrl: item.externalUrl || null,
              s3Url: item.s3Url || null,
              storageType: item.storageType || 'local',
            },
          })
        } else if (mode === 'update') {
          const existing = await prisma.imageMap.findUnique({ where: { id: item.id! } })
          if (!existing) throw new Error(`记录不存在：${item.id}`)
          if (existing.md5 !== md5) throw new Error('md5 与现有记录不匹配')
          await prisma.imageMap.update({
            where: { id: item.id! },
            data: {
              localUrl: item.localUrl.trim(),
              externalUrl: item.externalUrl || null,
              s3Url: item.s3Url || null,
              storageType: item.storageType || existing.storageType,
              deletedAt: null,
              deletedBy: null,
              retiredAt: null,
            },
          })
        } else {
          await prisma.imageMap.upsert({
            where: { md5 },
            update: {
              localUrl: item.localUrl.trim(),
              externalUrl: item.externalUrl || null,
              s3Url: item.s3Url || null,
              ...(item.storageType ? { storageType: item.storageType } : {}),
              deletedAt: null,
              deletedBy: null,
              retiredAt: null,
            },
            create: {
              id: item.id || crypto.randomUUID(),
              md5,
              localUrl: item.localUrl.trim(),
              externalUrl: item.externalUrl || null,
              s3Url: item.s3Url || null,
              storageType: item.storageType || 'local',
            },
          })
        }
        results.success++
      } catch (error) {
        results.failed++
        results.errors.push(
          `${JSON.stringify(item)}：${error instanceof Error ? error.message : '未知错误'}`
        )
      }
    }
    res.json(results)
  } catch (error) {
    console.error('Import image maps error:', error)
    res.status(500).json({ error: '导入图片映射失败' })
  }
})

// POST /api/image-maps/refresh-all-blurhash - Refresh all blurhash
router.post('/refresh-all-blurhash', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { limit = '100' } = req.query as { limit?: string }

    const limitNum = parseInt(limit, 10) || 100

    const imageMaps = await prisma.imageMap.findMany({
      where: {
        deletedAt: null,
        OR: [{ blurhash: null }, { thumbhash: null }],
      },
      take: limitNum,
    })

    if (imageMaps.length === 0) {
      res.json({
        success: true,
        message: '没有需要刷新 blurhash 的图片',
        processed: 0,
      })
      return
    }

    let processed = 0
    let failed = 0

    for (const imageMap of imageMaps) {
      // Prioritize localUrl for file-based blurhash generation
      const filePath = resolveUploadPathByUrl(imageMap.localUrl)

      if (!filePath) {
        continue
      }

      try {
        const blurhash = await generateBlurhashFromFile(filePath)

        await prisma.imageMap.update({
          where: { id: imageMap.id },
          data: {
            ...(blurhash && { blurhash }),
          },
        })

        processed++
        console.log(
          `[Refresh All Blurhash] Processed ${processed}/${imageMaps.length}:`,
          imageMap.id
        )
      } catch (err) {
        failed++
        console.error(`[Refresh All Blurhash] Failed for ${imageMap.id}:`, err)
      }
    }

    res.json({
      success: true,
      processed,
      failed,
      total: imageMaps.length,
    })
  } catch (error) {
    console.error('Refresh all blurhash error:', error)
    res.status(500).json({ error: '刷新 blurhash 失败' })
  }
})

// GET /api/image-maps/:id - Get image map by ID
router.get('/:id', async (req, res) => {
  try {
    const item = await prisma.imageMap.findUnique({
      where: { id: req.params.id },
    })

    if (!item) {
      res.status(404).json({ error: '图片映射不存在' })
      return
    }

    res.json({
      item: normalizeImageMap(item),
    })
  } catch (error) {
    console.error('Fetch image map detail error:', error)
    res.status(500).json({ error: '获取图片映射失败' })
  }
})

// POST /api/image-maps - Create image map
router.post('/', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { id, md5, localUrl, externalUrl, s3Url, storageType } = req.body as {
      id?: string
      md5?: string
      localUrl?: string
      externalUrl?: string
      s3Url?: string
      storageType?: 'local' | 'external' | 's3'
    }
    if (!id || !md5 || !/^[a-f0-9]{32}$/i.test(md5) || !localUrl?.trim()) {
      res.status(400).json({ error: 'id、32 位 md5 和非空 localUrl 为必填字段' })
      return
    }
    if (storageType === 's3' && !s3Url) {
      res.status(400).json({ error: 'S3 存储类型需要提供 s3Url' })
      return
    }
    if (storageType === 'external' && !externalUrl) {
      res.status(400).json({ error: '外部存储类型需要提供 externalUrl' })
      return
    }

    const existing = await prisma.imageMap.findFirst({
      where: { OR: [{ id }, { md5: md5.toLowerCase() }] },
      select: { id: true, md5: true },
    })
    if (existing) {
      res.status(409).json({ error: '图片映射已存在，请使用管理员导入或更新接口' })
      return
    }

    let blurhash: string | undefined
    const filePath = resolveUploadPathByUrl(localUrl)
    if (filePath && isBlurhashEnabled() && shouldAutoGenerate()) {
      try {
        blurhash = await generateBlurhashFromFile(filePath)
      } catch (error) {
        console.error('[ImageMap] Failed to generate blurhash:', error)
      }
    }
    const item = await prisma.imageMap.create({
      data: {
        id,
        md5: md5.toLowerCase(),
        localUrl: localUrl.trim(),
        externalUrl: externalUrl || null,
        s3Url: s3Url || null,
        storageType: storageType || 'local',
        ...(blurhash ? { blurhash } : {}),
      },
    })
    res.status(201).json({ item: normalizeImageMap(item) })
  } catch (error) {
    console.error('Create image map error:', error)
    res.status(500).json({ error: '保存图片映射失败' })
  }
})

router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { localUrl, externalUrl, s3Url, storageType, blurhash, thumbhash } = req.body as {
      localUrl?: string | null
      externalUrl?: string | null
      s3Url?: string | null
      storageType?: 'local' | 'external' | 's3'
      blurhash?: string | null
      thumbhash?: string | null
    }
    if (localUrl !== undefined && !localUrl?.trim()) {
      res.status(400).json({ error: 'localUrl 不能为空' })
      return
    }

    const item = await prisma.$transaction(async (tx) => {
      let existing = await tx.imageMap.findUnique({ where: { id: req.params.id } })
      if (!existing) throw new MediaAssetRequestError(404, '图片映射不存在')
      const changesPhysicalStorage =
        localUrl !== undefined ||
        externalUrl !== undefined ||
        s3Url !== undefined ||
        storageType !== undefined
      if (changesPhysicalStorage) {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${existing.md5}, 0))`
        )
        existing = await tx.imageMap.findUnique({ where: { id: existing.id } })
        if (!existing) throw new MediaAssetRequestError(404, '图片映射不存在')
        const effectiveLocalUrl = localUrl === undefined ? existing.localUrl : localUrl.trim()
        const effectiveS3Url = s3Url === undefined ? existing.s3Url : s3Url || null
        const effectiveExternalUrl =
          externalUrl === undefined ? existing.externalUrl : externalUrl || null
        const effectiveStorageType = storageType || existing.storageType
        if (effectiveStorageType === 's3' && !effectiveS3Url) {
          throw new MediaAssetRequestError(400, 'S3 存储类型需要提供 s3Url')
        }
        if (effectiveStorageType === 'external' && !effectiveExternalUrl) {
          throw new MediaAssetRequestError(400, '外部存储类型需要提供 externalUrl')
        }
        if (effectiveStorageType === 'local' && !effectiveLocalUrl) {
          throw new MediaAssetRequestError(400, '本地存储类型需要提供 localUrl')
        }
        const [activeClaims, references] = await Promise.all([
          tx.mediaAsset.count({
            where: { imageMapId: existing.id, status: { in: ['uploaded', 'ready'] } },
          }),
          collectMediaReferences(),
        ])
        if (
          activeClaims > 0 ||
          isMediaReferenced(references, {
            urls: [existing.localUrl, existing.s3Url, existing.externalUrl],
          }) ||
          existing.variantStatus === 'processing'
        ) {
          throw new MediaAssetRequestError(
            409,
            '图片映射仍有引用、活跃资源或变体任务，不能修改存储位置'
          )
        }
        return tx.imageMap.update({
          where: { id: existing.id },
          data: {
            localUrl: effectiveLocalUrl,
            s3Url: effectiveS3Url,
            externalUrl: effectiveExternalUrl,
            storageType: effectiveStorageType,
            ...(blurhash !== undefined ? { blurhash: blurhash || null } : {}),
            ...(thumbhash !== undefined ? { thumbhash: thumbhash || null } : {}),
          },
        })
      }
      return tx.imageMap.update({
        where: { id: existing.id },
        data: {
          ...(blurhash !== undefined ? { blurhash: blurhash || null } : {}),
          ...(thumbhash !== undefined ? { thumbhash: thumbhash || null } : {}),
        },
      })
    })
    res.json({ item: normalizeImageMap(item) })
  } catch (error) {
    if (error instanceof MediaAssetRequestError) {
      res.status(error.statusCode).json({ error: error.message })
      return
    }
    console.error('Update image map error:', error)
    res.status(500).json({ error: '更新图片映射失败' })
  }
})

router.delete('/:id', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.imageMap.findUnique({ where: { id: req.params.id } })
      if (!existing || existing.deletedAt) {
        throw new MediaAssetRequestError(404, '图片映射不存在')
      }
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${existing.md5}, 0))`
      )
      const locked = await tx.imageMap.findUnique({ where: { id: existing.id } })
      if (!locked || locked.deletedAt) {
        throw new MediaAssetRequestError(404, '图片映射不存在')
      }
      const [activeClaims, references] = await Promise.all([
        tx.mediaAsset.count({
          where: { imageMapId: locked.id, status: { in: ['uploaded', 'ready'] } },
        }),
        collectMediaReferences(),
      ])
      if (
        activeClaims > 0 ||
        isMediaReferenced(references, {
          urls: [locked.localUrl, locked.s3Url, locked.externalUrl],
        }) ||
        locked.variantStatus === 'processing'
      ) {
        throw new MediaAssetRequestError(409, '图片映射仍有引用、活跃资源或变体任务，不能删除')
      }
      await tx.imageMap.update({
        where: { id: locked.id },
        data: { ...softDeleteData(req.authUser!.uid), retiredAt: getMediaRetiredAt() },
      })
      await tx.moderationLog.create({
        data: {
          targetType: 'imageMap',
          targetId: locked.id,
          action: 'delete',
          operatorUid: req.authUser!.uid,
          note: null,
        },
      })
    })
    res.json({ success: true })
  } catch (error) {
    if (error instanceof MediaAssetRequestError) {
      res.status(error.statusCode).json({ error: error.message })
      return
    }
    console.error('Delete image map error:', error)
    res.status(500).json({ error: '删除图片映射失败' })
  }
})

router.post('/:id/refresh-blurhash', requireAuth, requireAdmin, async (req, res) => {
  try {
    const imageMap = await prisma.imageMap.findUnique({ where: { id: req.params.id } })
    if (!imageMap) {
      res.status(404).json({ error: '图片映射不存在' })
      return
    }
    const filePath = resolveUploadPathByUrl(imageMap.localUrl)
    if (!filePath) {
      res.status(400).json({ error: '没有可用的本地图片路径' })
      return
    }
    try {
      const blurhash = await generateBlurhashFromFile(filePath)
      const updatedItem = await prisma.imageMap.update({
        where: { id: imageMap.id },
        data: blurhash ? { blurhash } : {},
      })
      res.json({ success: true, item: normalizeImageMap(updatedItem) })
    } catch (error) {
      console.error('[Refresh Blurhash] Failed:', error)
      res.status(500).json({ error: '生成 blurhash 失败' })
    }
  } catch (error) {
    console.error('Refresh blurhash error:', error)
    res.status(500).json({ error: '刷新 blurhash 失败' })
  }
})

// POST /api/image-maps/migrate-to-s3 - Migrate local images to S3
router.post('/migrate-to-s3', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { limit = '100' } = req.query as { limit?: string }
    const limitNum = Math.max(1, Math.min(1000, parseInt(limit, 10) || 100))

    // Check if S3 is enabled
    const s3Config = getPublicConfig()
    if (!s3Config.enabled) {
      res.status(400).json({ error: 'S3 存储未启用，请先配置 S3' })
      return
    }

    // Query all ImageMap records where s3Url is null
    const imageMaps = await prisma.imageMap.findMany({
      where: {
        deletedAt: null,
        s3Url: null,
      },
      take: limitNum,
      orderBy: { createdAt: 'asc' },
    })

    if (imageMaps.length === 0) {
      res.json({
        success: true,
        message: '没有需要迁移到 S3 的图片',
        total: 0,
        processed: 0,
        failed: 0,
        errors: [],
      })
      return
    }

    const total = imageMaps.length
    const processed: number[] = []
    const errors: string[] = []

    for (const imageMap of imageMaps) {
      try {
        // Convert localUrl to absolute file path
        const filePath = resolveUploadPathByUrl(imageMap.localUrl)

        if (!filePath) {
          errors.push(`无法解析本地路径: ${imageMap.id} (${imageMap.localUrl})`)
          continue
        }

        // Check if file exists
        if (!fs.existsSync(filePath)) {
          errors.push(`本地文件不存在: ${imageMap.id} (${filePath})`)
          continue
        }

        const ext = path.extname(filePath).toLowerCase()
        const contentTypeMap: Record<string, string> = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.webp': 'image/webp',
          '.gif': 'image/gif',
          '.bmp': 'image/bmp',
        }
        const contentType = contentTypeMap[ext] || 'application/octet-stream'
        const syncResult = await ensureImageMapStorage(imageMap.id, 's3', {
          sourceFilePath: filePath,
          sourceFileName: path.basename(filePath),
          sourceMimeType: contentType,
        })
        if (syncResult.errors.length > 0) {
          errors.push(`S3 上传失败: ${imageMap.id} - ${syncResult.errors.join('; ')}`)
          continue
        }

        let blurhash: string | undefined
        if (isBlurhashEnabled() && shouldAutoGenerate()) {
          try {
            blurhash = await generateBlurhashFromFile(filePath)
          } catch (blurhashError) {
            console.error(
              `[Migrate to S3] Blurhash generation failed for ${imageMap.id}:`,
              blurhashError
            )
          }
        }
        if (blurhash) {
          await prisma.imageMap.update({ where: { id: imageMap.id }, data: { blurhash } })
        }
        processed.push(processed.length + 1)
        console.log(`[Migrate to S3] Processed ${processed.length}/${total}:`, imageMap.id)
      } catch (err) {
        errors.push(`处理失败: ${imageMap.id} - ${(err as Error).message}`)
        console.error(`[Migrate to S3] Error for ${imageMap.id}:`, err)
      }
    }

    res.json({
      success: true,
      total,
      processed: processed.length,
      failed: total - processed.length,
      errors,
    })
  } catch (error) {
    console.error('Migrate to S3 error:', error)
    res.status(500).json({ error: '迁移到 S3 失败' })
  }
})

export function registerImageMapsRoutes(app: Router) {
  app.use('/api/image-maps', router)
}
