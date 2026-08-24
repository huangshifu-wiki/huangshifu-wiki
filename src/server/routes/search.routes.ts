import type { Prisma } from '@prisma/client'
import { Router, type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import { requireAuth, requireAdmin, type AuthenticatedRequest } from '../middleware/auth'
import { searchLimiter } from '../middleware/rateLimiter'
import type { ApiUser } from '../types'
import {
  parseInteger,
  parsePagination,
  createPaginationMeta,
  parseMinSimilarityScore,
  parseBoolean,
  extractBase64Payload,
  normalizeKeyword,
  increaseSearchKeywordCount,
  buildWikiVisibilityWhere,
  buildPostVisibilityWhere,
  buildGalleryVisibilityWhere,
  fetchSongsWithRelations,
  findMusicDocIdsByArtistPartial,
  toWikiResponse,
  toPostResponse,
  toGalleryResponse,
  toGalleryListResponse,
  toMusicResponse,
  toAlbumResponse,
  parseDate,
  enhancedCache,
  logger,
  isSemanticSearchEnabled,
  isSearchHotKeywordsEnabled,
} from '../utils'
import { prisma } from '../prisma'
import { runtimeConfigService } from '../services/runtimeConfig.service'
import { UPLOAD_MAX_FILE_SIZE_BYTES } from '../../lib/uploadLimits'
import { formatMusicCredits } from '../../lib/musicCredits'
import { parseLyrics } from '../../lib/lrcParser'
import type { LyricMatchLine, LyricSearchItem } from '../../types/entities'
import type { ImageSourceType, ImageEmbeddingPayload } from '../vector/qdrantService'
import type { SemanticSearchResult } from '../../types/api'
import { createUploadStorageInfo } from '../uploadPath'

const router = Router()

const SEARCH_PAGE_SIZE = 20
const VECTOR_SCAN_BATCH_SIZE = 100
export const RRF_K = 60
const MAX_MATCHED_LINES_PER_SONG = 30

function makeSearchPage<T>(items: T[], total: number, pagination: { page: number; limit: number }) {
  const totalPages = Math.max(1, Math.ceil(total / pagination.limit))
  const page = Math.min(pagination.page, totalPages)
  return {
    items,
    ...createPaginationMeta(total, page, pagination.limit, items.length),
  }
}
function makeHybridPagedResponse(
  response: HybridSearchResponse,
  pages: Record<
    'wiki' | 'posts' | 'galleries' | 'music' | 'albums' | 'lyrics',
    { page: number; limit: number; offset?: number }
  >
) {
  const page = <T>(items: T[], pagination: { page: number; limit: number; offset?: number }) => {
    const total = items.length
    const meta = makeSearchPage(
      items.slice(
        pagination.offset ?? (pagination.page - 1) * pagination.limit,
        (pagination.offset ?? (pagination.page - 1) * pagination.limit) + pagination.limit
      ),
      total,
      pagination
    )
    return meta
  }
  return {
    wiki: page(response.wiki, pages.wiki),
    posts: page(response.posts, pages.posts),
    galleries: page(response.galleries, pages.galleries),
    music: page(response.music, pages.music),
    albums: page(response.albums, pages.albums),
    lyrics: page(response.lyrics || [], pages.lyrics),
    searchMeta: response.searchMeta,
  }
}

function getQdrantTimeoutMs(): number {
  return runtimeConfigService.getConfig().qdrantTimeoutMs
}
type ImageSearchSessionResult = Pick<
  SemanticSearchResult,
  'sourceType' | 'sourceId' | 'imageUrl' | 'similarity'
>
type ImageSearchSession = {
  userId: string | null
  results: ImageSearchSessionResult[]
  expiresAt: number
}

const imageSearchSessions = new Map<string, ImageSearchSession>()

function cleanupExpiredImageSearchSessions() {
  const now = Date.now()
  for (const [key, session] of imageSearchSessions) {
    if (session.expiresAt <= now) imageSearchSessions.delete(key)
  }
}

async function scanAllImageEmbeddingPoints(
  vector: number[],
  minScore?: number,
  timeoutMs = getQdrantTimeoutMs()
) {
  const { searchImageEmbeddingPoints } = await loadQdrantService()
  const matches = []
  const deadline = Date.now() + timeoutMs
  for (let offset = 0; ; offset += VECTOR_SCAN_BATCH_SIZE) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('Qdrant 搜索超时')
    const batch = await Promise.race([
      searchImageEmbeddingPoints({
        vector,
        limit: VECTOR_SCAN_BATCH_SIZE,
        offset,
        minScore,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Qdrant 搜索超时')), remaining)
      ),
    ])
    matches.push(...batch)
    if (batch.length < VECTOR_SCAN_BATCH_SIZE) break
  }
  return matches
}
// 音乐搜索与歌词搜索共用的歌曲字段，覆盖 toMusicResponse 必填入参
// （description/customPlatformLinks 为可选字段，搜索结果有意不取）
const MUSIC_SEARCH_SELECT = {
  docId: true,
  slug: true,
  title: true,
  artists: true,
  lyricists: true,
  composers: true,
  arrangers: true,
  vocals: true,
  album: true,
  tags: true,
  audioUrl: true,
  playableOverride: true,
  releaseDate: true,
  durationMs: true,
  coverId: true,
  coverAlbumDocId: true,
  displayAlbumMode: true,
  manualAlbumName: true,
  externalSources: {
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  },
  covers: {
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      publicUrl: true,
      thumbnailUrl: true,
      isDefault: true,
      sortOrder: true,
    },
  },
  albumRelations: {
    include: {
      album: {
        select: {
          docId: true,
          slug: true,
          title: true,
          artist: true,
          releaseDate: true,
          coverId: true,
          covers: {
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true,
              publicUrl: true,
              thumbnailUrl: true,
              isDefault: true,
            },
          },
        },
      },
    },
    orderBy: [{ discNumber: 'asc' }, { trackOrder: 'asc' }],
  },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.MusicTrackSelect
const SEMANTIC_SEARCH_DISABLED_MESSAGE = '语义搜索功能未启用'

type ClipEmbeddingModule = typeof import('../vector/clipEmbedding')
type QdrantServiceModule = typeof import('../vector/qdrantService')

let clipEmbeddingModulePromise: Promise<ClipEmbeddingModule> | null = null
let qdrantServiceModulePromise: Promise<QdrantServiceModule> | null = null

async function loadClipEmbedding() {
  if (!isSemanticSearchEnabled()) {
    throw new Error(SEMANTIC_SEARCH_DISABLED_MESSAGE)
  }
  clipEmbeddingModulePromise ??= import('../vector/clipEmbedding')
  return clipEmbeddingModulePromise
}

async function loadQdrantService() {
  if (!isSemanticSearchEnabled()) {
    throw new Error(SEMANTIC_SEARCH_DISABLED_MESSAGE)
  }
  qdrantServiceModulePromise ??= import('../vector/qdrantService')
  return qdrantServiceModulePromise
}

function requireSemanticSearchEnabled(_req: Request, res: Response, next: NextFunction) {
  if (!isSemanticSearchEnabled()) {
    res.status(404).json({ error: SEMANTIC_SEARCH_DISABLED_MESSAGE })
    return
  }
  next()
}

interface HybridSearchItem {
  id: string
  type: 'wiki' | 'post' | 'gallery' | 'music' | 'album'
  data: unknown
  relevanceScore: number
  matchType: 'keyword' | 'vector' | 'hybrid' | 'text'
  vectorDistance?: number
  keywordRank?: number
  vectorRank?: number
  textRank?: number
}

interface HybridSearchResponse {
  wiki: Awaited<ReturnType<typeof toWikiResponse>>[]
  posts: Awaited<ReturnType<typeof toPostResponse>>[]
  galleries: Awaited<ReturnType<typeof toGalleryResponse>>[]
  music: Awaited<ReturnType<typeof toMusicResponse>>[]
  albums: Awaited<ReturnType<typeof toAlbumResponse>>[]
  lyrics?: LyricSearchItem[]
  searchMeta: {
    mode: string
    query: string
    degraded: boolean
    degradationReason?: string
    keywordResultCount: number
    vectorResultCount: number
    textVectorResultCount: number
  }
}

const searchImageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, file, cb) => {
      const info = createUploadStorageInfo(
        process.env.UPLOADS_PATH || 'uploads',
        'search',
        file.originalname
      )
      ;(
        file as Express.Multer.File & { uploadInfo?: ReturnType<typeof createUploadStorageInfo> }
      ).uploadInfo = info
      cb(null, info.absoluteDir)
    },
    filename: (_req, file, cb) => {
      const info = (
        file as Express.Multer.File & { uploadInfo?: ReturnType<typeof createUploadStorageInfo> }
      ).uploadInfo
      cb(null, info?.fileName || file.originalname)
    },
  }),
  limits: {
    fileSize: UPLOAD_MAX_FILE_SIZE_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    const mime = (file.mimetype || '').toLowerCase()
    const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])
    const ALLOWED_IMAGE_MIME_TYPES = new Set([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/bmp',
    ])
    if (!ALLOWED_IMAGE_EXTENSIONS.has(ext) || !ALLOWED_IMAGE_MIME_TYPES.has(mime)) {
      cb(new Error('仅支持 JPG、PNG、WEBP、GIF、BMP 图片上传'))
      return
    }
    cb(null, true)
  },
})

type TextSearchResult = {
  sourceType: string
  sourceId: string
  score: number
  chunkPreview: string
  entity: Record<string, unknown>
}

/**
 * 获取 Gallery 数据
 */
async function fetchGalleryData(
  galleryIds: string[],
  authUser?: ApiUser
): Promise<Map<string, Awaited<ReturnType<typeof toGalleryResponse>>>> {
  if (!galleryIds.length) {
    return new Map()
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
  })

  const result = new Map<string, Awaited<ReturnType<typeof toGalleryResponse>>>()
  for (const gallery of galleryRows) {
    result.set(gallery.id, await toGalleryResponse(gallery))
  }
  return result
}

/**
 * 查询一批歌曲 ID 中当前用户已收藏的集合
 */
async function fetchFavoritedMusicDocIds(
  docIds: string[],
  authUser?: ApiUser
): Promise<Set<string>> {
  const favorited = new Set<string>()
  if (!authUser || !docIds.length) {
    return favorited
  }

  const favorites = await prisma.favorite.findMany({
    where: {
      userUid: authUser.uid,
      targetType: 'music',
      targetId: { in: docIds },
    },
    select: { targetId: true },
  })
  favorites.forEach((item) => favorited.add(item.targetId))
  return favorited
}

/**
 * 获取 WikiPage 数据
 */
async function fetchWikiData(
  slugs: string[],
  authUser?: ApiUser
): Promise<Map<string, ReturnType<typeof toWikiResponse>>> {
  if (!slugs.length) {
    return new Map()
  }

  const wikiRows = await prisma.wikiPage.findMany({
    where: {
      slug: { in: slugs },
      ...buildWikiVisibilityWhere(authUser),
    },
    include: {
      lastEditor: { select: { displayName: true } },
      location: true,
    },
  })

  const result = new Map<string, ReturnType<typeof toWikiResponse>>()
  for (const wiki of wikiRows) {
    result.set(wiki.slug, toWikiResponse(wiki))
  }
  return result
}

/**
 * 获取 Post 数据
 */
async function fetchPostData(
  ids: string[],
  authUser?: ApiUser
): Promise<Map<string, ReturnType<typeof toPostResponse>>> {
  if (!ids.length) {
    return new Map()
  }

  const postRows = await prisma.post.findMany({
    where: {
      id: { in: ids },
      ...buildPostVisibilityWhere(authUser),
    },
    include: {
      location: true,
    },
  })

  const result = new Map<string, ReturnType<typeof toPostResponse>>()
  for (const post of postRows) {
    result.set(post.id, toPostResponse(post))
  }
  return result
}

type LyricSearchTrack = Parameters<typeof toMusicResponse>[0] & {
  lyric: string | null
  lyricPlain: string | null
}

/**
 * 从命中歌词的歌曲中提取匹配行，按歌曲分组返回
 */
function buildLyricSearchItems(tracks: LyricSearchTrack[], q: string): LyricSearchItem[] {
  const items: LyricSearchItem[] = []

  for (const track of tracks) {
    const parsedLines: LyricMatchLine[] = track.lyric
      ? parseLyrics(track.lyric).lines.map((line, index) => ({ index, text: line.text }))
      : []
    const plainLines: LyricMatchLine[] = track.lyricPlain
      ? track.lyricPlain.split(/\r?\n/).map((text, index) => ({ index, text }))
      : []

    // 优先用解析后的歌词行匹配（剥离时间标签/元数据）；无命中时兑底 lyricPlain
    let matchedLines = parsedLines
      .filter((line) => line.text.includes(q))
      .slice(0, MAX_MATCHED_LINES_PER_SONG)
    if (matchedLines.length === 0) {
      matchedLines = plainLines
        .filter((line) => line.text.includes(q))
        .slice(0, MAX_MATCHED_LINES_PER_SONG)
    }
    if (matchedLines.length === 0) continue

    const song = toMusicResponse(track)
    items.push({
      docId: song.docId,
      slug: song.slug,
      title: song.title,
      artists: song.artists,
      album: song.album,
      cover: song.cover,
      coverThumbnail: song.coverThumbnail,
      matchedLines,
    })
  }

  return items
}

/**
 * 处理语义搜索结果，根据 sourceType 分别查询数据并合并
 */
async function processSemanticSearchResults(
  matches: Array<{ id: string | number; score: number; payload: ImageEmbeddingPayload | null }>,
  authUser?: ApiUser
): Promise<SemanticSearchResult[]> {
  // 按 sourceType 分组
  const galleryIds: string[] = []
  const galleryIdSet = new Set<string>()
  const wikiSlugs: string[] = []
  const wikiSlugSet = new Set<string>()
  const postIds: string[] = []
  const postIdSet = new Set<string>()

  // 记录每个 sourceId 的最高相似度分数
  const scoreBySourceId = new Map<string, number>()
  // 记录每个 sourceId 对应的图片 URL
  const imageUrlBySourceId = new Map<string, string>()

  for (const match of matches) {
    if (!match.payload) continue

    const score = typeof match.score === 'number' ? match.score : 0
    const { sourceType, sourceId, imageUrl } = match.payload

    if (!sourceId) continue

    // 更新最高分数
    const previousBest = scoreBySourceId.get(`${sourceType}:${sourceId}`)
    if (previousBest === undefined || score > previousBest) {
      scoreBySourceId.set(`${sourceType}:${sourceId}`, score)
      if (imageUrl) {
        imageUrlBySourceId.set(`${sourceType}:${sourceId}`, imageUrl)
      }
    }

    // 去重收集 ID
    if (sourceType === 'gallery' && !galleryIdSet.has(sourceId)) {
      galleryIds.push(sourceId)
      galleryIdSet.add(sourceId)
    } else if (sourceType === 'wiki' && !wikiSlugSet.has(sourceId)) {
      wikiSlugs.push(sourceId)
      wikiSlugSet.add(sourceId)
    } else if (sourceType === 'post' && !postIdSet.has(sourceId)) {
      postIds.push(sourceId)
      postIdSet.add(sourceId)
    }
  }

  // 并行获取各类数据
  const [galleryData, wikiData, postData] = await Promise.all([
    fetchGalleryData(galleryIds, authUser),
    fetchWikiData(wikiSlugs, authUser),
    fetchPostData(postIds, authUser),
  ])

  // 构建结果数组
  const results: SemanticSearchResult[] = []

  // 处理 Gallery 结果
  for (const galleryId of galleryIds) {
    const data = galleryData.get(galleryId)
    if (data) {
      results.push({
        sourceType: 'gallery',
        sourceId: galleryId,
        imageUrl: imageUrlBySourceId.get(`gallery:${galleryId}`) || '',
        similarity: Number((scoreBySourceId.get(`gallery:${galleryId}`) ?? 0).toFixed(4)),
        data,
      })
    }
  }

  // 处理 Wiki 结果
  for (const slug of wikiSlugs) {
    const data = wikiData.get(slug)
    if (data) {
      results.push({
        sourceType: 'wiki',
        sourceId: slug,
        imageUrl: imageUrlBySourceId.get(`wiki:${slug}`) || '',
        similarity: Number((scoreBySourceId.get(`wiki:${slug}`) ?? 0).toFixed(4)),
        data,
      })
    }
  }

  // 处理 Post 结果
  for (const postId of postIds) {
    const data = postData.get(postId)
    if (data) {
      results.push({
        sourceType: 'post',
        sourceId: postId,
        imageUrl: imageUrlBySourceId.get(`post:${postId}`) || '',
        similarity: Number((scoreBySourceId.get(`post:${postId}`) ?? 0).toFixed(4)),
        data,
      })
    }
  }

  // 按相似度排序
  results.sort((a, b) => b.similarity - a.similarity)

  return results
}

export function rrfScore(ranks: Array<number | undefined>): number {
  return ranks.reduce((sum, rank) => {
    if (rank === undefined || rank < 0) return sum
    return sum + 1 / (RRF_K + rank)
  }, 0)
}

export async function fetchVectorSearchWithTimeout(
  q: string,
  _limit: number,
  minScore: number,
  timeoutMs: number,
  authUser?: ApiUser
): Promise<{ results: SemanticSearchResult[]; timedOut: boolean }> {
  if (!isSemanticSearchEnabled()) return { results: [], timedOut: false }
  const results = await Promise.race([
    (async () => {
      const [{ generateTextEmbedding }, { searchImageEmbeddingPoints }] = await Promise.all([
        loadClipEmbedding(),
        loadQdrantService(),
      ])
      const queryVector = await generateTextEmbedding(q)
      const matches = []
      for (let offset = 0; ; offset += VECTOR_SCAN_BATCH_SIZE) {
        const batch = await searchImageEmbeddingPoints({
          vector: queryVector,
          limit: VECTOR_SCAN_BATCH_SIZE,
          offset,
          minScore,
        })
        matches.push(...batch)
        if (batch.length < VECTOR_SCAN_BATCH_SIZE) break
      }
      return { results: await processSemanticSearchResults(matches, authUser), timedOut: false }
    })(),
    new Promise<{ results: SemanticSearchResult[]; timedOut: boolean }>((resolve) =>
      setTimeout(() => resolve({ results: [], timedOut: true }), timeoutMs)
    ),
  ])
  return results
}

async function fetchTextVectorSearchWithTimeout(
  q: string,
  _limit: number,
  minScore: number,
  timeoutMs: number,
  authUser?: ApiUser
): Promise<{ results: TextSearchResult[]; timedOut: boolean }> {
  if (!isSemanticSearchEnabled()) return { results: [], timedOut: false }
  const results = await Promise.race([
    (async () => {
      const [{ generateTextEmbedding, isTextModelLoaded }, { searchTextEmbeddingPoints }] =
        await Promise.all([loadClipEmbedding(), loadQdrantService()])
      if (!isTextModelLoaded()) return { results: [], timedOut: false }
      const queryVector = await generateTextEmbedding(q)
      const matches = []
      for (let offset = 0; ; offset += VECTOR_SCAN_BATCH_SIZE) {
        const batch = await searchTextEmbeddingPoints(
          queryVector,
          VECTOR_SCAN_BATCH_SIZE,
          minScore,
          offset
        )
        matches.push(...batch)
        if (batch.length < VECTOR_SCAN_BATCH_SIZE) break
      }
      return { results: await processTextSearchResults(matches, authUser), timedOut: false }
    })(),
    new Promise<{ results: TextSearchResult[]; timedOut: boolean }>((resolve) =>
      setTimeout(() => resolve({ results: [], timedOut: true }), timeoutMs)
    ),
  ])
  return results
}

async function processTextSearchResults(
  matches: Array<{
    sourceType: string
    sourceId: string
    chunkIndex: number
    chunkPreview: string
    score: number
  }>,
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
      ? prisma.wikiPage.findMany({
          where: { slug: { in: wikiSlugs }, ...buildWikiVisibilityWhere(authUser) },
          include: { location: true },
        })
      : Promise.resolve([]),
    postIds.length
      ? prisma.post.findMany({
          where: { id: { in: postIds }, ...buildPostVisibilityWhere(authUser) },
          include: { location: true },
        })
      : Promise.resolve([]),
    musicDocIds.length
      ? fetchSongsWithRelations({ docId: { in: musicDocIds }, deletedAt: null })
      : Promise.resolve([]),
    albumDocIds.length
      ? prisma.album.findMany({ where: { docId: { in: albumDocIds }, deletedAt: null } })
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
    let entity: Record<string, unknown> | null = null

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
  keywordResults: {
    wiki: Record<string, unknown>[]
    posts: Record<string, unknown>[]
    galleries: Record<string, unknown>[]
    music: Record<string, unknown>[]
    albums: Record<string, unknown>[]
  },
  vectorResults: SemanticSearchResult[],
  mode: string,
  query: string,
  degraded: boolean,
  degradationReason?: string,
  textResults?: TextSearchResult[],
  favoritedMusicIds?: Set<string>
): HybridSearchResponse {
  const keywordFlat: HybridSearchItem[] = [
    ...keywordResults.wiki.map((d, i) => ({
      id: `wiki:${d.slug ?? i}`,
      type: 'wiki' as const,
      data: d,
      relevanceScore: 0,
      matchType: 'keyword' as const,
      keywordRank: i,
    })),
    ...keywordResults.posts.map((d, i) => ({
      id: `post:${d.id ?? i}`,
      type: 'post' as const,
      data: d,
      relevanceScore: 0,
      matchType: 'keyword' as const,
      keywordRank: i,
    })),
    ...keywordResults.galleries.map((d, i) => ({
      id: `gallery:${d.id ?? i}`,
      type: 'gallery' as const,
      data: d,
      relevanceScore: 0,
      matchType: 'keyword' as const,
      keywordRank: i,
    })),
    ...keywordResults.music.map((d, i) => ({
      id: `music:${d.docId ?? i}`,
      type: 'music' as const,
      data: d,
      relevanceScore: 0,
      matchType: 'keyword' as const,
      keywordRank: i,
    })),
    ...keywordResults.albums.map((d, i) => ({
      id: `album:${d.docId ?? i}`,
      type: 'album' as const,
      data: d,
      relevanceScore: 0,
      matchType: 'keyword' as const,
      keywordRank: i,
    })),
  ]

  const vectorFlat: HybridSearchItem[] = vectorResults.map((r, i) => ({
    id: `${r.sourceType}:${r.sourceId}`,
    type: r.sourceType === 'gallery' ? 'gallery' : r.sourceType === 'wiki' ? 'wiki' : 'post',
    data: r.data,
    relevanceScore: 0,
    matchType: 'vector' as const,
    vectorDistance: r.similarity,
    vectorRank: i,
  }))

  const textFlat: HybridSearchItem[] = (textResults || []).map((r, i) => ({
    id: `${r.sourceType}:${r.sourceId}`,
    type: r.sourceType as HybridSearchItem['type'],
    data: r.entity,
    relevanceScore: 0,
    matchType: 'text' as const,
    textRank: i,
  }))

  const hasVectorResults = vectorResults.length > 0
  const hasTextResults = (textResults || []).length > 0
  const hasKeywordResults = keywordFlat.length > 0
  const keywordResultCount = keywordFlat.length

  if (mode === 'hybrid' && (hasVectorResults || hasTextResults) && hasKeywordResults) {
    const vectorMap = new Map(vectorFlat.map((v) => [v.id, v]))
    const textMap = new Map(textFlat.map((v) => [v.id, v]))

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
      if (!keywordFlat.find((k) => k.id === v.id)) {
        const txt = textMap.get(v.id)
        if (txt) v.textRank = txt.textRank
        v.relevanceScore = rrfScore([undefined, v.vectorRank, v.textRank])
        keywordFlat.push(v)
      }
    }
    for (const t of textFlat) {
      if (!keywordFlat.find((k) => k.id === t.id)) {
        const vec = vectorMap.get(t.id)
        if (vec) t.vectorRank = vec.vectorRank
        t.relevanceScore = rrfScore([undefined, t.vectorRank, t.textRank])
        keywordFlat.push(t)
      }
    }
    keywordFlat.sort((a, b) => b.relevanceScore - a.relevanceScore)
  } else if (mode === 'vector') {
    return {
      wiki: vectorFlat
        .filter((v) => v.type === 'wiki')
        .map((v) => v.data as Awaited<ReturnType<typeof toWikiResponse>>),
      posts: vectorFlat
        .filter((v) => v.type === 'post')
        .map((v) => v.data as Awaited<ReturnType<typeof toPostResponse>>),
      galleries: vectorFlat
        .filter((v) => v.type === 'gallery')
        .map((v) => v.data as Awaited<ReturnType<typeof toGalleryResponse>>),
      music: [],
      albums: [],
      searchMeta: {
        mode: 'vector',
        query,
        degraded: false,
        keywordResultCount: 0,
        vectorResultCount: vectorResults.length,
        textVectorResultCount: (textResults || []).length,
      },
    }
  }

  return {
    wiki: keywordFlat
      .filter((v) => v.type === 'wiki')
      .map((v) => v.data as Awaited<ReturnType<typeof toWikiResponse>>),
    posts: keywordFlat
      .filter((v) => v.type === 'post')
      .map((v) => v.data as Awaited<ReturnType<typeof toPostResponse>>),
    galleries: keywordFlat
      .filter((v) => v.type === 'gallery')
      .map((v) => v.data as Awaited<ReturnType<typeof toGalleryResponse>>),
    music: keywordFlat
      .filter(
        (v) => v.type === 'music' && v.data && typeof v.data === 'object' && 'createdAt' in v.data
      )
      .map((v) => {
        const track = v.data as Parameters<typeof toMusicResponse>[0]
        return toMusicResponse(track, { favoritedByMe: favoritedMusicIds?.has(track.docId) })
      }),
    albums: keywordFlat
      .filter(
        (v) => v.type === 'album' && v.data && typeof v.data === 'object' && 'createdAt' in v.data
      )
      .map((v) => toAlbumResponse(v.data as Parameters<typeof toAlbumResponse>[0])),
    searchMeta: {
      mode: degraded ? 'keyword (degraded)' : mode,
      query,
      degraded,
      ...(degradationReason ? { degradationReason } : {}),
      keywordResultCount: keywordResultCount,
      vectorResultCount: vectorResults.length,
      textVectorResultCount: (textResults || []).length,
    },
  }
}

router.get('/', searchLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    const type = typeof req.query.type === 'string' ? req.query.type : 'all'
    const mode = (typeof req.query.mode === 'string' ? req.query.mode : 'keyword') as
      | 'keyword'
      | 'vector'
      | 'hybrid'
    const category = typeof req.query.category === 'string' ? req.query.category : undefined
    const startDate =
      typeof req.query.startDate === 'string' ? parseDate(req.query.startDate) : null
    const endDate = typeof req.query.endDate === 'string' ? parseDate(req.query.endDate) : null
    const tagsParam = typeof req.query.tags === 'string' ? req.query.tags : ''
    const tags = tagsParam
      ? tagsParam
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : []

    const wantsWiki = type === 'all' || type === 'wiki'
    const wantsPosts = type === 'all' || type === 'posts'
    const wantsGalleries = type === 'all' || type === 'galleries'
    const wantsMusic = type === 'all' || type === 'music'
    const wantsAlbums = type === 'all' || type === 'albums'
    const wantsLyrics = type === 'all' || type === 'lyrics'
    const wikiPage = parsePagination({ page: req.query.wikiPage, limit: SEARCH_PAGE_SIZE })
    const postsPage = parsePagination({ page: req.query.postsPage, limit: SEARCH_PAGE_SIZE })
    const galleriesPage = parsePagination({
      page: req.query.galleriesPage,
      limit: SEARCH_PAGE_SIZE,
    })
    const musicPage = parsePagination({ page: req.query.musicPage, limit: SEARCH_PAGE_SIZE })
    const albumsPage = parsePagination({ page: req.query.albumsPage, limit: SEARCH_PAGE_SIZE })
    const lyricsPage = parsePagination({ page: req.query.lyricsPage, limit: SEARCH_PAGE_SIZE })
    // 搜索详情开关控制其他内容的正文匹配；歌词分类始终按歌词内容检索
    const includeDetail = parseBoolean(req.query.detail)
    if (q) {
      increaseSearchKeywordCount(q)
    }

    const wikiVisibilityWhere = buildWikiVisibilityWhere(req.authUser)
    const postVisibilityWhere = buildPostVisibilityWhere(req.authUser)
    const galleryVisibilityWhere = buildGalleryVisibilityWhere(req.authUser)
    const cacheKey = `search:${q}:${category || 'all'}:${type}:${mode}:${req.authUser?.uid || 'anonymous'}:${includeDetail ? 'detail' : 'title'}:${JSON.stringify({ tags: [...tags].sort(), startDate, endDate, pages: { wiki: wikiPage.page, posts: postsPage.page, galleries: galleriesPage.page, music: musicPage.page, albums: albumsPage.page, lyrics: lyricsPage.page } })}`
    const cached = enhancedCache.get(cacheKey)
    if (cached) return res.json(cached)

    const musicArtistMatchDocIds = wantsMusic && q ? await findMusicDocIdsByArtistPartial(q) : []
    const wikiPromise = wantsWiki
      ? prisma.wikiPage.findMany({
          where: {
            ...wikiVisibilityWhere,
            ...(category ? { category } : {}),
            ...(q
              ? {
                  OR: [
                    { title: { contains: q } },
                    { slug: { contains: q } },
                    ...(includeDetail ? [{ content: { contains: q } }] : []),
                  ],
                }
              : {}),
            ...(tags.length ? { tags: { array_contains: tags } } : {}),
            ...(startDate || endDate
              ? {
                  updatedAt: {
                    ...(startDate ? { gte: startDate } : {}),
                    ...(endDate ? { lte: endDate } : {}),
                  },
                }
              : {}),
          },
          select: {
            id: true,
            slug: true,
            title: true,
            category: true,
            content: true,
            tags: true,
            relations: true,
            eventDate: true,
            locationCode: true,
            locationDetail: true,
            status: true,
            reviewNote: true,
            reviewedBy: true,
            reviewedAt: true,
            viewCount: true,
            favoritesCount: true,
            isPinned: true,
            likesCount: true,
            dislikesCount: true,
            lastEditorUid: true,
            lastEditor: { select: { displayName: true } },
            createdAt: true,
            updatedAt: true,
            location: true,
          },
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          skip: mode === 'keyword' ? wikiPage.offset : undefined,
          take: mode === 'keyword' ? wikiPage.limit : undefined,
        })
      : Promise.resolve([])

    const postsPromise = wantsPosts
      ? prisma.post.findMany({
          where: {
            ...postVisibilityWhere,
            ...(category ? { section: category } : {}),
            ...(q
              ? {
                  OR: [
                    { title: { contains: q } },
                    ...(includeDetail ? [{ content: { contains: q } }] : []),
                  ],
                }
              : {}),
            ...(tags.length ? { tags: { array_contains: tags } } : {}),
            ...(startDate || endDate
              ? {
                  updatedAt: {
                    ...(startDate ? { gte: startDate } : {}),
                    ...(endDate ? { lte: endDate } : {}),
                  },
                }
              : {}),
          },
          select: {
            id: true,
            slug: true,
            title: true,
            section: true,
            musicDocId: true,
            albumDocId: true,
            content: true,
            tags: true,
            locationCode: true,
            locationDetail: true,
            authorUid: true,
            author: { select: { displayName: true } },
            status: true,
            reviewNote: true,
            reviewedBy: true,
            reviewedAt: true,
            hotScore: true,
            viewCount: true,
            likesCount: true,
            dislikesCount: true,
            commentsCount: true,
            isPinned: true,
            createdAt: true,
            updatedAt: true,
            location: true,
          },
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          skip: mode === 'keyword' ? postsPage.offset : undefined,
          take: mode === 'keyword' ? postsPage.limit : undefined,
        })
      : Promise.resolve([])

    const galleriesPromise = wantsGalleries
      ? prisma.gallery.findMany({
          where: {
            ...galleryVisibilityWhere,
            ...(q
              ? {
                  OR: [
                    { title: { contains: q } },
                    ...(includeDetail ? [{ description: { contains: q } }] : []),
                  ],
                }
              : {}),
            ...(tags.length ? { tags: { array_contains: tags } } : {}),
            ...(startDate || endDate
              ? {
                  updatedAt: {
                    ...(startDate ? { gte: startDate } : {}),
                    ...(endDate ? { lte: endDate } : {}),
                  },
                }
              : {}),
          },
          include: {
            images: {
              include: {
                asset: true,
              },
              orderBy: { sortOrder: 'asc' },
            },
          },
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          skip: mode === 'keyword' ? galleriesPage.offset : undefined,
          take: mode === 'keyword' ? galleriesPage.limit : undefined,
        })
      : Promise.resolve([])

    const musicPromise = wantsMusic
      ? prisma.musicTrack.findMany({
          where: {
            deletedAt: null,
            ...(q
              ? {
                  OR: [
                    { title: { contains: q } },
                    { artists: { has: q } },
                    ...(musicArtistMatchDocIds.length
                      ? [{ docId: { in: musicArtistMatchDocIds } }]
                      : []),
                    { album: { contains: q } },
                    ...(includeDetail ? [{ description: { contains: q } }] : []),
                  ],
                }
              : {}),
          },
          select: MUSIC_SEARCH_SELECT,
          orderBy: [{ updatedAt: 'desc' }, { docId: 'asc' }],
          skip: mode === 'keyword' ? musicPage.offset : undefined,
          take: mode === 'keyword' ? musicPage.limit : undefined,
        })
      : Promise.resolve([])

    const albumsPromise = wantsAlbums
      ? prisma.album.findMany({
          where: {
            deletedAt: null,
            ...(q
              ? {
                  OR: [
                    { title: { contains: q } },
                    { artist: { contains: q } },
                    ...(includeDetail ? [{ description: { contains: q } }] : []),
                  ],
                }
              : {}),
          },
          select: {
            docId: true,
            slug: true,
            title: true,
            artist: true,
            description: true,
            tracks: true,
            releaseDate: true,
            coverId: true,
            externalSources: {
              orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
            },
            covers: {
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                publicUrl: true,
                thumbnailUrl: true,
                isDefault: true,
                sortOrder: true,
              },
            },
            songRelations: {
              include: {
                song: {
                  select: {
                    docId: true,
                    slug: true,
                    title: true,
                    artists: true,
                    coverId: true,
                    coverAlbumDocId: true,
                    covers: {
                      orderBy: { sortOrder: 'asc' },
                      select: {
                        id: true,
                        publicUrl: true,
                        thumbnailUrl: true,
                        isDefault: true,
                      },
                    },
                    albumRelations: {
                      include: {
                        album: {
                          include: {
                            covers: {
                              orderBy: { sortOrder: 'asc' },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              orderBy: [{ discNumber: 'asc' }, { trackOrder: 'asc' }],
            },
            createdAt: true,
            updatedAt: true,
          },
          orderBy: [{ updatedAt: 'desc' }, { docId: 'asc' }],
          skip: mode === 'keyword' ? albumsPage.offset : undefined,
          take: mode === 'keyword' ? albumsPage.limit : undefined,
        })
      : Promise.resolve([])
    const lyricsPromise =
      wantsLyrics && q
        ? prisma.musicTrack.findMany({
            where: {
              deletedAt: null,
              OR: [{ lyric: { contains: q } }, { lyricPlain: { contains: q } }],
            },
            select: {
              ...MUSIC_SEARCH_SELECT,
              lyric: true,
              lyricPlain: true,
            },
            orderBy: [{ updatedAt: 'desc' }, { docId: 'asc' }],
            skip: mode === 'keyword' ? lyricsPage.offset : undefined,
            take: mode === 'keyword' ? lyricsPage.limit : undefined,
          })
        : Promise.resolve([])
    const wikiCountPromise =
      mode === 'keyword' && wantsWiki
        ? prisma.wikiPage.count({
            where: {
              ...wikiVisibilityWhere,
              ...(category ? { category } : {}),
              ...(q
                ? {
                    OR: [
                      { title: { contains: q } },
                      { slug: { contains: q } },
                      ...(includeDetail ? [{ content: { contains: q } }] : []),
                    ],
                  }
                : {}),
              ...(tags.length ? { tags: { array_contains: tags } } : {}),
              ...(startDate || endDate
                ? {
                    updatedAt: {
                      ...(startDate ? { gte: startDate } : {}),
                      ...(endDate ? { lte: endDate } : {}),
                    },
                  }
                : {}),
            },
          })
        : Promise.resolve(0)
    const postsCountPromise =
      mode === 'keyword' && wantsPosts
        ? prisma.post.count({
            where: {
              ...postVisibilityWhere,
              ...(category ? { section: category } : {}),
              ...(q
                ? {
                    OR: [
                      { title: { contains: q } },
                      ...(includeDetail ? [{ content: { contains: q } }] : []),
                    ],
                  }
                : {}),
              ...(tags.length ? { tags: { array_contains: tags } } : {}),
              ...(startDate || endDate
                ? {
                    updatedAt: {
                      ...(startDate ? { gte: startDate } : {}),
                      ...(endDate ? { lte: endDate } : {}),
                    },
                  }
                : {}),
            },
          })
        : Promise.resolve(0)
    const galleriesCountPromise =
      mode === 'keyword' && wantsGalleries
        ? prisma.gallery.count({
            where: {
              ...galleryVisibilityWhere,
              ...(q
                ? {
                    OR: [
                      { title: { contains: q } },
                      ...(includeDetail ? [{ description: { contains: q } }] : []),
                    ],
                  }
                : {}),
              ...(tags.length ? { tags: { array_contains: tags } } : {}),
              ...(startDate || endDate
                ? {
                    updatedAt: {
                      ...(startDate ? { gte: startDate } : {}),
                      ...(endDate ? { lte: endDate } : {}),
                    },
                  }
                : {}),
            },
          })
        : Promise.resolve(0)
    const musicCountPromise =
      mode === 'keyword' && wantsMusic
        ? prisma.musicTrack.count({
            where: {
              deletedAt: null,
              ...(q
                ? {
                    OR: [
                      { title: { contains: q } },
                      { artists: { has: q } },
                      ...(musicArtistMatchDocIds.length
                        ? [{ docId: { in: musicArtistMatchDocIds } }]
                        : []),
                      { album: { contains: q } },
                      ...(includeDetail ? [{ description: { contains: q } }] : []),
                    ],
                  }
                : {}),
            },
          })
        : Promise.resolve(0)
    const albumsCountPromise =
      mode === 'keyword' && wantsAlbums
        ? prisma.album.count({
            where: {
              deletedAt: null,
              ...(q
                ? {
                    OR: [
                      { title: { contains: q } },
                      { artist: { contains: q } },
                      ...(includeDetail ? [{ description: { contains: q } }] : []),
                    ],
                  }
                : {}),
            },
          })
        : Promise.resolve(0)
    const lyricsCountPromise =
      mode === 'keyword' && wantsLyrics && q
        ? prisma.musicTrack.count({
            where: {
              deletedAt: null,
              OR: [{ lyric: { contains: q } }, { lyricPlain: { contains: q } }],
            },
          })
        : Promise.resolve(0)

    const [
      wiki,
      posts,
      galleries,
      music,
      albums,
      lyrics,
      wikiTotal,
      postsTotal,
      galleriesTotal,
      musicTotal,
      albumsTotal,
      lyricsTotal,
    ] = await Promise.all([
      wikiPromise,
      postsPromise,
      galleriesPromise,
      musicPromise,
      albumsPromise,
      lyricsPromise,
      wikiCountPromise,
      postsCountPromise,
      galleriesCountPromise,
      musicCountPromise,
      albumsCountPromise,
      lyricsCountPromise,
    ])

    const favoritedMusicSet = await fetchFavoritedMusicDocIds(
      music.map((song) => song.docId),
      req.authUser
    )

    if ((mode === 'hybrid' || mode === 'vector') && q && type !== 'lyrics' && includeDetail) {
      const keywordRaw = {
        wiki: wiki.map(toWikiResponse),
        posts: posts.map(toPostResponse),
        galleries: await toGalleryListResponse(galleries),
        music: music,
        albums: albums,
      }

      let hybridResponse: HybridSearchResponse

      if (!isSemanticSearchEnabled()) {
        if (mode === 'vector') {
          res.status(404).json({ error: SEMANTIC_SEARCH_DISABLED_MESSAGE })
          return
        }

        hybridResponse = buildHybridResponse(
          keywordRaw,
          [],
          mode,
          q,
          true,
          SEMANTIC_SEARCH_DISABLED_MESSAGE,
          [],
          favoritedMusicSet
        )
      } else {
        let vectorResults: SemanticSearchResult[] = []
        let textResults: TextSearchResult[] = []
        let degraded = false
        let degradationReason: string | undefined

        const qdrantTimeoutMs = getQdrantTimeoutMs()

        const [vectorResponse, textResponse] = await Promise.all([
          fetchVectorSearchWithTimeout(
            q,
            VECTOR_SCAN_BATCH_SIZE,
            0.25,
            qdrantTimeoutMs,
            req.authUser
          ).catch((error) => {
            degraded = true
            degradationReason =
              '向量搜索不可用：' + (error instanceof Error ? error.message : '未知错误')
            logger.warn({ err: error }, 'Vector search failed, degrading to keyword-only')
            return { results: [] as SemanticSearchResult[], timedOut: false }
          }),
          fetchTextVectorSearchWithTimeout(
            q,
            VECTOR_SCAN_BATCH_SIZE,
            0.25,
            qdrantTimeoutMs,
            req.authUser
          ).catch((error) => {
            logger.warn({ err: error }, 'Text vector search failed')
            return { results: [] as TextSearchResult[], timedOut: false }
          }),
        ])

        vectorResults = vectorResponse.results
        textResults = textResponse.results

        if (vectorResponse.timedOut || textResponse.timedOut) {
          degraded = true
          degradationReason =
            '向量搜索超时（>' + qdrantTimeoutMs / 1000 + 's），已自动降级为关键词搜索模式'
        }

        hybridResponse = buildHybridResponse(
          keywordRaw,
          vectorResults,
          mode,
          q,
          degraded,
          degradationReason,
          textResults,
          favoritedMusicSet
        )
      }
      res.json(
        makeHybridPagedResponse(hybridResponse, {
          wiki: wikiPage,
          posts: postsPage,
          galleries: galleriesPage,
          music: musicPage,
          albums: albumsPage,
          lyrics: lyricsPage,
        })
      )
      return
    }
    const builtLyrics = buildLyricSearchItems(lyrics, q)
    const keywordResult = {
      wiki: makeSearchPage(wiki.map(toWikiResponse), wikiTotal, wikiPage),
      posts: makeSearchPage(posts.map(toPostResponse), postsTotal, postsPage),
      galleries: makeSearchPage(
        await toGalleryListResponse(galleries),
        galleriesTotal,
        galleriesPage
      ),
      music: makeSearchPage(
        music.map((track) =>
          toMusicResponse(track, { favoritedByMe: favoritedMusicSet.has(track.docId) })
        ),
        musicTotal,
        musicPage
      ),
      albums: makeSearchPage(albums.map(toAlbumResponse), albumsTotal, albumsPage),
      lyrics: makeSearchPage(builtLyrics, lyricsTotal, lyricsPage),
      searchMeta: {
        mode: 'keyword',
        query: q,
        degraded: false,
        keywordResultCount:
          wikiTotal + postsTotal + galleriesTotal + musicTotal + albumsTotal + lyricsTotal,
        vectorResultCount: 0,
        textVectorResultCount: 0,
      },
    }
    enhancedCache.set(cacheKey, keywordResult, 30)
    res.json(keywordResult)
  } catch (error) {
    logger.error({ err: error }, 'Search error')
    res.status(500).json({ error: '搜索失败' })
  }
})

router.get(
  '/text-semantic',
  searchLimiter,
  requireSemanticSearchEnabled,
  async (req: AuthenticatedRequest, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
      const page = parsePagination({ page: req.query.page, limit: SEARCH_PAGE_SIZE })
      const minScore = parseMinSimilarityScore(req.query.minScore as string)

      if (!q) {
        res.status(400).json({ error: '请提供搜索文字 (q 参数)' })
        return
      }
      if (!parseBoolean(req.query.detail)) {
        res.json({ results: makeSearchPage([], 0, page), total: 0, query: q, minScore })
        return
      }
      const textResponse = await fetchTextVectorSearchWithTimeout(
        q,
        VECTOR_SCAN_BATCH_SIZE,
        minScore,
        getQdrantTimeoutMs(),
        req.authUser
      )
      const total = textResponse.results.length
      const items = textResponse.results.slice(page.offset, page.offset + page.limit)
      res.json({ results: makeSearchPage(items, total, page), total, query: q, minScore })
    } catch (error) {
      logger.error({ err: error }, 'Text semantic search error')
      res.status(500).json({ error: '文本语义搜索失败' })
    }
  }
)

router.get('/hot-keywords', async (_req, res) => {
  try {
    if (!(await isSearchHotKeywordsEnabled())) {
      res.json({ keywords: [] })
      return
    }

    const keywords = await prisma.searchKeyword.findMany({
      orderBy: [{ count: 'desc' }, { updatedAt: 'desc' }],
      take: 20,
    })

    res.json({
      keywords: keywords.map((k) => ({
        keyword: k.keyword,
        count: k.count,
      })),
    })
  } catch (error) {
    logger.error({ err: error }, 'Fetch hot keywords error')
    res.status(500).json({ error: '获取热门关键词失败' })
  }
})

router.post(
  '/by-image',
  searchLimiter,
  requireSemanticSearchEnabled,
  searchImageUpload.single('image'),
  async (req: AuthenticatedRequest, res) => {
    const tempFile = req.file
    try {
      const page = parsePagination({ page: req.body?.page, limit: SEARCH_PAGE_SIZE })
      const minScore = parseMinSimilarityScore(req.body?.minScore)
      let imageBuffer: Buffer | null = null

      if (tempFile?.path) {
        try {
          imageBuffer = await fs.promises.readFile(tempFile.path)
        } catch {
          imageBuffer = null
        }
      }
      if (!imageBuffer || imageBuffer.length === 0) {
        const base64Payload = extractBase64Payload(req.body?.imageBase64)
        if (base64Payload) {
          try {
            imageBuffer = Buffer.from(base64Payload, 'base64')
          } catch {
            imageBuffer = null
          }
        }
      }
      if (!imageBuffer || imageBuffer.length === 0) {
        res.status(400).json({ error: '请上传图片文件，或提供 imageBase64' })
        return
      }

      const { generateImageEmbedding } = await loadClipEmbedding()
      const queryVector = await generateImageEmbedding(imageBuffer)
      const matches = await scanAllImageEmbeddingPoints(queryVector, minScore)
      const results = await processSemanticSearchResults(matches, req.authUser)
      cleanupExpiredImageSearchSessions()
      const sessionId = randomUUID()
      imageSearchSessions.set(`image-search:${sessionId}`, {
        userId: req.authUser?.uid || null,
        results: results.map(({ sourceType, sourceId, imageUrl, similarity }) => ({
          sourceType,
          sourceId,
          imageUrl,
          similarity,
        })),
        expiresAt: Date.now() + 300_000,
      })
      const bySource = (sourceType: SemanticSearchResult['sourceType']) =>
        results.filter((item) => item.sourceType === sourceType)
      const wikiResults = bySource('wiki')
      const postResults = bySource('post')
      const galleryResults = bySource('gallery')
      const categoryPages = {
        semantic: makeSearchPage(
          results.slice(page.offset, page.offset + page.limit),
          results.length,
          page
        ),
        wiki: makeSearchPage(
          wikiResults.slice(page.offset, page.offset + page.limit),
          wikiResults.length,
          page
        ),
        post: makeSearchPage(
          postResults.slice(page.offset, page.offset + page.limit),
          postResults.length,
          page
        ),
        gallery: makeSearchPage(
          galleryResults.slice(page.offset, page.offset + page.limit),
          galleryResults.length,
          page
        ),
      }
      res.json({
        mode: 'semantic_image',
        sessionId,
        categoryPages,
        totalMatches: results.length,
        results: categoryPages.semantic,
      })
    } catch (error) {
      logger.error({ err: error }, 'Image semantic search error')
      res.status(500).json({ error: '图片语义搜索失败' })
    } finally {
      if (tempFile?.path) {
        await fs.promises
          .unlink(tempFile.path)
          .catch((err) => logger.debug({ err }, 'Failed to delete temp file'))
      }
    }
  }
)

router.get('/by-image/:sessionId', searchLimiter, async (req: AuthenticatedRequest, res) => {
  cleanupExpiredImageSearchSessions()
  const session = imageSearchSessions.get(`image-search:${req.params.sessionId}`)
  if (
    !session ||
    session.expiresAt <= Date.now() ||
    session.userId !== (req.authUser?.uid || null)
  ) {
    imageSearchSessions.delete(`image-search:${req.params.sessionId}`)
    res.status(410).json({ error: '图片搜索会话已过期，请重新上传图片' })
    return
  }
  const source = req.query.source
  if (source !== 'semantic' && source !== 'wiki' && source !== 'post' && source !== 'gallery') {
    res.status(400).json({ error: '无效的图片搜索来源' })
    return
  }
  const page = parsePagination({ page: req.query.page, limit: SEARCH_PAGE_SIZE })
  const freshResults = await processSemanticSearchResults(
    session.results.map((item) => ({
      id: item.sourceId,
      score: item.similarity,
      payload: {
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        imageUrl: item.imageUrl,
        updatedAt: '',
      },
    })),
    req.authUser
  )
  const results =
    source === 'semantic' ? freshResults : freshResults.filter((item) => item.sourceType === source)
  const pageResult = makeSearchPage(
    results.slice(page.offset, page.offset + page.limit),
    results.length,
    page
  )
  res.json({
    mode: 'semantic_image',
    sessionId: req.params.sessionId,
    totalMatches: results.length,
    results: pageResult,
  })
})

/**
 */
router.get(
  '/semantic-search',
  searchLimiter,
  requireSemanticSearchEnabled,
  async (req: AuthenticatedRequest, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
      const page = parsePagination({ page: req.query.page, limit: SEARCH_PAGE_SIZE })
      const minScore = parseMinSimilarityScore(req.query.minScore)
      if (!q) {
        res.status(400).json({ error: '请提供搜索文字 (q 参数)' })
        return
      }

      const { generateTextEmbedding } = await loadClipEmbedding()
      const queryVector = await generateTextEmbedding(q)
      const matches = await scanAllImageEmbeddingPoints(queryVector, minScore)
      const results = await processSemanticSearchResults(matches, req.authUser)
      const pageResult = makeSearchPage(
        results.slice(page.offset, page.offset + page.limit),
        results.length,
        page
      )
      res.json({
        mode: 'semantic_text',
        query: q,
        totalMatches: results.length,
        results: pageResult,
      })
    } catch (error) {
      logger.error({ err: error }, 'Semantic search error')
      res.status(500).json({ error: '语义搜索失败' })
    }
  }
)
router.get('/suggest', searchLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    if (!q || q.length < 2) {
      res.json({ suggestions: [] })
      return
    }
    const normalized = normalizeKeyword(q)
    const [musicArtistMatchDocIds, hotKeywordsEnabled] = await Promise.all([
      findMusicDocIdsByArtistPartial(q, 3),
      isSearchHotKeywordsEnabled(),
    ])

    const [keywordMatches, wikiMatches, postMatches, musicMatches, albumMatches] =
      await Promise.all([
        hotKeywordsEnabled
          ? prisma.searchKeyword.findMany({
              where: { keyword: { contains: normalized } },
              orderBy: { count: 'desc' },
              take: 5,
              select: { keyword: true, count: true },
            })
          : Promise.resolve([]),
        prisma.wikiPage.findMany({
          where: {
            ...buildWikiVisibilityWhere(req.authUser),
            OR: [{ title: { contains: q } }, { slug: { contains: q } }],
          },
          orderBy: { updatedAt: 'desc' },
          take: 3,
          select: { slug: true, title: true, category: true },
        }),
        prisma.post.findMany({
          where: {
            status: 'published',
            deletedAt: null,
            OR: [{ title: { contains: q } }],
          },
          orderBy: { updatedAt: 'desc' },
          take: 3,
          select: { slug: true, title: true, section: true },
        }),
        prisma.musicTrack.findMany({
          where: {
            deletedAt: null,
            OR: [
              { title: { contains: q } },
              { artists: { has: q } },
              ...(musicArtistMatchDocIds.length ? [{ docId: { in: musicArtistMatchDocIds } }] : []),
            ],
          },
          orderBy: { updatedAt: 'desc' },
          take: 3,
          select: { slug: true, title: true, artists: true },
        }),
        prisma.album.findMany({
          where: {
            deletedAt: null,
            OR: [{ title: { contains: q } }, { artist: { contains: q } }],
          },
          orderBy: { updatedAt: 'desc' },
          take: 3,
          select: { slug: true, title: true, artist: true },
        }),
      ])

    const suggestions: Array<{
      type: 'keyword' | 'wiki' | 'post' | 'music' | 'album'
      text: string
      subtext?: string
      id?: string
    }> = []

    keywordMatches.forEach((k) => {
      suggestions.push({ type: 'keyword', text: k.keyword, subtext: `${k.count} 次搜索` })
    })

    wikiMatches.forEach((w) => {
      suggestions.push({ type: 'wiki', text: w.title, subtext: w.category, id: w.slug })
    })

    postMatches.forEach((p) => {
      suggestions.push({ type: 'post', text: p.title, subtext: p.section, id: p.slug })
    })

    musicMatches.forEach((m) => {
      suggestions.push({
        type: 'music',
        text: m.title,
        subtext: formatMusicCredits(m.artists, '未知歌手'),
        id: m.slug,
      })
    })

    albumMatches.forEach((a) => {
      suggestions.push({ type: 'album', text: a.title, subtext: a.artist, id: a.slug })
    })

    res.json({ suggestions })
  } catch (error) {
    logger.error({ err: error }, 'Search suggest error')
    res.status(500).json({ error: '搜索建议失败' })
  }
})

export function registerSearchRoutes(app: Router) {
  app.use('/api/search', router)
}
