// Barrel re-export — 从各功能模块统一导出，保持向后兼容
// 所有原有 import { xxx } from '../utils' 的调用方无需修改

// === 基础配置 ===
export {
  prisma,
  uploadsDir,
  backupsDir,
  DEFAULT_MUSIC_PLATFORMS,
  BACKUP_PASSWORD,
  WECHAT_LOGIN_MOCK,
  defaultUploadsDir,
  isSemanticSearchEnabled,
} from './config'

// === 通用解析与验证 ===
export {
  parseDate,
  normalizeOptionalDateOnly,
  normalizeOptionalDateOnlyString,
  normalizeOptionalDurationMs,
  parseInteger,
  firstString,
  parseQueryString,
  parseRouteParam,
  parseBoolean,
  extractBase64Payload,
  parseMinSimilarityScore,
  toEmbeddingPayload,
  normalizeTagList,
  serializeTags,
  hasTag,
  normalizeWikiSlug,
  normalizeKeyword,
  normalizeOptionalDocId,
  parseAssetIdList,
  parseContentStatus,
  normalizeWikiWriteStatus,
  normalizePostWriteStatus,
  normalizeGalleryWriteStatus,
  normalizeTicketListingWriteStatus,
  parseFavoriteType,
  parseMusicPlatform,
  parseDisplayAlbumMode,
  normalizeModerationTargetType,
  parsePostSort,
  parsePagination,
  createPaginationMeta,
} from './parsers'

export {
  limitedString,
  optionalLimitedString,
  nullableLimitedString,
  limitedStringArray,
  ensureTextLimit,
} from './textLimits'

export { allocateNumericSlug, isNumericSlug, withNumericSlugTransaction } from './numericSlug'
export { normalizeLyricStorage } from './lyrics'
export { allocateUserPublicId, isUserPublicId } from './userPublicId'

export {
  buildUniqueDisplayNameFallback,
  normalizeDisplayNameFallback,
  validateUserDisplayName,
} from './display-name'

// === Wiki 关系引擎 ===
export {
  normalizeWikiRelationListForWrite,
  serializeRelations,
  buildWikiRelationBundle,
  clearWikiRelationCache,
} from './wiki-relations'

// === 权限与可见性 ===
export {
  canViewWikiPage,
  canViewPost,
  canViewGallery,
  canViewTicketListing,
  canManageGallery,
  buildWikiVisibilityWhere,
  buildPostVisibilityWhere,
  buildGalleryVisibilityWhere,
} from './authorization'
export { fetchVisibleTagSuggestions } from './tagSuggestions'

export {
  SOFT_DELETE_TABS,
  includeDeletedFromQuery,
  deletedAtFilter,
  softDeleteData,
  restoreDeleteData,
  normalizeDeleteReason,
  resolveDeleteReason,
} from './soft-delete'

// === API 响应转换器 ===
export {
  toWikiResponse,
  toWikiListResponse,
  toWikiBranchResponse,
  toWikiPullRequestResponse,
  toPostResponse,
  toCommentResponse,
  toGalleryResponse,
  toTicketListingResponse,
  toTicketListingListResponse,
  toGalleryListResponse,
  toEventResponse,
  toEventListResponse,
  toMusicResponse,
  toEditLockResponse,
  toUserResponse,
  toUploadSessionResponse,
  toSongResponse,
  toAlbumResponse,
} from './response-transformers'

export {
  fetchPostCommentsForResponse,
  fetchPostCommentsPageForResponse,
  fetchGalleryCommentsForResponse,
  resolveCommentReplyTarget,
  createCommentLike,
  deleteCommentLike,
} from './comments'

export { localizeImageUrlAsMediaAsset } from './remoteImageAsset'

// === 音乐全链路 ===
export {
  resolveSongDisplayAlbum,
  resolveSongCoverUrl,
  resolveAlbumCoverUrl,
  resolveSongCoverThumbnailUrl,
  resolveAlbumCoverThumbnailUrl,
  normalizeSongCustomPlatformLinks,
  normalizeMusicExternalSourceInputs,
  findDuplicateSongSources,
  findDuplicateAlbumSources,
  resolveMusicPlayUrl,
  normalizeMusicImportTracks,
  buildMusicMetadataFillUpdateData,
  buildAlbumTracksPayload,
  applyAlbumTracksToRelations,
  addSongCoverFromAsset,
  addSongCoverFromUrl,
  addAlbumCoverFromUrl,
  addAlbumCoverFromAsset,
  createOrUpdateImportedSong,
  autoLinkInstrumental,
  fetchSongsWithRelations,
  fetchSongsWithRelationsByDocIds,
  fetchSongWithRelationsByDocId,
  findMusicDocIdsByArtistPartial,
  ensureDisplayRelation,
} from './music'
export { batchMatchAndDiffImportTracks } from './musicImportMatch'
export type {
  DuplicateSongSourceWarning,
  DuplicateAlbumSourceWarning,
  SongDuplicateStrategy,
  MusicMetadataFields,
} from './music'
export type {
  SongImportMatchStatus,
  SongImportDiffFieldStatus,
  SongImportFieldDiff,
  SongImportExistingSongSummary,
  SongImportMatchResult,
  SongImportMatchSummary,
} from './musicImportMatch'

// === 通知与用户行为 ===
export {
  toNotificationResponse,
  createNotification,
  notifyCommentReply,
  recordBrowsingHistory,
  increaseSearchKeywordCount,
} from './notifications'

export {
  resolveMentionTargetsForText,
  buildMentionTargetsByTextKey,
  notifyMentionUsers,
} from './mentions'

// === 帖子热度 ===
export { calculatePostHotScore } from './post-scoring'

// === 微信登录 ===
export {
  createWechatPlaceholderEmail,
  isWechatPlaceholderEmail,
  exchangeWechatLoginCode,
  buildUniqueWechatEmail,
} from './wechat'

// === 邮箱验证 ===
export {
  EmailVerificationPurpose,
  EmailVerificationError,
  getEmailVerificationConfig,
  setEmailVerificationConfig,
  isEmailVerificationEnabled,
  toEmailVerificationPublicConfig,
  toEmailVerificationAdminConfig,
  createAndSendEmailVerification,
  createAndSendPasswordReset,
  hashEmailVerificationToken,
  verifyEmailVerificationToken,
} from './email-verification'

// === 文件上传与存储 ===
export {
  normalizeTrackDiscPayload,
  createUploadSessionExpiresAt,
  isUploadSessionExpired,
  buildUploadPublicUrl,
  resolveUploadPathByStorageKey,
  resolveUploadPathByUrl,
  extractStorageKeyFromUploadUrl,
  safeDeleteUploadFileByStorageKey,
  uploadFileToS3,
  uploadToSuperbed,
  deleteFromSuperbed,
  validateUploadedImage,
} from './upload'

// === 备份与安全工具 ===
export {
  parseDatabaseUrl,
  sanitizeFilename,
  formatBackupTimestamp,
  formatFileSize,
  cleanupOldBackups,
  readBackupNote,
  writeBackupNote,
  deleteBackupNote,
  BACKUP_METADATA_ENTRY,
  serializeBackupMetadata,
  parseBackupMetadata,
  encryptBuffer,
  decryptBuffer,
  type BackupArchiveMetadata,
  validateSqlContent,
  getPostgresClientExecutable,
  isPostgresClientMissingError,
  formatPostgresClientMissingError,
} from './backup'

// === 日志 ===
export { logger } from './logger'
export { doesPublicTableExist, isPrismaTableMissingError } from './prisma-schema'
export { getPasswordSaltRounds } from './password'

export {
  REGISTRATION_CONFIG_KEY,
  getRegistrationConfig,
  setRegistrationConfig,
  isRegistrationOpen,
} from './registration'

export {
  SEARCH_HOT_KEYWORDS_CONFIG_KEY,
  SEARCH_HOT_KEYWORDS_CACHE_KEY,
  getSearchHotKeywordsConfig,
  setSearchHotKeywordsConfig,
  isSearchHotKeywordsEnabled,
} from './search-hot-keywords'

// === 已有独立模块（保持原导出方式）===
export * from './cache'
export { calculateFileMD5 } from './hash'

// === SEO（robots / sitemap / 文档 X-Robots-Tag）===
export {
  getPublicSiteUrl,
  buildSitemapXml,
  buildSitemapIndexXml,
  getRobotsDirective,
  isDocumentPath,
} from './seo'
export type { SitemapEntry } from './seo'
