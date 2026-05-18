import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth, requireAdmin, type AuthenticatedRequest } from '../middleware/auth';
import type { ApiUser } from '../types';
import { searchLimiter } from '../middleware/rateLimiter';
import {
  parseInteger,
  parseBoolean,
  parseMinSimilarityScore,
  extractBase64Payload,
  normalizeKeyword,
  increaseSearchKeywordCount,
  buildWikiVisibilityWhere,
  buildPostVisibilityWhere,
  buildGalleryVisibilityWhere,
  toWikiResponse,
  toPostResponse,
  toGalleryResponse,
  toMusicResponse,
  toAlbumResponse,
  parseDate,
  enhancedCache,
  logger,
} from '../utils';
import { prisma } from '../prisma';
import { getEmbeddingModelName, getEmbeddingVectorSize, generateImageEmbedding, generateTextEmbedding, isTextModelLoaded } from '../vector/clipEmbedding';
import { getQdrantCollectionName, searchImageEmbeddingPoints, searchTextEmbeddingPoints, toEmbeddingPayload, type ImageSourceType, type ImageEmbeddingPayload } from '../vector/qdrantService';
import { createUploadStorageInfo } from '../uploadPath';

const router = Router();

const IMAGE_SEARCH_RESULT_LIMIT = Math.max(1, Number(process.env.IMAGE_SEARCH_RESULT_LIMIT || 24));
const VECTOR_SEARCH_CANDIDATE_LIMIT = 200;
const QDRANT_TIMEOUT_MS = Number(process.env.QDRANT_TIMEOUT_MS || 2000);
export const RRF_K = 60;

interface HybridSearchItem {
  id: string;
  type: 'wiki' | 'post' | 'gallery' | 'music' | 'album';
  data: unknown;
  relevanceScore: number;
  matchType: 'keyword' | 'vector' | 'hybrid' | 'text';
  vectorDistance?: number;
  keywordRank?: number;
  vectorRank?: number;
  textRank?: number;
}

interface HybridSearchResponse {
  wiki: Awaited<ReturnType<typeof toWikiResponse>>[];
  posts: Awaited<ReturnType<typeof toPostResponse>>[];
  galleries: Awaited<ReturnType<typeof toGalleryResponse>>[];
  music: Awaited<ReturnType<typeof toMusicResponse>>[];
  albums: Awaited<ReturnType<typeof toAlbumResponse>>[];
  searchMeta: {
    mode: string;
    query: string;
    degraded: boolean;
    degradationReason?: string;
    keywordResultCount: number;
    vectorResultCount: number;
    textVectorResultCount: number;
  };
}

const searchImageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, file, cb) => {
      const info = createUploadStorageInfo(process.env.UPLOADS_PATH || 'uploads', 'search', file.originalname);
      (file as Express.Multer.File & { uploadInfo?: ReturnType<typeof createUploadStorageInfo> }).uploadInfo = info;
      cb(null, info.absoluteDir);
    },
    filename: (_req, file, cb) => {
      const info = (file as Express.Multer.File & { uploadInfo?: ReturnType<typeof createUploadStorageInfo> }).uploadInfo;
      cb(null, info?.fileName || file.originalname);
    },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
    const ALLOWED_IMAGE_MIME_TYPES = new Set([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/bmp',
    ]);
    if (!ALLOWED_IMAGE_EXTENSIONS.has(ext) || !ALLOWED_IMAGE_MIME_TYPES.has(mime)) {
      cb(new Error('仅支持 JPG、PNG、WEBP、GIF、BMP 图片上传'));
      return;
    }
    cb(null, true);
  },
});

interface SemanticSearchResult {
  sourceType: ImageSourceType;
  sourceId: string;
  imageUrl: string;
  similarity: number;
  data: unknown;
}

type TextSearchResult = {
  sourceType: string
  sourceId: string
  score: number
  chunkPreview: string
  entity: any
}

/**
 * 获取 Gallery 数据
 */
async function fetchGalleryData(galleryIds: string[], authUser?: ApiUser): Promise<Map<string, Awaited<ReturnType<typeof toGalleryResponse>>>> {
  if (!galleryIds.length) {
    return new Map();
  }

  const galleryRows = await prisma.gallery.findMany({
    where: {
      id: { in: galleryIds },
      ...buildGalleryVisibilityWhere(authUser),
    },
    include: {
      images: {
        include: {
          asset: true,
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  const result = new Map<string, Awaited<ReturnType<typeof toGalleryResponse>>>();
  for (const gallery of galleryRows) {
    result.set(gallery.id, await toGalleryResponse(gallery));
  }
  return result;
}

/**
 * 获取 WikiPage 数据
 */
async function fetchWikiData(slugs: string[], authUser?: ApiUser): Promise<Map<string, ReturnType<typeof toWikiResponse>>> {
  if (!slugs.length) {
    return new Map();
  }

  const wikiRows = await prisma.wikiPage.findMany({
    where: {
      slug: { in: slugs },
      ...buildWikiVisibilityWhere(authUser),
    },
    include: {
      location: true,
    },
  });

  const result = new Map<string, ReturnType<typeof toWikiResponse>>();
  for (const wiki of wikiRows) {
    result.set(wiki.slug, toWikiResponse(wiki));
  }
  return result;
}

/**
 * 获取 Post 数据
 */
async function fetchPostData(ids: string[], authUser?: ApiUser): Promise<Map<string, ReturnType<typeof toPostResponse>>> {
  if (!ids.length) {
    return new Map();
  }

  const postRows = await prisma.post.findMany({
    where: {
      id: { in: ids },
      ...buildPostVisibilityWhere(authUser),
    },
    include: {
      location: true,
    },
  });

  const result = new Map<string, ReturnType<typeof toPostResponse>>();
  for (const post of postRows) {
    result.set(post.id, toPostResponse(post));
  }
  return result;
}

/**
 * 处理语义搜索结果，根据 sourceType 分别查询数据并合并
 */
async function processSemanticSearchResults(
  matches: Array<{ id: string | number; score: number; payload: ImageEmbeddingPayload | null }>,
  authUser?: ApiUser
): Promise<SemanticSearchResult[]> {
  // 按 sourceType 分组
  const galleryIds: string[] = [];
  const wikiSlugs: string[] = [];
  const postIds: string[] = [];

  // 记录每个 sourceId 的最高相似度分数
  const scoreBySourceId = new Map<string, number>();
  // 记录每个 sourceId 对应的图片 URL
  const imageUrlBySourceId = new Map<string, string>();

  for (const match of matches) {
    if (!match.payload) continue;

    const score = typeof match.score === 'number' ? match.score : 0;
    const { sourceType, sourceId, imageUrl } = match.payload;

    if (!sourceId) continue;

    // 更新最高分数
    const previousBest = scoreBySourceId.get(`${sourceType}:${sourceId}`);
    if (previousBest === undefined || score > previousBest) {
      scoreBySourceId.set(`${sourceType}:${sourceId}`, score);
      if (imageUrl) {
        imageUrlBySourceId.set(`${sourceType}:${sourceId}`, imageUrl);
      }
    }

    // 去重收集 ID
    if (sourceType === 'gallery' && !galleryIds.includes(sourceId)) {
      galleryIds.push(sourceId);
    } else if (sourceType === 'wiki' && !wikiSlugs.includes(sourceId)) {
      wikiSlugs.push(sourceId);
    } else if (sourceType === 'post' && !postIds.includes(sourceId)) {
      postIds.push(sourceId);
    }
  }

  // 并行获取各类数据
  const [galleryData, wikiData, postData] = await Promise.all([
    fetchGalleryData(galleryIds, authUser),
    fetchWikiData(wikiSlugs, authUser),
    fetchPostData(postIds, authUser),
  ]);

  // 构建结果数组
  const results: SemanticSearchResult[] = [];

  // 处理 Gallery 结果
  for (const galleryId of galleryIds) {
    const data = galleryData.get(galleryId);
    if (data) {
      results.push({
        sourceType: 'gallery',
        sourceId: galleryId,
        imageUrl: imageUrlBySourceId.get(`gallery:${galleryId}`) || '',
        similarity: Number((scoreBySourceId.get(`gallery:${galleryId}`) ?? 0).toFixed(4)),
        data,
      });
    }
  }

  // 处理 Wiki 结果
  for (const slug of wikiSlugs) {
    const data = wikiData.get(slug);
    if (data) {
      results.push({
        sourceType: 'wiki',
        sourceId: slug,
        imageUrl: imageUrlBySourceId.get(`wiki:${slug}`) || '',
        similarity: Number((scoreBySourceId.get(`wiki:${slug}`) ?? 0).toFixed(4)),
        data,
      });
    }
  }

  // 处理 Post 结果
  for (const postId of postIds) {
    const data = postData.get(postId);
    if (data) {
      results.push({
        sourceType: 'post',
        sourceId: postId,
        imageUrl: imageUrlBySourceId.get(`post:${postId}`) || '',
        similarity: Number((scoreBySourceId.get(`post:${postId}`) ?? 0).toFixed(4)),
        data,
      });
    }
  }

  // 按相似度排序
  results.sort((a, b) => b.similarity - a.similarity);

  return results;
}

export function rrfScore(ranks: Array<number | undefined>): number {
  return ranks.reduce((sum, rank) => {
    if (rank === undefined || rank < 0) return sum;
    return sum + 1 / (RRF_K + rank);
  }, 0);
}

export async function fetchVectorSearchWithTimeout(
  q: string,
  limit: number,
  minScore: number,
  timeoutMs: number,
  authUser?: ApiUser
): Promise<{ results: SemanticSearchResult[]; timedOut: boolean }> {
  const results = await Promise.race([
    (async (): Promise<{ results: SemanticSearchResult[]; timedOut: boolean }> => {
      const queryVector = await generateTextEmbedding(q);
      const matches = await searchImageEmbeddingPoints({
        vector: queryVector,
        limit,
        minScore,
      });
      return { results: await processSemanticSearchResults(matches, authUser), timedOut: false };
    })(),
    new Promise<{ results: SemanticSearchResult[]; timedOut: boolean }>((resolve) =>
      setTimeout(() => resolve({ results: [], timedOut: true }), timeoutMs)
    ),
  ]);
  return results;
}

async function fetchTextVectorSearchWithTimeout(
  q: string,
  limit: number,
  minScore: number,
  timeoutMs: number,
  authUser?: ApiUser
): Promise<{ results: TextSearchResult[]; timedOut: boolean }> {
  if (!isTextModelLoaded()) {
    return { results: [], timedOut: false }
  }

  const results = await Promise.race([
    (async (): Promise<{ results: TextSearchResult[]; timedOut: boolean }> => {
      const queryVector = await generateTextEmbedding(q)
      const matches = await searchTextEmbeddingPoints(queryVector, limit, minScore)
      return { results: await processTextSearchResults(matches, authUser), timedOut: false }
    })(),
    new Promise<{ results: TextSearchResult[]; timedOut: boolean }>((resolve) =>
      setTimeout(() => resolve({ results: [], timedOut: true }), timeoutMs)
    ),
  ])
  return results
}

async function processTextSearchResults(
  matches: Array<{ sourceType: string; sourceId: string; chunkIndex: number; chunkPreview: string; score: number }>,
  authUser?: ApiUser
): Promise<TextSearchResult[]> {
  const entityMap = new Map<string, { score: number; chunkPreview: string }>()

  for (const match of matches) {
    if (!match.sourceId || !match.sourceType) continue
    const key = `${match.sourceType}:${match.sourceId}`
    const existing = entityMap.get(key)
    if (!existing || match.score > existing.score) {
      entityMap.set(key, { score: match.score, chunkPreview: match.chunkPreview })
    }
  }

  const wikiSlugs: string[] = []
  const postIds: string[] = []
  const musicDocIds: string[] = []
  const albumDocIds: string[] = []

  for (const [key] of entityMap) {
    const colonIdx = key.indexOf(':')
    const sourceType = key.slice(0, colonIdx)
    const sourceId = key.slice(colonIdx + 1)
    if (sourceType === 'wiki' && !wikiSlugs.includes(sourceId)) wikiSlugs.push(sourceId)
    else if (sourceType === 'post' && !postIds.includes(sourceId)) postIds.push(sourceId)
    else if (sourceType === 'music' && !musicDocIds.includes(sourceId)) musicDocIds.push(sourceId)
    else if (sourceType === 'album' && !albumDocIds.includes(sourceId)) albumDocIds.push(sourceId)
  }

  const [wikiRows, postRows, musicRows, albumRows] = await Promise.all([
    wikiSlugs.length
      ? prisma.wikiPage.findMany({ where: { slug: { in: wikiSlugs }, ...buildWikiVisibilityWhere(authUser) }, include: { location: true } })
      : Promise.resolve([]),
    postIds.length
      ? prisma.post.findMany({ where: { id: { in: postIds }, ...buildPostVisibilityWhere(authUser) }, include: { location: true } })
      : Promise.resolve([]),
    musicDocIds.length
      ? prisma.musicTrack.findMany({ where: { docId: { in: musicDocIds } } }) // MusicTrack model has no visibility field — all tracks are publicly searchable
      : Promise.resolve([]),
    albumDocIds.length
      ? prisma.album.findMany({ where: { docId: { in: albumDocIds } } }) // Album model has no visibility field — all albums are publicly searchable
      : Promise.resolve([]),
  ])

  const wikiBySlug = new Map(wikiRows.map((w) => [w.slug, w]))
  const postById = new Map(postRows.map((p) => [p.id, p]))
  const musicByDocId = new Map(musicRows.map((m) => [m.docId, m]))
  const albumByDocId = new Map(albumRows.map((a) => [a.docId, a]))

  const results: TextSearchResult[] = []

  for (const [key, meta] of entityMap) {
    const colonIdx = key.indexOf(':')
    const sourceType = key.slice(0, colonIdx)
    const sourceId = key.slice(colonIdx + 1)
    let entity: any = null

    if (sourceType === 'wiki') entity = wikiBySlug.get(sourceId)
    else if (sourceType === 'post') entity = postById.get(sourceId)
    else if (sourceType === 'music') entity = musicByDocId.get(sourceId)
    else if (sourceType === 'album') entity = albumByDocId.get(sourceId)

    if (!entity) continue

    results.push({
      sourceType,
      sourceId,
      score: meta.score,
      chunkPreview: meta.chunkPreview,
      entity,
    })
  }

  results.sort((a, b) => b.score - a.score)
  return results
}

export function buildHybridResponse(
  keywordResults: { wiki: any[]; posts: any[]; galleries: any[]; music: any[]; albums: any[] },
  vectorResults: SemanticSearchResult[],
  mode: string,
  query: string,
  degraded: boolean,
  degradationReason?: string,
  textResults?: TextSearchResult[]
): HybridSearchResponse {
  const keywordFlat: HybridSearchItem[] = [
    ...keywordResults.wiki.map((d, i) => ({ id: d.slug || String(i), type: 'wiki' as const, data: d, relevanceScore: 0, matchType: 'keyword' as const, keywordRank: i })),
    ...keywordResults.posts.map((d, i) => ({ id: d.id || String(i), type: 'post' as const, data: d, relevanceScore: 0, matchType: 'keyword' as const, keywordRank: i })),
    ...keywordResults.galleries.map((d, i) => ({ id: d.id || String(i), type: 'gallery' as const, data: d, relevanceScore: 0, matchType: 'keyword' as const, keywordRank: i })),
    ...keywordResults.music.map((d, i) => ({ id: d.docId || String(i), type: 'music' as const, data: d, relevanceScore: 0, matchType: 'keyword' as const, keywordRank: i })),
    ...keywordResults.albums.map((d, i) => ({ id: d.docId || String(i), type: 'album' as const, data: d, relevanceScore: 0, matchType: 'keyword' as const, keywordRank: i })),
  ];

  const vectorFlat: HybridSearchItem[] = vectorResults.map((r, i) => ({
    id: `${r.sourceType}:${r.sourceId}`,
    type: r.sourceType === 'gallery' ? 'gallery' : r.sourceType === 'wiki' ? 'wiki' : 'post',
    data: r.data,
    relevanceScore: 0,
    matchType: 'vector' as const,
    vectorDistance: r.similarity,
    vectorRank: i,
  }));

  const textFlat: HybridSearchItem[] = (textResults || []).map((r, i) => ({
    id: `${r.sourceType}:${r.sourceId}`,
    type: r.sourceType as HybridSearchItem['type'],
    data: r.entity,
    relevanceScore: 0,
    matchType: 'text' as const,
    textRank: i,
  }));

  const hasVectorResults = vectorResults.length > 0
  const hasTextResults = (textResults || []).length > 0
  const hasKeywordResults = keywordFlat.length > 0
  const keywordResultCount = keywordFlat.length

  if (mode === 'hybrid' && (hasVectorResults || hasTextResults) && hasKeywordResults) {
    const vectorMap = new Map(vectorFlat.map(v => [v.id, v]))
    const textMap = new Map(textFlat.map(v => [v.id, v]))

    for (const kw of keywordFlat) {
      const vec = vectorMap.get(kw.id)
      const txt = textMap.get(kw.id)
      if (vec) {
        kw.matchType = 'hybrid'
        kw.vectorDistance = vec.vectorDistance
        kw.vectorRank = vec.vectorRank
      }
      if (txt) {
        kw.matchType = 'hybrid'
        kw.textRank = txt.textRank
      }
      kw.relevanceScore = rrfScore([kw.keywordRank, kw.vectorRank, kw.textRank])
    }
    for (const v of vectorFlat) {
      if (!keywordFlat.find(k => k.id === v.id)) {
        const txt = textMap.get(v.id)
        if (txt) v.textRank = txt.textRank
        v.relevanceScore = rrfScore([undefined, v.vectorRank, v.textRank])
        keywordFlat.push(v)
      }
    }
    for (const t of textFlat) {
      if (!keywordFlat.find(k => k.id === t.id)) {
        const vec = vectorMap.get(t.id)
        if (vec) t.vectorRank = vec.vectorRank
        t.relevanceScore = rrfScore([undefined, t.vectorRank, t.textRank])
        keywordFlat.push(t)
      }
    }
    keywordFlat.sort((a, b) => b.relevanceScore - a.relevanceScore)
  } else if (mode === 'vector') {
    return {
      wiki: vectorFlat.filter(v => v.type === 'wiki').map(v => v.data as Awaited<ReturnType<typeof toWikiResponse>>),
      posts: vectorFlat.filter(v => v.type === 'post').map(v => v.data as Awaited<ReturnType<typeof toPostResponse>>),
      galleries: vectorFlat.filter(v => v.type === 'gallery').map(v => v.data as Awaited<ReturnType<typeof toGalleryResponse>>),
      music: [],
      albums: [],
      searchMeta: { mode: 'vector', query, degraded: false, keywordResultCount: 0, vectorResultCount: vectorResults.length, textVectorResultCount: (textResults || []).length },
    };
  }

  return {
    wiki: keywordFlat.filter(v => v.type === 'wiki').map(v => v.data as Awaited<ReturnType<typeof toWikiResponse>>),
    posts: keywordFlat.filter(v => v.type === 'post').map(v => v.data as Awaited<ReturnType<typeof toPostResponse>>),
    galleries: keywordFlat.filter(v => v.type === 'gallery').map(v => v.data as Awaited<ReturnType<typeof toGalleryResponse>>),
    music: keywordResults.music.map(toMusicResponse),
    albums: keywordResults.albums.map(toAlbumResponse),
    searchMeta: {
      mode: degraded ? 'keyword (degraded)' : mode,
      query,
      degraded,
      ...(degradationReason ? { degradationReason } : {}),
      keywordResultCount: keywordResultCount,
      vectorResultCount: vectorResults.length,
      textVectorResultCount: (textResults || []).length,
    },
  };
}

router.get('/', searchLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const type = typeof req.query.type === 'string' ? req.query.type : 'all';
    const mode = (typeof req.query.mode === 'string' ? req.query.mode : 'keyword') as 'keyword' | 'vector' | 'hybrid';
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const startDate = typeof req.query.startDate === 'string' ? parseDate(req.query.startDate) : null;
    const endDate = typeof req.query.endDate === 'string' ? parseDate(req.query.endDate) : null;
    const tagsParam = typeof req.query.tags === 'string' ? req.query.tags : '';
    const tags = tagsParam ? tagsParam.split(',').map(t => t.trim()).filter(Boolean) : [];

    const wantsWiki = type === 'all' || type === 'wiki';
    const wantsPosts = type === 'all' || type === 'posts';
    const wantsGalleries = type === 'all' || type === 'galleries';
    const wantsMusic = type === 'all' || type === 'music';
    const wantsAlbums = type === 'all' || type === 'albums';

    if (q) {
      increaseSearchKeywordCount(q);
    }

    const wikiVisibilityWhere = buildWikiVisibilityWhere(req.authUser);
    const postVisibilityWhere = buildPostVisibilityWhere(req.authUser);
    const galleryVisibilityWhere = buildGalleryVisibilityWhere(req.authUser);

    const cacheKey = `search:${q}:${category || 'all'}:${type}:${mode}:${req.authUser?.role || 'anonymous'}`;
    const cached = enhancedCache.get(cacheKey);
    if (cached) return res.json(cached);

    const wikiPromise = wantsWiki
      ? prisma.wikiPage.findMany({
          where: {
            ...wikiVisibilityWhere,
            ...(category ? { category } : {}),
            ...(q
              ? {
                  OR: [
                    { title: { contains: q } },
                    { content: { contains: q } },
                    { slug: { contains: q } },
                  ],
                }
              : {}),
            ...(startDate || endDate
              ? {
                  updatedAt: {
                    ...(startDate ? { gte: startDate } : {}),
                    ...(endDate ? { lte: endDate } : {}),
                  },
                }
              : {}),
          },
          orderBy: { updatedAt: 'desc' },
          take: 100,
        })
      : Promise.resolve([]);

    const postsPromise = wantsPosts
      ? prisma.post.findMany({
          where: {
            ...postVisibilityWhere,
            ...(category ? { section: category } : {}),
            ...(q
              ? {
                  OR: [
                    { title: { contains: q } },
                    { content: { contains: q } },
                  ],
                }
              : {}),
            ...(startDate || endDate
              ? {
                  updatedAt: {
                    ...(startDate ? { gte: startDate } : {}),
                    ...(endDate ? { lte: endDate } : {}),
                  },
                }
              : {}),
          },
          orderBy: { updatedAt: 'desc' },
          take: 100,
        })
      : Promise.resolve([]);

    const galleriesPromise = wantsGalleries
      ? prisma.gallery.findMany({
          where: {
            ...galleryVisibilityWhere,
            ...(q
              ? {
                  OR: [
                    { title: { contains: q } },
                    { description: { contains: q } },
                  ],
                }
              : {}),
            ...(startDate || endDate
              ? {
                  updatedAt: {
                    ...(startDate ? { gte: startDate } : {}),
                    ...(endDate ? { lte: endDate } : {}),
                  },
                }
              : {}),
          },
          orderBy: { updatedAt: 'desc' },
          take: 100,
        })
      : Promise.resolve([]);

    const musicPromise = wantsMusic
      ? prisma.musicTrack.findMany({
          where: {
            // MusicTrack model has no visibility field — all tracks are publicly searchable
            ...(q
              ? {
                  OR: [
                    { title: { contains: q } },
                    { artist: { contains: q } },
                    { album: { contains: q } },
                    { lyric: { contains: q } },
                  ],
                }
              : {}),
          },
          orderBy: { updatedAt: 'desc' },
          take: 100,
        })
      : Promise.resolve([]);

    const albumsPromise = wantsAlbums
      ? prisma.album.findMany({
          where: {
            // Album model has no visibility field — all albums are publicly searchable
            ...(q
              ? {
                  OR: [
                    { title: { contains: q } },
                    { artist: { contains: q } },
                    { description: { contains: q } },
                  ],
                }
              : {}),
          },
          orderBy: { updatedAt: 'desc' },
          take: 100,
        })
      : Promise.resolve([]);

    const [wiki, posts, galleries, music, albums] = await Promise.all([wikiPromise, postsPromise, galleriesPromise, musicPromise, albumsPromise]);

    if ((mode === 'hybrid' || mode === 'vector') && q) {
      let vectorResults: SemanticSearchResult[] = [];
      let textResults: TextSearchResult[] = [];
      let degraded = false;
      let degradationReason: string | undefined;

      const [vectorResponse, textResponse] = await Promise.all([
        fetchVectorSearchWithTimeout(q, VECTOR_SEARCH_CANDIDATE_LIMIT, 0.25, QDRANT_TIMEOUT_MS, req.authUser).catch((error) => {
          degraded = true;
          degradationReason = '向量搜索不可用：' + (error instanceof Error ? error.message : '未知错误');
          logger.warn({ err: error }, 'Vector search failed, degrading to keyword-only');
          return { results: [] as SemanticSearchResult[], timedOut: false };
        }),
        fetchTextVectorSearchWithTimeout(q, VECTOR_SEARCH_CANDIDATE_LIMIT, 0.25, QDRANT_TIMEOUT_MS, req.authUser).catch((error) => {
          logger.warn({ err: error }, 'Text vector search failed');
          return { results: [] as TextSearchResult[], timedOut: false };
        }),
      ]);

      vectorResults = vectorResponse.results;
      textResults = textResponse.results;

      if (vectorResponse.timedOut || textResponse.timedOut) {
        degraded = true;
        degradationReason = '向量搜索超时（>' + (QDRANT_TIMEOUT_MS / 1000) + 's），已自动降级为关键词搜索模式';
      }

      const keywordRaw = {
        wiki: wiki.map(toWikiResponse),
        posts: posts.map(toPostResponse),
        galleries: await Promise.all(galleries.map(g => toGalleryResponse(g))),
        music: music,
        albums: albums,
      };

      const hybridResponse = buildHybridResponse(keywordRaw, vectorResults, mode, q, degraded, degradationReason, textResults);
      enhancedCache.set(cacheKey, hybridResponse, 30);
      return res.json(hybridResponse);
    }

    const keywordResult = {
      wiki: wiki.map(toWikiResponse),
      posts: posts.map(toPostResponse),
      galleries: await Promise.all(galleries.map(g => toGalleryResponse(g))),
      music: music.map(toMusicResponse),
      albums: albums.map(toAlbumResponse),
      searchMeta: { mode: 'keyword', query: q, degraded: false, keywordResultCount: wiki.length + posts.length + galleries.length + music.length + albums.length, vectorResultCount: 0, textVectorResultCount: 0 },
    };
    enhancedCache.set(cacheKey, keywordResult, 30);
    res.json(keywordResult);
  } catch (error) {
    logger.error({ err: error }, 'Search error');
    res.status(500).json({ error: '搜索失败' });
  }
});

router.get('/text-semantic', searchLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    const requestedLimit = parseInteger(req.query.limit as string, IMAGE_SEARCH_RESULT_LIMIT, {
      min: 1,
      max: 60,
    })
    const minScore = parseMinSimilarityScore(req.query.minScore as string)

    if (!q) {
      res.status(400).json({ error: '请提供搜索文字 (q 参数)' })
      return
    }

    const textResponse = await fetchTextVectorSearchWithTimeout(q, requestedLimit, minScore, QDRANT_TIMEOUT_MS, req.authUser)

    res.json({
      results: textResponse.results,
      total: textResponse.results.length,
      query: q,
      minScore,
    })
  } catch (error) {
    logger.error({ err: error }, 'Text semantic search error')
    res.status(500).json({ error: '文本语义搜索失败' })
  }
})

router.get('/hot-keywords', async (_req, res) => {
  try {
    const keywords = await prisma.searchKeyword.findMany({
      orderBy: [{ count: 'desc' }, { updatedAt: 'desc' }],
      take: 20,
    });

    res.json({
      keywords: keywords.map((k) => ({
        keyword: k.keyword,
        count: k.count,
      })),
    });
  } catch (error) {
    logger.error({ err: error }, 'Fetch hot keywords error');
    res.status(500).json({ error: '获取热门关键词失败' });
  }
});

router.post('/by-image', searchLimiter, searchImageUpload.single('image'), async (req: AuthenticatedRequest, res) => {
  const tempFile = req.file;
  try {
    const requestedLimit = parseInteger(req.body?.limit, IMAGE_SEARCH_RESULT_LIMIT, {
      min: 1,
      max: 60,
    });
    const minScore = parseMinSimilarityScore(req.body?.minScore);

    let imageBuffer: Buffer | null = null;

    if (tempFile?.path) {
      try {
        imageBuffer = await fs.promises.readFile(tempFile.path);
      } catch {
        imageBuffer = null;
      }
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      const base64Payload = extractBase64Payload(req.body?.imageBase64);
      if (base64Payload) {
        try {
          imageBuffer = Buffer.from(base64Payload, 'base64');
        } catch {
          imageBuffer = null;
        }
      }
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      res.status(400).json({ error: '请上传图片文件，或提供 imageBase64' });
      return;
    }

    const queryVector = await generateImageEmbedding(imageBuffer);
    const matches = await searchImageEmbeddingPoints({
      vector: queryVector,
      limit: requestedLimit,
      minScore,
    });

    const results = await processSemanticSearchResults(matches, req.authUser);

    res.json({
      mode: 'semantic_image',
      totalMatches: results.length,
      results,
    });
  } catch (error) {
    logger.error({ err: error }, 'Image semantic search error');
    res.status(500).json({ error: '图片语义搜索失败' });
  } finally {
    if (tempFile?.path) {
      await fs.promises.unlink(tempFile.path).catch((err) => logger.debug({ err }, 'Failed to delete temp file'));
    }
  }
});

/**
 * 新的语义搜索接口 - 支持混合结果
 */
router.get('/semantic-search', searchLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const requestedLimit = parseInteger(req.query.limit as string, IMAGE_SEARCH_RESULT_LIMIT, {
      min: 1,
      max: 60,
    });
    const minScore = parseMinSimilarityScore(req.query.minScore);

    if (!q) {
      res.status(400).json({ error: '请提供搜索文字 (q 参数)' });
      return;
    }

    const queryVector = await generateTextEmbedding(q);
    const matches = await searchImageEmbeddingPoints({
      vector: queryVector,
      limit: requestedLimit,
      minScore,
    });

    const results = await processSemanticSearchResults(matches, req.authUser);

    res.json({
      mode: 'semantic_text',
      query: q,
      totalMatches: results.length,
      results,
    });
  } catch (error) {
    logger.error({ err: error }, 'Semantic search error');
    res.status(500).json({ error: '语义搜索失败' });
  }
});

/**
 * 旧的语义搜索接口 - 保持向后兼容
 * @deprecated 请使用 /semantic-search
 */
router.get('/semantic-galleries', searchLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const requestedLimit = parseInteger(req.query.limit as string, IMAGE_SEARCH_RESULT_LIMIT, {
      min: 1,
      max: 60,
    });
    const minScore = parseMinSimilarityScore(req.query.minScore);

    if (!q) {
      res.status(400).json({ error: '请提供搜索文字 (q 参数)' });
      return;
    }

    const queryVector = await generateTextEmbedding(q);
    const matches = await searchImageEmbeddingPoints({
      vector: queryVector,
      limit: requestedLimit,
      minScore,
    });

    // 只返回 gallery 类型的结果，保持旧接口行为
    const galleryIds: string[] = [];
    const scoreByGalleryId = new Map<string, number>();
    const seenImageIds = new Set<string>();

    matches.forEach((match) => {
      const parsed = match.payload;
      if (!parsed) return;

      // 只处理 gallery 类型
      if (parsed.sourceType !== 'gallery') return;

      // 向后兼容：使用 galleryId 作为 sourceId
      const galleryId = parsed.galleryId || parsed.sourceId;
      if (!galleryId) return;

      if (parsed.galleryImageId) {
        seenImageIds.add(parsed.galleryImageId);
      }

      const score = typeof match.score === 'number' ? match.score : 0;
      const previousBest = scoreByGalleryId.get(galleryId);
      if (previousBest === undefined || score > previousBest) {
        scoreByGalleryId.set(galleryId, score);
      }

      if (!galleryIds.includes(galleryId)) {
        galleryIds.push(galleryId);
      }
    });

    if (!galleryIds.length) {
      res.json({
        mode: 'semantic_text',
        query: q,
        totalMatches: 0,
        totalGalleries: 0,
        galleries: [],
      });
      return;
    }

    const galleryRows = await prisma.gallery.findMany({
      where: {
        id: { in: galleryIds },
        ...buildGalleryVisibilityWhere(req.authUser),
      },
      include: {
        images: {
          include: {
            asset: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    const galleryById = new Map(galleryRows.map((gallery) => [gallery.id, gallery]));
    const galleries = (await Promise.all(
      galleryIds.map(async (galleryId) => {
        const gallery = galleryById.get(galleryId);
        if (!gallery) {
          return null;
        }
        return {
          ...(await toGalleryResponse(gallery)),
          similarity: Number((scoreByGalleryId.get(galleryId) ?? 0).toFixed(4)),
        };
      })
    )).filter((item): item is Awaited<ReturnType<typeof toGalleryResponse>> & { similarity: number } => item !== null);

    res.json({
      mode: 'semantic_text',
      query: q,
      totalMatches: seenImageIds.size,
      totalGalleries: galleries.length,
      galleries,
    });
  } catch (error) {
    logger.error({ err: error }, 'Semantic gallery search error');
    res.status(500).json({ error: '语义搜索画廊失败' });
  }
});

router.get('/suggest', searchLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q || q.length < 2) {
      res.json({ suggestions: [] });
      return;
    }

    const normalized = normalizeKeyword(q);

    const [keywordMatches, wikiMatches, postMatches, musicMatches, albumMatches] = await Promise.all([
      prisma.searchKeyword.findMany({
        where: { keyword: { contains: normalized } },
        orderBy: { count: 'desc' },
        take: 5,
        select: { keyword: true, count: true },
      }),
      prisma.wikiPage.findMany({
        where: {
          ...buildWikiVisibilityWhere(req.authUser),
          OR: [
            { title: { contains: q } },
            { slug: { contains: q } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: 3,
        select: { slug: true, title: true, category: true },
      }),
      prisma.post.findMany({
        where: {
          status: 'published',
          OR: [
            { title: { contains: q } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: 3,
        select: { id: true, title: true, section: true },
      }),
      prisma.musicTrack.findMany({
        where: {
          OR: [
            { title: { contains: q } },
            { artist: { contains: q } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: 3,
        select: { docId: true, title: true, artist: true },
      }),
      prisma.album.findMany({
        where: {
          OR: [
            { title: { contains: q } },
            { artist: { contains: q } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: 3,
        select: { docId: true, title: true, artist: true },
      }),
    ]);

    const suggestions: Array<{ type: 'keyword' | 'wiki' | 'post' | 'music' | 'album'; text: string; subtext?: string; id?: string }> = [];

    keywordMatches.forEach((k) => {
      suggestions.push({ type: 'keyword', text: k.keyword, subtext: `${k.count} 次搜索` });
    });

    wikiMatches.forEach((w) => {
      suggestions.push({ type: 'wiki', text: w.title, subtext: w.category, id: w.slug });
    });

    postMatches.forEach((p) => {
      suggestions.push({ type: 'post', text: p.title, subtext: p.section, id: p.id });
    });

    musicMatches.forEach((m) => {
      suggestions.push({ type: 'music', text: m.title, subtext: m.artist, id: m.docId });
    });

    albumMatches.forEach((a) => {
      suggestions.push({ type: 'album', text: a.title, subtext: a.artist, id: a.docId });
    });

    res.json({ suggestions });
  } catch (error) {
    logger.error({ err: error }, 'Search suggest error');
    res.status(500).json({ error: '搜索建议失败' });
  }
});

export function registerSearchRoutes(app: Router) {
  app.use('/api/search', router);
}
