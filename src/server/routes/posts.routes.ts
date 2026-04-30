import { Router } from 'express';
import { requireAuth, requireActiveUser, isAdminRole } from '../middleware/auth';
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
  parseContentStatus,
} from '../utils';
import type { AuthenticatedRequest, ContentStatus } from '../types';

const router = Router();
const MUSIC_SECTION_ID = 'music';

// Post list routes
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const section = typeof req.query.section === 'string' ? req.query.section : 'all';
    const limit = Number(req.query.limit) || 20;
    const page = Number(req.query.page) || 1;
    const sort = req.query.sort as string | undefined;
    const skip = (page - 1) * limit;
    const visibilityWhere = buildPostVisibilityWhere(req.authUser);
    const where = {
      ...(section !== 'all' ? { section } : {}),
      ...visibilityWhere,
    };

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
        take: Math.min(limit, 200),
        skip,
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

      await Promise.all(
        updates.map((item) =>
          prisma.post.update({
            where: { id: item.id },
            data: { hotScore: item.hotScore },
          }),
        ),
      );
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

    res.json({
      posts: posts.map((post) => ({
        ...toPostResponse(post),
        likedByMe: likedPostSet.has(post.id),
        favoritedByMe: favoritedPostSet.has(post.id),
      })),
      total,
      totalPages: Math.ceil(total / limit),
      page,
      limit,
    });
  } catch (error) {
    console.error('Fetch posts error:', error);
    res.status(500).json({ error: '获取帖子失败' });
  }
});

// Create post
router.post('/', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { title, section, content, tags, status, musicDocId, albumDocId, locationCode } = req.body as {
      title?: string;
      section?: string;
      content?: string;
      tags?: string[];
      status?: ContentStatus;
      musicDocId?: string;
      albumDocId?: string;
      locationCode?: string;
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

    if (finalSection !== section) {
      const sectionExists = await prisma.section.findUnique({
        where: { id: section },
        select: { id: true },
      });
      if (!sectionExists) {
        res.status(400).json({ error: '版块不存在' });
        return;
      }
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

    res.status(201).json({ post: toPostResponse(post) });
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
    });

    if (!post || !canViewPost(post, req.authUser)) {
      res.status(404).json({ error: '帖子未找到' });
      return;
    }

    await prisma.$executeRaw`UPDATE "Post" SET "viewCount" = "viewCount" + 1 WHERE "id" = ${req.params.id}`;
    const freshPost = await prisma.post.findUnique({
      where: { id: req.params.id },
    });
    if (!freshPost) {
      res.status(404).json({ error: '帖子未找到' });
      return;
    }

    const hotScore = calculatePostHotScore(freshPost);
    await prisma.post.update({
      where: { id: req.params.id },
      data: { hotScore },
    });

    if (req.authUser) {
      const existingHistory = await prisma.browsingHistory.findFirst({
        where: {
          userUid: req.authUser.uid,
          targetType: 'post' as const,
          targetId: req.params.id,
        },
      });

      if (existingHistory) {
        await prisma.browsingHistory.update({
          where: { id: existingHistory.id },
          data: { createdAt: new Date() },
        });
      } else {
        await prisma.browsingHistory.create({
          data: {
            userUid: req.authUser.uid,
            targetType: 'post' as const,
            targetId: req.params.id,
          },
        });
      }
    }

    const comments = await prisma.postComment.findMany({
      where: { postId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });

    const [likedByMe, favoritedByMe, dislikedByMe] = req.authUser
      ? await Promise.all([
          prisma.postLike.count({
            where: {
              postId: req.params.id,
              userUid: req.authUser.uid,
            },
          }).then((count) => count > 0),
          prisma.favorite.count({
            where: {
              targetType: 'post',
              targetId: req.params.id,
              userUid: req.authUser.uid,
            },
          }).then((count) => count > 0),
          prisma.postDislike.count({
            where: {
              postId: req.params.id,
              userUid: req.authUser.uid,
            },
          }).then((count) => count > 0),
        ])
      : [false, false, false];

    res.json({
      post: {
        ...toPostResponse({
          ...freshPost,
          hotScore,
        }),
        likedByMe,
        favoritedByMe,
        dislikedByMe,
      },
      comments: comments.map(toCommentResponse),
    });
  } catch (error) {
    console.error('Fetch post detail error:', error);
    res.status(500).json({ error: '获取帖子详情失败' });
  }
});

// Update post
router.put('/:id', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { title, section, content, tags, status, musicDocId, albumDocId, locationCode } = req.body as {
      title?: string;
      section?: string;
      content?: string;
      tags?: string[];
      status?: ContentStatus;
      musicDocId?: string;
      albumDocId?: string;
      locationCode?: string;
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

    if (finalSection !== section) {
      const sectionExists = await prisma.section.findUnique({
        where: { id: section },
        select: { id: true },
      });
      if (!sectionExists) {
        res.status(400).json({ error: '版块不存在' });
        return;
      }
    }

    let nextStatus: ContentStatus;
    if (isAdmin) {
      nextStatus = parseContentStatus(status) || existingPost.status;
    } else if (existingPost.status === 'published') {
      nextStatus = 'pending';
    } else {
      const normalized = normalizePostWriteStatus(status ?? existingPost.status, req.authUser!);
      nextStatus = existingPost.status === 'pending' && normalized === 'draft' ? 'pending' : normalized;
    }

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
        musicDocId: normalizedMusicDocId,
        albumDocId: normalizedAlbumDocId,
        locationCode,
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

    res.json({ post: toPostResponse(post) });
  } catch (error) {
    console.error('Edit post error:', error);
    res.status(500).json({ error: '编辑帖子失败' });
  }
});

// Delete post
router.delete('/:id', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const post = await prisma.post.findUnique({
      where: { id: req.params.id },
      select: { authorUid: true, status: true },
    });

    if (!post) {
      res.status(404).json({ error: '帖子未找到' });
      return;
    }

    const isOwner = post.authorUid === req.authUser!.uid;
    const isAdmin = isAdminRole(req.authUser!.role);
    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: '无权删除该帖子' });
      return;
    }

    await prisma.post.delete({
      where: { id: req.params.id },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ error: '删除帖子失败' });
  }
});

// Comment routes
router.get('/:postId/comments', async (req: AuthenticatedRequest, res) => {
  try {
    const postId = req.params.postId;
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { status: true, authorUid: true },
    });

    if (!post || !canViewPost(post, req.authUser)) {
      res.status(404).json({ error: '帖子未找到' });
      return;
    }

    const [comments, total] = await Promise.all([
      prisma.postComment.findMany({
        where: { postId },
        orderBy: { createdAt: 'asc' },
        take: limit,
        skip,
      }),
      prisma.postComment.count({ where: { postId } }),
    ]);

    res.json({
      comments: comments.map(toCommentResponse),
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error('Fetch post comments error:', error);
    res.status(500).json({ error: '获取评论失败' });
  }
});

router.post('/:postId/comments', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
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
    if (parentId) {
      const parent = await prisma.postComment.findUnique({
        where: { id: parentId },
        select: {
          id: true,
          postId: true,
          authorUid: true,
        },
      });
      if (!parent || parent.postId !== req.params.postId) {
        res.status(400).json({ error: '回复目标不存在' });
        return;
      }
      replyTargetUid = parent.authorUid;
    }

    const comment = await prisma.postComment.create({
      data: {
        postId: req.params.postId,
        authorUid: req.authUser!.uid,
        authorName: req.authUser!.displayName,
        authorPhoto: req.authUser!.photoURL,
        content,
        parentId: parentId || null,
      },
    });

    await prisma.post.update({
      where: { id: req.params.postId },
      data: {
        commentsCount: { increment: 1 },
      },
    });

    const notifyUid = replyTargetUid || currentPost.authorUid;
    if (notifyUid && notifyUid !== req.authUser!.uid) {
      await createNotification(notifyUid, 'reply', {
        postId: req.params.postId,
        commentId: comment.id,
        actorUid: req.authUser!.uid,
        actorName: req.authUser!.displayName,
        preview: comment.content.slice(0, 120),
      });
    }

    res.status(201).json({ comment: toCommentResponse(comment) });
  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({ error: '发表评论失败' });
  }
});

router.delete('/comments/:id', requireAuth, requireActiveUser, async (req: AuthenticatedRequest, res) => {
  try {
    const comment = await prisma.postComment.findUnique({
      where: { id: req.params.id },
      select: { authorUid: true, postId: true },
    });

    if (!comment) {
      res.status(404).json({ error: '评论未找到' });
      return;
    }

    const isOwner = comment.authorUid === req.authUser!.uid;
    const isAdmin = isAdminRole(req.authUser!.role);
    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: '无权删除该评论' });
      return;
    }

    await prisma.$transaction([
      prisma.postComment.delete({
        where: { id: req.params.id },
      }),
      prisma.post.update({
        where: { id: comment.postId },
        data: {
          commentsCount: { decrement: 1 },
        },
      }),
    ]);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ error: '删除评论失败' });
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

export function registerPostsRoutes(app: Router) {
  app.use('/api/posts', router);
}
