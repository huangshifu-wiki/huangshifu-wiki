import type { Router } from 'express'
import { createRouter } from '../utils/typed-router'
import { EmailVerificationPurpose, Prisma, UserRole as PrismaUserRole } from '@prisma/client'
import bcrypt from 'bcryptjs'
import {
  requireAuth,
  requireActiveUser,
  requireAdmin,
  requireSuperAdmin,
  userToApiUser,
  clearUserCache,
  issueUserSession,
  isBearerAuthRequest,
} from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { profileLimiter } from '../middleware/rateLimiter'
import {
  validateBody,
  adminResetUserPasswordSchema,
  adminUpdateUserRoleSchema,
  adminUpdateUserSchema,
  passwordSchema,
  userEmailUpdateSchema,
} from '../schemas'
import {
  CONTENT_LIMITS,
  PROFILE_SIGNATURE_MAX_LENGTH,
  WIKI_MAX_CONTENT_SIZE,
} from '../../lib/contentLimits'
import {
  prisma,
  toUserResponse,
  buildPostVisibilityWhere,
  buildGalleryVisibilityWhere,
  canViewWikiPage,
  canViewPost,
  toPostResponse,
  toCommentResponse,
  toGalleryListResponse,
  toWikiResponse,
  parseFavoriteType,
  safeDeleteUploadFileByUrl,
  parsePagination,
  logger,
  getPasswordSaltRounds,
  ensureTextLimit,
  validateUserDisplayName,
  ALLOW_SUPER_ADMIN_MANAGE_SUPER_ADMINS,
} from '../utils'
import type { AuthenticatedRequest, UserStatus } from '../types'

const router = createRouter()
const PASSWORD_SALT_ROUNDS = getPasswordSaltRounds()

const USER_WIKI_PAGE_SELECT = {
  id: true,
  slug: true,
  title: true,
  category: true,
  status: true,
  reviewNote: true,
  reviewedBy: true,
  reviewedAt: true,
  favoritesCount: true,
  isPinned: true,
  likesCount: true,
  dislikesCount: true,
  lastEditorUid: true,
  lastEditor: { select: { displayName: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WikiPageSelect

type PasswordUpdateResponse = {
  success: true
  token?: string
}

type PublicProfilePreferences = {
  publicFavorites: boolean
  publicHistory: boolean
}

const DEFAULT_PUBLIC_PROFILE_PREFERENCES: PublicProfilePreferences = {
  publicFavorites: false,
  publicHistory: false,
}

const ADMIN_USER_SELECT = {
  uid: true,
  email: true,
  displayName: true,
  photoURL: true,
  role: true,
  status: true,
  banReason: true,
  bannedAt: true,
  emailVerifiedAt: true,
  level: true,
  signature: true,
  bio: true,
  createdAt: true,
  updatedAt: true,
} as const

function canManageTargetUserRole(
  operatorRole: PrismaUserRole | undefined,
  targetRole: PrismaUserRole
) {
  if (operatorRole === 'super_admin') return true
  if (operatorRole === 'admin') return targetRole === 'user'
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizePublicProfilePreferences(value: unknown): PublicProfilePreferences {
  if (!isRecord(value)) {
    return DEFAULT_PUBLIC_PROFILE_PREFERENCES
  }

  return {
    publicFavorites:
      typeof value.publicFavorites === 'boolean'
        ? value.publicFavorites
        : DEFAULT_PUBLIC_PROFILE_PREFERENCES.publicFavorites,
    publicHistory:
      typeof value.publicHistory === 'boolean'
        ? value.publicHistory
        : DEFAULT_PUBLIC_PROFILE_PREFERENCES.publicHistory,
  }
}

function canViewPrivateProfileSection(
  targetUid: string,
  authUser: AuthenticatedRequest['authUser'],
  isPublic: boolean
) {
  if (authUser?.uid === targetUid) return true
  if (authUser?.role === 'admin' || authUser?.role === 'super_admin') return true
  return isPublic
}

function getPublicVisibilityWhere(
  forcePublic: boolean,
  authUser?: AuthenticatedRequest['authUser']
) {
  return forcePublic ? undefined : authUser
}

function toPublicUserProfile(
  user: {
    uid: string
    displayName: string
    photoURL: string | null
    signature: string
    bio: string
    preferences: unknown
    createdAt: Date
    updatedAt: Date
  },
  authUser?: AuthenticatedRequest['authUser']
) {
  const preferences = normalizePublicProfilePreferences(user.preferences)
  const isSelf = authUser?.uid === user.uid
  const isAdmin = authUser?.role === 'admin' || authUser?.role === 'super_admin'

  return {
    uid: user.uid,
    displayName: user.displayName,
    photoURL: user.photoURL,
    signature: user.signature,
    bio: user.bio,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    isSelf,
    canViewFavorites: Boolean(isSelf || isAdmin || preferences.publicFavorites),
    canViewHistory: Boolean(isSelf || isAdmin || preferences.publicHistory),
    publicFavorites: preferences.publicFavorites,
    publicHistory: preferences.publicHistory,
  }
}

async function resolveProfileContentTargets(
  items: Array<{ targetType: string; targetId: string }>,
  authUser?: AuthenticatedRequest['authUser']
) {
  const wikiIds = items.filter((item) => item.targetType === 'wiki').map((item) => item.targetId)
  const postIds = items.filter((item) => item.targetType === 'post').map((item) => item.targetId)
  const musicIds = items.filter((item) => item.targetType === 'music').map((item) => item.targetId)

  const [wikiPages, posts, songs] = await Promise.all([
    wikiIds.length
      ? prisma.wikiPage.findMany({
          where: { slug: { in: wikiIds }, deletedAt: null },
          include: {
            lastEditor: { select: { displayName: true } },
            location: true,
          },
        })
      : Promise.resolve([]),
    postIds.length
      ? prisma.post.findMany({ where: { id: { in: postIds }, deletedAt: null } })
      : Promise.resolve([]),
    musicIds.length
      ? prisma.musicTrack.findMany({ where: { docId: { in: musicIds }, deletedAt: null } })
      : Promise.resolve([]),
  ])

  const wikiMap = new Map(
    wikiPages
      .filter((page) => canViewWikiPage(page, authUser))
      .map((item) => [item.slug, toWikiResponse(item)])
  )
  const postMap = new Map(
    posts
      .filter((post) => canViewPost(post, authUser))
      .map((item) => [item.id, toPostResponse(item)])
  )
  const songMap = new Map(
    songs.map((song) => [
      song.docId,
      {
        ...song,
        createdAt: song.createdAt.toISOString(),
        updatedAt: song.updatedAt.toISOString(),
      },
    ])
  )

  return { wikiMap, postMap, songMap }
}

function getResolvedTarget(
  item: { targetType: string; targetId: string },
  targets: Awaited<ReturnType<typeof resolveProfileContentTargets>>
) {
  if (item.targetType === 'wiki') return targets.wikiMap.get(item.targetId) ?? null
  if (item.targetType === 'post') return targets.postMap.get(item.targetId) ?? null
  if (item.targetType === 'music') return targets.songMap.get(item.targetId) ?? null
  return null
}

type ProfileContentRecord = {
  id: string
  targetType: string
  targetId: string
  createdAt: Date
}

function getProfileContentKey(item: { targetType: string; targetId: string }) {
  return `${item.targetType}:${item.targetId}`
}

async function resolveVisibleProfileContentKeys(
  items: Array<{ targetType: string; targetId: string }>,
  authUser?: AuthenticatedRequest['authUser']
) {
  const wikiIds = items.filter((item) => item.targetType === 'wiki').map((item) => item.targetId)
  const postIds = items.filter((item) => item.targetType === 'post').map((item) => item.targetId)
  const musicIds = items.filter((item) => item.targetType === 'music').map((item) => item.targetId)

  const [wikiPages, posts, songs] = await Promise.all([
    wikiIds.length
      ? prisma.wikiPage.findMany({
          where: { slug: { in: wikiIds }, deletedAt: null },
          select: {
            slug: true,
            status: true,
            lastEditorUid: true,
            deletedAt: true,
          },
        })
      : Promise.resolve([]),
    postIds.length
      ? prisma.post.findMany({
          where: { id: { in: postIds }, deletedAt: null },
          select: {
            id: true,
            slug: true,
            status: true,
            authorUid: true,
            deletedAt: true,
          },
        })
      : Promise.resolve([]),
    musicIds.length
      ? prisma.musicTrack.findMany({
          where: { docId: { in: musicIds }, deletedAt: null },
          select: { docId: true },
        })
      : Promise.resolve([]),
  ])

  const visibleKeys = new Set<string>()
  wikiPages.forEach((page) => {
    if (canViewWikiPage(page, authUser)) {
      visibleKeys.add(`wiki:${page.slug}`)
    }
  })
  posts.forEach((post) => {
    if (canViewPost(post, authUser)) {
      visibleKeys.add(`post:${post.id}`)
    }
  })
  songs.forEach((song) => {
    visibleKeys.add(`music:${song.docId}`)
  })

  return visibleKeys
}

async function paginateVisibleProfileContent(
  records: ProfileContentRecord[],
  options: {
    skip: number
    limit: number
    authUser?: AuthenticatedRequest['authUser']
  }
) {
  const visibleKeys = await resolveVisibleProfileContentKeys(records, options.authUser)
  const visibleRecords = records.filter((record) => visibleKeys.has(getProfileContentKey(record)))

  return {
    pageItems: visibleRecords.slice(options.skip, options.skip + options.limit),
    total: visibleRecords.length,
  }
}

function toProfileContentItems(
  items: ProfileContentRecord[],
  targets: Awaited<ReturnType<typeof resolveProfileContentTargets>>
) {
  return items
    .map((item) => {
      const target = getResolvedTarget(item, targets)
      if (!target) return null
      return {
        id: item.id,
        targetType: item.targetType,
        targetId: item.targetId,
        createdAt: item.createdAt.toISOString(),
        target,
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
}

/**
 * 校验前端传入的 photoURL：
 * - 允许空字符串/null（清除头像）
 * - 允许相对路径 /uploads/...（本站上传）
 * - 允许 https?:// 形式的远端 URL（如外部图床、S3、微信头像）
 * - 禁止 javascript:/data:/vbscript: 等危险协议
 * - 限制最大长度 2048 字符
 */
function normalizePhotoUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > 2048) return null
  if (trimmed.startsWith('/uploads/')) {
    return trimmed
  }
  // 远端 URL 必须是 http/https
  try {
    const url = new URL(trimmed)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return trimmed
    }
  } catch {
    // 解析失败
  }
  return null
}

// User self-management routes
router.get(
  '/status',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const user = await prisma.user.findUnique({
        where: { uid: req.authUser!.uid },
        select: {
          uid: true,
          email: true,
          displayName: true,
          photoURL: true,
          role: true,
          status: true,
          banReason: true,
          bannedAt: true,
          emailVerifiedAt: true,
          level: true,
          signature: true,
          bio: true,
          preferences: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      if (!user) {
        res.status(404).json({ error: '用户不存在' })
        return
      }

      res.json({ user: toUserResponse(user) })
    } catch (error) {
      console.error('Fetch current user status error:', error)
      res.status(500).json({ error: '获取用户状态失败' })
    }
  })
)

// 管理员修改用户状态 - 需要超级管理员权限
router.put(
  '/:userId/status',
  requireSuperAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const targetUid = req.params.userId
      if (!targetUid) {
        res.status(400).json({ error: '无效用户' })
        return
      }

      const { status, banReason } = req.body as {
        status?: UserStatus
        banReason?: string
      }

      if (!status || !['active', 'banned'].includes(status)) {
        res.status(400).json({ error: '无效状态' })
        return
      }
      if (!ensureTextLimit(res, banReason, '封禁原因', CONTENT_LIMITS.userModeration.banReason)) {
        return
      }

      const updateData: Record<string, unknown> = {}
      updateData.status = status
      if (typeof banReason === 'string') updateData.banReason = banReason
      if (status === 'banned') {
        updateData.bannedAt = new Date()
      } else {
        updateData.banReason = null
        updateData.bannedAt = null
      }

      const user = await prisma.user.update({
        where: { uid: targetUid },
        data: updateData,
        select: {
          uid: true,
          email: true,
          displayName: true,
          photoURL: true,
          role: true,
          status: true,
          banReason: true,
          bannedAt: true,
          emailVerifiedAt: true,
          level: true,
          signature: true,
          bio: true,
          createdAt: true,
          updatedAt: true,
        },
      })
      // 清除目标用户在 authMiddleware 里的缓存，确保下次请求拿到最新状态
      clearUserCache(targetUid)

      await prisma.userBanLog.create({
        data: {
          targetUid,
          operatorUid: req.authUser!.uid,
          action: status === 'banned' ? 'ban' : 'unban',
          note: banReason || (status === 'banned' ? '管理员封禁' : '管理员解封'),
        },
      })

      res.json({ user: toUserResponse(user) })
    } catch (error) {
      console.error('Update user status error:', error)
      res.status(500).json({ error: '更新用户状态失败' })
    }
  })
)

router.put(
  '/name',
  requireAuth,
  requireActiveUser,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { displayName } = req.body as { displayName?: string }

      const displayNameResult = await validateUserDisplayName(displayName, {
        currentUid: req.authUser!.uid,
        currentDisplayName: req.authUser!.displayName,
      })
      if (displayNameResult.ok === false) {
        res.status(displayNameResult.status).json({ error: displayNameResult.error })
        return
      }

      const user = await prisma.user.update({
        where: { uid: req.authUser!.uid },
        data: { displayName: displayNameResult.displayName },
        select: {
          uid: true,
          email: true,
          displayName: true,
          photoURL: true,
          role: true,
          status: true,
          banReason: true,
          bannedAt: true,
          emailVerifiedAt: true,
          level: true,
          signature: true,
          bio: true,
          createdAt: true,
          updatedAt: true,
        },
      })
      clearUserCache(req.authUser!.uid)

      res.json({ user: toUserResponse(user) })
    } catch (error) {
      console.error('Update user name error:', error)
      res.status(500).json({ error: '更新昵称失败' })
    }
  })
)

router.put(
  '/email',
  profileLimiter,
  requireAuth,
  requireActiveUser,
  validateBody(userEmailUpdateSchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { currentPassword, newEmail } = req.body as {
        currentPassword: string
        newEmail: string
      }
      const normalizedEmail = newEmail.toLowerCase().trim()

      const user = await prisma.user.findUnique({
        where: { uid: req.authUser!.uid },
        select: {
          uid: true,
          email: true,
          displayName: true,
          passwordHash: true,
        },
      })

      if (!user?.passwordHash) {
        res.status(400).json({ error: '当前密码不正确' })
        return
      }

      const validPassword = await bcrypt.compare(currentPassword, user.passwordHash)
      if (!validPassword) {
        res.status(401).json({ error: '当前密码不正确' })
        return
      }

      if (normalizedEmail === user.email) {
        res.status(400).json({ error: '新邮箱不能与当前邮箱相同' })
        return
      }

      const existing = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { uid: true },
      })
      if (existing && existing.uid !== user.uid) {
        res.status(409).json({ error: '该邮箱已注册' })
        return
      }

      await prisma.$transaction([
        prisma.emailVerificationToken.updateMany({
          where: {
            userUid: user.uid,
            usedAt: null,
          },
          data: { usedAt: new Date() },
        }),
        prisma.user.update({
          where: { uid: user.uid },
          data: {
            email: normalizedEmail,
            emailVerifiedAt: null,
          },
        }),
      ])
      clearUserCache(user.uid)

      res.json({
        success: true,
        requiresEmailVerification: false,
        message: '邮箱已更新',
      })
    } catch (error) {
      console.error('Update user email error:', error)
      res.status(500).json({ error: '邮箱更新失败，请稍后重试' })
    }
  })
)

router.put(
  '/phone',
  requireAuth,
  requireActiveUser,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { phone } = req.body as { phone?: string }

      if (!phone || !phone.trim()) {
        res.status(400).json({ error: '手机号不能为空' })
        return
      }

      // Note: phone field is not in the User schema, this is a placeholder
      res.status(501).json({ error: '手机号功能暂未启用' })
    } catch (error) {
      console.error('Update user phone error:', error)
      res.status(500).json({ error: '更新手机号失败' })
    }
  })
)

router.put(
  '/password',
  requireAuth,
  requireActiveUser,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { currentPassword, newPassword } = req.body as {
        currentPassword?: string
        newPassword?: string
      }

      if (!currentPassword || !newPassword) {
        res.status(400).json({ error: '密码不能为空' })
        return
      }

      const passwordValidation = passwordSchema.safeParse(newPassword)
      if (!passwordValidation.success) {
        res
          .status(400)
          .json({ error: passwordValidation.error.issues[0]?.message || '新密码格式无效' })
        return
      }

      const user = await prisma.user.findUnique({
        where: { uid: req.authUser!.uid },
        select: { passwordHash: true },
      })

      if (!user?.passwordHash) {
        res.status(400).json({ error: '当前密码不正确' })
        return
      }

      const validPassword = await bcrypt.compare(currentPassword, user.passwordHash)
      if (!validPassword) {
        res.status(401).json({ error: '当前密码不正确' })
        return
      }

      const passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS)
      const [, updatedUser] = await prisma.$transaction([
        prisma.emailVerificationToken.updateMany({
          where: {
            userUid: req.authUser!.uid,
            purpose: EmailVerificationPurpose.reset_password,
            usedAt: null,
          },
          data: { usedAt: new Date() },
        }),
        prisma.user.update({
          where: { uid: req.authUser!.uid },
          data: { passwordHash },
          select: {
            uid: true,
            email: true,
            displayName: true,
            photoURL: true,
            wechatOpenId: true,
            role: true,
            status: true,
            banReason: true,
            bannedAt: true,
            emailVerifiedAt: true,
            level: true,
            signature: true,
            bio: true,
          },
        }),
      ])
      clearUserCache(req.authUser!.uid)
      const { token } = issueUserSession(req, res, {
        ...updatedUser,
        passwordHash,
      })

      const response: PasswordUpdateResponse = { success: true }
      if (isBearerAuthRequest(req)) {
        response.token = token
      }

      res.json(response)
    } catch (error) {
      console.error('Update user password error:', error)
      res.status(500).json({ error: '更新密码失败' })
    }
  })
)

// 注：头像上传走 POST /api/uploads/sessions/:id/files 通用上传接口，
// 客户端拿到文件 URL 后通过 PATCH /api/users/me { photoURL } 写入。
// 此处不再保留独立的 POST /avatar 占位路由。

// GET /api/users/me - Get current user info
router.get(
  '/me',
  requireAuth,
  requireActiveUser,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const user = await prisma.user.findUnique({
        where: { uid: req.authUser!.uid },
        select: {
          uid: true,
          email: true,
          displayName: true,
          signature: true,
          bio: true,
          photoURL: true,
          role: true,
          status: true,
          banReason: true,
          bannedAt: true,
          emailVerifiedAt: true,
          level: true,
          preferences: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      if (!user) {
        res.status(404).json({ error: '用户不存在' })
        return
      }

      res.json({ user: toUserResponse(user) })
    } catch (error) {
      console.error('Get current user error:', error)
      res.status(500).json({ error: '获取用户信息失败' })
    }
  })
)

router.patch(
  '/me',
  profileLimiter,
  requireAuth,
  requireActiveUser,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { displayName, signature, bio, preferences, photoURL } = req.body
      const updateData: Record<string, unknown> = {}

      if (displayName !== undefined) {
        const displayNameResult = await validateUserDisplayName(displayName, {
          currentUid: req.authUser!.uid,
          currentDisplayName: req.authUser!.displayName,
        })
        if (displayNameResult.ok === false) {
          res.status(displayNameResult.status).json({ error: displayNameResult.error })
          return
        }
        updateData.displayName = displayNameResult.displayName
      }
      if (signature !== undefined) {
        if (typeof signature === 'string' && signature.length > PROFILE_SIGNATURE_MAX_LENGTH) {
          res.status(400).json({ error: `签名不能超过${PROFILE_SIGNATURE_MAX_LENGTH}个字符` })
          return
        }
        updateData.signature = signature
      }
      if (bio !== undefined) {
        if (typeof bio === 'string' && bio.length > WIKI_MAX_CONTENT_SIZE) {
          res.status(400).json({ error: '个人简介不能超过500KB' })
          return
        }
        updateData.bio = bio
      }
      if (preferences !== undefined) {
        const prefSize =
          typeof preferences === 'string' ? preferences.length : JSON.stringify(preferences).length
        if (prefSize > CONTENT_LIMITS.profile.preferences) {
          res.status(400).json({ error: '偏好设置不能超过2KB' })
          return
        }
        const existing = await prisma.user.findUnique({
          where: { uid: req.authUser!.uid },
          select: { preferences: true },
        })
        updateData.preferences = {
          ...(isRecord(existing?.preferences) ? existing.preferences : {}),
          ...(isRecord(preferences) ? preferences : {}),
        }
      }

      // 头像处理：校验 URL，并在变更时同步历史评论 / 帖子作者头像快照
      let normalizedPhotoUrl: string | null | undefined
      let oldPhotoURL: string | null = null
      if (photoURL !== undefined) {
        if (!ensureTextLimit(res, photoURL, '头像地址', CONTENT_LIMITS.profile.photoURL)) {
          return
        }
        normalizedPhotoUrl = normalizePhotoUrl(photoURL)
        if (photoURL && photoURL !== '' && normalizedPhotoUrl === null) {
          res.status(400).json({ error: '头像地址不合法' })
          return
        }
        // 读取旧头像，便于在替换后清理已经无人引用的旧文件
        const existing = await prisma.user.findUnique({
          where: { uid: req.authUser!.uid },
          select: { photoURL: true },
        })
        oldPhotoURL = existing?.photoURL || null
        updateData.photoURL = normalizedPhotoUrl
      }

      if (Object.keys(updateData).length === 0) {
        res.status(400).json({ error: '没有要更新的字段' })
        return
      }

      const user = await prisma.user.update({
        where: { uid: req.authUser!.uid },
        data: updateData,
      })
      // 关键：authMiddleware 缓存了 ApiUser，不清就要等 5 分钟 TTL 才生效，导致刷新后看到旧头像/旧昵称
      clearUserCache(req.authUser!.uid)

      // 替换头像后，旧的本地上传文件不再被引用，安全删除
      if (photoURL !== undefined && oldPhotoURL !== normalizedPhotoUrl) {
        if (
          oldPhotoURL &&
          oldPhotoURL.startsWith('/uploads/') &&
          oldPhotoURL !== normalizedPhotoUrl
        ) {
          await safeDeleteUploadFileByUrl(oldPhotoURL).catch((err) =>
            logger.debug({ err }, 'Operation cleanup failed')
          )
        }
      }
      // 注：评论的作者昵称/头像现在通过 author 关系实时 JOIN 获取，
      // 不再需要 updateMany 同步快照字段。

      res.json({ user: userToApiUser(user) })
    } catch (error) {
      console.error('Update user profile error:', error)
      res.status(500).json({ error: '更新用户资料失败' })
    }
  })
)

router.delete(
  '/account',
  requireAuth,
  requireActiveUser,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      // 获取旧头像 URL，用于注销后清理本地文件
      const existing = await prisma.user.findUnique({
        where: { uid: req.authUser!.uid },
        select: { photoURL: true },
      })

      // Soft delete or account deletion logic
      await prisma.user.update({
        where: { uid: req.authUser!.uid },
        data: {
          displayName: '已注销用户',
          photoURL: null,
          signature: '',
          bio: '',
          status: 'banned',
          banReason: '用户主动注销',
        },
      })
      clearUserCache(req.authUser!.uid)

      // 注：评论的作者昵称/头像通过 author 关系实时 JOIN 获取，
      // 注销时 User.displayName 已置为 "已注销用户"、photoURL 已置 null，
      // 历史评论会自动反映这些更新，不需要再额外 updateMany。

      // 物理删除旧头像文件，防止留下孤儿文件
      if (existing?.photoURL && existing.photoURL.startsWith('/uploads/')) {
        await safeDeleteUploadFileByUrl(existing.photoURL).catch((err) =>
          logger.debug({ err }, 'Operation cleanup failed')
        )
      }

      res.json({ success: true })
    } catch (error) {
      console.error('Delete account error:', error)
      res.status(500).json({ error: '注销账户失败' })
    }
  })
)

// Admin user management routes
router.get(
  '/',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    try {
      const users = await prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          uid: true,
          email: true,
          displayName: true,
          photoURL: true,
          role: true,
          status: true,
          banReason: true,
          bannedAt: true,
          emailVerifiedAt: true,
          level: true,
          signature: true,
          bio: true,
          createdAt: true,
          updatedAt: true,
        },
      })
      res.json({ users: users.map(toUserResponse) })
    } catch (error) {
      console.error('Fetch users error:', error)
      res.status(500).json({ error: '获取用户列表失败' })
    }
  })
)

const updateUserRoleHandler = asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const { role, currentPassword } = req.body as {
      role: PrismaUserRole
      currentPassword?: string
    }

    const targetUid = req.params.userId
    if (!targetUid) {
      res.status(400).json({ error: '无效用户' })
      return
    }

    if (req.authUser?.uid === targetUid) {
      res.status(400).json({ error: '不能修改自己的角色' })
      return
    }

    const targetUser = await prisma.user.findUnique({
      where: { uid: targetUid },
      select: { role: true, deletedAt: true },
    })
    if (!targetUser || targetUser.deletedAt) {
      res.status(404).json({ error: '用户不存在' })
      return
    }

    if (targetUser.role === role) {
      const user = await prisma.user.findUnique({
        where: { uid: targetUid },
        select: ADMIN_USER_SELECT,
      })
      if (!user) {
        res.status(404).json({ error: '用户不存在' })
        return
      }
      res.json({ user: toUserResponse(user) })
      return
    }

    const demotesSuperAdmin = targetUser.role === 'super_admin' && role !== 'super_admin'
    const touchesSuperAdmin = role === 'super_admin' || demotesSuperAdmin
    if (touchesSuperAdmin && !ALLOW_SUPER_ADMIN_MANAGE_SUPER_ADMINS) {
      res.status(403).json({ error: '当前配置不允许变更超级管理员身份' })
      return
    }

    if (demotesSuperAdmin) {
      if (role !== 'admin') {
        res.status(400).json({ error: '超级管理员只能降为管理员' })
        return
      }

      const remainingSuperAdminCount = await prisma.user.count({
        where: {
          role: 'super_admin',
          status: 'active',
          deletedAt: null,
          uid: { not: targetUid },
        },
      })
      if (remainingSuperAdminCount < 1) {
        res.status(400).json({ error: '至少需要保留一名超级管理员' })
        return
      }
    }

    if (touchesSuperAdmin) {
      if (!currentPassword) {
        res.status(400).json({ error: '请验证当前账户密码' })
        return
      }

      const operator = await prisma.user.findUnique({
        where: { uid: req.authUser!.uid },
        select: { passwordHash: true },
      })
      if (!operator?.passwordHash) {
        res.status(400).json({ error: '当前账户未设置密码，请先在个人设置中设置登录密码' })
        return
      }

      const validPassword = await bcrypt.compare(currentPassword, operator.passwordHash)
      if (!validPassword) {
        res.status(401).json({ error: '当前密码不正确' })
        return
      }
    }

    const user = await prisma.user.update({
      where: { uid: targetUid },
      data: { role },
      select: ADMIN_USER_SELECT,
    })
    clearUserCache(targetUid)

    res.json({ user: toUserResponse(user) })
  } catch (error) {
    console.error('Update user role error:', error)
    res.status(500).json({ error: '更新角色失败' })
  }
})

router
  .route('/:userId/role')
  .put(requireSuperAdmin, validateBody(adminUpdateUserRoleSchema), updateUserRoleHandler)
  .patch(requireSuperAdmin, validateBody(adminUpdateUserRoleSchema), updateUserRoleHandler)

router.patch(
  '/:userId',
  requireAdmin,
  validateBody(adminUpdateUserSchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const targetUid = req.params.userId
      if (!targetUid) {
        res.status(400).json({ error: '无效用户' })
        return
      }

      if (req.authUser?.uid === targetUid) {
        res.status(400).json({ error: '不能编辑自己的资料' })
        return
      }

      const { displayName, signature, bio, email, emailVerified, newPassword } = req.body as {
        displayName?: string
        signature?: string
        bio?: string
        email?: string
        emailVerified?: boolean
        newPassword?: string
      }

      const targetUser = await prisma.user.findUnique({
        where: { uid: targetUid },
        select: {
          uid: true,
          email: true,
          displayName: true,
          role: true,
          emailVerifiedAt: true,
        },
      })

      if (!targetUser) {
        res.status(404).json({ error: '用户不存在' })
        return
      }

      if (!canManageTargetUserRole(req.authUser?.role, targetUser.role)) {
        res.status(403).json({ error: '只能编辑普通用户' })
        return
      }

      const emailChanged = email !== undefined && email !== targetUser.email
      if (emailChanged) {
        const existing = await prisma.user.findUnique({
          where: { email },
          select: { uid: true },
        })
        if (existing && existing.uid !== targetUid) {
          res.status(409).json({ error: '该邮箱已注册' })
          return
        }
      }

      const updateData: Prisma.UserUpdateInput = {}
      if (displayName !== undefined) {
        const displayNameResult = await validateUserDisplayName(displayName, {
          currentUid: targetUid,
          currentDisplayName: targetUser.displayName,
        })
        if (displayNameResult.ok === false) {
          res.status(displayNameResult.status).json({ error: displayNameResult.error })
          return
        }
        updateData.displayName = displayNameResult.displayName
      }
      if (signature !== undefined) updateData.signature = signature
      if (bio !== undefined) updateData.bio = bio
      if (email !== undefined) updateData.email = email

      const now = new Date()
      if (emailVerified !== undefined) {
        updateData.emailVerifiedAt = emailVerified
          ? emailChanged
            ? now
            : targetUser.emailVerifiedAt || now
          : null
      } else if (emailChanged) {
        updateData.emailVerifiedAt = null
      }

      if (newPassword) {
        updateData.passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS)
      }

      const verificationChanged =
        emailVerified !== undefined && emailVerified !== Boolean(targetUser.emailVerifiedAt)
      const shouldInvalidateEmailTokens = emailChanged || verificationChanged
      const shouldInvalidatePasswordResetTokens = Boolean(newPassword)
      const updateUserOperation = prisma.user.update({
        where: { uid: targetUid },
        data: updateData,
        select: ADMIN_USER_SELECT,
      })

      const user =
        shouldInvalidateEmailTokens || shouldInvalidatePasswordResetTokens
          ? (
              await prisma.$transaction([
                prisma.emailVerificationToken.updateMany({
                  where: {
                    userUid: targetUid,
                    usedAt: null,
                    ...(shouldInvalidateEmailTokens
                      ? {}
                      : { purpose: EmailVerificationPurpose.reset_password }),
                  },
                  data: { usedAt: now },
                }),
                updateUserOperation,
              ])
            )[1]
          : await updateUserOperation

      clearUserCache(targetUid)

      res.json({ user: toUserResponse(user) })
    } catch (error) {
      console.error('Admin update user error:', error)
      res.status(500).json({ error: '更新用户资料失败' })
    }
  })
)

router.put(
  '/:userId/reset-password',
  requireAdmin,
  validateBody(adminResetUserPasswordSchema),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const targetUid = req.params.userId
      if (!targetUid) {
        res.status(400).json({ error: '无效用户' })
        return
      }

      if (req.authUser?.uid === targetUid) {
        res.status(400).json({ error: '不能重置自己的密码' })
        return
      }

      const { newPassword } = req.body as { newPassword: string }

      const targetUser = await prisma.user.findUnique({
        where: { uid: targetUid },
        select: {
          uid: true,
          role: true,
        },
      })

      if (!targetUser) {
        res.status(404).json({ error: '用户不存在' })
        return
      }

      if (req.authUser?.role !== 'super_admin' && targetUser.role !== 'user') {
        res.status(403).json({ error: '只能重置普通用户的密码' })
        return
      }

      const passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS)
      await prisma.$transaction([
        prisma.emailVerificationToken.updateMany({
          where: {
            userUid: targetUid,
            purpose: EmailVerificationPurpose.reset_password,
            usedAt: null,
          },
          data: { usedAt: new Date() },
        }),
        prisma.user.update({
          where: { uid: targetUid },
          data: { passwordHash },
        }),
      ])
      clearUserCache(targetUid)

      res.json({ success: true })
    } catch (error) {
      console.error('Admin reset user password error:', error)
      res.status(500).json({ error: '重置密码失败' })
    }
  })
)

router.put(
  '/:userId/ban',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const targetUid = req.params.userId
      if (!targetUid) {
        res.status(400).json({ error: '无效用户' })
        return
      }

      if (req.authUser?.uid === targetUid) {
        res.status(400).json({ error: '不能封禁自己' })
        return
      }

      const noteRaw = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
      const reasonRaw = typeof req.body?.reason === 'string' ? req.body.reason.trim() : ''
      if (
        !ensureTextLimit(res, noteRaw, '操作备注', CONTENT_LIMITS.userModeration.note) ||
        !ensureTextLimit(res, reasonRaw, '封禁原因', CONTENT_LIMITS.userModeration.banReason)
      ) {
        return
      }
      const finalReason = reasonRaw || noteRaw
      if (!finalReason) {
        res.status(400).json({ error: '请输入封禁原因' })
        return
      }

      const targetUser = await prisma.user.findUnique({
        where: { uid: targetUid },
        select: { uid: true, role: true },
      })

      if (!targetUser) {
        res.status(404).json({ error: '用户不存在' })
        return
      }

      if (!canManageTargetUserRole(req.authUser?.role, targetUser.role)) {
        res.status(403).json({ error: '只能封禁普通用户' })
        return
      }

      const user = await prisma.user.update({
        where: { uid: targetUid },
        data: {
          status: 'banned',
          banReason: finalReason,
          bannedAt: new Date(),
        },
        select: ADMIN_USER_SELECT,
      })
      clearUserCache(targetUid)

      await prisma.userBanLog.create({
        data: {
          targetUid,
          operatorUid: req.authUser!.uid,
          action: 'ban',
          note: finalReason,
        },
      })

      res.json({ user: toUserResponse(user) })
    } catch (error) {
      console.error('Ban user error:', error)
      res.status(500).json({ error: '封禁用户失败' })
    }
  })
)

router.put(
  '/:userId/unban',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const targetUid = req.params.userId
      if (!targetUid) {
        res.status(400).json({ error: '无效用户' })
        return
      }

      const note = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
      if (!ensureTextLimit(res, note, '操作备注', CONTENT_LIMITS.userModeration.note)) {
        return
      }

      const targetUser = await prisma.user.findUnique({
        where: { uid: targetUid },
        select: { uid: true, role: true },
      })

      if (!targetUser) {
        res.status(404).json({ error: '用户不存在' })
        return
      }

      if (!canManageTargetUserRole(req.authUser?.role, targetUser.role)) {
        res.status(403).json({ error: '只能解封普通用户' })
        return
      }

      const user = await prisma.user.update({
        where: { uid: targetUid },
        data: {
          status: 'active',
          banReason: null,
          bannedAt: null,
        },
        select: ADMIN_USER_SELECT,
      })
      clearUserCache(targetUid)

      await prisma.userBanLog.create({
        data: {
          targetUid,
          operatorUid: req.authUser!.uid,
          action: 'unban',
          note: note || null,
        },
      })

      res.json({ user: toUserResponse(user) })
    } catch (error) {
      console.error('Unban user error:', error)
      res.status(500).json({ error: '解封用户失败' })
    }
  })
)

// User browsing history route
router.get(
  '/me/history',
  requireAuth,
  requireActiveUser,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { type, limit = '20', offset = '0' } = req.query
      const userId = req.authUser!.uid

      const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100)
      const offsetNum = Math.max(Number(offset) || 0, 0)

      const where: Record<string, unknown> = {
        userUid: userId,
      }

      // Filter by type if provided
      if (type && ['wiki', 'post', 'music'].includes(type as string)) {
        where.targetType = type as string
      }

      const [histories, total] = await Promise.all([
        prisma.browsingHistory.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limitNum,
          skip: offsetNum,
        }),
        prisma.browsingHistory.count({ where }),
      ])

      res.json({
        history: histories.map((item) => ({
          id: item.id,
          targetType: item.targetType,
          targetId: item.targetId,
          createdAt: item.createdAt.toISOString(),
        })),
        pagination: {
          total,
          limit: limitNum,
          offset: offsetNum,
          hasMore: offsetNum + limitNum < total,
        },
      })
    } catch (error) {
      console.error('Get user history error:', error)
      res.status(500).json({ error: '获取历史记录失败' })
    }
  })
)

router.get(
  '/mentions',
  requireAuth,
  requireActiveUser,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
      const parsedLimit = Number.parseInt(String(req.query.limit ?? '8'), 10)
      const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 20) : 8

      if (!query) {
        res.json({ users: [] })
        return
      }

      const users = await prisma.user.findMany({
        where: {
          status: 'active',
          deletedAt: null,
          displayName: { contains: query, mode: 'insensitive' },
        },
        select: {
          uid: true,
          displayName: true,
          photoURL: true,
        },
        orderBy: [{ displayName: 'asc' }, { createdAt: 'asc' }],
        take: limit,
      })

      res.json({ users })
    } catch (error) {
      console.error('Search mention users error:', error)
      res.status(500).json({ error: '搜索用户失败' })
    }
  })
)

// User detail routes
router.get(
  '/:userId/profile',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const user = await prisma.user.findUnique({
        where: { uid: req.params.userId },
        select: {
          uid: true,
          displayName: true,
          photoURL: true,
          signature: true,
          bio: true,
          preferences: true,
          deletedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      if (!user || user.deletedAt) {
        res.status(404).json({ error: '用户不存在' })
        return
      }

      res.json({ user: toPublicUserProfile(user, req.authUser) })
    } catch (error) {
      console.error('Fetch public user profile error:', error)
      res.status(500).json({ error: '获取用户资料失败' })
    }
  })
)

router.get(
  '/:userId/posts',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.params.userId
      const { limit, page, offset: skip } = parsePagination(req.query)
      const forcePublic = req.query.visibility === 'public'
      const canViewPrivateUserContent = Boolean(
        req.authUser &&
        (req.authUser.uid === uid ||
          req.authUser.role === 'admin' ||
          req.authUser.role === 'super_admin')
      )

      const visibilityWhere = buildPostVisibilityWhere(
        getPublicVisibilityWhere(forcePublic, req.authUser)
      )

      const where = {
        authorUid: uid,
        ...visibilityWhere,
      }

      const [posts, total] = await Promise.all([
        prisma.post.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip,
          select: {
            id: true,
            slug: true,
            title: true,
            section: true,
            content: true,
            tags: true,
            locationCode: true,
            authorUid: true,
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
            musicDocId: true,
            albumDocId: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.post.count({ where }),
      ])

      const likedPostSet = new Set<string>()
      const favoritedPostSet = new Set<string>()
      const dislikedPostSet = new Set<string>()
      if (req.authUser && posts.length) {
        const postIds = posts.map((item) => item.id)
        const [likedPosts, favoritedPosts, dislikedPosts] = await Promise.all([
          prisma.postLike.findMany({
            where: {
              userUid: req.authUser.uid,
              postId: { in: postIds },
            },
            select: { postId: true },
          }),
          prisma.favorite.findMany({
            where: {
              userUid: req.authUser.uid,
              targetType: 'post',
              targetId: { in: postIds },
            },
            select: { targetId: true },
          }),
          prisma.postDislike.findMany({
            where: {
              userUid: req.authUser.uid,
              postId: { in: postIds },
            },
            select: { postId: true },
          }),
        ])
        likedPosts.forEach((item) => likedPostSet.add(item.postId))
        favoritedPosts.forEach((item) => favoritedPostSet.add(item.targetId))
        dislikedPosts.forEach((item) => dislikedPostSet.add(item.postId))
      }

      res.json({
        posts: posts.map((post) => {
          const item = toPostResponse(post)
          return {
            ...item,
            reviewNote: canViewPrivateUserContent ? item.reviewNote : null,
            reviewedBy: canViewPrivateUserContent ? item.reviewedBy : null,
            reviewedAt: canViewPrivateUserContent ? item.reviewedAt : null,
            likedByMe: likedPostSet.has(post.id),
            favoritedByMe: favoritedPostSet.has(post.id),
            dislikedByMe: dislikedPostSet.has(post.id),
          }
        }),
        total,
        page,
        limit,
        hasMore: skip + posts.length < total,
      })
    } catch (error) {
      console.error('Fetch user posts error:', error)
      res.status(500).json({ error: '获取用户帖子失败' })
    }
  })
)

router.get(
  '/:userId/galleries',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.params.userId
      const { limit, page, offset: skip } = parsePagination(req.query)
      const forcePublic = req.query.visibility === 'public'
      const visibilityWhere = buildGalleryVisibilityWhere(
        getPublicVisibilityWhere(forcePublic, req.authUser)
      )

      const where = {
        authorUid: uid,
        ...visibilityWhere,
      }

      const [galleries, total] = await Promise.all([
        prisma.gallery.findMany({
          where,
          include: {
            images: {
              include: {
                asset: true,
              },
              orderBy: { sortOrder: 'asc' },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip,
        }),
        prisma.gallery.count({ where }),
      ])

      res.json({
        galleries: await toGalleryListResponse(galleries),
        total,
        page,
        limit,
        hasMore: skip + galleries.length < total,
      })
    } catch (error) {
      console.error('Fetch user galleries error:', error)
      res.status(500).json({ error: '获取用户图集失败' })
    }
  })
)

router.get(
  '/:userId/wiki',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.params.userId
      const { limit, page, offset: skip } = parsePagination(req.query)
      const isAdmin = req.authUser?.role === 'admin' || req.authUser?.role === 'super_admin'
      const canViewPrivateUserContent = Boolean(
        req.authUser && (req.authUser.uid === uid || isAdmin)
      )
      const visibilityWhere = canViewPrivateUserContent
        ? isAdmin
          ? Prisma.sql`page."deletedAt" IS NULL`
          : Prisma.sql`
          page."deletedAt" IS NULL
          AND (
            page."status" = 'published'
            OR page."lastEditorUid" = ${uid}
          )
        `
        : Prisma.sql`page."deletedAt" IS NULL AND page."status" = 'published'`
      const editedPagesWhere = Prisma.sql`
      ${visibilityWhere}
      AND (
        page."lastEditorUid" = ${uid}
        OR EXISTS (
          SELECT 1
          FROM "WikiRevision" AS revision
          WHERE revision."pageSlug" = page."slug"
            AND revision."editorUid" = ${uid}
        )
      )
    `

      const [pageRows, totalRows] = await Promise.all([
        prisma.$queryRaw<Array<{ slug: string; editedAt: Date }>>(Prisma.sql`
        SELECT
          page."slug",
          COALESCE(MAX(revision."createdAt"), page."updatedAt") AS "editedAt"
        FROM "WikiPage" AS page
        LEFT JOIN "WikiRevision" AS revision
          ON revision."pageSlug" = page."slug"
          AND revision."editorUid" = ${uid}
        WHERE ${editedPagesWhere}
        GROUP BY page."slug", page."updatedAt"
        ORDER BY "editedAt" DESC, page."slug" ASC
        LIMIT ${limit}
        OFFSET ${skip}
      `),
        prisma.$queryRaw<Array<{ count: number | bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS "count"
        FROM "WikiPage" AS page
        WHERE ${editedPagesWhere}
      `),
      ])

      const pageSlugs = pageRows.map((item) => item.slug)
      const editedAtBySlug = new Map(pageRows.map((item) => [item.slug, item.editedAt]))

      const pages = pageSlugs.length
        ? await prisma.wikiPage.findMany({
            where: { slug: { in: pageSlugs } },
            select: USER_WIKI_PAGE_SELECT,
          })
        : []
      const pageBySlug = new Map(pages.map((item) => [item.slug, item]))
      const pageItems = pageSlugs
        .map((slug) => {
          const wikiPage = pageBySlug.get(slug)
          const editedAt = editedAtBySlug.get(slug)
          if (!wikiPage || !editedAt) return null
          return { page: wikiPage, editedAt }
        })
        .filter((item): item is { page: (typeof pages)[number]; editedAt: Date } => Boolean(item))
      const total = Number(totalRows[0]?.count ?? 0)

      const favoritedWikiSet = new Set<string>()
      const likedWikiSet = new Set<string>()
      const dislikedWikiSet = new Set<string>()
      if (req.authUser && pageSlugs.length) {
        const [favorites, likes, dislikes] = await Promise.all([
          prisma.favorite.findMany({
            where: {
              userUid: req.authUser.uid,
              targetType: 'wiki',
              targetId: { in: pageSlugs },
            },
            select: { targetId: true },
          }),
          prisma.wikiLike.findMany({
            where: {
              userUid: req.authUser.uid,
              pageSlug: { in: pageSlugs },
            },
            select: { pageSlug: true },
          }),
          prisma.wikiDislike.findMany({
            where: {
              userUid: req.authUser.uid,
              pageSlug: { in: pageSlugs },
            },
            select: { pageSlug: true },
          }),
        ])
        favorites.forEach((item) => favoritedWikiSet.add(item.targetId))
        likes.forEach((item) => likedWikiSet.add(item.pageSlug))
        dislikes.forEach((item) => dislikedWikiSet.add(item.pageSlug))
      }

      res.json({
        pages: pageItems.map((entry) => {
          const item = entry.page
          return {
            id: item.id,
            slug: item.slug,
            title: item.title,
            category: item.category,
            status: item.status,
            reviewNote: canViewPrivateUserContent ? item.reviewNote : null,
            reviewedBy: canViewPrivateUserContent ? item.reviewedBy : null,
            reviewedAt: canViewPrivateUserContent ? item.reviewedAt : null,
            favoritesCount: item.favoritesCount,
            isPinned: item.isPinned,
            likesCount: item.likesCount,
            dislikesCount: item.dislikesCount,
            lastEditorUid: item.lastEditorUid,
            lastEditorName: item.lastEditor?.displayName || '匿名',
            createdAt: item.createdAt.toISOString(),
            updatedAt: item.updatedAt.toISOString(),
            editedAt: entry.editedAt.toISOString(),
            favoritedByMe: favoritedWikiSet.has(item.slug),
            likedByMe: likedWikiSet.has(item.slug),
            dislikedByMe: dislikedWikiSet.has(item.slug),
          }
        }),
        total,
        page,
        limit,
        hasMore: skip + pageItems.length < total,
      })
    } catch (error) {
      console.error('Fetch user wiki pages error:', error)
      res.status(500).json({ error: '获取用户百科失败' })
    }
  })
)

router.get(
  '/:userId/comments',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.params.userId
      const { limit, page, offset: skip } = parsePagination(req.query)
      const isAdmin = req.authUser?.role === 'admin' || req.authUser?.role === 'super_admin'
      const canViewPrivateUserContent = Boolean(
        req.authUser && (req.authUser.uid === uid || isAdmin)
      )

      const visibilityWhere = buildPostVisibilityWhere(req.authUser)
      const galleryVisibilityWhere = buildGalleryVisibilityWhere(req.authUser)
      const where = {
        authorUid: uid,
      }

      const [comments, total] = await Promise.all([
        prisma.postComment.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip,
          include: {
            author: {
              select: { displayName: true, photoURL: true },
            },
            replyTo: {
              select: {
                authorUid: true,
                author: {
                  select: { displayName: true },
                },
              },
            },
            _count: {
              select: { likes: true },
            },
          },
        }),
        prisma.postComment.count({ where }),
      ])

      // PostComment.postId 可能为 null（图集评论），筛掉非空的再传给 Post 查询，
      // 让 Prisma 的 in 子句类型对齐 string[]
      const postIds = [
        ...new Set(comments.map((c) => c.postId).filter((id): id is string => Boolean(id))),
      ]
      const galleryIds = [
        ...new Set(comments.map((c) => c.galleryId).filter((id): id is string => Boolean(id))),
      ]
      const commentIds = comments.map((comment) => comment.id)
      const postsMap = new Map<
        string,
        { id: string; slug: string; title: string; status: string }
      >()
      const galleriesMap = new Map<
        string,
        { id: string; slug: string; title: string; status: string; published: boolean }
      >()
      const deletionReasonMap = new Map<string, string | null>()

      const [posts, galleries, deleteLogs] = await Promise.all([
        postIds.length
          ? prisma.post.findMany({
              where: {
                id: { in: postIds },
                ...visibilityWhere,
              },
              select: { id: true, slug: true, title: true, status: true },
            })
          : Promise.resolve([]),
        galleryIds.length
          ? prisma.gallery.findMany({
              where: {
                id: { in: galleryIds },
                ...galleryVisibilityWhere,
              },
              select: { id: true, slug: true, title: true, status: true, published: true },
            })
          : Promise.resolve([]),
        canViewPrivateUserContent && commentIds.length
          ? prisma.moderationLog.findMany({
              where: {
                targetType: 'comment',
                action: 'delete',
                targetId: { in: commentIds },
              },
              orderBy: { createdAt: 'desc' },
              select: { targetId: true, note: true },
            })
          : Promise.resolve([]),
      ])
      posts.forEach((p) => postsMap.set(p.id, p))
      galleries.forEach((gallery) => galleriesMap.set(gallery.id, gallery))
      deleteLogs.forEach((log) => {
        if (!deletionReasonMap.has(log.targetId)) {
          deletionReasonMap.set(log.targetId, log.note)
        }
      })

      res.json({
        comments: comments.map((comment) => {
          const post = comment.postId ? (postsMap.get(comment.postId) ?? null) : null
          const gallery = comment.galleryId ? (galleriesMap.get(comment.galleryId) ?? null) : null
          const targetType = comment.galleryId ? 'gallery' : 'post'
          const targetVisible = comment.postId ? !!post : !!gallery
          const commentResp = toCommentResponse(comment, { maskDeletedContent: !isAdmin })
          return {
            ...commentResp,
            content: targetVisible || isAdmin ? commentResp.content : null,
            targetType,
            target: gallery
              ? {
                  id: gallery.id,
                  slug: gallery.slug,
                  title: gallery.title,
                  status: gallery.status,
                  published: gallery.published,
                }
              : post,
            post,
            gallery,
            deletionReason:
              canViewPrivateUserContent && comment.deletedAt
                ? (deletionReasonMap.get(comment.id) ?? null)
                : null,
          }
        }),
        total,
        page,
        limit,
        hasMore: skip + comments.length < total,
      })
    } catch (error) {
      console.error('Fetch user comments error:', error)
      res.status(500).json({ error: '获取用户评论失败' })
    }
  })
)

router.get(
  '/:userId/favorites',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.params.userId
      const rawType = req.query.type
      const requestedType = parseFavoriteType(rawType)
      const { limit, page, offset: skip } = parsePagination(req.query)

      if (rawType !== undefined && rawType !== null && rawType !== '' && !requestedType) {
        res.status(400).json({ error: '无效收藏类型' })
        return
      }

      const targetUser = await prisma.user.findUnique({
        where: { uid },
        select: { uid: true, preferences: true, deletedAt: true },
      })

      if (!targetUser || targetUser.deletedAt) {
        res.status(404).json({ error: '用户不存在' })
        return
      }

      const preferences = normalizePublicProfilePreferences(targetUser.preferences)
      if (!canViewPrivateProfileSection(uid, req.authUser, preferences.publicFavorites)) {
        res.status(403).json({ error: '无权查看该用户的收藏' })
        return
      }

      const favorites = await prisma.favorite.findMany({
        where: {
          userUid: uid,
          ...(requestedType ? { targetType: requestedType } : {}),
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          targetType: true,
          targetId: true,
          createdAt: true,
        },
      })
      const { pageItems, total } = await paginateVisibleProfileContent(favorites, {
        skip,
        limit,
        authUser: req.authUser,
      })
      const targets = await resolveProfileContentTargets(pageItems, req.authUser)

      res.json({
        favorites: toProfileContentItems(pageItems, targets),
        total,
        page,
        limit,
        hasMore: skip + pageItems.length < total,
      })
    } catch (error) {
      console.error('Fetch user public favorites error:', error)
      res.status(500).json({ error: '获取用户收藏失败' })
    }
  })
)

router.get(
  '/:userId/history',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.params.userId
      const { limit, page, offset: skip } = parsePagination(req.query)
      const type = req.query.type

      if (type && !['wiki', 'post', 'music'].includes(String(type))) {
        res.status(400).json({ error: '无效历史类型' })
        return
      }

      const targetUser = await prisma.user.findUnique({
        where: { uid },
        select: { uid: true, preferences: true, deletedAt: true },
      })

      if (!targetUser || targetUser.deletedAt) {
        res.status(404).json({ error: '用户不存在' })
        return
      }

      const preferences = normalizePublicProfilePreferences(targetUser.preferences)
      if (!canViewPrivateProfileSection(uid, req.authUser, preferences.publicHistory)) {
        res.status(403).json({ error: '无权查看该用户的浏览历史' })
        return
      }

      const histories = await prisma.browsingHistory.findMany({
        where: {
          userUid: uid,
          ...(type ? { targetType: String(type) as 'wiki' | 'post' | 'music' } : {}),
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          targetType: true,
          targetId: true,
          createdAt: true,
        },
      })
      const { pageItems, total } = await paginateVisibleProfileContent(histories, {
        skip,
        limit,
        authUser: req.authUser,
      })
      const targets = await resolveProfileContentTargets(pageItems, req.authUser)

      res.json({
        history: toProfileContentItems(pageItems, targets),
        total,
        page,
        limit,
        hasMore: skip + pageItems.length < total,
      })
    } catch (error) {
      console.error('Fetch user public history error:', error)
      res.status(500).json({ error: '获取用户浏览历史失败' })
    }
  })
)

router.get(
  '/:userId/likes',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.params.userId
      const { limit, page, offset: skip } = parsePagination(req.query)

      // Users can only see their own likes unless they're admin
      if (req.authUser?.uid !== uid && req.authUser?.role === 'user') {
        res.status(403).json({ error: '无权查看该用户的点赞记录' })
        return
      }

      const likedPosts = await prisma.postLike.findMany({
        where: {
          userUid: uid,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
        include: {
          post: {
            select: {
              id: true,
              slug: true,
              title: true,
              section: true,
              status: true,
              authorUid: true,
              likesCount: true,
              commentsCount: true,
              viewCount: true,
              createdAt: true,
              updatedAt: true,
              content: true,
              tags: true,
              reviewNote: true,
              reviewedBy: true,
              reviewedAt: true,
              hotScore: true,
              isPinned: true,
              dislikesCount: true,
              musicDocId: true,
              albumDocId: true,
              locationCode: true,
            },
          },
        },
      })

      const total = await prisma.postLike.count({ where: { userUid: uid } })

      const visibilityWhere = buildPostVisibilityWhere(req.authUser)
      const visiblePosts = likedPosts.filter((item) => {
        if (!item.post) return false
        if (item.post.status === 'published') return true
        if (
          req.authUser &&
          (item.post.authorUid === req.authUser.uid ||
            req.authUser.role === 'admin' ||
            req.authUser.role === 'super_admin')
        ) {
          return true
        }
        return false
      })

      res.json({
        likes: visiblePosts.map((item) => ({
          id: item.id,
          createdAt: item.createdAt.toISOString(),
          post: item.post ? toPostResponse(item.post) : null,
        })),
        total,
        page,
        limit,
      })
    } catch (error) {
      console.error('Fetch user likes error:', error)
      res.status(500).json({ error: '获取用户点赞失败' })
    }
  })
)

export function registerUsersRoutes(app: Router) {
  app.use('/api/users', router)
}
