import { Prisma } from '@prisma/client';
import type { Router } from 'express';
import { createRouter } from '../utils/typed-router';
import { requireAuth, requireAdmin, requireActiveUser, isAdminRole } from '../middleware/auth';
import { postWriteLimiter } from '../middleware/rateLimiter';
import {
  validateBody,
  postCreateSchema,
  postUpdateSchema,
  postDeleteSchema,
  postCommentSchema,
} from '../schemas';
import {
  prisma,
  toPostResponse,
  toCommentResponse,
  buildPostVisibilityWhere,
  calculatePostHotScore,
  normalizePostWriteStatus,
  normalizeOptionalDocId,
  canViewPost,
  createNotification,
  notifyCommentReply,
  parsePagination,
  enhancedCache,
  fetchPostCommentsForResponse,
  fetchPostCommentsPageForResponse,
  resolveCommentReplyTarget,
  createCommentLike,
  deleteCommentLike,
  softDeleteData,
  resolveDeleteReason,
  ensureTextLimit,
  notifyMentionUsers,
  resolveMentionTargetsForText,
} from '../utils';
import type { AuthenticatedRequest, ContentStatus } from '../types';
import { CONTENT_LIMITS } from '../../lib/contentLimits';

const router = createRouter();
const MUSIC_SECTION_ID = 'music';

// Post list routes
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const section = typeof req.query.section === 'string' ? req.query.section : 'all';
    const { limit, page, offset: skip } = parsePagination(req.query);
    const sort = req.query.sort as string | undefined;
    const visibilityWhere = buildPostVisibilityWhere(req.authUser);
    const where = {
      ...(section !== 'all' ? { section } : {}),
      ...visibilityWhere,
      status: 'published' as ContentStatus,
    };

    if (!req.authUser && sort === 'latest') {
      const cacheKey = `post_list:${section}:${page}:${limit}`;
      const cached = enhancedCache.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }
    }

    let orderBy: Array<Record<string, 'asc' | 'desc'>>;
    if (sort === 'hot') {
      orderBy = [{ isPinned: 'desc' }, { hotScore: 'desc' }, { updatedAt: 'desc' }];
    } else if (sort === 'recommended') {
      orderBy = [{ isPinned: 'desc' }, { commentsCount: 'desc' }, { likesCount: 'desc' }, { updatedAt: 'desc' }];
    } else {
      orderBy = [{ isPinned: 'desc' }, { updatedAt: 'desc' }];
    }

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        orderBy,
        take: limit,
        skip,
        select: {
          id: true,
          title: true,
          section: true,
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
          author: { select: { displayName: true } },
        },
      }),
      prisma.post.count({ where }),
    ]);

    if (sort !== 'latest' && posts.length) {
      const updates = posts
        .map((post) => ({
          id: post.id,
          hotScore: calculatePostHotScore(post),
        }))
        .filter((item) => Number.isFinite(item.hotScore));

      if (updates.length > 0) {
        await prisma.$transaction(
          updates.map((item) =>
            prisma.post.update({
              where: { id: item.id },
              data: { hotScore: item.hotScore },
            }),
          ),
        );
      }
    }

    const likedPostSet = new Set<string>();
    const favoritedPostSet = new Set<string>();
    if (req.authUser && posts.length) {
      const [likedPosts, favoritedPosts] = await Promise.all([
        prisma.postLike.findMany({
          where: {
            userUid: req.authUser.uid,
            postId: { in: posts.map((item) => item.id) },
          },
          select: { postId: true },
        }),
        prisma.favorite.findMany({
          where: {
            userUid: req.authUser.uid,
            targetType: 'post',
            targetId: { in: posts.map((item) => item.id) },
          },
          select: { targetId: true },
        }),
      ]);
      likedPosts.forEach((item) => likedPostSet.add(item.postId));
      favoritedPosts.forEach((item) => favoritedPostSet.add(item.targetId));
    }

    const excerptMap = new Map<string, string>()
    if (posts.length) {
      const excerpts = await prisma.$queryRaw<Array<{ id: string; excerpt: string }>>`
        SELECT id, LEFT(content, 200) AS excerpt
        FROM "Post"
        WHERE id IN (${Prisma.join(posts.map((post) => post.id))})
      `
      for (const excerpt of excerpts) {
        excerptMap.set(excerpt.id, excerpt.excerpt || '')
      }
    }

    const result = {
      posts: posts.map((post) => ({
        id: post.id,
        title: post.title,
        section: post.section,
        authorUid: post.authorUid,
        authorName: post.author?.displayName || null,
        status: post.status,
        hotScore: post.hotScore ?? 0,
        viewCount: post.viewCount ?? 0,
        likesCount: post.likesCount,
        dislikesCount: post.dislikesCount,
        commentsCount: post.commentsCount,
        isPinned: post.isPinned,
        musicDocId: post.musicDocId || null,
        albumDocId: post.albumDocId || null,
        tags: post.tags,
        locationCode: post.locationCode || null,
        createdAt: post.createdAt.toISOString(),
        updatedAt: post.updatedAt.toISOString(),
        excerpt: excerptMap.get(post.id) || '',
        likedByMe: likedPostSet.has(post.id),
        favoritedByMe: favoritedPostSet.has(post.id),
      })),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore: skip + posts.length < total,
    };

    if (!req.authUser && sort === 'latest') {
      const cacheKey = `post_list:${section}:${page}:${limit}`;
      enhancedCache.set(cacheKey, result, 60);
    }

    res.json(result);
  } catch (error) {
    console.error('Fetch posts error:', error);
    res.status(500).json({ error: '获取帖子失败' });
  }
});

// Create post
router.post('/', postWriteLimiter, requireAuth, requireActiveUser, validateBody(postCreateSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const { title, section, content, tags, status, musicDocId, albumDocId, locationCode, locationDetail } = req.body as {
      title?: string;
      section?: string;
      content?: string;
      tags?: string[];
      status?: ContentStatus;
      musicDocId?: string;
      albumDocId?: string;
      locationCode?: string;
      locationDetail?: string;
    };

    if (!title || !section || !content) {
      res.status(400).json({ error: '缺少必要字段' });
      return;
    }

    const normalizedMusicDocId = normalizeOptionalDocId(musicDocId);
    const normalizedAlbumDocId = normalizeOptionalDocId(albumDocId);

    let finalSection = section;
    if (normalizedMusicDocId || normalizedAlbumDocId) {
      const musicSection = await prisma.section.findUnique({
        where: { id: MUSIC_SECTION_ID },
        select: { id: true },
      });
      if (!musicSection) {
        res.status(500).json({ error: '音乐版块不存在，请先在后台创建' });
        return;
      }
      finalSection = MUSIC_SECTION_ID;
    }

    const sectionExists = await prisma.section.findUnique({
      where: { id: finalSection },
      select: { id: true },
    });
    if (!sectionExists) {
      res.status(400).json({ error: '版块不存在' });
      return;
    }

    const nextStatus = normalizePostWriteStatus(status, req.authUser!);

    const post = await prisma.post.create({
      data: {
        title,
        section: finalSection,
        content,
        tags: tags || [],
        status: nextStatus,
        reviewNote: null,
        reviewedBy: null,
        reviewedAt: null,
        authorUid: req.authUser!.uid,
        musicDocId: normalizedMusicDocId,
        albumDocId: normalizedAlbumDocId,
        locationCode,
        locationDetail: locationDetail || null,
      },
    });

    if (nextStatus === 'pending') {
      await prisma.moderationLog.create({
        data: {
          targetType: 'post',
          targetId: post.id,
          action: 'submit',
          operatorUid: req.authUser!.uid,
          note: null,
        },
      });
    }

    const mentionTargets = await resolveMentionTargetsForText(post.content);

    if (nextStatus === 'published') {
      await notifyMentionUsers({
        content: post.content,
        mentionTargets,
        actorUid: req.authUser!.uid,
        actorName: req.authUser!.displayName,
        target: { type: 'post', id: post.id },
      });
    }

    res.status(201).json({
      post: toPostResponse({
        ...post,
        mentionTargets,
      }),
    });
    enhancedCache.invalidateByPrefix('post_list:');
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ error: '发布帖子失败' });
  }
});

// Get post detail
router.get('/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const post = await prisma.post.findUnique({
      where: { id: req.params.id },
      include: { author: { select: { displayName: true } } },
    });

    if (!post || !canViewPost(post, req.authUser)) {
      res.status(404).json({ error: '帖子未找到' });
      return;
    }

    const hotScore = calculatePostHotScore(post);

    const browsingPromise = req.authUser
      ? (async () => {
          const existing = await prisma.browsingHistory.findFirst({
            where: {
              userUid: req.authUser!.uid,
              targetType: 'post',
              targetId: req.params.id,
            },
          });
          if (existing) {
            await prisma.browsingHistory.update({
              where: { id: existing.id },
              data: { createdAt: new Date() },
            });
          } else {
            await prisma.browsingHistory.create({
              data: {
                userUid: req.authUser!.uid,
                targetType: 'post',
                targetId: req.params.id,
              },
            });
          }
        })()
      : Promise.resolve();

    await Promise.all([
      prisma.post.update({
        where: { id: req.params.id },
        data: { viewCount: { increment: 1 }, hotScore },
      }),
      browsingPromise,
    ]);

    const includeDeletedComments =
      isAdminRole(req.authUser?.role) && req.query.includeDeleted === 'true';

    const [comments, mentionTargets, likedByMe, favoritedByMe, dislikedByMe] = await Promise.all([
      fetchPostCommentsForResponse(req.params.id, {
        authUserUid: req.authUser?.uid,
        includeDeleted: includeDeletedComments,
      }),
      resolveMentionTargetsForText(post.content),
      ...(req.authUser
        ? [
            prisma.postLike.count({
              where: { postId: req.params.id, userUid: req.authUser.uid },
            }).then((c) => c > 0),
            prisma.favorite.count({
              where: { targetType: 'post', targetId: req.params.id, userUid: req.authUser.uid },
            }).then((c) => c > 0),
            prisma.postDislike.count({
              where: { postId: req.params.id, userUid: req.authUser.uid },
            }).then((c) => c > 0),
          ]
        : [Promise.resolve(false), Promise.resolve(false), Promise.resolve(false)]),
    ]);

    res.json({
      post: {
        ...toPostResponse({
          ...post,
          viewCount: post.viewCount + 1,
          hotScore,
          mentionTargets,
        }),
        likedByMe,
        favoritedByMe,
        dislikedByMe,
      },
      comments,
    });
  } catch (error) {
    console.error('Fetch post detail error:', error);
    res.status(500).json({ error: '获取帖子详情失败' });
  }
});

// Update post
router.put('/:id', postWriteLimiter, requireAuth, requireActiveUser, validateBody(postUpdateSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const { title, section, content, tags, status, musicDocId, albumDocId, locationCode, locationDetail } = req.body as {
      title?: string;
      section?: string;
      content?: string;
      tags?: string[];
      status?: ContentStatus;
      musicDocId?: string;
      albumDocId?: string;
      locationCode?: string;
      locationDetail?: string;
    };

    if (!title || !section || !content) {
      res.status(400).json({ error: '缺少必要字段' });
      return;
    }

    const normalizedMusicDocId = normalizeOptionalDocId(musicDocId);
    const normalizedAlbumDocId = normalizeOptionalDocId(albumDocId);

    const existingPost = await prisma.post.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        authorUid: true,
        status: true,
        content: true,
        pendingReviewBaseContent: true,
      },
    });

    if (!existingPost) {
      res.status(404).json({ error: '帖子未找到' });
      return;
    }

    const isOwner = existingPost.authorUid === req.authUser!.uid;
    const isAdmin = isAdminRole(req.authUser!.role);
    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: '无权编辑该帖子' });
      return;
    }

    let finalSection = section;
    if (normalizedMusicDocId || normalizedAlbumDocId) {
      const musicSection = await prisma.section.findUnique({
        where: { id: MUSIC_SECTION_ID },
        select: { id: true },
      });
      if (!musicSection) {
        res.status(500).json({ error: '音乐版块不存在，请先在后台创建' });
        return;
      }
      finalSection = MUSIC_SECTION_ID;
    }

    const sectionExists = await prisma.section.findUnique({
      where: { id: finalSection },
      select: { id: true },
    });
    if (!sectionExists) {
      res.status(400).json({ error: '版块不存在' });
      return;
    }

    let nextStatus: ContentStatus;
    if (isAdmin) {
      nextStatus = status === undefined
        ? existingPost.status
        : normalizePostWriteStatus(status, req.authUser!);
    } else if (existingPost.status === 'published') {
      nextStatus = 'pending';
    } else {
      const normalized = normalizePostWriteStatus(status ?? existingPost.status, req.authUser!);
      nextStatus = existingPost.status === 'pending' && normalized === 'draft' ? 'pending' : normalized;
    }

    const nextPendingReviewBaseContent =
      nextStatus === 'pending'
        ? !isAdmin && existingPost.status === 'published'
          ? existingPost.content
          : existingPost.pendingReviewBaseContent
        : null;

    const post = await prisma.post.update({
      where: { id: req.params.id },
      data: {
        title,
        section: finalSection,
        content,
        tags: Array.isArray(tags) ? tags : [],
        status: nextStatus,
        reviewNote: null,
        reviewedBy: null,
        reviewedAt: null,
        pendingReviewBaseContent: nextPendingReviewBaseContent,
        musicDocId: normalizedMusicDocId,
        albumDocId: normalizedAlbumDocId,
        locationCode,
        locationDetail: locationDetail || null,
      },
    });

    if (nextStatus === 'pending') {
      await prisma.moderationLog.create({
        data: {
          targetType: 'post',
          targetId: post.id,
          action: 'submit',
          operatorUid: req.authUser!.uid,
          note: !isAdmin && existingPost.status === 'published' ? '编辑后重新提交审核' : null,
        },
      });
    }

    const mentionTargets = await resolveMentionTargetsForText(post.content);

    if (nextStatus === 'published') {
      await notifyMentionUsers({
        content: post.content,
        previousContent:
          existingPost.pendingReviewBaseContent ??
          (existingPost.status === 'published' ? existingPost.content : null),
        mentionTargets,
        actorUid: req.authUser!.uid,
        actorName: req.authUser!.displayName,
        target: { type: 'post', id: post.id },
      });
    }

    res.json({
      post: toPostResponse({
        ...post,
        mentionTargets,
      }),
    });
    enhancedCache.invalidateByPrefix('post_list:');
  } catch (error) {
    console.error('Edit post error:', error);
    res.status(500).json({ error: '编辑帖子失败' });
  }
});

// Delete post
router.delete(
  '/:id',
  requireAuth,
  requireActiveUser,
  validateBody(postDeleteSchema),
  async (req: AuthenticatedRequest, res) => {
    try {
      const post = await prisma.post.findUnique({
        where: { id: req.params.id },
        select: { authorUid: true, title: true, status: true, deletedAt: true },
      });

      if (!post || post.deletedAt) {
        res.status(404).json({ error: '帖子未找到' });
        return;
      }

      const isOwner = post.authorUid === req.authUser!.uid;
      const isAdmin = isAdminRole(req.authUser!.role);
      if (!isOwner && !isAdmin) {
        res.status(403).json({ error: '无权删除该帖子' });
        return;
      }

      const reason = resolveDeleteReason(req.body?.reason, isOwner);
      if (!isOwner && !reason) {
        res.status(400).json({ error: '删除理由不能为空' });
        return;
      }
      if (!ensureTextLimit(res, reason, '删除理由', CONTENT_LIMITS.post.reviewNote)) {
        return;
      }

      await prisma.$transaction(async (tx) => {
        await tx.post.update({
          where: { id: req.params.id },
          data: softDeleteData(req.authUser!.uid),
        });

        await tx.moderationLog.create({
          data: {
            targetType: 'post',
            targetId: req.params.id,
            action: 'delete',
            operatorUid: req.authUser!.uid,
            note: reason,
          },
        });
      });

      if (post.authorUid !== req.authUser!.uid) {
        await createNotification(post.authorUid, 'review_result', {
          approved: false,
          action: 'deleted',
          targetType: 'post',
          targetId: req.params.id,
          title: post.title,
          note: reason,
          operatorUid: req.authUser!.uid,
          operatorName: req.authUser!.displayName,
        });
      }

      res.json({ success: true });
      enhancedCache.invalidateByPrefix('post_list:');
    } catch (error) {
      console.error('Delete post error:', error);
      res.status(500).json({ error: '删除帖子失败' });
    }
  }
);

// Comment routes
router.get('/:postId/comments', async (req: AuthenticatedRequest, res) => {
  try {
    const postId = req.params.postId;
    const { limit, page, offset: skip } = parsePagination(req.query);
    const includeDeletedComments =
      isAdminRole(req.authUser?.role) && req.query.includeDeleted === 'true';

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { status: true, authorUid: true },
    });

    if (!post || !canViewPost(post, req.authUser)) {
      res.status(404).json({ error: '帖子未找到' });
      return;
    }

    const { comments, total } = await fetchPostCommentsPageForResponse(postId, {
      authUserUid: req.authUser?.uid,
      includeDeleted: includeDeletedComments,
      take: limit,
      skip,
    });

    res.json({
      comments,
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error('Fetch post comments error:', error);
    res.status(500).json({ error: '获取评论失败' });
  }
});

router.post('/:postId/comments', postWriteLimiter, requireAuth, requireActiveUser, validateBody(postCommentSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const { content, parentId } = req.body as {
      content?: string;
      parentId?: string | null;
    };

    if (!content || !content.trim()) {
      res.status(400).json({ error: '评论内容不能为空' });
      return;
    }

    const currentPost = await prisma.post.findUnique({
      where: { id: req.params.postId },
      select: {
        id: true,
        status: true,
        authorUid: true,
      },
    });

    if (!currentPost || !canViewPost(currentPost, req.authUser)) {
      res.status(404).json({ error: '帖子未找到' });
      return;
    }

    if (currentPost.status !== 'published') {
      res.status(403).json({ error: '仅已发布内容可评论' });
      return;
    }

    let replyTargetUid: string | null = null;
    let rootParentId: string | null = null;
    let replyToId: string | null = null;
    if (parentId) {
      const replyTarget = await resolveCommentReplyTarget(parentId, { postId: req.params.postId });
      if (!replyTarget) {
        res.status(400).json({ error: '回复目标不存在' });
        return;
      }
      rootParentId = replyTarget.parentId;
      replyToId = replyTarget.replyToId;
      replyTargetUid = replyTarget.replyTargetUid;
    }

    const comment = await prisma.postComment.create({
      data: {
        postId: req.params.postId,
        authorUid: req.authUser!.uid,
        content,
        parentId: rootParentId,
        replyToId,
      },
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
    });

    await prisma.post.update({
      where: { id: req.params.postId },
      data: {
        commentsCount: { increment: 1 },
      },
    });

    await notifyCommentReply({
      ownerUid: currentPost.authorUid,
      replyTargetUid,
      actorUid: req.authUser!.uid,
      actorName: req.authUser!.displayName,
      commentId: comment.id,
      content: comment.content,
      parentId: comment.parentId,
      target: { type: 'post', id: req.params.postId },
    });
    const mentionTargets = await resolveMentionTargetsForText(comment.content);
    const replyRecipientUid = replyTargetUid || currentPost.authorUid;
    await notifyMentionUsers({
      content: comment.content,
      mentionTargets,
      actorUid: req.authUser!.uid,
      actorName: req.authUser!.displayName,
      target: { type: 'post', id: req.params.postId, commentId: comment.id },
      excludeUserUids:
        replyRecipientUid && replyRecipientUid !== req.authUser!.uid ? [replyRecipientUid] : [],
    });

    res.status(201).json({
      comment: toCommentResponse({
        ...comment,
        mentionTargets,
      }),
    });
  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({ error: '发表评论失败' });
  }
});

router.delete('/comments/:id', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const comment = await prisma.postComment.findUnique({
      where: { id: req.params.id },
      select: { authorUid: true, postId: true, galleryId: true, deletedAt: true },
    });

    if (!comment || (!comment.postId && !comment.galleryId)) {
      res.status(404).json({ error: '评论未找到' });
      return;
    }

    const isOwner = comment.authorUid === req.authUser!.uid;
    const isAdmin = isAdminRole(req.authUser!.role);
    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: '无权删除该评论' });
      return;
    }

    const reason = resolveDeleteReason(req.body?.reason, isOwner);
    if (!isOwner && !reason) {
      res.status(400).json({ error: '删除理由不能为空' });
      return;
    }
    if (!ensureTextLimit(res, reason, '删除理由', CONTENT_LIMITS.post.reviewNote)) {
      return;
    }

    if (!comment.deletedAt) {
      await prisma.$transaction(async (tx) => {
        await tx.postComment.update({
          where: { id: req.params.id },
          data: {
            deletedAt: new Date(),
            deletedBy: req.authUser!.uid,
          },
        });

        if (comment.postId) {
          await tx.post.update({
            where: { id: comment.postId },
            data: { commentsCount: { decrement: 1 } },
          });
        }

        await tx.moderationLog.create({
          data: {
            targetType: 'comment',
            targetId: req.params.id,
            action: 'delete',
            operatorUid: req.authUser!.uid,
            note: reason,
          },
        });
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ error: '删除评论失败' });
  }
});

router.post('/comments/:id/restore', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const comment = await prisma.postComment.findUnique({
      where: { id: req.params.id },
      select: { id: true, postId: true, galleryId: true, deletedAt: true },
    });

    if (!comment || (!comment.postId && !comment.galleryId)) {
      res.status(404).json({ error: '评论未找到' });
      return;
    }

    if (comment.deletedAt) {
      await prisma.$transaction(async (tx) => {
        await tx.postComment.update({
          where: { id: req.params.id },
          data: {
            deletedAt: null,
            deletedBy: null,
          },
        });

        if (comment.postId) {
          await tx.post.update({
            where: { id: comment.postId },
            data: { commentsCount: { increment: 1 } },
          });
        }
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Restore comment error:', error);
    res.status(500).json({ error: '恢复评论失败' });
  }
});

router.post('/comments/:id/like', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await createCommentLike(req.params.id, req.authUser!);
    if (!result) {
      res.status(404).json({ error: '评论未找到' });
      return;
    }

    res.json(result);
  } catch (error) {
    console.error('Like comment error:', error);
    res.status(500).json({ error: '点赞失败' });
  }
});

router.delete('/comments/:id/like', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await deleteCommentLike(req.params.id, req.authUser!);
    if (!result) {
      res.status(404).json({ error: '评论未找到' });
      return;
    }

    res.json(result);
  } catch (error) {
    console.error('Unlike comment error:', error);
    res.status(500).json({ error: '取消点赞失败' });
  }
});

// Like/Dislike routes
router.post('/:id/like', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const postId = req.params.id;
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        status: true,
        authorUid: true,
      },
    });

    if (!post || !canViewPost(post, req.authUser)) {
      res.status(404).json({ error: '帖子未找到' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.postDislike.deleteMany({
        where: { postId, userUid: req.authUser!.uid },
      });

      try {
        await tx.postLike.create({
          data: {
            postId,
            userUid: req.authUser!.uid,
          },
        });
      } catch {
        // already liked
      }

      const [likesCount, dislikesCount] = await Promise.all([
        tx.postLike.count({ where: { postId } }),
        tx.postDislike.count({ where: { postId } }),
      ]);

      await tx.post.update({
        where: { id: postId },
        data: { likesCount, dislikesCount },
      });
    });

    const [likesCount, dislikesCount] = await Promise.all([
      prisma.postLike.count({ where: { postId } }),
      prisma.postDislike.count({ where: { postId } }),
    ]);

    const updatedPost = await prisma.post.update({
      where: { id: postId },
      data: {
        likesCount,
      },
    });

    const hotScore = calculatePostHotScore(updatedPost);
    await prisma.post.update({
      where: { id: postId },
      data: { hotScore },
    });

    if (post.authorUid !== req.authUser!.uid) {
      await createNotification(post.authorUid, 'like', {
        postId,
        actorUid: req.authUser!.uid,
        actorName: req.authUser!.displayName,
      });
    }

    res.json({ liked: true, likesCount, dislikesCount });
  } catch (error) {
    console.error('Like post error:', error);
    res.status(500).json({ error: '点赞失败' });
  }
});

router.delete('/:id/like', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const postId = req.params.id;
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, status: true, authorUid: true, deletedAt: true },
    });

    if (!post || !canViewPost(post, req.authUser)) {
      res.status(404).json({ error: '帖子未找到' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      const deleted = await tx.postLike.deleteMany({
        where: {
          postId,
          userUid: req.authUser!.uid,
        },
      });

      if (!deleted.count) {
        return;
      }

      await tx.post.update({
        where: { id: postId },
        data: {
          likesCount: { decrement: 1 },
        },
      });
    });

    const likesCount = await prisma.postLike.count({ where: { postId } });
    const updatedPost = await prisma.post.update({
      where: { id: postId },
      data: {
        likesCount,
      },
    });

    const hotScore = calculatePostHotScore(updatedPost);
    await prisma.post.update({
      where: { id: postId },
      data: { hotScore },
    });

    res.json({ liked: false, likesCount });
  } catch (error) {
    console.error('Unlike post error:', error);
    res.status(500).json({ error: '取消点赞失败' });
  }
});

router.post('/:id/dislike', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const postId = req.params.id;
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        status: true,
        authorUid: true,
      },
    });

    if (!post || !canViewPost(post, req.authUser)) {
      res.status(404).json({ error: '帖子未找到' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.postLike.deleteMany({
        where: { postId, userUid: req.authUser!.uid },
      });

      try {
        await tx.postDislike.create({
          data: {
            postId,
            userUid: req.authUser!.uid,
          },
        });
      } catch {
        // already disliked
      }

      const [likesCount, dislikesCount] = await Promise.all([
        tx.postLike.count({ where: { postId } }),
        tx.postDislike.count({ where: { postId } }),
      ]);

      await tx.post.update({
        where: { id: postId },
        data: { likesCount, dislikesCount },
      });
    });

    const [likesCount, dislikesCount] = await Promise.all([
      prisma.postLike.count({ where: { postId } }),
      prisma.postDislike.count({ where: { postId } }),
    ]);

    const updatedPost = await prisma.post.update({
      where: { id: postId },
      data: {
        dislikesCount,
      },
    });

    const hotScore = calculatePostHotScore(updatedPost);
    await prisma.post.update({
      where: { id: postId },
      data: { hotScore },
    });

    res.json({ disliked: true, dislikesCount, likesCount });
  } catch (error) {
    console.error('Dislike post error:', error);
    res.status(500).json({ error: '踩失败' });
  }
});

router.delete('/:id/dislike', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const postId = req.params.id;
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, status: true, authorUid: true, deletedAt: true },
    });

    if (!post || !canViewPost(post, req.authUser)) {
      res.status(404).json({ error: '帖子未找到' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      const deleted = await tx.postDislike.deleteMany({
        where: {
          postId,
          userUid: req.authUser!.uid,
        },
      });

      if (!deleted.count) {
        return;
      }

      await tx.post.update({
        where: { id: postId },
        data: {
          dislikesCount: { decrement: 1 },
        },
      });
    });

    const dislikesCount = await prisma.postDislike.count({ where: { postId } });
    const updatedPost = await prisma.post.update({
      where: { id: postId },
      data: {
        dislikesCount,
      },
    });

    const hotScore = calculatePostHotScore(updatedPost);
    await prisma.post.update({
      where: { id: postId },
      data: { hotScore },
    });

    res.json({ disliked: false, dislikesCount });
  } catch (error) {
    console.error('Undislike post error:', error);
    res.status(500).json({ error: '取消踩失败' });
  }
});

// Pin routes
router.post('/:id/pin', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const postId = req.params.id;

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, isPinned: true },
    });

    if (!post) {
      res.status(404).json({ error: '帖子未找到' });
      return;
    }

    const updated = await prisma.post.update({
      where: { id: postId },
      data: { isPinned: true },
    });

    res.json({ isPinned: updated.isPinned });
  } catch (error) {
    console.error('Pin post error:', error);
    res.status(500).json({ error: '置顶失败' });
  }
});

router.delete('/:id/pin', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const postId = req.params.id;

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, isPinned: true },
    });

    if (!post) {
      res.status(404).json({ error: '帖子未找到' });
      return;
    }

    const updated = await prisma.post.update({
      where: { id: postId },
      data: { isPinned: false },
    });

    res.json({ isPinned: updated.isPinned });
  } catch (error) {
    console.error('Unpin post error:', error);
    res.status(500).json({ error: '取消置顶失败' });
  }
});

export function registerPostsRoutes(app: Router) {
  app.use('/api/posts', router);
}
