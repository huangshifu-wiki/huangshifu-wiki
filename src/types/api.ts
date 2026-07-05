import type { AlbumItem, EventItem, GalleryItem, SongItem } from './entities'

export interface ApiResponse<T> {
  data: T
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface HomeFeedResponse {
  announcements: Array<{
    id: string
    content: string
    link?: string
    createdAt: string
  }>
  hotPosts: Array<{
    id: string
    title: string
    section: string
    commentsCount: number
    likesCount: number
    createdAt: string
    updatedAt: string
  }>
  recentPosts: Array<{
    id: string
    title: string
    section: string
    commentsCount: number
    likesCount: number
    updatedAt: string
  }>
}

export interface NotificationsResponse {
  notifications: Array<{
    id: string
    type: 'reply' | 'like' | 'review_result' | 'mention'
    payload: Record<string, unknown>
    isRead: boolean
    createdAt: string
  }>
  total: number
  unreadCount: number
  page: number
  limit: number
}

export interface UploadSessionResponse {
  session: {
    id: string
    status: 'open' | 'finalized' | 'expired'
    maxFiles: number
    uploadedFiles: number
    expiresAt: string
  }
}

export interface UploadFileResponse {
  session: {
    id: string
    status: 'open' | 'finalized' | 'expired'
    uploadedFiles: number
    maxFiles: number
  }
  asset: {
    id: string
    publicUrl: string
    storageKey?: string
    fileName: string
    mimeType: string
    sizeBytes: number
    md5?: string
  }
  tripleStorage?: {
    localUrl: string
    s3Url?: string
    externalUrl?: string
  }
}

export interface GalleryCreateResponse {
  gallery: GalleryItem
}

export interface EventListResponse {
  events: EventItem[]
  total: number
  page: number
  limit: number
  totalPages: number
  hasMore: boolean
}

export interface EventDetailResponse {
  event: EventItem
}

export interface EventCreateResponse extends EventDetailResponse {}

export interface AdminEventDetailResponse {
  item: EventItem
}

export interface ImageStats {
  total: number
  stats: {
    local: number
    external: number
    s3: number
  }
}

export interface ImagePreference {
  strategy: 'local' | 's3' | 'external'
  fallback: boolean
}

export type MediaHealthScanMode = 'strict' | 'business'

export type MediaHealthRecordType = 'mediaAsset' | 'imageMap'

export type MediaHealthBlockReason =
  | 'referenced'
  | 'shared_image_map'
  | 'processing'
  | 'not_found'
  | 'already_deleted'
  | 'active_upload_session'

export interface MediaHealthReference {
  source: string
  id?: string
  field: string
  value: string
}

export interface MediaHealthMissingLocalFile {
  recordType: MediaHealthRecordType
  id: string
  storageKey: string
  publicUrl: string
  expectedPath: string
  label: string
  references: MediaHealthReference[]
  canCleanup: boolean
  blockedReasons: MediaHealthBlockReason[]
}

export interface MediaHealthUnusedRecord {
  recordType: MediaHealthRecordType
  id: string
  storageKey?: string
  publicUrl?: string
  localUrl?: string
  label: string
  canCleanup: boolean
  blockedReasons: MediaHealthBlockReason[]
}

export interface MediaHealthScanResult {
  generatedAt: string
  mode: MediaHealthScanMode
  summary: {
    missingLocalFiles: number
    unusedMediaAssets: number
    unusedImageMaps: number
    cleanupCandidates: number
    blockedRecords: number
  }
  missingLocalFiles: MediaHealthMissingLocalFile[]
  unusedMediaRecords: MediaHealthUnusedRecord[]
}

export interface MediaHealthScanResponse extends ApiResponse<MediaHealthScanResult> {
  success: boolean
}

export interface MediaHealthCleanupTarget {
  recordType: MediaHealthRecordType
  id: string
}

export interface MediaHealthCleanupResponse {
  total: number
  cleaned: number
  skipped: number
  results: Array<{
    recordType: MediaHealthRecordType
    id: string
    success: boolean
    skipped: boolean
    blockedReasons: MediaHealthBlockReason[]
    message: string
  }>
}

export interface MediaHealthCleanupApiResponse extends ApiResponse<MediaHealthCleanupResponse> {
  success: boolean
}

export interface EmailVerificationPublicConfig {
  enabled: boolean
}

export interface EmailVerificationAdminConfig extends EmailVerificationPublicConfig {
  publicBaseUrl: string
  tokenTtlMinutes: number
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpUser: string
  smtpFrom: string
  smtpPassSet: boolean
  verificationSubject: string
  verificationTextBody: string
  verificationHtmlBody: string
  resetSubject: string
  resetTextBody: string
  resetHtmlBody: string
}

export interface RegistrationConfig {
  enabled: boolean
}

export type {
  RateLimitAdminConfig,
  RateLimitBucketConfig,
  RateLimitBucketId,
} from '../lib/rateLimitConfig'

// ============================================================================
// 错误类型定义
// ============================================================================

export type ErrorType = 'NetworkError' | 'AuthError' | 'BusinessError' | 'ServerError'

export interface ApiErrorObject {
  error: string
  code?: string
  details?: Record<string, unknown>
}

// ============================================================================
// 通用响应类型
// ============================================================================

export interface PaginationParams {
  page?: number
  limit?: number
  sort?: string
  order?: 'asc' | 'desc'
}

export interface SuccessResponse {
  success: boolean
  message?: string
}

// ============================================================================
// 认证相关类型
// ============================================================================

export interface AuthMeResponse {
  user: {
    uid: string
    nickname: string
    avatarUrl?: string
    role: 'user' | 'admin' | 'super_admin'
    status: 'active' | 'banned' | 'pending'
    preferences?: Record<string, unknown>
  } | null
}

export interface AuthRegisterRequest {
  email: string
  password: string
  nickname: string
}

export interface AuthLoginRequest {
  email: string
  password: string
}

export interface PasswordResetRequest {
  email: string
}

export interface PasswordResetConfirmRequest {
  token: string
  newPassword: string
}

// ============================================================================
// 用户相关类型
// ============================================================================

export interface UserUpdateRequest {
  displayName?: string
  signature?: string
  bio?: string
  photoURL?: string | null
  preferences?: Record<string, unknown>
}

export interface UserResponse {
  user: {
    uid: string
    nickname: string
    avatarUrl?: string
    role: string
    status: string
    emailVerified?: boolean
    emailVerifiedAt?: string | null
    createdAt: string
    updatedAt: string
  }
}

// ============================================================================
// Wiki 相关类型
// ============================================================================

export interface WikiDetailResponse {
  wiki: {
    id: string
    slug: string
    title: string
    category: string
    content: string
    summary?: string
    tags?: string[]
    likes: number
    dislikes: number
    views: number
    isPinned: boolean
    status: 'draft' | 'pending' | 'approved' | 'rejected'
    createdAt: string
    updatedAt: string
    author?: UserResponse['user']
  }
}

export interface WikiListResponse extends PaginatedResponse<WikiDetailResponse['wiki']> {}

// ============================================================================
// 帖子相关类型
// ============================================================================

export interface PostDetailResponse {
  post: {
    id: string
    slug: string
    title: string
    content: string
    sectionId: string
    authorId: string
    likes: number
    dislikes: number
    commentsCount: number
    views: number
    isPinned: boolean
    status: string
    createdAt: string
    updatedAt: string
    author?: UserResponse['user']
    section?: {
      id: string
      name: string
    }
  }
}

export interface PostListResponse extends PaginatedResponse<PostDetailResponse['post']> {}

// ============================================================================
// 音乐相关类型
// ============================================================================

export interface MusicListResponse {
  songs: SongItem[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

export interface AlbumListResponse {
  albums: AlbumItem[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

export interface MusicDetailResponse {
  song: {
    docId: string
    slug: string
    title: string
    artists: string[]
    lyricists?: string[]
    composers?: string[]
    arrangers?: string[]
    vocals?: string[]
    album?: string
    description?: string | null
    coverUrl?: string
    coverThumbnail?: string
    playUrl?: string
    playable?: boolean
    releaseDate?: string | null
    durationMs?: number | null
    createdAt: string
  }
}

export interface MusicPlayUrlResponse {
  playUrl: string
  playable?: boolean
  platform?: string | null
  sourceId?: string | null
  cached?: boolean
  cacheExpiresAt?: string | null
}

// ============================================================================
// 画廊相关类型
// ============================================================================

export interface GalleryDetailResponse {
  gallery: GalleryItem
}

export interface GalleryListResponse {
  galleries: GalleryItem[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

export interface GalleryUploadResponse {
  urls: string[]
}

// ============================================================================
// 管理相关类型
// ============================================================================

export interface AdminBackup {
  filename: string
  size: number
  sizeFormatted?: string
  createdAt: string
  note: string
}

export interface AdminBackupsResponse {
  backups: AdminBackup[]
}

export interface AdminBackupCreateResponse {
  backup: AdminBackup
}

export interface AdminBackupNoteResponse {
  success: boolean
  note: string
}

export interface RestoreMediaReport {
  filename: string
  generatedAt: string
  referencedKeys: number
  scannedFiles: number
  missingFiles: number
  orphanFiles: number
  orphanSizeBytes: number
  missingFilePreview?: Array<{
    storageKey: string
    publicUrl: string
    expectedPath: string
    references: Array<{
      source: string
      id?: string
      field: string
      value: string
    }>
  }>
  orphanFilePreview?: Array<{
    storageKey: string
    sizeBytes: number
    mtime: string
  }>
  previewLimit?: number
}

export interface AdminBackupRestoreResponse {
  success: boolean
  mediaReport?: RestoreMediaReport
  mediaReportError?: string
}

export type AdminReviewQueueType = 'wiki' | 'posts' | 'galleries'

export type AdminReviewItemType = 'wiki' | 'post' | 'gallery'

export type AdminReviewQueueItem = {
  id: string
  slug?: string
  title?: string
  category?: string
  section?: string
  sectionName?: string
  content?: string
  description?: string
  copyright?: string | null
  tags?: string[]
  locationCode?: string | null
  locationName?: string | null
  locationDetail?: string | null
  status?: 'draft' | 'pending' | 'published' | 'rejected'
  reviewNote?: string | null
  reviewedBy?: string | null
  reviewedAt?: string | null
  viewCount?: number
  favoritesCount?: number
  likesCount?: number
  dislikesCount?: number
  commentsCount?: number
  isPinned?: boolean
  published?: boolean
  publishedAt?: string | null
  authorUid?: string
  authorName?: string | null
  lastEditorUid?: string
  lastEditorName?: string | null
  createdAt?: string
  updatedAt?: string
  sensitiveWords?: string[]
  images?: {
    id: string
    url: string
    originalUrl?: string | null
    thumbnailUrl?: string | null
    name: string
  }[]
}

export type AdminReviewQueueMergedItem = AdminReviewQueueItem & {
  reviewType: AdminReviewItemType
  reviewId: string
}

export interface AdminReviewQueueResponse {
  type: AdminReviewQueueType
  status: 'draft' | 'pending' | 'published' | 'rejected'
  items: AdminReviewQueueItem[]
}

export interface AdminReviewQueueCountResponse {
  status: 'draft' | 'pending' | 'published' | 'rejected'
  counts: {
    wiki: number
    posts: number
    galleries: number
  }
  total: number
}

// ============================================================================
// 文本语义搜索类型
// ============================================================================

export type TextSearchResult =
  | {
      sourceType: 'wiki'
      sourceId: string
      score: number
      chunkPreview: string
      entity: { slug: string; title?: string; [key: string]: unknown }
    }
  | {
      sourceType: 'post'
      sourceId: string
      score: number
      chunkPreview: string
      entity: { id: string; slug?: string; title?: string; [key: string]: unknown }
    }
  | {
      sourceType: 'music'
      sourceId: string
      score: number
      chunkPreview: string
      entity: {
        id: string
        slug?: string
        title?: string
        artists?: string[]
        [key: string]: unknown
      }
    }
  | {
      sourceType: 'album'
      sourceId: string
      score: number
      chunkPreview: string
      entity: { id: string; slug?: string; title?: string; artist?: string; [key: string]: unknown }
    }

export interface TextSearchResponse {
  results: TextSearchResult[]
  total: number
  query: string
  minScore: number
}
