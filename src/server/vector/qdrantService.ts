import { QdrantClient } from '@qdrant/js-client-rest';

const DEFAULT_COLLECTION = 'hsf_image_embeddings';
const DEFAULT_TEXT_COLLECTION = 'hsf_text_embeddings';
const DEFAULT_DISTANCE: 'Cosine' | 'Dot' | 'Euclid' | 'Manhattan' = 'Cosine';

let qdrantClient: QdrantClient | null = null;
let ensureCollectionPromise: Promise<void> | null = null;
let ensureTextCollectionPromise: Promise<void> | null = null;

function parseInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function getQdrantCollectionName() {
  return process.env.QDRANT_COLLECTION || DEFAULT_COLLECTION;
}

export function getTextCollectionName(): string {
  return process.env.QDRANT_TEXT_COLLECTION || DEFAULT_TEXT_COLLECTION;
}

function getQdrantUrl() {
  return process.env.QDRANT_URL || 'http://127.0.0.1:6333';
}

function getQdrantApiKey() {
  return process.env.QDRANT_API_KEY || undefined;
}

function getVectorSize() {
  return parseInteger(process.env.IMAGE_EMBEDDING_VECTOR_SIZE, 512);
}

export function getQdrantClient() {
  if (!qdrantClient) {
    qdrantClient = new QdrantClient({
      url: getQdrantUrl(),
      apiKey: getQdrantApiKey(),
    });
  }
  return qdrantClient;
}

export async function ensureQdrantCollection() {
  if (!ensureCollectionPromise) {
    ensureCollectionPromise = (async () => {
      const client = getQdrantClient();
      const collectionName = getQdrantCollectionName();

      const collections = await client.getCollections();
      const exists = collections.collections.some((collection) => collection.name === collectionName);
      if (exists) {
        try {
          const existing = await client.getCollection(collectionName)
          const existingSize = existing.config?.params?.vectors?.size
          if (existingSize === getVectorSize()) {
            try {
              await client.createPayloadIndex(collectionName, {
                field_name: 'sourceId',
                field_schema: 'keyword',
                wait: true,
              })
            } catch {}
            return
          }
          console.warn(`[Qdrant] 向量维度不匹配: existing=${existingSize}, required=${getVectorSize()}，将重建 collection`)
          await client.deleteCollection(collectionName)
        } catch (error) {
          console.error('[Qdrant] 获取现有 collection 信息失败:', error)
          throw error
        }
      }

      await client.createCollection(collectionName, {
        vectors: {
          size: getVectorSize(),
          distance: DEFAULT_DISTANCE,
        },
        hnsw_config: {
          m: 16,
          ef_construct: 256,
        },
      })

      await client.createPayloadIndex(collectionName, {
        field_name: 'sourceType',
        field_schema: 'keyword',
        wait: true,
      })

      try {
        await client.createPayloadIndex(collectionName, {
          field_name: 'sourceId',
          field_schema: 'keyword',
          wait: true,
        })
      } catch {}
    })().catch((error) => {
      ensureCollectionPromise = null;
      throw error;
    });
  }

  return ensureCollectionPromise;
}

export async function ensureTextQdrantCollection() {
  if (!ensureTextCollectionPromise) {
    ensureTextCollectionPromise = (async () => {
      const client = getQdrantClient();
      const collectionName = getTextCollectionName();

      const collections = await client.getCollections();
      const exists = collections.collections.some((collection) => collection.name === collectionName);
      if (exists) {
        try {
          const existing = await client.getCollection(collectionName)
          const existingSize = existing.config?.params?.vectors?.size
          if (existingSize === getVectorSize()) {
            try {
              await client.createPayloadIndex(collectionName, {
                field_name: 'sourceType',
                field_schema: 'keyword',
                wait: true,
              })
            } catch {}
            try {
              await client.createPayloadIndex(collectionName, {
                field_name: 'sourceId',
                field_schema: 'keyword',
                wait: true,
              })
            } catch {}
            return
          }
          console.warn(`[Qdrant] 文本向量维度不匹配: existing=${existingSize}, required=${getVectorSize()}，将重建 collection`)
          await client.deleteCollection(collectionName)
        } catch (error) {
          console.error('[Qdrant] 获取现有文本 collection 信息失败:', error)
          throw error
        }
      }

      await client.createCollection(collectionName, {
        vectors: {
          size: getVectorSize(),
          distance: DEFAULT_DISTANCE,
        },
        hnsw_config: {
          m: 16,
          ef_construct: 256,
        },
      })

      try {
        await client.createPayloadIndex(collectionName, {
          field_name: 'sourceType',
          field_schema: 'keyword',
          wait: true,
        })
      } catch {}
      try {
        await client.createPayloadIndex(collectionName, {
          field_name: 'sourceId',
          field_schema: 'keyword',
          wait: true,
        })
      } catch {}
    })().catch((error) => {
      ensureTextCollectionPromise = null;
      throw error;
    });
  }

  return ensureTextCollectionPromise;
}

/**
 * 图片来源类型
 */
export type ImageSourceType = 'gallery' | 'wiki' | 'post';

/**
 * 图片向量嵌入的 Payload 类型
 * 支持多种来源：图库(gallery)、维基(wiki)、帖子(post)
 */
export interface ImageEmbeddingPayload {
  // 通用字段
  sourceType: ImageSourceType;
  sourceId: string;
  imageUrl: string;
  updatedAt: string;

  // Gallery 类型特有字段
  galleryId?: string;
  imageName?: string;

  // Wiki 类型特有字段
  wikiPageSlug?: string;

  // Post 类型特有字段
  postId?: string;

  // 向后兼容：旧数据可能只有这些字段
  /** @deprecated 使用 sourceType 和 sourceId 替代 */
  galleryImageId?: string;
}

/**
 * 将 Qdrant 返回的 payload 解析为 ImageEmbeddingPayload
 * 处理向后兼容逻辑
 */
export function toEmbeddingPayload(payload: Record<string, unknown> | null | undefined): ImageEmbeddingPayload | null {
  if (!payload) {
    return null;
  }

  // 如果已有 sourceType，直接返回
  if (payload.sourceType) {
    return payload as unknown as ImageEmbeddingPayload;
  }

  // 向后兼容：旧数据只有 galleryImageId 等字段
  if (payload.galleryImageId && !payload.sourceType) {
    return {
      sourceType: 'gallery',
      sourceId: String(payload.galleryImageId),
      imageUrl: String(payload.imageUrl || ''),
      updatedAt: String(payload.updatedAt || new Date().toISOString()),
      galleryId: payload.galleryId ? String(payload.galleryId) : undefined,
      galleryImageId: String(payload.galleryImageId),
      imageName: payload.imageName ? String(payload.imageName) : undefined,
    };
  }

  return null;
}

/**
 * 创建图片向量嵌入点
 * 支持多种来源：gallery、wiki、post
 */
export async function upsertImageEmbeddingPoint(params: {
  pointId: string;
  vector: number[];
  sourceType: ImageSourceType;
  sourceId: string;
  imageUrl: string;
  galleryId?: string;
  galleryImageId?: string;
  wikiPageSlug?: string;
  postId?: string;
  imageName?: string;
  updatedAt: string;
}) {
  await ensureQdrantCollection();
  const client = getQdrantClient();
  const collectionName = getQdrantCollectionName();

  // 构建 payload
  const payload: ImageEmbeddingPayload = {
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    imageUrl: params.imageUrl,
    updatedAt: params.updatedAt,
  };

  // 根据来源类型添加特定字段
  if (params.sourceType === 'gallery') {
    payload.galleryId = params.galleryId;
    payload.galleryImageId = params.galleryImageId || params.sourceId;
    payload.imageName = params.imageName;
  } else if (params.sourceType === 'wiki') {
    payload.wikiPageSlug = params.wikiPageSlug || params.sourceId;
  } else if (params.sourceType === 'post') {
    payload.postId = params.postId || params.sourceId;
  }

  await client.upsert(collectionName, {
    wait: true,
    points: [
      {
        id: params.pointId,
        vector: params.vector,
        payload: payload as unknown as Record<string, unknown>,
      },
    ],
  });
}

/**
 * 搜索图片向量嵌入点
 * 返回的结果包含完整的来源信息
 */
export async function searchImageEmbeddingPoints(params: {
  vector: number[];
  limit: number;
  minScore?: number;
  sourceType?: string;
}) {
  await ensureQdrantCollection();
  const client = getQdrantClient();
  const collectionName = getQdrantCollectionName();

  const results = await client.search(collectionName, {
    vector: params.vector,
    limit: params.limit,
    score_threshold: params.minScore,
    with_payload: true,
    with_vector: false,
    ...(params.sourceType
      ? {
          filter: {
            must: [
              { key: 'sourceType', match: { value: params.sourceType } },
            ],
          },
        }
      : {}),
  });

  // 转换结果为包含解析后 payload 的格式
  return results.map((result) => ({
    id: result.id,
    score: result.score,
    payload: toEmbeddingPayload(result.payload as Record<string, unknown> | undefined),
  }));
}

/**
 * 删除图片向量嵌入点
 */
export async function deleteImageEmbeddingPoint(pointId: string) {
  await ensureQdrantCollection();
  const client = getQdrantClient();
  const collectionName = getQdrantCollectionName();

  await client.delete(collectionName, {
    wait: true,
    points: [pointId],
  });
}

export async function healthCheck(): Promise<{ status: string; latencyMs: number }> {
  const start = Date.now();
  try {
    const client = getQdrantClient();
    await client.getCollections();
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (error) {
    return { status: 'error', latencyMs: Date.now() - start };
  }
}

export async function upsertTextEmbeddingPoint(params: {
  pointId: string
  vector: number[]
  sourceType: string
  sourceId: string
  chunkIndex: number
  chunkPreview: string
  updatedAt: string
}): Promise<void> {
  await ensureTextQdrantCollection()
  const client = getQdrantClient()
  const collectionName = getTextCollectionName()

  await client.upsert(collectionName, {
    wait: true,
    points: [
      {
        id: params.pointId,
        vector: params.vector,
        payload: {
          sourceType: params.sourceType,
          sourceId: params.sourceId,
          chunkIndex: params.chunkIndex,
          chunkPreview: params.chunkPreview,
          updatedAt: params.updatedAt,
        },
      },
    ],
  })
}

export async function searchTextEmbeddingPoints(
  queryVector: number[],
  limit?: number,
  minScore?: number
): Promise<Array<{
  sourceType: string
  sourceId: string
  chunkIndex: number
  chunkPreview: string
  score: number
}>> {
  await ensureTextQdrantCollection()
  const client = getQdrantClient()
  const collectionName = getTextCollectionName()

  const results = await client.search(collectionName, {
    vector: queryVector,
    limit: limit ?? 10,
    score_threshold: minScore,
    with_payload: true,
    with_vector: false,
  })

  return results.map((result) => ({
    sourceType: String(result.payload?.sourceType ?? ''),
    sourceId: String(result.payload?.sourceId ?? ''),
    chunkIndex: Number(result.payload?.chunkIndex ?? 0),
    chunkPreview: String(result.payload?.chunkPreview ?? ''),
    score: result.score,
  }))
}

export async function deleteTextEmbeddingPointsBySource(
  sourceType: string,
  sourceId: string
): Promise<number> {
  await ensureTextQdrantCollection()
  const client = getQdrantClient()
  const collectionName = getTextCollectionName()

  let allPointIds: string[] = []
  let offset: string | number | Record<string, unknown> | null | undefined = undefined
  do {
    const filtered = await client.scroll(collectionName, {
      filter: {
        must: [
          { key: 'sourceType', match: { value: sourceType } },
          { key: 'sourceId', match: { value: sourceId } },
        ],
      },
      with_payload: false,
      with_vector: false,
      limit: 1000,
      offset,
    })
    allPointIds.push(...filtered.points.map((p) => String(p.id)))
    const rawNextOffset = (filtered as Record<string, unknown>).next_offset
    offset = (typeof rawNextOffset === 'string' ? rawNextOffset : undefined)
  } while (offset)

  if (allPointIds.length === 0) return 0
  await client.delete(collectionName, { wait: true, points: allPointIds })
  return allPointIds.length
}

export async function deleteTextEmbeddingPoint(
  pointId: string
): Promise<void> {
  await ensureTextQdrantCollection()
  const client = getQdrantClient()
  const collectionName = getTextCollectionName()

  await client.delete(collectionName, {
    wait: true,
    points: [pointId],
  })
}

export async function deleteImageEmbeddingPointsBySource(
  sourceType: string,
  sourceId: string
): Promise<number> {
  await ensureQdrantCollection()
  const client = getQdrantClient()
  const collectionName = getQdrantCollectionName()

  const filtered = await client.scroll(collectionName, {
    filter: {
      must: [
        { key: 'sourceType', match: { value: sourceType } },
        { key: 'sourceId', match: { value: sourceId } },
      ],
    },
    with_payload: false,
    with_vector: false,
    limit: 1000,
  })

  const pointIds = filtered.points.map((p) => p.id)
  if (pointIds.length === 0) {
    return 0
  }

  await client.delete(collectionName, {
    wait: true,
    points: pointIds,
  })

  return pointIds.length
}
