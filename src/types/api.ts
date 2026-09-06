import type {
  AdminDataItem,
  AlbumItem,
  AnnouncementItem,
  EventItem,
  GalleryItem,
  LyricSearchItem,
  PostItem,
  SongItem,
  TicketListingEventOption,
  TicketListingItem,
  TicketListingSummary,
  WikiItem,
} from './entities'
import type { Platform } from './common'
export interface ApiResponse<T> {
  data: T
}

export interface ApiSuccessResponse<T> extends ApiResponse<T> {
  success: boolean
}

export interface PaginationMeta {
  total: number
  page: number
  limit: number
  totalPages: number
  hasMore: boolean
}

export interface PaginatedResponse<T> extends PaginationMeta {
  items: T[]
}

export interface SearchResultPage<T> extends PaginationMeta {
  items: T[]
}

export interface SearchMeta {
  mode: string
  query: string
  degraded: boolean
  degradationReason?: string
  keywordResultCount: number
  vectorResultCount: number
  textVectorResultCount: number
}

export type SemanticSearchResult = {
  sourceType: 'gallery' | 'wiki' | 'post'
  sourceId: string
  imageUrl: string
  similarity: number
  data: unknown
}

export interface SearchResultsResponse {
  wiki: SearchResultPage<WikiItem>
  posts: SearchResultPage<PostItem>
  galleries: SearchResultPage<GalleryItem>
  music: SearchResultPage<SongItem>
  albums: SearchResultPage<AlbumItem>
  lyrics: SearchResultPage<LyricSearchItem>
  searchMeta?: SearchMeta
}

export interface SemanticSearchPageResponse {
  mode: 'semantic_text' | 'semantic_image'
  query?: string
  results: SearchResultPage<SemanticSearchResult>
  totalMatches: number
}
export type SemanticSearchCategory = 'semantic' | 'wiki' | 'post' | 'gallery'

export type SemanticSearchCategoryPages = Record<
  SemanticSearchCategory,
  SearchResultPage<SemanticSearchResult>
>

export interface ImageSearchSessionResponse extends SemanticSearchPageResponse {
  mode: 'semantic_image'
  sessionId: string
  categoryPages: SemanticSearchCategoryPages
}
export interface ImageSearchSessionPageResponse extends SemanticSearchPageResponse {
  mode: 'semantic_image'
  sessionId: string
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

export interface NotificationsResponse extends PaginationMeta {
  notifications: Array<{
    id: string
    type: 'reply' | 'like' | 'review_result' | 'mention'
    payload: Record<string, unknown>
    isRead: boolean
    createdAt: string
  }>
  unreadCount: number
}

export interface AnnouncementsResponse extends PaginationMeta {
  announcements: AnnouncementItem[]
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
    expiresAt?: string
  }
  asset: {
    id: string
    imageMapId: string
    publicUrl: string | null
    storageKey: string | null
    fileName: string
    mimeType: string
    sizeBytes: number
    md5: string
    status: 'uploaded' | 'ready' | 'deleted'
    reused: boolean
  }
  tripleStorage?: {
    localUrl: string
    s3Url?: string
    externalUrl?: string
  }
  storageErrors?: string[]
}

export interface GalleryCreateResponse {
  gallery: GalleryItem
}

export interface GalleryDetailResponse extends GalleryCreateResponse {}

export interface EventListResponse extends PaginationMeta {
  events: EventItem[]
}

export interface EventDetailResponse {
  event: EventItem
}

export interface EventCreateResponse extends EventDetailResponse {}
export interface TicketListingListResponse extends PaginationMeta {
  listings: TicketListingSummary[]
}

export interface TicketListingDetailResponse {
  listing: TicketListingItem
}

export interface TicketListingCreateResponse extends TicketListingDetailResponse {}

export interface TicketListingMineResponse extends TicketListingListResponse {}

export interface TicketListingEventsResponse {
  events: TicketListingEventOption[]
}

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

export interface SearchHotKeywordsConfig {
  enabled: boolean
}

// 管理面板可调的运行时行为配置（GET/PATCH /api/admin/runtime-config）
export interface RuntimeAdminConfig {
  semanticSearchEnabled: boolean
  galleryAdminOnly: boolean
  allowSuperAdminManageSuperAdmins: boolean
  blurhashEnabled: boolean
  blurhashAutoGenerate: boolean
  blurhashComponentsX: number
  blurhashComponentsY: number
  uploadSessionTtlMinutes: number
  backupRetainCount: number
  playUrlCacheTtlSeconds: number
  cacheMaxKeys: number
  qdrantTimeoutMs: number
  imageEmbeddingBatchSize: number
  editLockCleanupIntervalMs: number
  mediaCleanupIntervalMs: number
  variantMaxConcurrent: number
  variantTaskTimeoutMs: number
  variantQueueMaxWaitMs: number
  variantSharpMemoryLimitMb: number
  variantMaxRetries: number
  cloudSyncMaxConcurrent: number
  cloudSyncMaxRetries: number
  logLevel: string
  s3Enabled: boolean
  s3PublicBucketName: string
  s3PublicBucketRegion: string
  s3PublicBucketPrefix: string
  s3PrivateBucketName: string
  s3PrivateBucketRegion: string
  s3EndpointUrl: string
  s3ForcePathStyle: boolean
  s3SslEnabled: boolean
  s3SignatureVersion: string
  s3PublicDomain: string
  s3DefaultAcl: string
  s3ExpiresIn: number
  s3MaxFileSize: number
  s3AllowedContentTypes: string
  s3EnableMd5Verification: boolean
  qdrantUrl: string
  qdrantCollection: string
  qdrantTextCollection: string
  lskyBaseUrl: string
  lskyStrategyId: string
  lskyTimeout: number
}

// 服务凭证掩码状态（GET/PATCH /api/admin/secrets-config，绝不包含明文）
export type SecretsFieldStatus = { configured: boolean; last4: string }

export interface SecretsAdminConfig {
  disabled: boolean
  secrets: Record<string, SecretsFieldStatus>
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
    publicId: string
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
  photoAssetId?: string | null
  preferences?: Record<string, unknown>
}

export interface UserResponse {
  user: {
    uid: string
    publicId: string
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

export interface MusicListResponse extends PaginationMeta {
  songs: SongItem[]
}

export interface AlbumListResponse extends PaginationMeta {
  albums: AlbumItem[]
}

export interface AdminDataListResponse extends PaginationMeta {
  data: AdminDataItem[]
}

export interface AdminMusicListResponse extends AdminDataListResponse {}

export interface AdminAlbumListResponse extends AdminDataListResponse {}

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
    tags?: string[]
    coverUrl?: string
    coverThumbnail?: string
    playUrl?: string
    playable?: boolean
    releaseDate?: string | null
    durationMs?: number | null
    createdAt: string
  }
}

export interface DuplicateSongSourceWarning {
  platform: Platform
  sourceId: string
  song: { docId: string; title: string; artists: string[] }
}

export interface DuplicateAlbumSourceWarning {
  platform: Platform
  sourceId: string
  album: { docId: string; title: string }
}

export type MusicPlayUrlMode = 'manual' | 'cache' | 'resolved' | 'outer' | 'none' | 'disabled'

export interface MusicPlayUrlResponse {
  playUrl: string
  mode?: MusicPlayUrlMode
  playable?: boolean
  platform?: string | null
  sourceId?: string | null
  cached?: boolean
  cacheExpiresAt?: string | null
}

// ============================================================================
// 画廊相关类型
// ============================================================================

export interface GalleryListResponse extends PaginationMeta {
  galleries: GalleryItem[]
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
  removedFilenames?: string[]
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

export type AdminReviewQueueType = 'wiki' | 'posts' | 'galleries' | 'tickets'

export type AdminReviewItemType = 'wiki' | 'post' | 'gallery' | 'ticket'

export type AdminReviewQueueItem = {
  id: string
  slug?: string
  title?: string
  category?: string
  section?: string
  sectionName?: string
  content?: string
  description?: string
  type?: 'offer' | 'request'
  eventId?: string | null
  customEventName?: string | null
  eventName?: string
  eventSlug?: string | null
  eventLocation?: string | null
  quantity?: number
  ticketTier?: string
  seat?: string
  contact?: string
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

export interface AdminReviewQueueResponse extends PaginationMeta {
  type: AdminReviewQueueType | 'all'
  status: 'draft' | 'pending' | 'published' | 'rejected'
  items: AdminReviewQueueItem[]
}

export interface AdminReviewQueueCountResponse {
  status: 'draft' | 'pending' | 'published' | 'rejected'
  counts: {
    wiki: number
    posts: number
    galleries: number
    tickets: number
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

export type MediaMaintenanceMode = 'dry-run' | 'apply'
export type MediaMaintenanceType = 'all' | 'gallery' | 'song' | 'album'
export type MediaMaintenanceOperation =
  | 'scan'
  | 'reconcile'
  | 'bind-legacy'
  | 'localize'
  | 'repair-thumbnails'
  | 'orphans/preview'
  | 'orphans/delete'
export type MediaMaintenanceResultMode = MediaMaintenanceMode | 'strict' | 'business'

export interface MediaMaintenanceDetail {
  id: string
  status: 'processed' | 'skipped' | 'failed'
  reason?: string
  type?: MediaMaintenanceType
}

export interface MediaMaintenanceBatchResult {
  operation: MediaMaintenanceOperation
  mode: MediaMaintenanceResultMode
  type: MediaMaintenanceType
  scanned: number
  processed: number
  skipped: number
  failed: number
  nextCursor: string | null
  hasMore: boolean
  details: MediaMaintenanceDetail[]
  queued?: number
  alreadyQueued?: number
  skippedMissingSource?: number
  conflicts?: number
}

export interface MediaMaintenanceScanResult extends MediaMaintenanceBatchResult {
  counts: {
    unboundMediaAssets: number
    legacyUrlOnlyRecords: number
    missingThumbnails: number
    remoteCandidates: number
    orphanFiles: number
    orphanBytes: number
    sharedImageMaps: number
    activeUploadSessions: number
    missingLocalFiles: number
    retiredMedia: number
  }
  health: MediaHealthScanResult
}

export interface MediaMaintenanceOrphanEntry {
  storageKey: string
  sizeBytes: number
  mtimeMs: number
  sha256: string
}

export interface MediaMaintenanceOrphanPreview extends MediaMaintenanceBatchResult {
  previewToken: string
  storageKeys: string[]
  entries: MediaMaintenanceOrphanEntry[]
  totalBytes: number
  includeVariants: boolean
}
export interface MediaMaintenanceOrphanDelete extends MediaMaintenanceBatchResult {
  deletedBytes: number
  deletedKeys: string[]
}
