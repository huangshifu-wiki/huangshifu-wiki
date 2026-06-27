// Barrel re-export — 从各功能模块统一导出，保持向后兼容
// 所有原有 import { xxx } from '../utils' 的调用方无需修改

// === 基础配置 ===
export {
  prisma,
  uploadsDir,
  backupsDir,
  DEFAULT_MUSIC_PLATFORMS,
  SUPER_ADMIN_EMAIL,
  BACKUP_PASSWORD,
  BACKUP_RETAIN_COUNT,
  GALLERY_ADMIN_ONLY,
  WECHAT_MP_APPID,
  WECHAT_MP_APP_SECRET,
  WECHAT_LOGIN_MOCK,
  UPLOAD_SESSION_TTL_MINUTES,
  PLAY_URL_CACHE_TTL_MS,
  playUrlCache,
  defaultUploadsDir,
  isSemanticSearchEnabled,
} from './config'

// === 通用解析与验证 ===
export {
  parseDate,
  parseInteger,
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
  parseFavoriteType,
  parseMusicPlatform,
  parseDisplayAlbumMode,
  parseMusicCollectionType,
  parseBrowsingTargetType,
  parseModerationTargetType,
  normalizeModerationTargetType,
  parsePostSort,
  parsePagination,
} from './parsers'

export {
  limitedString,
  optionalLimitedString,
  nullableLimitedString,
  limitedStringArray,
  ensureTextLimit,
  trimText,
} from './textLimits'

// === Wiki 关系引擎 ===
export {
  RELATION_LABEL_TO_TYPE,
  normalizeWikiRelationType,
  normalizeWikiRelationLabel,
  normalizeWikiRelationList,
  normalizeWikiRelationListForWrite,
  serializeRelations,
  relationTypeLabel,
  relationIdentityKey,
  buildWikiReverseRelationIndex,
  buildResolvedWikiRelations,
  buildWikiRelationGraph,
  findWikiRelationCenterPage,
  buildWikiRelationBundle,
  clearWikiRelationCache,
} from './wiki-relations'

// === 权限与可见性 ===
export {
  canViewWikiPage,
  canViewPost,
  canViewGallery,
  canManageGallery,
  buildWikiVisibilityWhere,
  buildPostVisibilityWhere,
  buildGalleryVisibilityWhere,
  canManageWikiPullRequest,
} from './authorization'

export {
  SOFT_DELETE_TABS,
  isSoftDeleteTab,
  includeDeletedFromQuery,
  deletedAtFilter,
  softDeleteData,
  restoreDeleteData,
  SELF_DELETE_REASON,
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
  toGalleryListResponse,
  toMusicResponse,
  toEditLockResponse,
  toUserResponse,
  toUploadSessionResponse,
  toMediaAssetResponse,
  toSongResponse,
  toAlbumResponse,
} from './response-transformers'

export {
  buildCommentResponses,
  fetchPostCommentsForResponse,
  fetchPostCommentsPageForResponse,
  fetchGalleryCommentsForResponse,
  resolveCommentReplyTarget,
  createCommentLike,
  deleteCommentLike,
} from './comments'

// === 音乐全链路 ===
export {
  resolveSongDisplayAlbum,
  resolveSongCoverUrl,
  normalizeSongCustomPlatformLinkUrl,
  normalizeSongCustomPlatformLinks,
  getPlatformSourceId,
  getPlatformSourceField,
  buildPlaybackPlatformCandidates,
  clearExpiredPlayUrlCache,
  getCachedPlayUrl,
  setCachedPlayUrl,
  resolveMusicPlayUrl,
  normalizeMusicImportTracks,
  buildAlbumTracksPayload,
  applyAlbumTracksToRelations,
  addSongCoverFromAsset,
  addAlbumCoverFromAsset,
  createOrUpdateImportedSong,
  autoLinkInstrumental,
  fetchSongsWithRelations,
  fetchSongWithRelationsByDocId,
  ensureDisplayRelation,
} from './music'

// === 通知与用户行为 ===
export {
  toNotificationResponse,
  createNotification,
  notifyCommentReply,
  recordBrowsingHistory,
  increaseSearchKeywordCount,
} from './notifications'

// === 帖子热度 ===
export { calculatePostHotScore, refreshPostHotScore } from './post-scoring'

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
  normalizeEditLockCollection,
  normalizeEditLockRecordId,
  createUploadSessionExpiresAt,
  isUploadSessionExpired,
  buildUploadPublicUrl,
  resolveUploadPathByStorageKey,
  resolveUploadPathByUrl,
  extractStorageKeyFromUploadUrl,
  safeDeleteUploadFileByStorageKey,
  safeDeleteUploadFileByUrl,
  uploadFileToS3,
  uploadFileToExternal,
  uploadToSuperbed,
  deleteFromSuperbed,
  validateUploadedImage,
  detectImageMimeType,
  getUploadFileStorageKey,
} from './upload'

// === 备份与安全工具 ===
export {
  parseDatabaseUrl,
  verifyBackupPassword,
  sanitizeFilename,
  formatFileSize,
  cleanupOldBackups,
  encryptBuffer,
  decryptBuffer,
  validateSqlContent,
} from './backup'

// === 日志 ===
export { logger } from './logger'
export { doesPublicTableExist, isPrismaTableMissingError } from './prisma-schema'
export { getPasswordSaltRounds } from './password'

// === 已有独立模块（保持原导出方式）===
export * from './cache'
export { calculateFileMD5, calculateBufferMD5 } from './hash'
