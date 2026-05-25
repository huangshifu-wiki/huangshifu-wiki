import { Router } from 'express';
import { UserRole as PrismaUserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { requireAuth, requireActiveUser, requireAdmin, requireSuperAdmin, userToApiUser, clearUserCache, issueUserSession, isBearerAuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { profileLimiter } from '../middleware/rateLimiter';
import { validateBody, adminResetUserPasswordSchema, passwordSchema } from '../schemas';
import {
  prisma,
  toUserResponse,
  buildPostVisibilityWhere,
  toPostResponse,
  toCommentResponse,
  safeDeleteUploadFileByUrl,
  parsePagination,
  logger,
  getPasswordSaltRounds,
} from '../utils';
import type { AuthenticatedRequest, UserStatus } from '../types';

const router = Router();
const PASSWORD_SALT_ROUNDS = getPasswordSaltRounds();

type PasswordUpdateResponse = {
  success: true;
  token?: string;
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
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 2048) return null;
  if (trimmed.startsWith('/uploads/')) {
    return trimmed;
  }
  // 远端 URL 必须是 http/https
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return trimmed;
    }
  } catch {
    // 解析失败
  }
  return null;
}

// User self-management routes
router.get('/status', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res) => {
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
        level: true,
        bio: true,
        preferences: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    res.json({ user: toUserResponse(user) });
  } catch (error) {
    console.error('Fetch current user status error:', error);
    res.status(500).json({ error: '获取用户状态失败' });
  }
}));

// 管理员修改用户状态 - 需要超级管理员权限
router.put('/:userId/status', requireSuperAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const targetUid = req.params.userId;
    if (!targetUid) {
      res.status(400).json({ error: '无效用户' });
      return;
    }

    const { status, banReason } = req.body as {
      status?: UserStatus;
      banReason?: string;
    };

    if (!status || !['active', 'banned'].includes(status)) {
      res.status(400).json({ error: '无效状态' });
      return;
    }

    const updateData: Record<string, unknown> = {};
    updateData.status = status;
    if (typeof banReason === 'string') updateData.banReason = banReason;
    if (status === 'banned') {
      updateData.bannedAt = new Date();
    } else {
      updateData.banReason = null;
      updateData.bannedAt = null;
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
        level: true,
        bio: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    // 清除目标用户在 authMiddleware 里的缓存，确保下次请求拿到最新状态
    clearUserCache(targetUid);

    await prisma.userBanLog.create({
      data: {
        targetUid,
        operatorUid: req.authUser!.uid,
        action: status === 'banned' ? 'ban' : 'unban',
        note: banReason || (status === 'banned' ? '管理员封禁' : '管理员解封'),
      },
    });

    res.json({ user: toUserResponse(user) });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({ error: '更新用户状态失败' });
  }
}));

router.put('/name', requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const { displayName } = req.body as { displayName?: string };

    if (!displayName || !displayName.trim()) {
      res.status(400).json({ error: '昵称不能为空' });
      return;
    }

    const user = await prisma.user.update({
      where: { uid: req.authUser!.uid },
      data: { displayName: displayName.trim() },
      select: {
        uid: true,
        email: true,
        displayName: true,
        photoURL: true,
        role: true,
        status: true,
        banReason: true,
        bannedAt: true,
        level: true,
        bio: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    clearUserCache(req.authUser!.uid);

    res.json({ user: toUserResponse(user) });
  } catch (error) {
    console.error('Update user name error:', error);
    res.status(500).json({ error: '更新昵称失败' });
  }
}));

router.put('/phone', requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const { phone } = req.body as { phone?: string };

    if (!phone || !phone.trim()) {
      res.status(400).json({ error: '手机号不能为空' });
      return;
    }

    // Note: phone field is not in the User schema, this is a placeholder
    res.status(501).json({ error: '手机号功能暂未启用' });
  } catch (error) {
    console.error('Update user phone error:', error);
    res.status(500).json({ error: '更新手机号失败' });
  }
}));

router.put('/password', requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: '密码不能为空' });
      return;
    }

    const passwordValidation = passwordSchema.safeParse(newPassword)
    if (!passwordValidation.success) {
      res.status(400).json({ error: passwordValidation.error.issues[0]?.message || '新密码格式无效' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { uid: req.authUser!.uid },
      select: { passwordHash: true },
    });

    if (!user?.passwordHash) {
      res.status(400).json({ error: '当前密码不正确' });
      return;
    }

    const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!validPassword) {
      res.status(401).json({ error: '当前密码不正确' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS);
    const updatedUser = await prisma.user.update({
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
        level: true,
        bio: true,
      },
    });
    clearUserCache(req.authUser!.uid);
    const { token } = issueUserSession(req, res, {
      ...updatedUser,
      passwordHash,
    });

    const response: PasswordUpdateResponse = { success: true };
    if (isBearerAuthRequest(req)) {
      response.token = token;
    }

    res.json(response);
  } catch (error) {
    console.error('Update user password error:', error);
    res.status(500).json({ error: '更新密码失败' });
  }
}));

// 注：头像上传走 POST /api/uploads/sessions/:id/files 通用上传接口，
// 客户端拿到文件 URL 后通过 PATCH /api/users/me { photoURL } 写入。
// 此处不再保留独立的 POST /avatar 占位路由。

// GET /api/users/me - Get current user info
router.get('/me', requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { uid: req.authUser!.uid },
      select: {
        uid: true,
        email: true,
        displayName: true,
        bio: true,
        photoURL: true,
        role: true,
        status: true,
        banReason: true,
        bannedAt: true,
        level: true,
        preferences: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    res.json({ user: toUserResponse(user) });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({ error: '获取用户信息失败' });
  }
}));

router.patch('/me', profileLimiter, requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const { displayName, bio, preferences, photoURL } = req.body;
    const updateData: Record<string, unknown> = {};

    if (displayName !== undefined) {
      if (typeof displayName === 'string' && displayName.length > 50) {
        res.status(400).json({ error: '昵称不能超过50个字符' });
        return;
      }
      updateData.displayName = displayName;
    }
    if (bio !== undefined) {
      if (typeof bio === 'string' && bio.length > 500) {
        res.status(400).json({ error: '个人简介不能超过500个字符' });
        return;
      }
      updateData.bio = bio;
    }
    if (preferences !== undefined) {
      const prefSize = typeof preferences === 'string' ? preferences.length : JSON.stringify(preferences).length;
      if (prefSize > 2048) {
        res.status(400).json({ error: '偏好设置不能超过2KB' });
        return;
      }
      updateData.preferences = preferences;
    }

    // 头像处理：校验 URL，并在变更时同步历史评论 / 帖子作者头像快照
    let normalizedPhotoUrl: string | null | undefined;
    let oldPhotoURL: string | null = null;
    if (photoURL !== undefined) {
      normalizedPhotoUrl = normalizePhotoUrl(photoURL);
      if (photoURL && photoURL !== '' && normalizedPhotoUrl === null) {
        res.status(400).json({ error: '头像地址不合法' });
        return;
      }
      // 读取旧头像，便于在替换后清理已经无人引用的旧文件
      const existing = await prisma.user.findUnique({
        where: { uid: req.authUser!.uid },
        select: { photoURL: true },
      });
      oldPhotoURL = existing?.photoURL || null;
      updateData.photoURL = normalizedPhotoUrl;
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: '没有要更新的字段' });
      return;
    }

    const user = await prisma.user.update({
      where: { uid: req.authUser!.uid },
      data: updateData,
    });
    // 关键：authMiddleware 缓存了 ApiUser，不清就要等 5 分钟 TTL 才生效，导致刷新后看到旧头像/旧昵称
    clearUserCache(req.authUser!.uid);

    // 替换头像后，旧的本地上传文件不再被引用，安全删除
    if (photoURL !== undefined && oldPhotoURL !== normalizedPhotoUrl) {
      if (oldPhotoURL && oldPhotoURL.startsWith('/uploads/') && oldPhotoURL !== normalizedPhotoUrl) {
        await safeDeleteUploadFileByUrl(oldPhotoURL).catch((err) => logger.debug({ err }, 'Operation cleanup failed'));
      }
    }
    // 注：评论的作者昵称/头像现在通过 author 关系实时 JOIN 获取，
    // 不再需要 updateMany 同步快照字段。

    res.json({ user: userToApiUser(user) });
  } catch (error) {
    console.error('Update user profile error:', error);
    res.status(500).json({ error: '更新用户资料失败' });
  }
}));

router.delete('/account', requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    // 获取旧头像 URL，用于注销后清理本地文件
    const existing = await prisma.user.findUnique({
      where: { uid: req.authUser!.uid },
      select: { photoURL: true },
    });

    // Soft delete or account deletion logic
    await prisma.user.update({
      where: { uid: req.authUser!.uid },
      data: {
        displayName: '已注销用户',
        photoURL: null,
        bio: '',
        status: 'banned',
        banReason: '用户主动注销',
      },
    });
    clearUserCache(req.authUser!.uid);

    // 注：评论的作者昵称/头像通过 author 关系实时 JOIN 获取，
    // 注销时 User.displayName 已置为 "已注销用户"、photoURL 已置 null，
    // 历史评论会自动反映这些更新，不需要再额外 updateMany。

    // 物理删除旧头像文件，防止留下孤儿文件
    if (existing?.photoURL && existing.photoURL.startsWith('/uploads/')) {
      await safeDeleteUploadFileByUrl(existing.photoURL).catch((err) => logger.debug({ err }, 'Operation cleanup failed'));
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: '注销账户失败' });
  }
}));

// Admin user management routes
router.get('/', requireAdmin, asyncHandler(async (_req, res) => {
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
        level: true,
        bio: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    res.json({ users: users.map(toUserResponse) });
  } catch (error) {
    console.error('Fetch users error:', error);
    res.status(500).json({ error: '获取用户列表失败' });
  }
}));

const updateUserRoleHandler = asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const { role } = req.body as { role?: PrismaUserRole };
    if (!role || !['user', 'admin', 'super_admin'].includes(role)) {
      res.status(400).json({ error: '无效角色' });
      return;
    }

    const user = await prisma.user.update({
      where: { uid: req.params.userId },
      data: { role },
      select: {
        uid: true,
        email: true,
        displayName: true,
        photoURL: true,
        role: true,
        status: true,
        banReason: true,
        bannedAt: true,
        level: true,
        bio: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    clearUserCache(req.params.userId);

    res.json({ user: toUserResponse(user) });
  } catch (error) {
    console.error('Update user role error:', error);
    res.status(500).json({ error: '更新角色失败' });
  }
})

router.route('/:userId/role')
  .put(requireSuperAdmin, updateUserRoleHandler)
  .patch(requireSuperAdmin, updateUserRoleHandler)

router.put('/:userId/reset-password', requireAdmin, validateBody(adminResetUserPasswordSchema), asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const targetUid = req.params.userId;
    if (!targetUid) {
      res.status(400).json({ error: '无效用户' });
      return;
    }

    if (req.authUser?.uid === targetUid) {
      res.status(400).json({ error: '不能重置自己的密码' });
      return;
    }

    const { newPassword } = req.body as { newPassword: string };

    const targetUser = await prisma.user.findUnique({
      where: { uid: targetUid },
      select: {
        uid: true,
        role: true,
      },
    });

    if (!targetUser) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    if (req.authUser?.role !== 'super_admin' && targetUser.role !== 'user') {
      res.status(403).json({ error: '只能重置普通用户的密码' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS);
    await prisma.user.update({
      where: { uid: targetUid },
      data: { passwordHash },
    });
    clearUserCache(targetUid);

    res.json({ success: true });
  } catch (error) {
    console.error('Admin reset user password error:', error);
    res.status(500).json({ error: '重置密码失败' });
  }
}));

router.put('/:userId/ban', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const targetUid = req.params.userId;
    if (!targetUid) {
      res.status(400).json({ error: '无效用户' });
      return;
    }

    if (req.authUser?.uid === targetUid) {
      res.status(400).json({ error: '不能封禁自己' });
      return;
    }

    const noteRaw = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    const reasonRaw = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const finalReason = reasonRaw || noteRaw || '违反社区规范';

    const user = await prisma.user.update({
      where: { uid: targetUid },
      data: {
        status: 'banned',
        banReason: finalReason,
        bannedAt: new Date(),
      },
      select: {
        uid: true,
        email: true,
        displayName: true,
        photoURL: true,
        role: true,
        status: true,
        banReason: true,
        bannedAt: true,
        level: true,
        bio: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    clearUserCache(targetUid);

    await prisma.userBanLog.create({
      data: {
        targetUid,
        operatorUid: req.authUser!.uid,
        action: 'ban',
        note: finalReason,
      },
    });

    res.json({ user: toUserResponse(user) });
  } catch (error) {
    console.error('Ban user error:', error);
    res.status(500).json({ error: '封禁用户失败' });
  }
}));

router.put('/:userId/unban', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const targetUid = req.params.userId;
    if (!targetUid) {
      res.status(400).json({ error: '无效用户' });
      return;
    }

    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';

    const user = await prisma.user.update({
      where: { uid: targetUid },
      data: {
        status: 'active',
        banReason: null,
        bannedAt: null,
      },
      select: {
        uid: true,
        email: true,
        displayName: true,
        photoURL: true,
        role: true,
        status: true,
        banReason: true,
        bannedAt: true,
        level: true,
        bio: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    clearUserCache(targetUid);

    await prisma.userBanLog.create({
      data: {
        targetUid,
        operatorUid: req.authUser!.uid,
        action: 'unban',
        note: note || null,
      },
    });

    res.json({ user: toUserResponse(user) });
  } catch (error) {
    console.error('Unban user error:', error);
    res.status(500).json({ error: '解封用户失败' });
  }
}));

// User detail routes
router.get('/:userId/posts', asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.params.userId;
    const { limit, page, offset: skip } = parsePagination(req.query);

    const visibilityWhere = buildPostVisibilityWhere(req.authUser);

    const where = {
      authorUid: uid,
      ...visibilityWhere,
    };

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
        select: {
          id: true,
          title: true,
          section: true,
          content: true,
          tags: true,
          locationCode: true,
          authorUid: true,
          status: true,
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
    ]);

    const likedPostSet = new Set<string>();
    const favoritedPostSet = new Set<string>();
    const dislikedPostSet = new Set<string>();
    if (req.authUser && posts.length) {
      const postIds = posts.map((item) => item.id);
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
      ]);
      likedPosts.forEach((item) => likedPostSet.add(item.postId));
      favoritedPosts.forEach((item) => favoritedPostSet.add(item.targetId));
      dislikedPosts.forEach((item) => dislikedPostSet.add(item.postId));
    }

    res.json({
      posts: posts.map((post) => ({
        ...toPostResponse(post),
        likedByMe: likedPostSet.has(post.id),
        favoritedByMe: favoritedPostSet.has(post.id),
        dislikedByMe: dislikedPostSet.has(post.id),
      })),
      total,
      page,
      limit,
      hasMore: skip + posts.length < total,
    });
  } catch (error) {
    console.error('Fetch user posts error:', error);
    res.status(500).json({ error: '获取用户帖子失败' });
  }
}));

router.get('/:userId/comments', asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.params.userId;
    const { limit, page, offset: skip } = parsePagination(req.query);
    const isAdmin = req.authUser?.role === 'admin' || req.authUser?.role === 'super_admin';

    const visibilityWhere = buildPostVisibilityWhere(req.authUser);

    const [comments, total] = await Promise.all([
      prisma.postComment.findMany({
        where: {
          authorUid: uid,
        },
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
      prisma.postComment.count({ where: { authorUid: uid } }),
    ]);

    // PostComment.postId 可能为 null（图集评论），筛掉非空的再传给 Post 查询，
    // 让 Prisma 的 in 子句类型对齐 string[]
    const postIds = [...new Set(comments.map((c) => c.postId).filter((id): id is string => Boolean(id)))];
    const postsMap = new Map<string, { id: string; title: string; status: string }>();

    if (postIds.length) {
      const posts = await prisma.post.findMany({
        where: {
          id: { in: postIds },
          ...visibilityWhere,
        },
        select: { id: true, title: true, status: true },
      });
      posts.forEach((p) => postsMap.set(p.id, p));
    }

    res.json({
      comments: comments.map((comment) => ({
        ...toCommentResponse(comment, { maskDeletedContent: !isAdmin }),
        post: comment.postId && postsMap.has(comment.postId) ? postsMap.get(comment.postId)! : null,
      })),
      total,
      page,
      limit,
      hasMore: skip + comments.length < total,
    });
  } catch (error) {
    console.error('Fetch user comments error:', error);
    res.status(500).json({ error: '获取用户评论失败' });
  }
}));

router.get('/:userId/likes', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.params.userId;
    const { limit, page, offset: skip } = parsePagination(req.query);

    // Users can only see their own likes unless they're admin
    if (req.authUser?.uid !== uid && req.authUser?.role === 'user') {
      res.status(403).json({ error: '无权查看该用户的点赞记录' });
      return;
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
    });

    const total = await prisma.postLike.count({ where: { userUid: uid } });

    const visibilityWhere = buildPostVisibilityWhere(req.authUser);
    const visiblePosts = likedPosts.filter((item) => {
      if (!item.post) return false;
      if (item.post.status === 'published') return true;
      if (req.authUser && (item.post.authorUid === req.authUser.uid || req.authUser.role === 'admin' || req.authUser.role === 'super_admin')) {
        return true;
      }
      return false;
    });

    res.json({
      likes: visiblePosts.map((item) => ({
        id: item.id,
        createdAt: item.createdAt.toISOString(),
        post: item.post ? toPostResponse(item.post) : null,
      })),
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error('Fetch user likes error:', error);
    res.status(500).json({ error: '获取用户点赞失败' });
  }
}));

// User browsing history route
router.get('/me/history', requireAuth, requireActiveUser, asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const { type, limit = '20', offset = '0' } = req.query;
    const userId = req.authUser!.uid;

    const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const offsetNum = Math.max(Number(offset) || 0, 0);

    const where: Record<string, unknown> = {
      userUid: userId,
    };

    // Filter by type if provided
    if (type && ['wiki', 'post', 'music'].includes(type as string)) {
      where.targetType = type as string;
    }

    const [histories, total] = await Promise.all([
      prisma.browsingHistory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limitNum,
        skip: offsetNum,
      }),
      prisma.browsingHistory.count({ where }),
    ]);

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
    });
  } catch (error) {
    console.error('Get user history error:', error);
    res.status(500).json({ error: '获取历史记录失败' });
  }
}));

export function registerUsersRoutes(app: Router) {
  app.use('/api/users', router);
}
