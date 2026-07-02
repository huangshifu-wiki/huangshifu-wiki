import { z } from 'zod'

// ============================================================================
// 基础 Schema
// ============================================================================

export const successResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
})

// ============================================================================
// 用户相关 Schema
// ============================================================================

export const userSchema = z.object({
  uid: z.string(),
  nickname: z.string(),
  avatarUrl: z.string().optional(),
  role: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const authMeResponseSchema = z.object({
  user: z
    .object({
      uid: z.string(),
      nickname: z.string(),
      avatarUrl: z.string().optional(),
      role: z.enum(['user', 'admin', 'super_admin']),
      status: z.enum(['active', 'banned', 'pending']),
      preferences: z.record(z.string(), z.unknown()).optional(),
    })
    .nullable(),
})

// ============================================================================
// Wiki 相关 Schema
// ============================================================================

export const wikiSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  category: z.string(),
  content: z.string(),
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  likes: z.number(),
  dislikes: z.number(),
  views: z.number(),
  isPinned: z.boolean(),
  status: z.enum(['draft', 'pending', 'approved', 'rejected']),
  createdAt: z.string(),
  updatedAt: z.string(),
  author: userSchema.optional(),
})

export const wikiDetailResponseSchema = z.object({
  wiki: wikiSchema,
})

// ============================================================================
// 帖子相关 Schema
// ============================================================================

export const sectionSchema = z.object({
  id: z.string(),
  name: z.string(),
})

export const postSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  sectionId: z.string(),
  authorId: z.string(),
  likes: z.number(),
  dislikes: z.number(),
  commentsCount: z.number(),
  views: z.number(),
  isPinned: z.boolean(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  author: userSchema.optional(),
  section: sectionSchema.optional(),
})

export const postDetailResponseSchema = z.object({
  post: postSchema,
})

// ============================================================================
// 音乐相关 Schema
// ============================================================================

export const songSchema = z.object({
  id: z.string(),
  docId: z.string(),
  title: z.string(),
  artists: z.array(z.string()),
  lyricists: z.array(z.string()).optional(),
  composers: z.array(z.string()).optional(),
  arrangers: z.array(z.string()).optional(),
  vocals: z.array(z.string()).optional(),
  album: z.string().optional(),
  description: z.string().nullable().optional(),
  coverUrl: z.string().optional(),
  playUrl: z.string().optional(),
  releaseDate: z.string().nullable().optional(),
  durationMs: z.number().nullable().optional(),
  createdAt: z.string(),
})

export const musicListResponseSchema = z.object({
  songs: z.array(songSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  hasMore: z.boolean(),
})

export const musicDetailResponseSchema = z.object({
  song: songSchema,
})

export const musicPlayUrlResponseSchema = z.object({
  playUrl: z.string(),
})

// ============================================================================
// 画廊相关 Schema
// ============================================================================

export const galleryImageItemSchema = z.object({
  id: z.string(),
  assetId: z.string().nullable(),
  url: z.string(),
  name: z.string(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().nullable(),
})

export const gallerySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  authorUid: z.string(),
  authorName: z.string(),
  tags: z.array(z.string()),
  locationCode: z.string().nullable(),
  locationName: z.string().nullable(),
  locationDetail: z.string().nullable(),
  copyright: z.string().nullable(),
  published: z.boolean(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  images: z.array(galleryImageItemSchema),
})

export const galleryDetailResponseSchema = z.object({
  gallery: gallerySchema,
})

export const galleryListResponseSchema = z.object({
  galleries: z.array(gallerySchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  hasMore: z.boolean(),
})

export const galleryUploadResponseSchema = z.object({
  urls: z.array(z.string()),
})

// ============================================================================
// 分页响应 Schema
// ============================================================================

export function createPaginatedResponseSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    limit: z.number(),
    totalPages: z.number(),
  })
}

// ============================================================================
// 管理相关 Schema
// ============================================================================

export const adminBackupSchema = z.object({
  filename: z.string(),
  size: z.number(),
  createdAt: z.string(),
  note: z.string(),
})

export const adminBackupsResponseSchema = z.object({
  backups: z.array(adminBackupSchema),
})

export const adminReviewQueueItemSchema = z.object({
  id: z.string(),
  type: z.enum(['wiki', 'post', 'gallery']),
  title: z.string(),
  author: userSchema,
  submittedAt: z.string(),
})

export const adminReviewQueueResponseSchema = z.object({
  items: z.array(adminReviewQueueItemSchema),
  total: z.number(),
})

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 验证并解析 API 响应数据
 * @param data - 待验证的数据
 * @param schema - Zod schema
 * @returns 验证通过的数据
 * @throws ZodError - 验证失败时抛出错误
 */
export function validateApiResponse<T>(data: unknown, schema: z.ZodSchema<T>): T {
  return schema.parse(data)
}

/**
 * 安全地验证 API 响应（不抛出异常）
 * @param data - 待验证的数据
 * @param schema - Zod schema
 * @returns 验证结果
 */
export function safeValidateApiResponse<T>(data: unknown, schema: z.ZodSchema<T>) {
  return schema.safeParse(data)
}
