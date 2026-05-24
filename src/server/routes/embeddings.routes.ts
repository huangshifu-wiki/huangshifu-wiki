import { Router } from 'express';
import { requireAdmin, type AuthenticatedRequest } from '../middleware/auth';
import { parseInteger, parseBoolean, doesPublicTableExist, isPrismaTableMissingError } from '../utils';
import { prisma } from '../prisma';
import { getEmbeddingModelName, getEmbeddingVectorSize, getModelCacheDir, isImageModelLoaded, isTextModelLoaded, isTokenizerLoaded, getModelLoadError, isModelScopeActive, getActualDtype } from '../vector/clipEmbedding';
import { getQdrantCollectionName, getTextCollectionName } from '../vector/qdrantService';
import { enqueueMissingImageEmbeddings, syncImageEmbeddingBatch } from '../vector/embeddingSync';
import {
  enqueueMissingWikiImageEmbeddings,
  enqueueMissingPostImageEmbeddings,
  enqueueWikiImageEmbeddings,
  enqueuePostImageEmbeddings,
  syncWikiImageEmbeddingBatch,
  syncPostImageEmbeddingBatch,
} from '../vector/wikiPostEmbedding';
import {
  enqueueMissingTextEmbeddings,
  enqueueWikiTextEmbeddings,
  enqueuePostTextEmbeddings,
  enqueueMusicTextEmbeddings,
  enqueueAlbumTextEmbeddings,
  syncTextEmbeddingBatch,
  retryFailedTextEmbeddings,
  rebuildAllTextEmbeddings,
} from '../vector/textEmbeddingSync';

const router = Router();

const IMAGE_EMBEDDING_BATCH_SIZE = Math.max(1, Number(process.env.IMAGE_EMBEDDING_BATCH_SIZE || 100));

type EmbeddingType = 'gallery' | 'wiki' | 'post' | 'all';
type EmbeddingStatusKey = 'pending' | 'processing' | 'ready' | 'failed'
type EmbeddingSummary = { pending: number; processing: number; ready: number; failed: number; total: number }
type ImageSummaryKey = 'gallery' | 'wiki' | 'post'
type ImageSummary = Record<ImageSummaryKey, EmbeddingSummary>
type ImageSourceAvailability = Record<ImageSummaryKey, boolean>
type TextSummarySourceType = 'wiki' | 'post' | 'music' | 'album'
type TextSummary = Record<TextSummarySourceType, EmbeddingSummary>

const EMBEDDING_STATUSES: EmbeddingStatusKey[] = ['pending', 'processing', 'ready', 'failed']
const TEXT_SOURCE_TYPES: TextSummarySourceType[] = ['wiki', 'post', 'music', 'album']
const EMPTY_SUMMARY: EmbeddingSummary = { pending: 0, processing: 0, ready: 0, failed: 0, total: 0 }

function createEmptySummary(): EmbeddingSummary {
  return { ...EMPTY_SUMMARY }
}

function createEmptyTextSummary(): TextSummary {
  return {
    wiki: createEmptySummary(),
    post: createEmptySummary(),
    music: createEmptySummary(),
    album: createEmptySummary(),
  }
}

function createEmptyImageSummary(): ImageSummary {
  return {
    gallery: createEmptySummary(),
    wiki: createEmptySummary(),
    post: createEmptySummary(),
  }
}

function createDefaultImageSourceAvailability(): ImageSourceAvailability {
  return {
    gallery: false,
    wiki: false,
    post: false,
  }
}

async function getEmbeddingSummary(
  countByStatus: (status: EmbeddingStatusKey) => Promise<number>
) {
  const [pending, processing, ready, failed] = await Promise.all(
    EMBEDDING_STATUSES.map((status) => countByStatus(status))
  )

  return {
    pending,
    processing,
    ready,
    failed,
    total: pending + processing + ready + failed,
  }
}

async function getTextSummary() {
  try {
    const tableExists = await doesPublicTableExist(prisma, 'TextEmbeddingChunk')
    if (!tableExists) {
      return {
        textSummary: createEmptyTextSummary(),
        textEmbeddingReady: false,
        textEmbeddingTableMissing: true,
        textEmbeddingWarning: 'TextEmbeddingChunk 表不存在，请执行数据库迁移后再使用文本向量功能。',
      }
    }

    const textSummary = createEmptyTextSummary()

    const entries = await Promise.all(
      TEXT_SOURCE_TYPES.map(async (sourceType) => {
        const summary = await getEmbeddingSummary((status) =>
          prisma.textEmbeddingChunk.count({
            where: { sourceType, status },
          })
        )

        return [sourceType, summary] as const
      })
    )

    for (const [sourceType, summary] of entries) {
      textSummary[sourceType] = summary
    }

    return {
      textSummary,
      textEmbeddingReady: true,
      textEmbeddingTableMissing: false,
      textEmbeddingWarning: null,
    }
  } catch (error) {
    if (!isPrismaTableMissingError(error, 'TextEmbeddingChunk')) {
      throw error
    }

    return {
      textSummary: createEmptyTextSummary(),
      textEmbeddingReady: false,
      textEmbeddingTableMissing: true,
      textEmbeddingWarning: 'TextEmbeddingChunk 表不存在，请执行数据库迁移后再使用文本向量功能。',
    }
  }
}

async function getImageSummary() {
  const missingImageTables: string[] = []
  const imageSummary = createEmptyImageSummary()
  const imageSourceAvailability = createDefaultImageSourceAvailability()

  const tableChecks = await Promise.all([
    doesPublicTableExist(prisma, 'ImageEmbedding'),
    doesPublicTableExist(prisma, 'WikiImageEmbedding'),
    doesPublicTableExist(prisma, 'PostImageEmbedding'),
  ])

  const imageConfigs: Array<{
    key: ImageSummaryKey
    tableName: string
    exists: boolean
    countByStatus: (status: EmbeddingStatusKey) => Promise<number>
  }> = [
    {
      key: 'gallery',
      tableName: 'ImageEmbedding',
      exists: tableChecks[0],
      countByStatus: (status) =>
        prisma.imageEmbedding.count({
          where: { status },
        }),
    },
    {
      key: 'wiki',
      tableName: 'WikiImageEmbedding',
      exists: tableChecks[1],
      countByStatus: (status) =>
        prisma.wikiImageEmbedding.count({
          where: { status },
        }),
    },
    {
      key: 'post',
      tableName: 'PostImageEmbedding',
      exists: tableChecks[2],
      countByStatus: (status) =>
        prisma.postImageEmbedding.count({
          where: { status },
        }),
    },
  ]

  for (const config of imageConfigs) {
    if (!config.exists) {
      missingImageTables.push(config.tableName)
      continue
    }

    imageSourceAvailability[config.key] = true
    imageSummary[config.key] = await getEmbeddingSummary(config.countByStatus)
  }

  return {
    summary: imageSummary,
    imageSourceAvailability,
    imageEmbeddingReady: missingImageTables.length === 0,
    imageEmbeddingTableMissing: missingImageTables.length > 0,
    imageEmbeddingWarning:
      missingImageTables.length > 0
        ? `${missingImageTables.join('、')} 表不存在，请执行数据库迁移后再使用对应图片向量功能。`
        : null,
  }
}

async function getImageSourceAvailability() {
  const [gallery, wiki, post] = await Promise.all([
    doesPublicTableExist(prisma, 'ImageEmbedding'),
    doesPublicTableExist(prisma, 'WikiImageEmbedding'),
    doesPublicTableExist(prisma, 'PostImageEmbedding'),
  ])

  return {
    gallery,
    wiki,
    post,
  } satisfies ImageSourceAvailability
}

function parseType(type: unknown): EmbeddingType {
  if (type === 'gallery' || type === 'wiki' || type === 'post' || type === 'all') {
    return type;
  }
  return 'all';
}

router.get('/status', requireAdmin, async (_req: AuthenticatedRequest, res) => {
  try {
    const {
      summary,
      imageSourceAvailability,
      imageEmbeddingReady,
      imageEmbeddingTableMissing,
      imageEmbeddingWarning,
      textSummary,
      textEmbeddingReady,
      textEmbeddingTableMissing,
      textEmbeddingWarning,
    } = await Promise.all([
      getImageSummary(),
      getTextSummary(),
    ]).then(([imageState, textState]) => ({
      ...imageState,
      ...textState,
    }))

    // 获取模型加载状态
    const modelLoaded = isImageModelLoaded();
    const textModelLoaded = isTextModelLoaded();
    const tokenizerLoaded = isTokenizerLoaded();
    const modelErrors = getModelLoadError();
    const usingModelScope = isModelScopeActive();
    const actualDtype = getActualDtype();

    res.json({
      modelName: getEmbeddingModelName(),
      vectorSize: getEmbeddingVectorSize(),
      qdrantCollection: getQdrantCollectionName(),
      modelCacheDir: getModelCacheDir(),
      modelLoaded,
      textModelLoaded,
      tokenizerLoaded,
      modelErrors: {
        image: modelErrors.image ? modelErrors.image.message : null,
        text: modelErrors.text ? modelErrors.text.message : null,
        tokenizer: modelErrors.tokenizer ? modelErrors.tokenizer.message : null,
      },
      usingModelScope,
      actualDtype,
      summary,
      imageSourceAvailability,
      imageEmbeddingReady,
      imageEmbeddingTableMissing,
      imageEmbeddingWarning,
      textSummary,
      textEmbeddingReady,
      textEmbeddingTableMissing,
      textEmbeddingWarning,
    });
  } catch (error) {
    console.error('Fetch embeddings status error:', error);
    res.status(500).json({ error: '获取向量状态失败' });
  }
});

router.post('/enqueue-missing', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const type = parseType(req.body?.type);
    const limit = parseInteger(req.body?.limit, IMAGE_EMBEDDING_BATCH_SIZE, {
      min: 1,
      max: 2000,
    });

    const result: {
      gallery?: { requested: number; queued: number };
      wiki?: { requested: number; queued: number };
      post?: { requested: number; queued: number };
      limit: number;
      type: EmbeddingType;
    } = {
      limit,
      type,
    };

    if (type === 'all' || type === 'gallery') {
      result.gallery = await enqueueMissingImageEmbeddings(prisma, limit);
    }

    if (type === 'all' || type === 'wiki') {
      result.wiki = await enqueueMissingWikiImageEmbeddings(prisma, limit);
    }

    if (type === 'all' || type === 'post') {
      result.post = await enqueueMissingPostImageEmbeddings(prisma, limit);
    }

    res.json(result);
  } catch (error) {
    console.error('Enqueue missing embeddings error:', error);
    res.status(500).json({ error: '补齐向量队列失败' });
  }
});

router.post('/sync-batch', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const type = parseType(req.body?.type)
    const galleryImageIdsRaw = Array.isArray(req.body?.galleryImageIds)
      ? req.body.galleryImageIds
      : []
    const galleryImageIds = galleryImageIdsRaw
      .filter((item: unknown): item is string => typeof item === 'string')
      .map((item: string) => item.trim())
      .filter(Boolean)

    const limit = parseInteger(req.body?.limit, IMAGE_EMBEDDING_BATCH_SIZE, {
      min: 1,
      max: 500,
    })
    const includeFailed = parseBoolean(req.body?.includeFailed, false)
    const forceRebuild = parseBoolean(req.body?.forceRebuild, false)

    const uploadsDir = process.env.UPLOADS_PATH || 'uploads'
    const result: {
      gallery?: Awaited<ReturnType<typeof syncImageEmbeddingBatch>>
      wiki?: Awaited<ReturnType<typeof syncWikiImageEmbeddingBatch>>
      post?: Awaited<ReturnType<typeof syncPostImageEmbeddingBatch>>
      limit: number
      includeFailed: boolean
      forceRebuild: boolean
      type: EmbeddingType
      modelName: string
      vectorSize: number
      qdrantCollection: string
    } = {
      limit,
      includeFailed,
      forceRebuild,
      type,
      modelName: getEmbeddingModelName(),
      vectorSize: getEmbeddingVectorSize(),
      qdrantCollection: getQdrantCollectionName(),
    }

    if (type === 'all' || type === 'gallery') {
      result.gallery = await syncImageEmbeddingBatch(prisma, uploadsDir, {
        limit,
        includeFailed,
        forceRebuild,
        galleryImageIds,
      })
    }

    if (type === 'all' || type === 'wiki') {
      result.wiki = await syncWikiImageEmbeddingBatch(prisma, uploadsDir, {
        limit,
        includeFailed,
      })
    }

    if (type === 'all' || type === 'post') {
      result.post = await syncPostImageEmbeddingBatch(prisma, uploadsDir, {
        limit,
        includeFailed,
      })
    }

    res.json(result)
  } catch (error) {
    console.error('Sync embeddings batch error:', error)
    res.status(500).json({ error: '批量生成向量失败' })
  }
})

router.get('/errors', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const type = parseType(req.query.type);
    const limit = parseInteger(req.query.limit, 20, {
      min: 1,
      max: 200,
    });
    const imageSourceAvailability = await getImageSourceAvailability()
    const requestedTypes = type === 'all'
      ? (['gallery', 'wiki', 'post'] as const)
      : [type]
    const unavailableRequestedTypes = requestedTypes.filter((sourceType) => {
      if (sourceType === 'gallery') return !imageSourceAvailability.gallery
      if (sourceType === 'wiki') return !imageSourceAvailability.wiki
      return !imageSourceAvailability.post
    })

    const errors: Array<{
      id: string;
      sourceType: 'gallery' | 'wiki' | 'post';
      sourceId?: string;
      galleryImageId?: string | null;
      galleryId?: string | null;
      galleryTitle?: string | null;
      wikiPageSlug?: string | null;
      postId?: string | null;
      imageUrl: string;
      modelName: string;
      vectorSize: number;
      status: string;
      errorMessage: string | null;
      retryCount: number;
      embeddedAt: string | null;
      createdAt: string;
      updatedAt: string;
      gallery?: { id: string; title: string } | null;
    }> = [];

    const warnings: string[] = []
    if (unavailableRequestedTypes.length > 0) {
      const labels = unavailableRequestedTypes.map((sourceType) => {
        if (sourceType === 'gallery') return 'ImageEmbedding'
        if (sourceType === 'wiki') return 'WikiImageEmbedding'
        return 'PostImageEmbedding'
      })
      warnings.push(`${labels.join('、')} 表不存在，已跳过对应错误记录查询。`)
    }

    // Gallery errors
    if ((type === 'all' || type === 'gallery') && imageSourceAvailability.gallery) {
      const galleryFailed = await prisma.imageEmbedding.findMany({
        where: {
          status: 'failed',
        },
        include: {
          galleryImage: {
            include: {
              gallery: {
                select: {
                  id: true,
                  title: true,
                },
              },
              asset: {
                select: {
                  id: true,
                  publicUrl: true,
                  storageKey: true,
                },
              },
            },
          },
        },
        orderBy: {
          updatedAt: 'desc',
        },
        take: limit,
      });

      errors.push(...galleryFailed.map((item) => ({
        id: item.id,
        sourceType: 'gallery' as const,
        sourceId: item.galleryImageId,
        galleryImageId: item.galleryImageId,
        galleryId: item.galleryImage.galleryId,
        galleryTitle: item.galleryImage.gallery.title,
        wikiPageSlug: null,
        postId: null,
        imageUrl: item.galleryImage.asset?.publicUrl || item.galleryImage.url,
        modelName: item.modelName,
        vectorSize: item.vectorSize,
        status: item.status,
        errorMessage: item.lastError,
        retryCount: item.status === 'failed' ? 1 : 0,
        embeddedAt: item.embeddedAt ? item.embeddedAt.toISOString() : null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        gallery: {
          id: item.galleryImage.gallery.id,
          title: item.galleryImage.gallery.title,
        },
      })));
    }

    // Wiki errors
    if ((type === 'all' || type === 'wiki') && imageSourceAvailability.wiki) {
      const wikiFailed = await prisma.wikiImageEmbedding.findMany({
        where: {
          status: 'failed',
        },
        orderBy: {
          updatedAt: 'desc',
        },
        take: limit,
      });

      errors.push(...wikiFailed.map((item) => ({
        id: item.id,
        sourceType: 'wiki' as const,
        sourceId: item.wikiPageSlug,
        galleryImageId: null,
        galleryId: null,
        galleryTitle: null,
        wikiPageSlug: item.wikiPageSlug,
        postId: null,
        imageUrl: item.imageUrl,
        modelName: item.modelName,
        vectorSize: item.vectorSize,
        status: item.status,
        errorMessage: item.lastError,
        retryCount: item.status === 'failed' ? 1 : 0,
        embeddedAt: item.embeddedAt ? item.embeddedAt.toISOString() : null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        gallery: null,
      })));
    }

    // Post errors
    if ((type === 'all' || type === 'post') && imageSourceAvailability.post) {
      const postFailed = await prisma.postImageEmbedding.findMany({
        where: {
          status: 'failed',
        },
        orderBy: {
          updatedAt: 'desc',
        },
        take: limit,
      });

      errors.push(...postFailed.map((item) => ({
        id: item.id,
        sourceType: 'post' as const,
        sourceId: item.postId,
        galleryImageId: null,
        galleryId: null,
        galleryTitle: null,
        wikiPageSlug: null,
        postId: item.postId,
        imageUrl: item.imageUrl,
        modelName: item.modelName,
        vectorSize: item.vectorSize,
        status: item.status,
        errorMessage: item.lastError,
        retryCount: item.status === 'failed' ? 1 : 0,
        embeddedAt: item.embeddedAt ? item.embeddedAt.toISOString() : null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        gallery: null,
      })));
    }

    // 按 updatedAt 排序并限制数量
    errors.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const limitedErrors = errors.slice(0, limit);

    res.json({
      errors: limitedErrors,
      total: limitedErrors.length,
      type,
      warnings,
      imageSourceAvailability,
    });
  } catch (error) {
    console.error('Fetch embedding errors error:', error);
    res.status(500).json({ error: '获取向量失败记录失败' });
  }
});

router.post('/retry-failed', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const type = parseType(req.body?.type)
    const limit = parseInteger(req.body?.limit, IMAGE_EMBEDDING_BATCH_SIZE, {
      min: 1,
      max: 500,
    })

    const uploadsDir = process.env.UPLOADS_PATH || 'uploads'
    const result: {
      gallery?: { resetCount: number; processedCount: number } & Awaited<ReturnType<typeof syncImageEmbeddingBatch>>
      wiki?: { resetCount: number; processedCount: number } & Awaited<ReturnType<typeof syncWikiImageEmbeddingBatch>>
      post?: { resetCount: number; processedCount: number } & Awaited<ReturnType<typeof syncPostImageEmbeddingBatch>>
      limit: number
      type: EmbeddingType
    } = {
      limit,
      type,
    }

    if (type === 'all' || type === 'gallery') {
      const failedIds = await prisma.imageEmbedding.findMany({
        where: { status: 'failed' },
        select: { id: true },
        take: limit,
      })
      const galleryUpdated = await prisma.imageEmbedding.updateMany({
        where: { id: { in: failedIds.map((r) => r.id) } },
        data: {
          status: 'pending',
          lastError: null,
        },
      })

      const gallerySyncResult = await syncImageEmbeddingBatch(prisma, uploadsDir, {
        limit,
        includeFailed: true,
        forceRebuild: false,
      })

      result.gallery = {
        resetCount: galleryUpdated.count,
        processedCount: gallerySyncResult.ready + gallerySyncResult.failed,
        ...gallerySyncResult,
      }
    }

    if (type === 'all' || type === 'wiki') {
      const failedIds = await prisma.wikiImageEmbedding.findMany({
        where: { status: 'failed' },
        select: { id: true },
        take: limit,
      })
      const wikiUpdated = await prisma.wikiImageEmbedding.updateMany({
        where: { id: { in: failedIds.map((r) => r.id) } },
        data: {
          status: 'pending',
          lastError: null,
        },
      })

      const wikiSyncResult = await syncWikiImageEmbeddingBatch(prisma, uploadsDir, {
        limit,
        includeFailed: true,
      })

      result.wiki = {
        resetCount: wikiUpdated.count,
        processedCount: wikiSyncResult.ready + wikiSyncResult.failed,
        ...wikiSyncResult,
      }
    }

    if (type === 'all' || type === 'post') {
      const failedIds = await prisma.postImageEmbedding.findMany({
        where: { status: 'failed' },
        select: { id: true },
        take: limit,
      })
      const postUpdated = await prisma.postImageEmbedding.updateMany({
        where: { id: { in: failedIds.map((r) => r.id) } },
        data: {
          status: 'pending',
          lastError: null,
        },
      })

      const postSyncResult = await syncPostImageEmbeddingBatch(prisma, uploadsDir, {
        limit,
        includeFailed: true,
      })

      result.post = {
        resetCount: postUpdated.count,
        processedCount: postSyncResult.ready + postSyncResult.failed,
        ...postSyncResult,
      }
    }

    res.json(result)
  } catch (error) {
    console.error('Retry failed embeddings error:', error)
    res.status(500).json({ error: '重试失败向量任务失败' })
  }
})

router.post('/rebuild-all', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const type = parseType(req.body?.type)
    const limit = parseInteger(req.body?.limit, IMAGE_EMBEDDING_BATCH_SIZE, {
      min: 1,
      max: 500,
    })

    const uploadsDir = process.env.UPLOADS_PATH || 'uploads'
    const result: {
      gallery?: { resetCount: number } & Awaited<ReturnType<typeof syncImageEmbeddingBatch>>
      wiki?: { resetCount: number } & Awaited<ReturnType<typeof syncWikiImageEmbeddingBatch>>
      post?: { resetCount: number } & Awaited<ReturnType<typeof syncPostImageEmbeddingBatch>>
      limit: number
      type: EmbeddingType
    } = {
      limit,
      type,
    }

    if (type === 'all' || type === 'gallery') {
      const galleryUpdated = await prisma.imageEmbedding.updateMany({
        data: {
          status: 'pending',
          lastError: null,
        },
      })

      const gallerySyncResult = await syncImageEmbeddingBatch(prisma, uploadsDir, {
        limit,
        includeFailed: true,
      })

      result.gallery = {
        resetCount: galleryUpdated.count,
        ...gallerySyncResult,
      }
    }

    if (type === 'all' || type === 'wiki') {
      const wikiUpdated = await prisma.wikiImageEmbedding.updateMany({
        data: {
          status: 'pending',
          lastError: null,
        },
      })

      const wikiSyncResult = await syncWikiImageEmbeddingBatch(prisma, uploadsDir, {
        limit,
        includeFailed: true,
      })

      result.wiki = {
        resetCount: wikiUpdated.count,
        ...wikiSyncResult,
      }
    }

    if (type === 'all' || type === 'post') {
      const postUpdated = await prisma.postImageEmbedding.updateMany({
        data: {
          status: 'pending',
          lastError: null,
        },
      })

      const postSyncResult = await syncPostImageEmbeddingBatch(prisma, uploadsDir, {
        limit,
        includeFailed: true,
      })

      result.post = {
        resetCount: postUpdated.count,
        ...postSyncResult,
      }
    }

    res.json(result)
  } catch (error) {
    console.error('Rebuild all embeddings error:', error)
    res.status(500).json({ error: '重建所有向量失败' })
  }
})

// 同步指定 Wiki 页面的图片向量
router.post('/sync-wiki', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const slugsRaw = Array.isArray(req.body?.slugs)
      ? req.body.slugs
      : [];
    const slugs = slugsRaw
      .filter((item: unknown): item is string => typeof item === 'string')
      .map((item: string) => item.trim())
      .filter(Boolean);

    if (slugs.length === 0) {
      res.status(400).json({ error: '请提供至少一个 Wiki 页面 slug' });
      return;
    }

    const result = await enqueueWikiImageEmbeddings(prisma, slugs);

    res.json({
      ...result,
      slugs,
      modelName: getEmbeddingModelName(),
      vectorSize: getEmbeddingVectorSize(),
    });
  } catch (error) {
    console.error('Sync wiki embeddings error:', error);
    res.status(500).json({ error: '同步 Wiki 页面向量失败' });
  }
});

// 同步指定 Post 的图片向量
router.post('/sync-post', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const idsRaw = Array.isArray(req.body?.ids)
      ? req.body.ids
      : [];
    const ids = idsRaw
      .filter((item: unknown): item is string => typeof item === 'string')
      .map((item: string) => item.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      res.status(400).json({ error: '请提供至少一个 Post ID' });
      return;
    }

    const result = await enqueuePostImageEmbeddings(prisma, ids);

    res.json({
      ...result,
      ids,
      modelName: getEmbeddingModelName(),
      vectorSize: getEmbeddingVectorSize(),
    });
  } catch (error) {
    console.error('Sync post embeddings error:', error);
    res.status(500).json({ error: '同步 Post 向量失败' });
  }
});

type TextSourceType = 'wiki' | 'post' | 'music' | 'album' | 'all'

function parseTextSourceType(type: unknown): TextSourceType {
  if (type === 'wiki' || type === 'post' || type === 'music' || type === 'album' || type === 'all') {
    return type
  }
  return 'all'
}

router.get('/text/status', requireAdmin, async (_req: AuthenticatedRequest, res) => {
  try {
    const {
      textSummary,
      textEmbeddingReady,
      textEmbeddingTableMissing,
      textEmbeddingWarning,
    } = await getTextSummary()

    res.json({
      summary: textSummary,
      modelName: getEmbeddingModelName(),
      vectorSize: getEmbeddingVectorSize(),
      textCollection: getTextCollectionName(),
      textModelLoaded: isTextModelLoaded(),
      tokenizerLoaded: isTokenizerLoaded(),
      textEmbeddingReady,
      textEmbeddingTableMissing,
      textEmbeddingWarning,
    })
  } catch (error) {
    console.error('Fetch text embeddings status error:', error)
    res.status(500).json({ error: '获取文本向量状态失败' })
  }
})

router.post('/text/enqueue', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const sourceType = parseTextSourceType(req.body?.sourceType)
    const limit = parseInteger(req.body?.limit, IMAGE_EMBEDDING_BATCH_SIZE, {
      min: 1,
      max: 2000,
    })

    const slugsRaw = Array.isArray(req.body?.slugs)
      ? req.body.slugs
      : []
    const slugs = slugsRaw
      .filter((item: unknown): item is string => typeof item === 'string')
      .map((item: string) => item.trim())
      .filter(Boolean)

    const idsRaw = Array.isArray(req.body?.ids)
      ? req.body.ids
      : []
    const ids = idsRaw
      .filter((item: unknown): item is string => typeof item === 'string')
      .map((item: string) => item.trim())
      .filter(Boolean)

    if (slugs.length > 0) {
      const result = await enqueueWikiTextEmbeddings(prisma, slugs)
      res.json({ ...result, slugs, sourceType: 'wiki' })
      return
    }

    if (ids.length > 0) {
      if (sourceType === 'post') {
        const result = await enqueuePostTextEmbeddings(prisma, ids)
        res.json({ ...result, ids, sourceType: 'post' })
        return
      }
      if (sourceType === 'music') {
        const result = await enqueueMusicTextEmbeddings(prisma, ids)
        res.json({ ...result, ids, sourceType: 'music' })
        return
      }
      if (sourceType === 'album') {
        const result = await enqueueAlbumTextEmbeddings(prisma, ids)
        res.json({ ...result, ids, sourceType: 'album' })
        return
      }
      res.status(400).json({ error: '提供 ids 时必须指定 sourceType 为 post/music/album' })
      return
    }

    const enqueueType = sourceType === 'all' ? undefined : sourceType
    const result = await enqueueMissingTextEmbeddings(prisma, enqueueType, limit)
    res.json({ ...result, sourceType, limit })
  } catch (error) {
    console.error('Enqueue text embeddings error:', error)
    res.status(500).json({ error: '补齐文本向量队列失败' })
  }
})

router.post('/text/sync', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const limit = parseInteger(req.body?.limit, IMAGE_EMBEDDING_BATCH_SIZE, {
      min: 1,
      max: 500,
    })
    const includeFailed = parseBoolean(req.body?.includeFailed, false)

    const result = await syncTextEmbeddingBatch(prisma, { limit, includeFailed })

    res.json({
      ...result,
      limit,
      includeFailed,
    })
  } catch (error) {
    console.error('Sync text embeddings batch error:', error)
    res.status(500).json({ error: '批量生成文本向量失败' })
  }
})

router.post('/text/retry-failed', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const sourceType = parseTextSourceType(req.body?.sourceType)
    const limit = parseInteger(req.body?.limit, IMAGE_EMBEDDING_BATCH_SIZE, {
      min: 1,
      max: 500,
    })

    const sourceTypeFilter = sourceType === 'all' ? undefined : sourceType
    const result = await retryFailedTextEmbeddings(prisma, {
      limit,
      sourceType: sourceTypeFilter,
    })

    res.json({
      ...result,
      limit,
      sourceType,
    })
  } catch (error) {
    console.error('Retry failed text embeddings error:', error)
    res.status(500).json({ error: '重试失败文本向量任务失败' })
  }
})

router.post('/text/rebuild-all', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const sourceType = parseTextSourceType(req.body?.sourceType)
    const limit = parseInteger(req.body?.limit, IMAGE_EMBEDDING_BATCH_SIZE, {
      min: 1,
      max: 500,
    })

    const sourceTypeFilter = sourceType === 'all' ? undefined : sourceType
    const result = await rebuildAllTextEmbeddings(prisma, {
      limit,
      sourceType: sourceTypeFilter,
    })

    res.json({
      ...result,
      limit,
      sourceType,
    })
  } catch (error) {
    console.error('Rebuild all text embeddings error:', error)
    res.status(500).json({ error: '重建所有文本向量失败' })
  }
})

export function registerEmbeddingsRoutes(app: Router) {
  app.use('/api/embeddings', router);
}
