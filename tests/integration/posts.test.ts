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
import { prisma, createTestUser, createTestToken, createTestPost } from './setup';
import type { CreateTestPostInput } from './setup';

async function cleanupPostTestData() {
  await prisma.user.deleteMany({
    where: {
      email: {
        startsWith: 'test_',
      },
    },
  });

  // Defensive cleanup for legacy dirty test DBs that still contain orphaned rows
  // from older versions of this suite.
  await prisma.post.deleteMany({
    where: {
      OR: [
        { title: { startsWith: 'Test' } },
        { title: { startsWith: 'Pagination Test' } },
        { title: { startsWith: 'Sort Test' } },
        { title: { startsWith: 'New Test Post ' } },
        { title: { startsWith: 'Long Content Test ' } },
      ],
    },
  });
}

describe('Posts API - 文章接口测试', () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let adminUser: Awaited<ReturnType<typeof createTestUser>>;
  let userToken: string;
  let adminToken: string;

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

    // 创建测试用户
    testUser = await createTestUser({ role: 'user' });
    adminUser = await createTestUser({ role: 'admin' });

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
      const response = await request(app).get('/api/posts');

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

      const response = await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${userToken}`)
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
      // 缺少标题
      const response1 = await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          section: 'general',
          content: 'No title provided',
        });

      expect(response1.status).toBe(400);
      expect(response1.body.error).toContain('缺少必要字段');

      // 缺少内容
      const response2 = await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          title: 'No Content',
          section: 'general',
        });

      expect(response2.status).toBe(400);

      // 缺少版块
      const response3 = await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          title: 'No Section',
          content: 'Content without section',
        });

      expect(response3.status).toBe(400);
    });

    /**
     * 测试目的：验证标签的处理
     * 预期结果：标签应被正确存储为数组格式
     */
    it('应该正确处理文章标签', async () => {
      const response = await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${userToken}`)
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
      const response = await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${userToken}`)
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

      const response = await request(app)
        .put(`/api/posts/${post.id}`)
        .set('Authorization', `Bearer ${userToken}`)
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
      const response = await request(app)
        .put(`/api/posts/${post.id}`)
        .set('Authorization', `Bearer ${userToken}`)
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
      const response = await request(app)
        .put(`/api/posts/${post.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Admin Updated Title',
          content: 'Admin updated this content',
          section: 'general',
        });

      expect(response.status).toBe(200);
      expect(response.body.post.title).toBe('Admin Updated Title');
    });

    /**
     * 测试目的：验证更新不存在的文章
     * 预期结果：返回 404 错误
     */
    it('更新不存在的文章应该返回 404 错误', async () => {
      const response = await request(app)
        .put('/api/posts/nonexistent_id_for_update')
        .set('Authorization', `Bearer ${userToken}`)
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
      const response = await request(app)
        .delete(`/api/posts/${post.id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);

      // 验证文章已被删除
      dbPost = await prisma.post.findUnique({ where: { id: post.id } });
      expect(dbPost).toBeNull();
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
      const response = await request(app)
        .delete(`/api/posts/${post.id}`)
        .set('Authorization', `Bearer ${userToken}`);

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
      const response = await request(app)
        .delete(`/api/posts/${post.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);

      // 验证文章已被删除
      const dbPost = await prisma.post.findUnique({ where: { id: post.id } });
      expect(dbPost).toBeNull();
    });

    /**
     * 测试目的：验证删除不存在的文章
     * 预期结果：返回 404 错误
     */
    it('删除不存在的文章应该返回 404 错误', async () => {
      const response = await request(app)
        .delete('/api/posts/nonexistent_id_for_delete')
        .set('Authorization', `Bearer ${userToken}`);

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

      const response = await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${userToken}`)
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

      const response = await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${userToken}`)
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
      const response = await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${userToken}`)
        .set('Content-Type', 'application/json')
        .send('');

      expect(response.status).toBe(400);
    });
  });
});
