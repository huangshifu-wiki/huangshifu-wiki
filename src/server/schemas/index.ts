export { validateBody } from './validate'
export {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  resendEmailVerificationSchema,
  passwordResetRequestSchema,
  passwordResetConfirmSchema,
  passwordSchema,
  setupInitializeSchema,
} from './auth.schema'
export { userEmailUpdateSchema, userPasswordUpdateSchema } from './user.schema'
export {
  wikiCreateSchema,
  wikiUpdateSchema,
  wikiDeleteSchema,
  wikiRevisionSchema,
} from './wiki.schema'
export {
  postCreateSchema,
  postUpdateSchema,
  postDeleteSchema,
  postCommentSchema,
} from './post.schema'
export { galleryDeleteSchema } from './gallery.schema'
export {
  backupCreateSchema,
  backupNoteSchema,
  backupRestoreSchema,
  adminResetUserPasswordSchema,
  adminUpdateUserRoleSchema,
  adminUpdateUserSchema,
  adminBatchGalleryImagesSchema,
  adminBatchSongCoversSchema,
  adminBatchAlbumCoversSchema,
  adminBatchEditLocksSchema,
  adminBatchMusicDisplaySchema,
  adminMusicCoverThumbnailBackfillSchema,
} from './admin.schema'
