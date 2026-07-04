export const RATE_LIMIT_BUCKETS = [
  'auth',
  'emailVerification',
  'passwordResetRequest',
  'passwordResetConfirm',
  'global',
  'search',
  'upload',
  'wikiWrite',
  'postWrite',
  'galleryWrite',
  'profile',
] as const

export type RateLimitBucketId = (typeof RATE_LIMIT_BUCKETS)[number]

export interface RateLimitBucketConfig {
  enabled: boolean
  windowMs: number
  max: number
  message: string
}

export type RateLimitAdminConfig = Record<RateLimitBucketId, RateLimitBucketConfig>
export type RateLimitAdminConfigUpdate = Partial<
  Record<RateLimitBucketId, Partial<RateLimitBucketConfig>>
>

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitAdminConfig = {
  auth: {
    enabled: true,
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: '请求过于频繁，请15分钟后再试',
  },
  emailVerification: {
    enabled: true,
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: '邮箱验证请求过于频繁，请15分钟后再试',
  },
  passwordResetRequest: {
    enabled: true,
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: '密码找回请求过于频繁，请15分钟后再试',
  },
  passwordResetConfirm: {
    enabled: true,
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: '密码重置确认过于频繁，请15分钟后再试',
  },
  global: {
    enabled: true,
    windowMs: 60 * 1000,
    max: 200,
    message: '请求过于频繁，请稍后再试',
  },
  search: {
    enabled: true,
    windowMs: 60 * 1000,
    max: 30,
    message: '搜索过于频繁，请稍后再试',
  },
  upload: {
    enabled: true,
    windowMs: 60 * 1000,
    max: 10,
    message: '上传过于频繁，请稍后再试',
  },
  wikiWrite: {
    enabled: true,
    windowMs: 60 * 1000,
    max: 20,
    message: 'Wiki 编辑过于频繁，请稍后再试',
  },
  postWrite: {
    enabled: true,
    windowMs: 60 * 1000,
    max: 10,
    message: '发帖过于频繁，请稍后再试',
  },
  galleryWrite: {
    enabled: true,
    windowMs: 60 * 1000,
    max: 10,
    message: '图集操作过于频繁，请稍后再试',
  },
  profile: {
    enabled: true,
    windowMs: 60 * 1000,
    max: 5,
    message: '资料修改过于频繁，请稍后再试',
  },
}

export const RATE_LIMIT_BUCKET_LABELS: Array<{
  id: RateLimitBucketId
  label: string
  description: string
}> = [
  { id: 'global', label: '全局请求', description: '所有 API 请求的基础保护。' },
  { id: 'auth', label: '登录注册', description: '登录、注册与微信登录等认证入口。' },
  { id: 'emailVerification', label: '邮箱验证', description: '邮箱验证邮件发送频率。' },
  { id: 'passwordResetRequest', label: '密码找回', description: '密码找回邮件请求频率。' },
  { id: 'passwordResetConfirm', label: '密码重置确认', description: '提交新密码确认频率。' },
  { id: 'search', label: '搜索', description: '关键词、推荐与图片搜索入口。' },
  { id: 'upload', label: '上传', description: '图片上传接口。' },
  { id: 'wikiWrite', label: 'Wiki 写入', description: 'Wiki 编辑、分支和 PR 写操作。' },
  { id: 'postWrite', label: '帖子写入', description: '帖子发布、更新和互动写操作。' },
  { id: 'galleryWrite', label: '图集写入', description: '图集创建、编辑和删除操作。' },
  { id: 'profile', label: '资料修改', description: '用户资料和账户设置写操作。' },
]
