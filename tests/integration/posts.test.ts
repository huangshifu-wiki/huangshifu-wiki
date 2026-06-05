/**
 * Posts API 集成测试
 *
 * 测试范围：
 * 1. GET /api/posts - 获取文章列表
 * 2. GET /api/posts/:id - 获取单个文章详情（包含评论）
 * 3. POST /api/posts - 创建新文章（需要认证）
 * 4. PUT /api/posts/:id - 更新文章（需要认证）
 * 5. DELETE /api/posts/:id - 删除文章（需要认证）
 *
 * 测试策略：
 * - 使用 supertest 进行 HTTP 请求测试
 * - 测试未认证和已认证两种状态下的访问权限
 * - 验证分页、排序、筛选等查询参数
 * - 测试权限控制（作者、管理员、普通用户）
 * - 包含正常情况和错误情况的完整测试覆盖
 */

import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../server';
import { prisma, createTestUser, createTestToken, createTestPost, createTestGallery } from './setup';
import type { CreateTestPostInput } from './setup';

async function cleanupPostTestData() {
  // Defensive cleanup for legacy dirty test DBs that still contain orphaned rows
  // from older versions of this suite.
  await prisma.post.deleteMany({
    where: {
      OR: [
        { title: { startsWith: 'Test' } },
        { title: { startsWith: 'Pagination Test' } },
        { title: { startsWith: 'Sort Test' } },
        { title: { startsWith: 'General Section Post' } },
        { title: { startsWith: 'Discussion Section Post' } },
        { title: { startsWith: 'Personalized Post' } },
        { title: { startsWith: 'Draft Post Should Not Appear' } },
        { title: { startsWith: 'Detail Test Post' } },
        { title: { startsWith: 'View Count Test Post' } },
        { title: { startsWith: 'Auth Personalized Post' } },
        { title: { startsWith: 'Draft Post For Auth Test' } },
        { title: { startsWith: 'My Draft Post' } },
        { title: { startsWith: 'Comment Order Test' } },
        { title: { startsWith: 'Top Level Comment Test' } },
        { title: { startsWith: 'Reply Comment Test' } },
        { title: { startsWith: 'Reply Nested Comment Test' } },
        { title: { startsWith: 'Comment Pagination Visibility Test' } },
        { title: { startsWith: 'Soft Delete Parent Comment Test' } },
        { title: { startsWith: 'Soft Delete Child Comment Test' } },
        { title: { startsWith: 'Restore Deleted Comment Test' } },
        { title: { startsWith: 'Comment Like Test' } },
        { title: { startsWith: 'Hidden Comment Like Post Test' } },
        { title: { startsWith: 'Tags Test Post' } },
        { title: { startsWith: 'No Tags Post' } },
        { title: { startsWith: 'Original Title' } },
        { title: { startsWith: "Other User's Post" } },
        { title: { startsWith: "User's Post" } },
        { title: { startsWith: 'To Be Deleted By Author' } },
        { title: { startsWith: 'To Be Deleted By Admin' } },
        { title: { startsWith: 'Unauth Delete Test' } },
        { title: { startsWith: 'New Test Post ' } },
        { title: { startsWith: 'Admin Direct Publish Test ' } },
        { title: { startsWith: 'Admin Preserve Pending Test ' } },
        { title: { startsWith: 'Admin Restore Post Test' } },
        { title: { startsWith: 'Long Content Test ' } },
      ],
    },
  });

  await prisma.postComment.deleteMany({
    where: {
      OR: [
        { content: { startsWith: 'Top level comment' } },
        { content: { startsWith: 'Reply comment' } },
        { content: { startsWith: 'Reply child comment' } },
        { content: { startsWith: 'Root comment' } },
        { content: { startsWith: 'Deleted child comment' } },
        { content: { startsWith: 'Visible child comment' } },
        { content: { startsWith: 'Parent comment content' } },
        { content: { startsWith: 'Child comment content' } },
        { content: { startsWith: 'Reply to deleted parent' } },
        { content: { startsWith: 'Gallery comment content' } },
        { content: { startsWith: 'Reply to deleted child' } },
        { content: { startsWith: 'Restorable comment' } },
        { content: { startsWith: 'Comment to like' } },
        { content: { startsWith: 'Draft post comment' } },
      ],
    },
  });

  await prisma.gallery.deleteMany({
    where: {
      OR: [
        { title: { startsWith: 'Test Gallery ' } },
        { title: { startsWith: 'Gallery Comment Notification Test' } },
      ],
    },
  });

  await prisma.user.deleteMany({
    where: {
      email: {
        startsWith: 'test_',
      },
    },
  });
}

describe('Posts API - 文章接口测试', () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let adminUser: Awaited<ReturnType<typeof createTestUser>>;
  let userToken: string;
  let adminToken: string;

  function findCookieValue(setCookieHeader: string | string[] | undefined, cookieName: string) {
    const cookies = Array.isArray(setCookieHeader)
      ? setCookieHeader
      : setCookieHeader
        ? [setCookieHeader]
        : [];
    const targetCookie = cookies.find((cookie) => cookie?.startsWith(`${cookieName}=`));
    return targetCookie?.split(';')[0].split('=')[1];
  }

  async function createAuthenticatedAgent(email: string, password: string) {
    const agent = request.agent(app);
    const loginResponse = await agent
      .post('/api/auth/login')
      .send({ email, password });

    expect(loginResponse.status).toBe(200);
    const xsrfToken = findCookieValue(loginResponse.headers['set-cookie'], 'XSRF-TOKEN');
    expect(xsrfToken).toBeTruthy();

    return {
      agent,
      xsrfToken: xsrfToken!,
    };
  }

  async function createCurrentUserPost(overrides: Omit<CreateTestPostInput, 'authorUid'>) {
    return createTestPost({
      ...overrides,
      authorUid: testUser.user.uid,
    });
  }

  /**
   * 每个测试套件前准备测试数据
   */
  beforeEach(async () => {
    await cleanupPostTestData();
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 创建测试用户
    testUser = await createTestUser({
      role: 'user',
      email: `test_posts_user_${suffix}@example.com`,
      displayName: `TestPostsUser_${suffix}`,
    });
    adminUser = await createTestUser({
      role: 'admin',
      email: `test_posts_admin_${suffix}@example.com`,
      displayName: `TestPostsAdmin_${suffix}`,
    });

    // 创建认证 token
    userToken = await createTestToken(testUser.user.uid, testUser.user.role);
    adminToken = await createTestToken(adminUser.user.uid, adminUser.user.role);
  });

  /**
   * 清理测试数据
   */
  afterEach(async () => {
    await cleanupPostTestData();
  });

  // ============================================================================
  // 获取文章列表接口测试
  // ============================================================================
  describe('GET /api/posts - 获取文章列表', () => {
    /**
     * 测试目的：验证获取空列表时的响应格式
     * 预期结果：返回空数组和正确的元数据
     */
    it('应该返回空的文章列表（当没有数据时）', async () => {
      const emptySection = `empty-section-${Date.now()}`;
      const response = await request(app).get('/api/posts').query({ section: emptySection });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('posts');
      expect(Array.isArray(response.body.posts)).toBe(true);
      expect(response.body.posts.length).toBe(0);

      // 验证分页元数据
      expect(response.body).toHaveProperty('total', 0);
      expect(response.body).toHaveProperty('page', 1);
      expect(response.body).toHaveProperty('limit', 20);
      expect(response.body).toHaveProperty('totalPages', 1);
      expect(response.body).toHaveProperty('hasMore', false);
    });

    /**
     * 测试目的：验证返回包含数据的文章列表
     * 预期结果：返回正确数量的文章和完整的文章信息
     */
    it('应该返回包含数据的文章列表', async () => {
      // 创建多个测试文章
      const post1 = await createTestPost({
        title: 'Test Post 1',
        section: 'general',
        content: 'Content of post 1',
        status: 'published',
        authorUid: testUser.user.uid,
      });

      const post2 = await createTestPost({
        title: 'Test Post 2',
        section: 'discussion',
        content: 'Content of post 2',
        status: 'published',
        authorUid: testUser.user.uid,
      });

      const response = await request(app).get('/api/posts');

      expect(response.status).toBe(200);
      expect(response.body.posts.length).toBeGreaterThanOrEqual(2);

      // 验证文章结构包含必要字段
      const post = response.body.posts.find(
        (p: { id: string }) => p.id === post1.id,
      );
      expect(post).toBeDefined();
      expect(post).toHaveProperty('id', post1.id);
      expect(post).toHaveProperty('title', post1.title);
      expect(post).toHaveProperty('section', post1.section);
      expect(post).toHaveProperty('status');
      expect(post).toHaveProperty('authorName', testUser.user.displayName);
      expect(post).toHaveProperty('createdAt');
      expect(post).toHaveProperty('updatedAt');
      expect(post).toHaveProperty('viewCount');
      expect(post).toHaveProperty('likesCount');
      expect(post).toHaveProperty('commentsCount');
      expect(post).toHaveProperty('excerpt', 'Content of post 1');

      // 验证总数
      expect(response.body.total).toBeGreaterThanOrEqual(2);
    });

    /**
     * 测试目的：验证分页功能是否正常工作
     * 预期结果：返回指定页码的数据和正确的分页信息
     */
    it('应该支持分页参数', async () => {
      // 创建多个测试文章
      for (let i = 0; i < 25; i++) {
        await createTestPost({
          title: `Pagination Test ${i}`,
          status: 'published',
          authorUid: testUser.user.uid,
        });
      }

      // 请求第一页，每页 10 条
      const response1 = await request(app)
        .get('/api/posts')
        .query({ page: 1, limit: 10 });

      expect(response1.status).toBe(200);
      expect(response1.body.posts.length).toBe(10);
      expect(response1.body.page).toBe(1);
      expect(response1.body.limit).toBe(10);
      expect(response1.body.totalPages).toBe(
        Math.max(1, Math.ceil(response1.body.total / response1.body.limit)),
      );
      expect(response1.body.hasMore).toBe(true);

      // 请求第二页
      const response2 = await request(app)
        .get('/api/posts')
        .query({ page: 2, limit: 10 });

      expect(response2.status).toBe(200);
      expect(response2.body.posts.length).toBe(10);
      expect(response2.body.page).toBe(2);
      expect(response2.body.totalPages).toBe(response1.body.totalPages);

      // 请求第三页（剩余 5 条）
      const response3 = await request(app)
        .get('/api/posts')
        .query({ page: 3, limit: 10 });

      expect(response3.status).toBe(200);
      expect(response3.body.totalPages).toBe(response1.body.totalPages);
      expect(response3.body.hasMore).toBe(false);
    });

    /**
     * 测试目的：验证按版块筛选功能
     * 预期结果：只返回指定版块的文章
     */
    it('应该支持按版块筛选', async () => {
      // 创建不同版块的文章
      await createCurrentUserPost({
        title: 'General Section Post',
        section: 'general',
        status: 'published',
      });

      await createCurrentUserPost({
        title: 'Discussion Section Post',
        section: 'discussion',
        status: 'published',
      });

      // 筛选 general 版块
      const response = await request(app)
        .get('/api/posts')
        .query({ section: 'general' });

      expect(response.status).toBe(200);

      // 验证所有返回的文章都属于 general 版块
      if (response.body.posts.length > 0) {
        response.body.posts.forEach((post: { section: string }) => {
          expect(post.section).toBe('general');
        });
      }
    });

    /**
     * 测试目的：验证排序参数功能
     * 预期结果：根据不同的排序方式返回正确排序的结果
     */
    it('应该支持不同的排序方式', async () => {
      // 创建一些测试文章
      for (let i = 0; i < 5; i++) {
        await createTestPost({
          title: `Sort Test ${i}`,
          status: 'published',
          authorUid: testUser.user.uid,
        });
      }

      // 默认排序（最新优先）
      const responseLatest = await request(app)
        .get('/api/posts')
        .query({ sort: 'latest' });

      expect(responseLatest.status).toBe(200);
      if (responseLatest.body.posts.length >= 2) {
        const date1 = new Date(responseLatest.body.posts[0].updatedAt).getTime();
        const date2 = new Date(responseLatest.body.posts[1].updatedAt).getTime();
        expect(date1).toBeGreaterThanOrEqual(date2);
      }

      // 热门排序
      const responseHot = await request(app)
        .get('/api/posts')
        .query({ sort: 'hot' });

      expect(responseHot.status).toBe(200);
      expect(responseHot.body).toHaveProperty('posts');
    });

    /**
     * 测试目的：验证已登录用户的个性化数据
     * 预期结果：登录用户应看到 likedByMe、favoritedByMe 等字段
     */
    it('已登录用户应该看到个性化交互状态', async () => {
      // 创建测试文章
      const post = await createTestPost({
        title: 'Personalized Post',
        status: 'published',
        authorUid: testUser.user.uid,
      });

      // 用户点赞该文章
      await prisma.postLike.create({
        data: {
          postId: post.id,
          userUid: testUser.user.uid,
        },
      });

      // 已认证用户访问
      const response = await request(app)
        .get('/api/posts')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);

      // 查找我们创建的文章
      const userPost = response.body.posts.find(
        (p: { id: string }) => p.id === post.id,
      );
      if (userPost) {
        expect(userPost).toHaveProperty('likedByMe', true);
      }
    });

    /**
     * 测试目的：验证草稿状态的文章对非作者不可见
     * 预期结果：未登录/非作者不应看到草稿文章
     */
    it('未登录用户不应该看到草稿状态的文章', async () => {
      // 创建草稿文章
      await createTestPost({
        title: 'Draft Post Should Not Appear',
        status: 'draft',
        authorUid: testUser.user.uid,
      });

      // 未登录用户获取列表
      const response = await request(app).get('/api/posts');

      expect(response.status).toBe(200);

      // 草稿文章不应出现在列表中
      const draftPost = response.body.posts.find(
        (post: { title: string }) =>
          post.title === 'Draft Post Should Not Appear',
      );
      expect(draftPost).toBeUndefined();
    });

    /**
     * 测试目的：验证非已发布状态的文章不应出现在论坛列表中
     * 预期结果：列表只显示已通过审核的文章
     */
    it('已登录作者不应该在列表中看到待审核或被驳回的文章', async () => {
      await createCurrentUserPost({
        title: 'Pending Post Should Not Appear',
        status: 'pending',
      });
      await createCurrentUserPost({
        title: 'Rejected Post Should Not Appear',
        status: 'rejected',
      });

      const response = await request(app)
        .get('/api/posts')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);

      const pendingPost = response.body.posts.find(
        (post: { title: string }) => post.title === 'Pending Post Should Not Appear',
      );
      const rejectedPost = response.body.posts.find(
        (post: { title: string }) =>
          post.title === 'Rejected Post Should Not Appear',
      );
      expect(pendingPost).toBeUndefined();
      expect(rejectedPost).toBeUndefined();
    });
  });

  // ============================================================================
  // 获取单个文章详情接口测试
  // ============================================================================
  describe('GET /api/posts/:id - 获取文章详情', () => {
    /**
     * 测试目的：验证获取存在的文章详情
     * 预期结果：返回完整的文章信息和评论列表
     */
    it('应该返回存在的文章详情', async () => {
      // 创建测试文章
      const post = await createTestPost({
        title: 'Detail Test Post',
        content: '# Hello\n\nThis is detailed **content**.',
        section: 'general',
        status: 'published',
        authorUid: testUser.user.uid,
      });

      // 添加一些评论
      await prisma.postComment.createMany({
        data: [
          {
            postId: post.id,
            authorUid: testUser.user.uid,
            content: 'First comment',
          },
          {
            postId: post.id,
            authorUid: testUser.user.uid,
            content: 'Second comment',
          },
        ],
      });

      const response = await request(app).get(`/api/posts/${post.id}`);

      expect(response.status).toBe(200);

      // 验证主要字段
      expect(response.body).toHaveProperty('post');
      expect(response.body.post.id).toBe(post.id);
      expect(response.body.post.title).toBe(post.title);
      expect(response.body.post.content).toBe(post.content);
      expect(response.body.post.section).toBe(post.section);
      expect(response.body.post.author).toMatchObject({
        displayName: testUser.user.displayName,
      });

      // 验证评论列表
      expect(response.body).toHaveProperty('comments');
      expect(Array.isArray(response.body.comments)).toBe(true);
      expect(response.body.comments.length).toBe(2);
    });

    /**
     * 测试目的：验证访问不存在的文章
     * 预期结果：返回 404 错误
     */
    it('访问不存在的文章应该返回 404 错误', async () => {
      const nonExistentId = 'non_existent_post_id_12345';

      const response = await request(app).get(`/api/posts/${nonExistentId}`);

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('未找到');
    });

    /**
     * 测试目的：验证访问文章时浏览次数是否增加
     * 预期结果：每次访问后 viewCount 应该增加
     */
    it('每次访问应该增加浏览次数', async () => {
      // 创建测试文章
      const post = await createCurrentUserPost({
        title: 'View Count Test Post',
        status: 'published',
      });

      // 第一次访问
      const response1 = await request(app).get(`/api/posts/${post.id}`);
      expect(response1.status).toBe(200);

      // 从数据库获取更新后的浏览次数
      const updatedPost = await prisma.post.findUnique({
        where: { id: post.id },
      });

      expect(updatedPost?.viewCount).toBeGreaterThanOrEqual(1);
    });

    /**
     * 测试目的：验证已认证用户的个性化数据
     * 预期结果：登录用户应看到 favoritedByMe、likedByMe、dislikedByMe 字段
     */
    it('已登录用户应该看到个性化交互状态', async () => {
      // 创建测试文章
      const post = await createTestPost({
        title: 'Auth Personalized Post',
        status: 'published',
        authorUid: testUser.user.uid,
      });

      // 用户点赞并收藏该文章
      await Promise.all([
        prisma.postLike.create({
          data: { postId: post.id, userUid: testUser.user.uid },
        }),
        prisma.favorite.create({
          data: {
            userUid: testUser.user.uid,
            targetType: 'post',
            targetId: post.id,
          },
        }),
      ]);

      // 已认证用户访问
      const response = await request(app)
        .get(`/api/posts/${post.id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);
      expect(response.body.post).toHaveProperty('likedByMe', true);
      expect(response.body.post).toHaveProperty('favoritedByMe', true);
      expect(response.body.post).toHaveProperty('dislikedByMe', false);
    });

    /**
     * 测试目的：验证草稿文章的访问权限
     * 预期结果：非作者/管理员不能查看草稿
     */
    it('未认证用户不能查看草稿状态的文章', async () => {
      // 创建草稿文章
      const draftPost = await createCurrentUserPost({
        title: 'Draft Post For Auth Test',
        status: 'draft',
      });

      // 未认证用户尝试访问草稿
      const response = await request(app).get(`/api/posts/${draftPost.id}`);

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
    });

    /**
     * 测试目的：验证作者可以查看自己的草稿
     * 预期结果：作者应能看到自己的草稿文章
     */
    it('作者应该能够查看自己的草稿文章', async () => {
      // 创建属于当前用户的草稿文章
      const draftPost = await createTestPost({
        title: 'My Draft Post',
        status: 'draft',
        authorUid: testUser.user.uid,
      });

      // 作者访问自己的草稿
      const response = await request(app)
        .get(`/api/posts/${draftPost.id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);
      expect(response.body.post.id).toBe(draftPost.id);
      expect(response.body.post.status).toBe('draft');
    });

    /**
     * 测试目的：验证评论的正确排序
     * 预期结果：评论应按时间升序排列（最早的在前）
     */
    it('评论应该按时间升序排列', async () => {
      // 创建测试文章
      const post = await createCurrentUserPost({
        title: 'Comment Order Test',
        status: 'published',
      });

      // 添加评论（注意顺序）
      const comment1 = await prisma.postComment.create({
        data: {
          postId: post.id,
          authorUid: testUser.user.uid,
          content: 'First comment',
        },
      });

      const comment2 = await prisma.postComment.create({
        data: {
          postId: post.id,
          authorUid: testUser.user.uid,
          content: 'Second comment',
        },
      });

      const response = await request(app).get(`/api/posts/${post.id}`);

      expect(response.status).toBe(200);
      expect(response.body.comments.length).toBe(2);

      // 验证顺序：第一个评论应该在前面
      expect(response.body.comments[0].id).toBe(comment1.id);
      expect(response.body.comments[1].id).toBe(comment2.id);
    });
  });

  // ============================================================================
  // 发表评论接口测试（需要认证）
  // ============================================================================
  describe('POST /api/posts/:postId/comments - 发表评论', () => {
    it('应该允许顶级评论显式传入 null parentId', async () => {
      const post = await createCurrentUserPost({
        title: 'Top Level Comment Test',
        status: 'published',
      });
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );

      const response = await agent
        .post(`/api/posts/${post.id}/comments`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({
          content: 'Top level comment',
          parentId: null,
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('comment');
      expect(response.body.comment.content).toBe('Top level comment');
      expect(response.body.comment.parentId).toBeNull();

      const dbComment = await prisma.postComment.findUnique({
        where: { id: response.body.comment.id },
      });
      expect(dbComment?.parentId).toBeNull();

      const dbPost = await prisma.post.findUnique({
        where: { id: post.id },
      });
      expect(dbPost?.commentsCount).toBe(1);
    });

    it('应该允许回复已有评论', async () => {
      const post = await createCurrentUserPost({
        title: 'Reply Comment Test',
        status: 'published',
      });
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );

      const parent = await prisma.postComment.create({
        data: {
          postId: post.id,
          authorUid: testUser.user.uid,
          content: 'Parent comment',
        },
      });

      const response = await agent
        .post(`/api/posts/${post.id}/comments`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({
          content: 'Reply comment',
          parentId: parent.id,
        });

      expect(response.status).toBe(201);
      expect(response.body.comment.parentId).toBe(parent.id);

      const dbComment = await prisma.postComment.findUnique({
        where: { id: response.body.comment.id },
      });
      expect(dbComment?.parentId).toBe(parent.id);
    });

    it('回复子评论时应归入根评论并记录实际回复目标', async () => {
      const post = await createCurrentUserPost({
        title: 'Reply Nested Comment Test',
        status: 'published',
      });
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );

      const parent = await prisma.postComment.create({
        data: {
          postId: post.id,
          authorUid: testUser.user.uid,
          content: 'Root comment',
        },
      });
      const child = await prisma.postComment.create({
        data: {
          postId: post.id,
          authorUid: testUser.user.uid,
          content: 'Child comment',
          parentId: parent.id,
          replyToId: parent.id,
        },
      });

      const response = await agent
        .post(`/api/posts/${post.id}/comments`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({
          content: 'Reply child comment',
          parentId: child.id,
        });

      expect(response.status).toBe(201);
      expect(response.body.comment.parentId).toBe(parent.id);
      expect(response.body.comment.replyToId).toBe(child.id);
      expect(response.body.comment.replyToAuthorUid).toBe(testUser.user.uid);

      const dbComment = await prisma.postComment.findUnique({
        where: { id: response.body.comment.id },
      });
      expect(dbComment?.parentId).toBe(parent.id);
      expect(dbComment?.replyToId).toBe(child.id);
    });
  });

  describe('GET /api/posts/:postId/comments - 获取评论列表', () => {
    it('分页应在过滤不可见删除评论之后执行', async () => {
      const post = await createCurrentUserPost({
        title: 'Comment Pagination Visibility Test',
        status: 'published',
      });
      const root = await prisma.postComment.create({
        data: {
          postId: post.id,
          authorUid: testUser.user.uid,
          content: 'Root comment',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      });
      const hiddenChild = await prisma.postComment.create({
        data: {
          postId: post.id,
          authorUid: testUser.user.uid,
          content: 'Deleted child comment',
          parentId: root.id,
          replyToId: root.id,
          deletedAt: new Date('2026-01-01T00:00:01.000Z'),
          deletedBy: testUser.user.uid,
          createdAt: new Date('2026-01-01T00:00:01.000Z'),
        },
      });
      const visibleChild = await prisma.postComment.create({
        data: {
          postId: post.id,
          authorUid: testUser.user.uid,
          content: 'Visible child comment',
          parentId: root.id,
          replyToId: root.id,
          createdAt: new Date('2026-01-01T00:00:02.000Z'),
        },
      });

      const publicResponse = await request(app)
        .get(`/api/posts/${post.id}/comments`)
        .query({ page: 1, limit: 2 });
      expect(publicResponse.status).toBe(200);
      expect(publicResponse.body.total).toBe(2);
      expect(publicResponse.body.comments.map((comment: { id: string }) => comment.id)).toEqual([
        root.id,
        visibleChild.id,
      ]);

      const adminResponse = await request(app)
        .get(`/api/posts/${post.id}/comments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 3, includeDeleted: true });
      expect(adminResponse.status).toBe(200);
      expect(adminResponse.body.total).toBe(3);
      expect(adminResponse.body.comments.map((comment: { id: string }) => comment.id)).toEqual([
        root.id,
        hiddenChild.id,
        visibleChild.id,
      ]);
    });
  });

  // ============================================================================
  // 删除评论接口测试（需要认证）
  // ============================================================================
  describe('DELETE /api/posts/comments/:id - 删除评论', () => {
    it('删除父评论时应软删除并保留子评论可见', async () => {
      const post = await createCurrentUserPost({
        title: 'Soft Delete Parent Comment Test',
        status: 'published',
      });

      const parent = await prisma.postComment.create({
        data: {
          postId: post.id,
          authorUid: testUser.user.uid,
          content: 'Parent comment content',
        },
      });

      const child = await prisma.postComment.create({
        data: {
          postId: post.id,
          authorUid: testUser.user.uid,
          content: 'Child comment content',
          parentId: parent.id,
        },
      });

      await prisma.post.update({
        where: { id: post.id },
        data: { commentsCount: 2 },
      });

      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const deleteResponse = await agent
        .delete(`/api/posts/comments/${parent.id}`)
        .set('X-XSRF-TOKEN', xsrfToken);

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body).toEqual({ success: true });

      const dbParent = await prisma.postComment.findUnique({
        where: { id: parent.id },
      });
      expect(dbParent).not.toBeNull();
      expect(dbParent?.deletedAt).not.toBeNull();
      expect(dbParent?.deletedBy).toBe(testUser.user.uid);

      const dbChild = await prisma.postComment.findUnique({
        where: { id: child.id },
      });
      expect(dbChild?.deletedAt).toBeNull();
      expect(dbChild?.parentId).toBe(parent.id);

      const publicResponse = await request(app).get(`/api/posts/${post.id}`);
      expect(publicResponse.status).toBe(200);
      expect(publicResponse.body.comments).toHaveLength(2);
      const publicParent = publicResponse.body.comments.find(
        (comment: { id: string }) => comment.id === parent.id,
      );
      const publicChild = publicResponse.body.comments.find(
        (comment: { id: string }) => comment.id === child.id,
      );
      expect(publicParent).toMatchObject({
        id: parent.id,
        content: '评论已删除',
        isDeleted: true,
        deletedByName: null,
      });
      expect(publicChild).toMatchObject({
        id: child.id,
        content: 'Child comment content',
      });

      const adminResponse = await request(app)
        .get(`/api/posts/${post.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(adminResponse.status).toBe(200);
      expect(adminResponse.body.comments[0].content).toBe('评论已删除');
      expect(adminResponse.body.comments[0].isDeleted).toBe(true);
      expect(adminResponse.body.comments[0].deletedByName).toBeNull();

      const adminWithDeletedResponse = await request(app)
        .get(`/api/posts/${post.id}?includeDeleted=true`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(adminWithDeletedResponse.status).toBe(200);
      expect(adminWithDeletedResponse.body.comments[0].content).toBe('Parent comment content');
      expect(adminWithDeletedResponse.body.comments[0].deletedBy).toBe(testUser.user.uid);
      expect(adminWithDeletedResponse.body.comments[0].deletedByName).toBe(testUser.user.displayName);

      const replyDeletedParentResponse = await agent
        .post(`/api/posts/${post.id}/comments`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({
          content: 'Reply to deleted parent',
          parentId: parent.id,
        });
      expect(replyDeletedParentResponse.status).toBe(201);
      expect(replyDeletedParentResponse.body.comment.parentId).toBe(parent.id);
      expect(replyDeletedParentResponse.body.comment.replyToId).toBe(parent.id);

      const dbPost = await prisma.post.findUnique({
        where: { id: post.id },
      });
      expect(dbPost?.commentsCount).toBe(3);
    });

    it('应该允许通过通用评论接口删除图集评论', async () => {
      const gallery = await createTestGallery({ authorUid: testUser.user.uid, authorName: testUser.user.displayName });

      const galleryComment = await prisma.postComment.create({
        data: {
          galleryId: gallery.id,
          authorUid: testUser.user.uid,
          content: 'Gallery comment content',
        },
      });

      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const responseWithCsrf = await agent
        .delete(`/api/posts/comments/${galleryComment.id}`)
        .set('X-XSRF-TOKEN', xsrfToken);

      expect(responseWithCsrf.status).toBe(200);
      expect(responseWithCsrf.body).toEqual({ success: true });

      const dbComment = await prisma.postComment.findUnique({
        where: { id: galleryComment.id },
      });
      expect(dbComment?.deletedAt).not.toBeNull();
      expect(dbComment?.deletedBy).toBe(testUser.user.uid);
    });

    it('删除子评论后普通用户不可见且不能继续回复', async () => {
      const post = await createCurrentUserPost({
        title: 'Soft Delete Child Comment Test',
        status: 'published',
      });
      const parent = await prisma.postComment.create({
        data: {
          postId: post.id,
          authorUid: testUser.user.uid,
          content: 'Root comment content',
        },
      });
      const child = await prisma.postComment.create({
        data: {
          postId: post.id,
          authorUid: testUser.user.uid,
          content: 'Child comment content',
          parentId: parent.id,
          replyToId: parent.id,
        },
      });

      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const deleteResponse = await agent
        .delete(`/api/posts/comments/${child.id}`)
        .set('X-XSRF-TOKEN', xsrfToken);
      expect(deleteResponse.status).toBe(200);

      const publicResponse = await request(app).get(`/api/posts/${post.id}`);
      expect(publicResponse.status).toBe(200);
      expect(publicResponse.body.comments.map((comment: { id: string }) => comment.id)).toEqual([parent.id]);

      const adminWithDeletedResponse = await request(app)
        .get(`/api/posts/${post.id}?includeDeleted=true`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(adminWithDeletedResponse.status).toBe(200);
      expect(adminWithDeletedResponse.body.comments.map((comment: { id: string }) => comment.id)).toEqual([
        parent.id,
        child.id,
      ]);

      const replyDeletedChildResponse = await agent
        .post(`/api/posts/${post.id}/comments`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({
          content: 'Reply to deleted child',
          parentId: child.id,
        });
      expect(replyDeletedChildResponse.status).toBe(400);
      expect(replyDeletedChildResponse.body.error).toBe('回复目标不存在');
    });

    it('管理员应该可以恢复已删除评论', async () => {
      const post = await createCurrentUserPost({
        title: 'Restore Deleted Comment Test',
        status: 'published',
      });
      const comment = await prisma.postComment.create({
        data: {
          postId: post.id,
          authorUid: testUser.user.uid,
          content: 'Restorable comment',
          deletedAt: new Date(),
          deletedBy: testUser.user.uid,
        },
      });

      const { agent: userAgent, xsrfToken: userXsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const forbiddenResponse = await userAgent
        .post(`/api/posts/comments/${comment.id}/restore`)
        .set('X-XSRF-TOKEN', userXsrfToken);
      expect(forbiddenResponse.status).toBe(403);

      const { agent: adminAgent, xsrfToken: adminXsrfToken } = await createAuthenticatedAgent(
        adminUser.user.email,
        adminUser.plainPassword,
      );
      const response = await adminAgent
        .post(`/api/posts/comments/${comment.id}/restore`)
        .set('X-XSRF-TOKEN', adminXsrfToken);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });

      const dbComment = await prisma.postComment.findUnique({
        where: { id: comment.id },
      });
      expect(dbComment?.deletedAt).toBeNull();
      expect(dbComment?.deletedBy).toBeNull();
    });
  });

  describe('POST/DELETE /api/posts/comments/:id/like - 评论点赞', () => {
    it('应该持久化评论点赞并防重复', async () => {
      const post = await createCurrentUserPost({
        title: 'Comment Like Test',
        status: 'published',
      });
      const comment = await prisma.postComment.create({
        data: {
          postId: post.id,
          authorUid: testUser.user.uid,
          content: 'Comment to like',
        },
      });

      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const likeResponse = await agent
        .post(`/api/posts/comments/${comment.id}/like`)
        .set('X-XSRF-TOKEN', xsrfToken);
      expect(likeResponse.status).toBe(200);
      expect(likeResponse.body).toMatchObject({ likedByMe: true, likesCount: 1 });

      const duplicateLikeResponse = await agent
        .post(`/api/posts/comments/${comment.id}/like`)
        .set('X-XSRF-TOKEN', xsrfToken);
      expect(duplicateLikeResponse.status).toBe(200);
      expect(duplicateLikeResponse.body).toMatchObject({ likedByMe: true, likesCount: 1 });

      const detailResponse = await agent
        .get(`/api/posts/${post.id}`)

      expect(detailResponse.status).toBe(200);
      expect(detailResponse.body.comments[0]).toMatchObject({
        id: comment.id,
        likedByMe: true,
        likesCount: 1,
      });

      const unlikeResponse = await agent
        .delete(`/api/posts/comments/${comment.id}/like`)
        .set('X-XSRF-TOKEN', xsrfToken);
      expect(unlikeResponse.status).toBe(200);
      expect(unlikeResponse.body).toMatchObject({ likedByMe: false, likesCount: 0 });
    });

    it('不能点赞或取消点赞当前用户不可见内容下的评论', async () => {
      const otherUser = await createTestUser({
        email: `test_other_${Date.now()}@example.com`,
        role: 'user',
      });
      const otherToken = await createTestToken(otherUser.user.uid, otherUser.user.role);
      const { agent: ownerAgent, xsrfToken: ownerXsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const { agent: otherAgent, xsrfToken: otherXsrfToken } = await createAuthenticatedAgent(
        otherUser.user.email,
        otherUser.plainPassword,
      );
      const draftPost = await createCurrentUserPost({
        title: 'Hidden Comment Like Post Test',
        status: 'draft',
      });
      const postComment = await prisma.postComment.create({
        data: {
          postId: draftPost.id,
          authorUid: testUser.user.uid,
          content: 'Draft post comment',
        },
      });
      const hiddenGallery = await createTestGallery({ authorUid: testUser.user.uid, authorName: testUser.user.displayName, published: false });
      const galleryComment = await prisma.postComment.create({
        data: {
          galleryId: hiddenGallery.id,
          authorUid: testUser.user.uid,
          content: 'Hidden gallery comment',
        },
      });

      const postLikeResponse = await otherAgent
        .post(`/api/posts/comments/${postComment.id}/like`)
        .set('X-XSRF-TOKEN', otherXsrfToken);
      expect(postLikeResponse.status).toBe(404);

      const postUnlikeResponse = await otherAgent
        .delete(`/api/posts/comments/${postComment.id}/like`)
        .set('X-XSRF-TOKEN', otherXsrfToken);
      expect(postUnlikeResponse.status).toBe(404);

      const galleryLikeResponse = await otherAgent
        .post(`/api/posts/comments/${galleryComment.id}/like`)
        .set('X-XSRF-TOKEN', otherXsrfToken);
      expect(galleryLikeResponse.status).toBe(404);

      const ownerLikeResponse = await ownerAgent
        .post(`/api/posts/comments/${postComment.id}/like`)
        .set('X-XSRF-TOKEN', ownerXsrfToken);
      expect(ownerLikeResponse.status).toBe(200);
      expect(ownerLikeResponse.body).toMatchObject({ likedByMe: true, likesCount: 1 });
    });
  });

  // ============================================================================
  // 创建文章接口测试（需要认证）
  // ============================================================================
  describe('POST /api/posts - 创建文章', () => {
    /**
     * 测试目的：验证已认证用户能否成功创建文章
     * 预期结果：返回 201 状态码和新创建的文章信息
     */
    it('已认证用户应该能够创建新文章', async () => {
      const newPostData = {
        title: `New Test Post ${Date.now()}`,
        section: 'general',
        content: 'This is a new post content with **markdown** support.',
        tags: ['test', 'new'],
      };

      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const response = await agent
        .post('/api/posts')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send(newPostData);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('post');
      expect(response.body.post.title).toBe(newPostData.title);
      expect(response.body.post.section).toBe(newPostData.section);
      expect(response.body.post.content).toBe(newPostData.content);
      expect(response.body.post.authorUid).toBe(testUser.user.uid);

      // 验证数据库中确实创建了该文章
      const dbPost = await prisma.post.findUnique({
        where: { id: response.body.post.id },
      });
      expect(dbPost).not.toBeNull();
      expect(dbPost?.title).toBe(newPostData.title);
    });

    it('应该允许提交待审核状态并接受空位置信息', async () => {
      const newPostData = {
        title: `New Test Post Pending ${Date.now()}`,
        section: 'discussion',
        content: 'Pending review content.',
        tags: [],
        status: 'pending',
        locationCode: null,
        locationDetail: null,
      };

      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const response = await agent
        .post('/api/posts')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send(newPostData);

      expect(response.status).toBe(201);
      expect(response.body.post.status).toBe('pending');
      expect(response.body.post.locationCode).toBeNull();
      expect(response.body.post.locationDetail).toBeNull();

      const dbPost = await prisma.post.findUnique({
        where: { id: response.body.post.id },
      });
      expect(dbPost?.status).toBe('pending');
      expect(dbPost?.locationCode ?? null).toBeNull();
      expect(dbPost?.locationDetail ?? null).toBeNull();
    });

    it('管理员提交待审核状态时应该直接发布', async () => {
      const newPostData = {
        title: `Admin Direct Publish Test ${Date.now()}`,
        section: 'discussion',
        content: 'Admin post should skip review.',
        tags: [],
        status: 'pending',
      };

      const { agent, xsrfToken } = await createAuthenticatedAgent(
        adminUser.user.email,
        adminUser.plainPassword,
      );
      const response = await agent
        .post('/api/posts')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send(newPostData);

      expect(response.status).toBe(201);
      expect(response.body.post.status).toBe('published');

      const dbPost = await prisma.post.findUnique({
        where: { id: response.body.post.id },
      });
      expect(dbPost?.status).toBe('published');
    });

    /**
     * 测试目的：验证未认证用户无法创建文章
     * 预期结果：返回 401 认证错误
     */
    it('未认证用户尝试创建文章应该返回 401 错误', async () => {
      const response = await request(app)
        .post('/api/posts')
        .send({
          title: 'Unauthorized Create',
          section: 'general',
          content: 'Should not be created',
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });

    /**
     * 测试目的：验证缺少必填字段的创建请求
     * 预期结果：返回 400 错误并提示缺少必要字段
     */
    it('缺少必填字段时应该返回 400 错误', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      // 缺少标题
      const response1 = await agent
        .post('/api/posts')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({
          section: 'general',
          content: 'No title provided',
        });

      expect(response1.status).toBe(400);
      expect(response1.body.error).toBe('Validation failed');
      expect(response1.body.fields).toHaveProperty('title');

      // 缺少内容
      const response2 = await agent
        .post('/api/posts')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({
          title: 'No Content',
          section: 'general',
        });

      expect(response2.status).toBe(400);
      expect(response2.body.error).toBe('Validation failed');
      expect(response2.body.fields).toHaveProperty('content');

      // 缺少版块
      const response3 = await agent
        .post('/api/posts')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({
          title: 'No Section',
          content: 'Content without section',
        });

      expect(response3.status).toBe(400);
      expect(response3.body.error).toBe('Validation failed');
      expect(response3.body.fields).toHaveProperty('section');
    });

    /**
     * 测试目的：验证标签的处理
     * 预期结果：标签应被正确存储为数组格式
     */
    it('应该正确处理文章标签', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const response = await agent
        .post('/api/posts')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({
          title: 'Tags Test Post',
          section: 'general',
          content: 'Testing tags functionality',
          tags: ['javascript', 'typescript', 'testing'],
        });

      expect(response.status).toBe(201);

      // 从数据库验证标签
      const dbPost = await prisma.post.findUnique({
        where: { id: response.body.post.id },
      });
      expect(dbPost?.tags).toEqual(['javascript', 'typescript', 'testing']);
    });

    /**
     * 测试目的：验证空标签数组或无标签的处理
     * 预期结果：应能正常处理没有标签的情况
     */
    it('应该能处理没有标签的文章', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const response = await agent
        .post('/api/posts')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({
          title: 'No Tags Post',
          section: 'general',
          content: 'Post without any tags',
        });

      expect(response.status).toBe(201);
      expect(response.body.post.tags).toEqual([]);
    });
  });

  // ============================================================================
  // 更新文章接口测试（需要认证）
  // ============================================================================
  describe('PUT /api/posts/:id - 更新文章', () => {
    /**
     * 测试目的：验证作者能否成功更新自己创建的文章
     * 预期结果：返回更新后的文章信息
     */
    it('作者应该能够成功更新自己的文章', async () => {
      // 创建属于当前用户的文章
      const post = await createTestPost({
        title: 'Original Title',
        content: 'Original content',
        authorUid: testUser.user.uid,
        status: 'published',
      });

      const updateData = {
        title: 'Updated Title',
        section: 'general',
        content: 'Updated content with new information',
        tags: ['updated'],
      };

      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const response = await agent
        .put(`/api/posts/${post.id}`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.post.title).toBe(updateData.title);
      expect(response.body.post.content).toBe(updateData.content);

      // 验证数据库中的更新
      const dbPost = await prisma.post.findUnique({
        where: { id: post.id },
      });
      expect(dbPost?.title).toBe(updateData.title);
    });

    /**
     * 测试目的：验证非作者无法更新他人的文章
     * 预期结果：返回 403 权限错误
     */
    it('非作者尝试更新他人文章应该返回 403 错误', async () => {
      // 创建属于其他用户的文章
      const otherUser = await createTestUser();
      const post = await createTestPost({
        title: "Other User's Post",
        authorUid: otherUser.user.uid,
        status: 'published',
      });

      // 当前用户尝试更新
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const response = await agent
        .put(`/api/posts/${post.id}`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({
          title: 'Hacked Title',
          content: 'Hacked content',
          section: 'general',
        });

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('无权');
    });

    /**
     * 测试目的：验证管理员可以更新任何文章
     * 预期结果：管理员应能成功更新其他人的文章
     */
    it('管理员应该能够更新任意文章', async () => {
      // 创建普通用户的文章
      const post = await createTestPost({
        title: "User's Post",
        authorUid: testUser.user.uid,
        status: 'published',
      });

      // 管理员更新
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        adminUser.user.email,
        adminUser.plainPassword,
      );
      const response = await agent
        .put(`/api/posts/${post.id}`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({
          title: 'Admin Updated Title',
          content: 'Admin updated this content',
          section: 'general',
        });

      expect(response.status).toBe(200);
      expect(response.body.post.title).toBe('Admin Updated Title');
    });

    it('管理员更新待审核文章但未传状态时应该保留原状态', async () => {
      const post = await createTestPost({
        title: `Admin Preserve Pending Test ${Date.now()}`,
        authorUid: testUser.user.uid,
        status: 'pending',
      });

      const { agent, xsrfToken } = await createAuthenticatedAgent(
        adminUser.user.email,
        adminUser.plainPassword,
      );
      const response = await agent
        .put(`/api/posts/${post.id}`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({
          title: 'Admin Preserve Pending Test Updated',
          content: 'Admin updated content without reviewing.',
          section: 'general',
        });

      expect(response.status).toBe(200);
      expect(response.body.post.status).toBe('pending');

      const dbPost = await prisma.post.findUnique({
        where: { id: post.id },
      });
      expect(dbPost?.status).toBe('pending');
    });

    /**
     * 测试目的：验证更新不存在的文章
     * 预期结果：返回 404 错误
     */
    it('更新不存在的文章应该返回 404 错误', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const response = await agent
        .put('/api/posts/nonexistent_id_for_update')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({
          title: 'Update Nonexistent',
          content: 'Content',
          section: 'general',
        });

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
    });

    /**
     * 测试目的：验证未认证用户无法更新文章
     * 预期结果：返回 401 认证错误
     */
    it('未认证用户尝试更新应该返回 401 错误', async () => {
      const post = await createCurrentUserPost({
        title: 'Unauth Update Test',
        status: 'published',
      });

      const response = await request(app)
        .put(`/api/posts/${post.id}`)
        .send({
          title: 'Unauthorized Update',
          content: 'Hacked',
          section: 'general',
        });

      expect(response.status).toBe(401);
    });
  });

  // ============================================================================
  // 删除文章接口测试（需要认证）
  // ============================================================================
  describe('DELETE /api/posts/:id - 删除文章', () => {
    /**
     * 测试目的：验证作者能否成功删除自己创建的文章
     * 预期结果：返回成功响应且数据库中的记录被删除
     */
    it('作者应该能够成功删除自己的文章', async () => {
      // 创建属于当前用户的文章
      const post = await createTestPost({
        title: 'To Be Deleted By Author',
        authorUid: testUser.user.uid,
        status: 'published',
      });

      // 验证文章存在
      let dbPost = await prisma.post.findUnique({ where: { id: post.id } });
      expect(dbPost).not.toBeNull();

      // 执行删除
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const response = await agent
        .delete(`/api/posts/${post.id}`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({ reason: '作者自行删除' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);

      // 验证文章已被软删除
      dbPost = await prisma.post.findUnique({ where: { id: post.id } });
      expect(dbPost?.deletedAt).not.toBeNull();
      expect(dbPost?.deletedBy).toBe(testUser.user.uid);

      const moderationLog = await prisma.moderationLog.findFirst({
        where: {
          targetType: 'post',
          targetId: post.id,
          action: 'delete',
        },
      });
      expect(moderationLog).not.toBeNull();
      expect(moderationLog?.operatorUid).toBe(testUser.user.uid);
      expect(moderationLog?.note).toBe('作者自行删除');
    });

    /**
     * 测试目的：验证非作者无法删除他人的文章
     * 预期结果：返回 403 权限错误
     */
    it('非作者尝试删除他人文章应该返回 403 错误', async () => {
      // 创建属于其他用户的文章
      const otherUser = await createTestUser();
      const post = await createTestPost({
        title: "Other User's Post",
        authorUid: otherUser.user.uid,
        status: 'published',
      });

      // 当前用户尝试删除
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const response = await agent
        .delete(`/api/posts/${post.id}`)
        .set('X-XSRF-TOKEN', xsrfToken);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error');
    });

    /**
     * 测试目的：验证管理员可以删除任何文章
     * 预期结果：管理员应能成功删除其他人的文章
     */
    it('管理员应该能够删除任意文章', async () => {
      // 创建普通用户的文章
      const post = await createTestPost({
        title: 'To Be Deleted By Admin',
        authorUid: testUser.user.uid,
        status: 'published',
      });

      // 管理员删除
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        adminUser.user.email,
        adminUser.plainPassword,
      );
      const response = await agent
        .delete(`/api/posts/${post.id}`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({ reason: '管理员删除违规内容' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);

      // 验证文章已被软删除
      const dbPost = await prisma.post.findUnique({ where: { id: post.id } });
      expect(dbPost?.deletedAt).not.toBeNull();
      expect(dbPost?.deletedBy).toBe(adminUser.user.uid);

      const notification = await prisma.notification.findFirst({
        where: {
          userUid: testUser.user.uid,
          type: 'review_result',
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(notification).not.toBeNull();
      const payload = notification!.payload as Record<string, unknown>;
      expect(payload.action).toBe('deleted');
      expect(payload.approved).toBe(false);
      expect(payload.targetType).toBe('post');
      expect(payload.targetId).toBe(post.id);
      expect(payload.title).toBe(post.title);
      expect(payload.note).toBe('管理员删除违规内容');
      expect(payload.operatorUid).toBe(adminUser.user.uid);
    });

    /**
     * 测试目的：验证删除不存在的文章
     * 预期结果：返回 404 错误
     */
    it('删除不存在的文章应该返回 404 错误', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const response = await agent
        .delete('/api/posts/nonexistent_id_for_delete')
        .set('X-XSRF-TOKEN', xsrfToken);

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
    });

    /**
     * 测试目的：验证未认证用户无法删除文章
     * 预期结果：返回 401 认证错误
     */
    it('未认证用户尝试删除应该返回 401 错误', async () => {
      const post = await createCurrentUserPost({
        title: 'Unauth Delete Test',
        status: 'published',
      });

      const response = await request(app).delete(`/api/posts/${post.id}`);

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/admin/posts/:id/restore - 恢复文章', () => {
    it('管理员恢复他人的文章后通知作者', async () => {
      const post = await createTestPost({
        title: 'Admin Restore Post Test',
        authorUid: testUser.user.uid,
        status: 'published',
      });
      await prisma.post.update({
        where: { id: post.id },
        data: { deletedAt: new Date(), deletedBy: adminUser.user.uid },
      });

      const { agent, xsrfToken } = await createAuthenticatedAgent(
        adminUser.user.email,
        adminUser.plainPassword,
      );
      const response = await agent
        .post(`/api/admin/posts/${post.id}/restore`)
        .set('X-XSRF-TOKEN', xsrfToken);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      const restoredPost = await prisma.post.findUnique({ where: { id: post.id } });
      expect(restoredPost?.deletedAt).toBeNull();
      expect(restoredPost?.deletedBy).toBeNull();

      const notification = await prisma.notification.findFirst({
        where: {
          userUid: testUser.user.uid,
          type: 'review_result',
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(notification).not.toBeNull();
      const payload = notification!.payload as Record<string, unknown>;
      expect(payload.action).toBe('restored');
      expect(payload.approved).toBe(true);
      expect(payload.targetType).toBe('post');
      expect(payload.targetId).toBe(post.id);
      expect(payload.title).toBe(post.title);
      expect(payload.status).toBe('published');
      expect(payload.linkable).toBe(true);
      expect(payload.operatorUid).toBe(adminUser.user.uid);
    });
  });

  // ============================================================================
  // 边界情况和安全性测试
  // ============================================================================
  describe('边界情况和安全性', () => {
    /**
     * 测试目的：验证超长内容的处理
     * 预期结果：系统应优雅地处理超长输入
     */
    it('应该优雅地处理超长内容', async () => {
      const longContent = 'x'.repeat(100000); // 100KB 内容

      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const response = await agent
        .post('/api/posts')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({
          title: `Long Content Test ${Date.now()}`,
          section: 'general',
          content: longContent,
        });

      // 不应该崩溃，可能成功或返回错误
      expect([201, 400, 413]).toContain(response.status);
      expect(response.status).not.toBe(500);
    });

    /**
     * 测试目的：验证 HTML/脚本注入防护
     * 预期结果：恶意脚本应被安全存储或清理
     */
    it('应该正确处理包含 HTML/脚本的内容', async () => {
      const maliciousContent =
        '<script>alert("xss")</script><img src=x onerror="alert(1)">';

      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const response = await agent
        .post('/api/posts')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({
          title: '<script>alert("xss")</script>',
          section: 'general',
          content: maliciousContent,
        });

      // 不应该导致服务器错误
      if (response.status === 201) {
        expect(response.body.post).toBeDefined();
      }
      expect(response.status).not.toBe(500);
    });

    /**
     * 测试目的：验证并发请求的处理
     * 预期结果：系统应能正确处理并发请求
     */
    it('应该能够处理并发请求', async () => {
      // 发送多个并发请求
      const requests = Array.from({ length: 5 }, (_, i) =>
        request(app)
          .get('/api/posts')
          .query({ limit: 10 }),
      );

      const responses = await Promise.all(requests);

      // 所有请求都应该成功
      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('posts');
      });
    });

    /**
     * 测试目的：验证特殊字符 ID 的处理
     * 预期结果：特殊字符 ID 应被安全处理
     */
    it('应该安全地处理特殊字符的 ID', async () => {
      const specialIds = [
        "../etc/passwd",
        "'; DROP TABLE posts; --",
        "<script>alert(1)</script>",
        "1 OR 1=1",
      ];

      for (const specialId of specialIds) {
        const response = await request(app).get(`/api/posts/${encodeURIComponent(specialId)}`);

        // 不应该导致服务器错误
        expect([200, 400, 404]).toContain(response.status);
        expect(response.status).not.toBe(500);
      }
    });

    /**
     * 测试目的：验证空请求体的处理
     * 预期结果：返回适当的错误响应
     */
    it('发送空请求体时应该返回 400 错误', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const response = await agent
        .post('/api/posts')
        .set('X-XSRF-TOKEN', xsrfToken)
        .set('Content-Type', 'application/json')
        .send('');

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/galleries/:id/comments - 图集评论通知', () => {
    it('顶层评论应通知图集作者，且通知 payload 带 galleryId 而非 postId', async () => {
      const gallery = await createTestGallery({ authorUid: testUser.user.uid, authorName: testUser.user.displayName });

      const { agent, xsrfToken } = await createAuthenticatedAgent(
        adminUser.user.email,
        adminUser.plainPassword,
      );
      const response = await agent
        .post(`/api/galleries/${gallery.id}/comments`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({ content: 'Gallery comment content for notification' });

      expect(response.status).toBe(201);

      const notifications = await prisma.notification.findMany({
        where: { userUid: testUser.user.uid, type: 'reply' },
      });
      expect(notifications).toHaveLength(1);

      const payload = notifications[0].payload as Record<string, unknown>;
      expect(payload.targetType).toBe('gallery');
      expect(payload.galleryId).toBe(gallery.id);
      expect(payload.postId).toBeUndefined();
      expect(payload.parentId).toBeNull();
      expect(payload.actorUid).toBe(adminUser.user.uid);
      expect(payload.commentId).toBe(response.body.comment.id);
    });

    it('回复评论应通知被回复者', async () => {
      const gallery = await createTestGallery({ authorUid: testUser.user.uid, authorName: testUser.user.displayName });

      const adminSession = await createAuthenticatedAgent(
        adminUser.user.email,
        adminUser.plainPassword,
      );
      const rootResponse = await adminSession.agent
        .post(`/api/galleries/${gallery.id}/comments`)
        .set('X-XSRF-TOKEN', adminSession.xsrfToken)
        .send({ content: 'Gallery comment content root' });
      expect(rootResponse.status).toBe(201);

      const ownerSession = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const replyResponse = await ownerSession.agent
        .post(`/api/galleries/${gallery.id}/comments`)
        .set('X-XSRF-TOKEN', ownerSession.xsrfToken)
        .send({
          content: 'Gallery comment content reply',
          parentId: rootResponse.body.comment.id,
        });
      expect(replyResponse.status).toBe(201);

      const adminNotifications = await prisma.notification.findMany({
        where: { userUid: adminUser.user.uid, type: 'reply' },
      });
      expect(adminNotifications).toHaveLength(1);

      const payload = adminNotifications[0].payload as Record<string, unknown>;
      expect(payload.targetType).toBe('gallery');
      expect(payload.galleryId).toBe(gallery.id);
      expect(payload.parentId).toBe(rootResponse.body.comment.id);
      expect(payload.actorUid).toBe(testUser.user.uid);
    });

    it('对自己的图集评论不应给自己发通知', async () => {
      const gallery = await createTestGallery({ authorUid: testUser.user.uid, authorName: testUser.user.displayName });

      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const response = await agent
        .post(`/api/galleries/${gallery.id}/comments`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({ content: 'Gallery comment content self' });

      expect(response.status).toBe(201);

      const notifications = await prisma.notification.findMany({
        where: { userUid: testUser.user.uid },
      });
      expect(notifications).toHaveLength(0);
    });
  });
});
