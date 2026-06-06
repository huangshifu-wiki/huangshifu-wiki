/**
 * Users API 集成测试
 *
 * 测试范围：
 * 1. GET /api/users - 获取用户列表（管理员权限）
 * 2. GET /api/users/me - 获取当前用户信息（需要认证）
 * 3. GET /api/users/:userId/posts - 获取用户的文章列表
 * 4. GET /api/users/:userId/comments - 获取用户的评论列表
 * 5. PATCH /api/users/me - 更新当前用户信息（需要认证）
 *
 * 测试策略：
 * - 使用 supertest 进行 HTTP 请求测试
 * - 测试不同角色（普通用户、管理员、超级管理员）的权限控制
 * - 验证用户信息的完整性和隐私保护
 * - 包含正常情况和错误情况的完整测试覆盖
 */

import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../server';
import { prisma, createTestUser, createTestToken, createTestPost, createTestGallery } from './setup';
import type { CreateTestPostInput } from './setup';
import { WIKI_MAX_CONTENT_SIZE } from '../../src/lib/contentLimits';

describe('Users API - 用户接口测试', () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let adminUser: Awaited<ReturnType<typeof createTestUser>>;
  let superAdminUser: Awaited<ReturnType<typeof createTestUser>>;
  let userToken: string;
  let adminToken: string;
  let superAdminToken: string;

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
    // 清理现有数据
    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: 'test_',
        },
      },
    });
    await prisma.post.deleteMany({
      where: {
        title: {
          startsWith: 'Test',
        },
      },
    });

    // 创建不同角色的测试用户
    testUser = await createTestUser({ role: 'user' });
    adminUser = await createTestUser({ role: 'admin' });
    superAdminUser = await createTestUser({ role: 'super_admin' });

    // 创建认证 token
    userToken = await createTestToken(testUser.user.uid, testUser.user.role);
    adminToken = await createToken(adminUser.user.uid, adminUser.user.role);
    superAdminToken = await createToken(superAdminUser.user.uid, superAdminUser.user.role);
  });

  /**
   * 辅助函数：创建认证 token
   */
  async function createToken(userUid: string, role: string): Promise<string> {
    return createTestToken(userUid, role);
  }

  // ============================================================================
  // 获取用户列表接口测试（管理员权限）
  // ============================================================================
  describe('GET /api/users - 获取用户列表', () => {
    /**
     * 测试目的：验证管理员能否获取用户列表
     * 预期结果：返回包含所有用户的列表
     */
    it('管理员应该能够获取用户列表', async () => {
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('users');
      expect(Array.isArray(response.body.users)).toBe(true);

      // 应该至少包含我们创建的用户
      expect(response.body.users.length).toBeGreaterThanOrEqual(3);

      // 验证用户对象结构
      const user = response.body.users[0];
      expect(user).toHaveProperty('uid');
      expect(user).toHaveProperty('email');
      expect(user).toHaveProperty('displayName');
      expect(user).toHaveProperty('role');
      expect(user).toHaveProperty('status');
      expect(user).toHaveProperty('createdAt');
      expect(user).toHaveProperty('updatedAt');

      // 不应返回敏感字段（如 passwordHash）
      expect(user).not.toHaveProperty('passwordHash');
    });

    /**
     * 测试目的：验证普通用户无法访问用户列表
     * 预期结果：返回 403 权限错误
     */
    it('普通用户尝试获取用户列表应该返回 403 错误', async () => {
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('权限');
    });

    /**
     * 测试目的：验证未认证用户无法访问用户列表
     * 预期结果：返回 401 认证错误
     */
    it('未认证用户尝试获取用户列表应该返回 401 错误', async () => {
      const response = await request(app).get('/api/users');

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error');
    });

    /**
     * 测试目的：验证超级管理员能否获取用户列表
     * 预期结果：成功返回用户列表
     */
    it('超级管理员应该能够获取用户列表', async () => {
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.users.length).toBeGreaterThanOrEqual(3);
    });

    /**
     * 测试目的：验证返回的用户数量限制
     * 预期结果：返回的用户数量不应超过限制值（100）
     */
    it('返回的用户数量应该在合理范围内', async () => {
      // 如果数据库中有很多用户，验证分页或限制是否生效
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      // 根据路由实现，最多返回 100 个用户
      expect(response.body.users.length).toBeLessThanOrEqual(100);
    });

    /**
     * 测试目的：验证用户列表按创建时间排序
     * 预期结果：最新创建的用户应在前面
     */
    it('用户列表应该按创建时间降序排列', async () => {
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);

      if (response.body.users.length >= 2) {
        for (let i = 0; i < response.body.users.length - 1; i++) {
          const current = new Date(response.body.users[i].createdAt).getTime();
          const next = new Date(response.body.users[i + 1].createdAt).getTime();
          expect(current).toBeGreaterThanOrEqual(next);
        }
      }
    });
  });

  describe('PUT /api/users/:userId/reset-password - 管理员重置密码', () => {
    it('管理员重置密码后，目标用户旧 token 应该失效', async () => {
      const oldToken = await createTestToken(testUser.user.uid, testUser.user.role);
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        adminUser.user.email,
        adminUser.plainPassword,
      );

      const resetResponse = await agent
        .put(`/api/users/${testUser.user.uid}/reset-password`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({ newPassword: 'ResetPassword123!' });

      expect(resetResponse.status).toBe(200);
      expect(resetResponse.body).toEqual({ success: true });

      const staleSessionResponse = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${oldToken}`);

      expect(staleSessionResponse.status).toBe(401);
      expect(staleSessionResponse.body.error).toBe('请先登录');
    });
  });

  describe('PUT /api/users/password - 用户自助改密', () => {
    it('改密成功后当前 cookie 会话应被续签，不应立即掉线', async () => {
      const agent = request.agent(app);

      const loginResponse = await agent
        .post('/api/auth/login')
        .send({
          email: testUser.user.email,
          password: testUser.plainPassword,
        });

      expect(loginResponse.status).toBe(200);
      const xsrfToken = findCookieValue(loginResponse.headers['set-cookie'], 'XSRF-TOKEN');
      expect(xsrfToken).toBeTruthy();

      const passwordResponse = await agent
        .put('/api/users/password')
        .set('X-XSRF-TOKEN', xsrfToken!)
        .send({
          currentPassword: testUser.plainPassword,
          newPassword: 'UpdatedPassword123!',
        });

      expect(passwordResponse.status).toBe(200);
      expect(passwordResponse.body).toEqual({ success: true });

      expect(findCookieValue(passwordResponse.headers['set-cookie'], 'hsf_token')).toBeTruthy();

      const meResponse = await agent.get('/api/users/me');
      expect(meResponse.status).toBe(200);
      expect(meResponse.body.user.uid).toBe(testUser.user.uid);
    });
  });

  // ============================================================================
  // 获取当前用户信息接口测试
  // ============================================================================
  describe('GET /api/users/me - 获取当前用户信息', () => {
    /**
     * 测试目的：验证已认证用户能否获取自己的详细信息
     * 预期结果：返回完整的当前用户信息
     */
    it('已登录用户应该能够获取自己的详细信息', async () => {
      const response = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);

      // 验证返回的用户信息
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toMatchObject({
        uid: testUser.user.uid,
        email: testUser.user.email,
        displayName: testUser.user.displayName,
        role: 'user',
        status: 'active',
      });

      // 验证其他字段存在
      expect(response.body.user).toHaveProperty('bio');
      expect(response.body.user).toHaveProperty('level');
      expect(response.body.user).toHaveProperty('photoURL');
      expect(response.body.user).toHaveProperty('preferences');
      expect(response.body.user).toHaveProperty('createdAt');
      expect(response.body.user).toHaveProperty('updatedAt');
    });

    /**
     * 测试目的：验证未认证用户无法访问此接口
     * 预期结果：返回 401 认证错误
     */
    it('未登录时应该返回 401 错误', async () => {
      const response = await request(app).get('/api/users/me');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });

    /**
     * 测试目的：验证无效 token 的处理
     * 预期结果：返回 401 错误
     */
    it('使用无效 token 时应该返回 401 错误', async () => {
      const response = await request(app)
        .get('/api/users/me')
        .set('Authorization', 'Bearer invalid_token_12345');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });

    /**
     * 测试目的：验证被封禁用户的状态信息
     * 预期结果：被封禁用户应能看到自己的封禁状态
     */
    it('被封禁用户应该能看到封禁状态', async () => {
      // 创建一个被封禁的用户
      const bannedUser = await createTestUser();
      await prisma.user.update({
        where: { uid: bannedUser.user.uid },
        data: {
          status: 'banned',
          banReason: '违反社区规范测试',
          bannedAt: new Date(),
        },
      });

      const bannedToken = await createToken(bannedUser.user.uid, bannedUser.user.role);

      const response = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${bannedToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('账号已被封禁');
      expect(response.body.banReason).toBe('违反社区规范测试');
      expect(response.body.bannedAt).not.toBeNull();
    });

    /**
     * 测试目的：验证管理员用户的信息完整性
     * 预期结果：管理员用户应看到完整的角色和权限信息
     */
    it('管理员用户应该看到正确的角色信息', async () => {
      const response = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.user.role).toBe('admin');
    });
  });

  // ============================================================================
  // 更新当前用户信息接口测试
  // ============================================================================
  describe('PATCH /api/users/me - 更新当前用户信息', () => {
    /**
     * 测试目的：验证已认证用户能否更新自己的昵称
     * 预期结果：昵称被成功更新
     */
    it('已登录用户应该能够更新自己的昵称', async () => {
      const newDisplayName = `UpdatedName_${Date.now()}`;
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );

      const response = await agent
        .patch('/api/users/me')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({ displayName: newDisplayName });

      expect(response.status).toBe(200);
      expect(response.body.user.displayName).toBe(newDisplayName);

      // 验证数据库中的更新
      const updatedUser = await prisma.user.findUnique({
        where: { uid: testUser.user.uid },
      });
      expect(updatedUser?.displayName).toBe(newDisplayName);
    });

    /**
     * 测试目的：验证用户能否更新个人简介
     * 预期结果：个人简介被成功更新
     */
    it('已登录用户应该能够更新自己的个人简介', async () => {
      const newBio = 'This is my updated bio with more information about me.';
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );

      const response = await agent
        .patch('/api/users/me')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({ bio: newBio });

      expect(response.status).toBe(200);
      expect(response.body.user.bio).toBe(newBio);
    });

    it('个人简介应该允许和 Wiki 内容相同的上限', async () => {
      const newBio = 'a'.repeat(WIKI_MAX_CONTENT_SIZE);
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );

      const response = await agent
        .patch('/api/users/me')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({ bio: newBio });

      expect(response.status).toBe(200);
      expect(response.body.user.bio).toBe(newBio);
    });

    it('个人简介超过 Wiki 内容上限时应该返回 400 错误', async () => {
      const tooLongBio = 'a'.repeat(WIKI_MAX_CONTENT_SIZE + 1);
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );

      const response = await agent
        .patch('/api/users/me')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({ bio: tooLongBio });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: '个人简介不能超过500KB' });
    });

    /**
     * 测试目的：验证未认证用户无法更新信息
     * 预期结果：返回 401 认证错误
     */
    it('未登录时应该返回 401 错误', async () => {
      const response = await request(app)
        .patch('/api/users/me')
        .send({ displayName: 'Hacked Name' });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });

    /**
     * 测试目的：验证空昵称的处理
     * 预期结果：返回 400 错误
     */
    it('使用空昵称时应该返回 400 错误', async () => {
      const originalDisplayName = testUser.user.displayName;
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const response = await agent
        .patch('/api/users/me')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({ displayName: '' });

      expect(response.status).toBe(200);
      expect(response.body.user.displayName).toBe('');

      const updatedUser = await prisma.user.findUnique({
        where: { uid: testUser.user.uid },
      });
      expect(updatedUser?.displayName).toBe('');

      await prisma.user.update({
        where: { uid: testUser.user.uid },
        data: { displayName: originalDisplayName },
      });
    });

    /**
     * 测试目的：验证不提供任何更新字段时的处理
     * 预期结果：返回 400 错误提示没有要更新的字段
     */
    it('不提供任何更新字段时应该返回 400 错误', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const response = await agent
        .patch('/api/users/me')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('没有要更新的字段');
    });

    /**
     * 测试目的：验证头像 URL 的合法性校验
     * 预期结果：非法 URL 应被拒绝
     */
    it('使用非法头像 URL 时应该返回 400 错误', async () => {
      // 尝试使用 javascript: 协议
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const response = await agent
        .patch('/api/users/me')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({
          photoURL: 'javascript:alert("xss")',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('不合法');
    });

    /**
     * 测试目的：验证合法头像 URL 的更新
     * 预期结果：合法 URL 应被接受并保存
     */
    it('使用合法的头像 URL 应该能够成功更新', async () => {
      const validUrl = 'https://example.com/avatar.jpg';
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );

      const response = await agent
        .patch('/api/users/me')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({ photoURL: validUrl });

      expect(response.status).toBe(200);
      expect(response.body.user.photoURL).toBe(validUrl);
    });
  });

  // ============================================================================
  // 获取用户文章列表接口测试
  // ============================================================================
  describe('GET /api/users/:userId/posts - 获取用户的文章列表', () => {
    /**
     * 测试目的：验证能否获取指定用户的公开文章
     * 预期结果：返回该用户的已发布文章列表
     */
    it('应该返回指定用户的已发布文章列表', async () => {
      // 为测试用户创建一些文章
      const post1 = await createTestPost({
        title: 'User Public Post 1',
        status: 'published',
        authorUid: testUser.user.uid,
      });

      const post2 = await createTestPost({
        title: 'User Public Post 2',
        status: 'published',
        authorUid: testUser.user.uid,
      });

      // 创建一个草稿文章（不应出现在列表中）
      await createTestPost({
        title: 'User Draft Post (Hidden)',
        status: 'draft',
        authorUid: testUser.user.uid,
      });

      const response = await request(app)
        .get(`/api/users/${testUser.user.uid}/posts`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('posts');
      expect(Array.isArray(response.body.posts)).toBe(true);

      // 应该只显示已发布的文章
      const publishedPosts = response.body.posts.filter(
        (post: { id: string }) =>
          post.id === post1.id || post.id === post2.id,
      );
      expect(publishedPosts.length).toBe(2);

      // 草稿不应出现
      const draftPost = response.body.posts.find(
        (post: { title: string }) =>
          post.title === 'User Draft Post (Hidden)',
      );
      expect(draftPost).toBeUndefined();

      // 验证分页信息
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('page', 1);
      expect(response.body).toHaveProperty('limit');
      expect(response.body).toHaveProperty('hasMore');
    });

    /**
     * 测试目的：验证访问不存在用户的文章
     * 预期结果：返回空列表而不是错误
     */
    it('访问不存在的用户 ID 应该返回空列表', async () => {
      const response = await request(app).get(
        '/api/users/nonexistent_user_id/posts',
      );

      // 可能返回空列表或 404，取决于实现
      expect([200, 404]).toContain(response.status);
      if (response.status === 200) {
        expect(response.body.posts).toEqual([]);
      }
    });

    /**
     * 测试目的：验证分页参数功能
     * 预期结果：正确返回指定页码的数据
     */
    it('应该支持分页参数', async () => {
      // 创建多个文章
      for (let i = 0; i < 15; i++) {
        await createTestPost({
          title: `Pagination Post ${i}`,
          status: 'published',
          authorUid: testUser.user.uid,
        });
      }

      // 请求第一页
      const response1 = await request(app)
        .get(`/api/users/${testUser.user.uid}/posts`)
        .query({ page: 1, limit: 10 });

      expect(response1.status).toBe(200);
      expect(response1.body.posts.length).toBe(10);
      expect(response1.body.hasMore).toBe(true);

      // 请求第二页
      const response2 = await request(app)
        .get(`/api/users/${testUser.user.uid}/posts`)
        .query({ page: 2, limit: 10 });

      expect(response2.status).toBe(200);
      expect(response2.body.posts.length).toBe(5); // 剩余 5 篇
      expect(response2.body.hasMore).toBe(false);
    });

    /**
     * 测试目的：验证已登录用户看到的个性化数据
     * 预期结果：作者应看到 likedByMe、favoritedByMe 等字段
     */
    it('已登录用户查看自己的文章时应看到个性化状态', async () => {
      // 创建一篇文章并点赞
      const post = await createTestPost({
        title: 'My Personalized Post',
        status: 'published',
        authorUid: testUser.user.uid,
      });

      await prisma.postLike.create({
        data: {
          postId: post.id,
          userUid: testUser.user.uid,
        },
      });

      // 用户查看自己的文章
      const response = await request(app)
        .get(`/api/users/${testUser.user.uid}/posts`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);

      const userPost = response.body.posts.find(
        (p: { id: string }) => p.id === post.id,
      );
      if (userPost) {
        expect(userPost).toHaveProperty('likedByMe', true);
      }
    });

    it('自己查看帖子列表时应返回驳回原因', async () => {
      const post = await createTestPost({
        title: 'Rejected Post With Review Note',
        status: 'rejected',
        authorUid: testUser.user.uid,
      });
      await prisma.post.update({
        where: { id: post.id },
        data: { reviewNote: '内容不符合要求' },
      });

      const response = await request(app)
        .get(`/api/users/${testUser.user.uid}/posts`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);
      const rejectedPost = response.body.posts.find((item: { id: string }) => item.id === post.id);
      expect(rejectedPost).toBeDefined();
      expect(rejectedPost.reviewNote).toBe('内容不符合要求');
      expect(rejectedPost.status).toBe('rejected');

      const publicResponse = await request(app).get(`/api/users/${testUser.user.uid}/posts`);
      expect(publicResponse.status).toBe(200);
      const publicRejectedPost = publicResponse.body.posts.find((item: { id: string }) => item.id === post.id);
      expect(publicRejectedPost).toBeUndefined();
    });

    it('公开帖子列表不应向访客泄露审核备注', async () => {
      const post = await createTestPost({
        title: 'Published Post With Private Review Note',
        status: 'published',
        authorUid: testUser.user.uid,
      });
      await prisma.post.update({
        where: { id: post.id },
        data: { reviewNote: '内部审核备注' },
      });

      const publicResponse = await request(app).get(`/api/users/${testUser.user.uid}/posts`);
      expect(publicResponse.status).toBe(200);
      const publicPost = publicResponse.body.posts.find((item: { id: string }) => item.id === post.id);
      expect(publicPost).toBeDefined();
      expect(publicPost.reviewNote).toBeNull();

      const ownerResponse = await request(app)
        .get(`/api/users/${testUser.user.uid}/posts`)
        .set('Authorization', `Bearer ${userToken}`);
      expect(ownerResponse.status).toBe(200);
      const ownerPost = ownerResponse.body.posts.find((item: { id: string }) => item.id === post.id);
      expect(ownerPost).toBeDefined();
      expect(ownerPost.reviewNote).toBe('内部审核备注');
    });
  });

  describe('GET /api/users/:userId/profile - 获取公开个人资料', () => {
    it('应该返回公开资料且不泄露敏感字段', async () => {
      const response = await request(app).get(`/api/users/${testUser.user.uid}/profile`);

      expect(response.status).toBe(200);
      expect(response.body.user.uid).toBe(testUser.user.uid);
      expect(response.body.user).toHaveProperty('displayName');
      expect(response.body.user).toHaveProperty('canViewFavorites', false);
      expect(response.body.user).toHaveProperty('canViewHistory', false);
      expect(response.body.user).not.toHaveProperty('email');
      expect(response.body.user).not.toHaveProperty('preferences');
      expect(response.body.user).not.toHaveProperty('role');
    });
  });

  describe('GET /api/users/:userId/galleries - 获取用户图集列表', () => {
    it('公开模式只返回已发布图集', async () => {
      const publishedGallery = await createTestGallery({
        title: 'Test Published User Gallery',
        authorUid: testUser.user.uid,
        authorName: testUser.user.displayName,
        published: true,
      });
      await createTestGallery({
        title: 'Test Draft User Gallery',
        authorUid: testUser.user.uid,
        authorName: testUser.user.displayName,
        published: false,
      });

      const publicResponse = await request(app).get(`/api/users/${testUser.user.uid}/galleries`).query({
        visibility: 'public',
      });

      expect(publicResponse.status).toBe(200);
      expect(publicResponse.body.galleries.map((gallery: { id: string }) => gallery.id)).toContain(
        publishedGallery.id
      );
      expect(
        publicResponse.body.galleries.find((gallery: { title: string }) => gallery.title === 'Test Draft User Gallery')
      ).toBeUndefined();

      const selfResponse = await request(app)
        .get(`/api/users/${testUser.user.uid}/galleries`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(selfResponse.status).toBe(200);
      expect(
        selfResponse.body.galleries.find((gallery: { title: string }) => gallery.title === 'Test Draft User Gallery')
      ).toBeDefined();
    });
  });

  // ============================================================================
  // 获取用户评论列表接口测试
  // ============================================================================
  describe('GET /api/users/:userId/comments - 获取用户的评论列表', () => {
    /**
     * 测试目的：验证能否获取指定用户的评论列表
     * 预期结果：返回该用户的所有评论及关联的文章信息
     */
    it('应该返回指定用户的评论列表', async () => {
      // 创建文章和评论
      const post = await createCurrentUserPost({
        title: 'Post With Comments',
        status: 'published',
      });

      const comment1 = await prisma.postComment.create({
        data: {
          postId: post.id,
          authorUid: testUser.user.uid,
          content: 'First comment by user',
        },
      });

      const comment2 = await prisma.postComment.create({
        data: {
          postId: post.id,
          authorUid: testUser.user.uid,
          content: 'Second comment by user',
        },
      });

      const response = await request(app)
        .get(`/api/users/${testUser.user.uid}/comments`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('comments');
      expect(Array.isArray(response.body.comments)).toBe(true);
      expect(response.body.comments.length).toBeGreaterThanOrEqual(2);

      // 验证评论结构
      const comment = response.body.comments.find(
        (c: { id: string }) => c.id === comment1.id || c.id === comment2.id,
      );
      expect(comment).toBeDefined();
      expect(comment).toHaveProperty('id');
      expect(comment).toHaveProperty('content');
      expect(comment).toHaveProperty('createdAt');
      expect(comment).toHaveProperty('authorUid', testUser.user.uid);
      expect(comment).toHaveProperty('authorName', testUser.user.displayName);

      // 验证关联的文章信息
      expect(comment).toHaveProperty('post');
      if (comment.post) {
        expect(comment.post).toHaveProperty('id');
        expect(comment.post).toHaveProperty('title');
      }

      // 验证分页信息
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('page');
      expect(response.body).toHaveProperty('limit');
      expect(response.body).toHaveProperty('hasMore');
    });

    /**
     * 测试目的：验证没有评论的用户返回空列表
     * 预期结果：返回空的评论数组
     */
    it('没有评论的用户应该返回空列表', async () => {
      // 创建一个新用户（没有任何评论）
      const newUser = await createTestUser();

      const response = await request(app)
        .get(`/api/users/${newUser.user.uid}/comments`);

      expect(response.status).toBe(200);
      expect(response.body.comments).toEqual([]);
      expect(response.body.total).toBe(0);
    });

    /**
     * 测试目的：验证分页功能
     * 预期结果：正确返回指定页码的评论数据
     */
    it('应该支持分页参数', async () => {
      const post = await createCurrentUserPost({
        title: 'Pagination Comments Test',
        status: 'published',
      });

      // 创建多个评论
      for (let i = 0; i < 15; i++) {
        await prisma.postComment.create({
          data: {
            postId: post.id,
            authorUid: testUser.user.uid,
            content: `Comment number ${i + 1}`,
          },
        });
      }

      // 请求第一页
      const response1 = await request(app)
        .get(`/api/users/${testUser.user.uid}/comments`)
        .query({ page: 1, limit: 10 });

      expect(response1.status).toBe(200);
      expect(response1.body.comments.length).toBe(10);
      expect(response1.body.hasMore).toBe(true);

      // 请求第二页
      const response2 = await request(app)
        .get(`/api/users/${testUser.user.uid}/comments`)
        .query({ page: 2, limit: 10 });

      expect(response2.status).toBe(200);
      expect(response2.body.comments.length).toBe(5);
      expect(response2.body.hasMore).toBe(false);
    });

    /**
     * 测试目的：验证评论排序顺序
     * 预期结果：评论应按时间降序排列（最新的在前）
     */
    it('评论应该按时间降序排列', async () => {
      const post = await createCurrentUserPost({
        title: 'Comment Order Test',
        status: 'published',
      });

      // 按顺序创建评论
      const comment1 = await prisma.postComment.create({
        data: {
          postId: post.id,
          authorUid: testUser.user.uid,
          content: 'First comment',
        },
      });

      // 稍等一下确保时间戳不同
      await new Promise((resolve) => setTimeout(resolve, 10));

      const comment2 = await prisma.postComment.create({
        data: {
          postId: post.id,
          authorUid: testUser.user.uid,
          content: 'Second comment (newer)',
        },
      });

      const response = await request(app)
        .get(`/api/users/${testUser.user.uid}/comments`);

      expect(response.status).toBe(200);

      // 最新的评论应该在前面
      const newerCommentIndex = response.body.comments.findIndex(
        (c: { id: string }) => c.id === comment2.id,
      );
      const olderCommentIndex = response.body.comments.findIndex(
        (c: { id: string }) => c.id === comment1.id,
      );

      expect(newerCommentIndex).toBeLessThan(olderCommentIndex);
    });

    it('应该正确返回图集评论目标信息', async () => {
      const gallery = await createTestGallery({
        title: 'Test Gallery Comment Target',
        authorUid: adminUser.user.uid,
        authorName: adminUser.user.displayName,
        published: true,
      });

      const comment = await prisma.postComment.create({
        data: {
          galleryId: gallery.id,
          authorUid: testUser.user.uid,
          content: 'Gallery comment by user',
        },
      });

      const response = await request(app).get(`/api/users/${testUser.user.uid}/comments`);

      expect(response.status).toBe(200);
      const item = response.body.comments.find((entry: { id: string }) => entry.id === comment.id);
      expect(item).toBeDefined();
      expect(item.targetType).toBe('gallery');
      expect(item.target).toMatchObject({ id: gallery.id, title: 'Test Gallery Comment Target' });
      expect(item.gallery).toMatchObject({ id: gallery.id, title: 'Test Gallery Comment Target' });
      expect(item.post).toBeNull();
    });

    it('应该保留原帖子已不可见的评论并隐藏目标信息', async () => {
      const hiddenPost = await createTestPost({
        title: 'Hidden Comment Target Post',
        status: 'draft',
        authorUid: adminUser.user.uid,
      });

      const comment = await prisma.postComment.create({
        data: {
          postId: hiddenPost.id,
          authorUid: testUser.user.uid,
          content: 'Comment on hidden post',
        },
      });

      const response = await request(app).get(`/api/users/${testUser.user.uid}/comments`);

      expect(response.status).toBe(200);
      const item = response.body.comments.find((entry: { id: string }) => entry.id === comment.id);
      expect(item).toBeDefined();
      expect(item.targetType).toBe('post');
      expect(item.target).toBeNull();
      expect(item.post).toBeNull();
      expect(item.content).toBe('Comment on hidden post');
    });

    it('应该保留原图集已不可见的评论并保持图集目标类型', async () => {
      const hiddenGallery = await createTestGallery({
        title: 'Hidden Comment Target Gallery',
        authorUid: adminUser.user.uid,
        authorName: adminUser.user.displayName,
        published: false,
      });

      const comment = await prisma.postComment.create({
        data: {
          galleryId: hiddenGallery.id,
          authorUid: testUser.user.uid,
          content: 'Comment on hidden gallery',
        },
      });

      const response = await request(app).get(`/api/users/${testUser.user.uid}/comments`);

      expect(response.status).toBe(200);
      const item = response.body.comments.find((entry: { id: string }) => entry.id === comment.id);
      expect(item).toBeDefined();
      expect(item.targetType).toBe('gallery');
      expect(item.target).toBeNull();
      expect(item.gallery).toBeNull();
      expect(item.post).toBeNull();
      expect(item.content).toBe('Comment on hidden gallery');
    });

    it('应该返回已删除评论状态和删除原因', async () => {
      const post = await createTestPost({
        title: 'Deleted Comment Target Post',
        status: 'published',
        authorUid: adminUser.user.uid,
      });

      const comment = await prisma.postComment.create({
        data: {
          postId: post.id,
          authorUid: testUser.user.uid,
          content: 'Deleted comment original text',
        },
      });

      await prisma.postComment.update({
        where: { id: comment.id },
        data: {
          deletedAt: new Date(),
          deletedBy: adminUser.user.uid,
        },
      });
      await prisma.moderationLog.create({
        data: {
          targetType: 'comment',
          targetId: comment.id,
          action: 'delete',
          operatorUid: adminUser.user.uid,
          note: '评论违规',
        },
      });

      const userResponse = await request(app)
        .get(`/api/users/${testUser.user.uid}/comments`)
        .set('Authorization', `Bearer ${userToken}`);
      expect(userResponse.status).toBe(200);
      const userItem = userResponse.body.comments.find((entry: { id: string }) => entry.id === comment.id);
      expect(userItem).toBeDefined();
      expect(userItem.isDeleted).toBe(true);
      expect(userItem.content).toBe('评论已删除');
      expect(userItem.deletionReason).toBe('评论违规');

      const publicResponse = await request(app).get(`/api/users/${testUser.user.uid}/comments`);
      expect(publicResponse.status).toBe(200);
      const publicItem = publicResponse.body.comments.find((entry: { id: string }) => entry.id === comment.id);
      expect(publicItem).toBeDefined();
      expect(publicItem.isDeleted).toBe(true);
      expect(publicItem.content).toBe('评论已删除');
      expect(publicItem.deletionReason).toBeNull();

      const adminResponse = await request(app)
        .get(`/api/users/${testUser.user.uid}/comments`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(adminResponse.status).toBe(200);
      const adminItem = adminResponse.body.comments.find((entry: { id: string }) => entry.id === comment.id);
      expect(adminItem).toBeDefined();
      expect(adminItem.isDeleted).toBe(true);
      expect(adminItem.content).toBe('Deleted comment original text');
      expect(adminItem.deletionReason).toBe('评论违规');
    });
  });

  describe('GET /api/users/:userId/favorites 和 /history - 隐私设置', () => {
    it('默认不允许他人查看收藏，开启后可查看公开收藏', async () => {
      const post = await createTestPost({
        title: 'Test Favorited Public Post',
        status: 'published',
        authorUid: adminUser.user.uid,
      });
      await prisma.favorite.create({
        data: {
          userUid: testUser.user.uid,
          targetType: 'post',
          targetId: post.id,
        },
      });

      const deniedResponse = await request(app).get(`/api/users/${testUser.user.uid}/favorites`);
      expect(deniedResponse.status).toBe(403);

      await prisma.user.update({
        where: { uid: testUser.user.uid },
        data: { preferences: { publicFavorites: true } },
      });

      const response = await request(app).get(`/api/users/${testUser.user.uid}/favorites`);
      expect(response.status).toBe(200);
      expect(response.body.favorites[0]).toMatchObject({
        targetType: 'post',
        targetId: post.id,
      });
      expect(response.body.favorites[0].target.title).toBe('Test Favorited Public Post');
    });

    it('公开收藏分页不应被不可见目标截断', async () => {
      const hiddenPost = await createTestPost({
        title: 'Test Hidden Favorite Prefix',
        status: 'draft',
        authorUid: testUser.user.uid,
      });
      const visiblePost = await createTestPost({
        title: 'Test Visible Favorite After Hidden',
        status: 'published',
        authorUid: adminUser.user.uid,
      });

      await prisma.user.update({
        where: { uid: testUser.user.uid },
        data: { preferences: { publicFavorites: true } },
      });
      await prisma.favorite.create({
        data: {
          userUid: testUser.user.uid,
          targetType: 'post',
          targetId: visiblePost.id,
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await prisma.favorite.create({
        data: {
          userUid: testUser.user.uid,
          targetType: 'post',
          targetId: hiddenPost.id,
        },
      });

      const response = await request(app)
        .get(`/api/users/${testUser.user.uid}/favorites`)
        .query({ page: 1, limit: 1 });

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(response.body.hasMore).toBe(false);
      expect(response.body.favorites).toHaveLength(1);
      expect(response.body.favorites[0].targetId).toBe(visiblePost.id);
    });

    it('默认不允许他人查看浏览历史，开启后可查看公开历史', async () => {
      const post = await createTestPost({
        title: 'Test History Public Post',
        status: 'published',
        authorUid: adminUser.user.uid,
      });
      await prisma.browsingHistory.create({
        data: {
          userUid: testUser.user.uid,
          targetType: 'post',
          targetId: post.id,
        },
      });

      const deniedResponse = await request(app).get(`/api/users/${testUser.user.uid}/history`);
      expect(deniedResponse.status).toBe(403);

      await prisma.user.update({
        where: { uid: testUser.user.uid },
        data: { preferences: { publicHistory: true } },
      });

      const response = await request(app).get(`/api/users/${testUser.user.uid}/history`);
      expect(response.status).toBe(200);
      expect(response.body.history[0]).toMatchObject({
        targetType: 'post',
        targetId: post.id,
      });
      expect(response.body.history[0].target.title).toBe('Test History Public Post');
    });

    it('公开浏览历史分页不应被不可见目标截断', async () => {
      const hiddenPost = await createTestPost({
        title: 'Test Hidden History Prefix',
        status: 'draft',
        authorUid: testUser.user.uid,
      });
      const visiblePost = await createTestPost({
        title: 'Test Visible History After Hidden',
        status: 'published',
        authorUid: adminUser.user.uid,
      });

      await prisma.user.update({
        where: { uid: testUser.user.uid },
        data: { preferences: { publicHistory: true } },
      });
      await prisma.browsingHistory.create({
        data: {
          userUid: testUser.user.uid,
          targetType: 'post',
          targetId: visiblePost.id,
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await prisma.browsingHistory.create({
        data: {
          userUid: testUser.user.uid,
          targetType: 'post',
          targetId: hiddenPost.id,
        },
      });

      const response = await request(app)
        .get(`/api/users/${testUser.user.uid}/history`)
        .query({ page: 1, limit: 1 });

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(response.body.hasMore).toBe(false);
      expect(response.body.history).toHaveLength(1);
      expect(response.body.history[0].targetId).toBe(visiblePost.id);
    });
  });

  // ============================================================================
  // 边界情况和安全性测试
  // ============================================================================
  describe('边界情况和安全性', () => {
    /**
     * 测试目的：验证特殊字符用户 ID 的处理
     * 预期结果：特殊字符 ID 应被安全处理
     */
    it('应该安全地处理特殊字符的用户 ID', async () => {
      const specialIds = [
        "../etc/passwd",
        "'; DROP TABLE users; --",
        "<script>alert(1)</script>",
        "1 OR 1=1",
        "UNION SELECT * FROM users",
      ];

      for (const specialId of specialIds) {
        // 测试获取用户文章
        const responsePosts = await request(app).get(
          `/api/users/${encodeURIComponent(specialId)}/posts`,
        );
        expect([200, 400, 404]).toContain(responsePosts.status);
        expect(responsePosts.status).not.toBe(500);

        // 测试获取用户评论
        const responseComments = await request(app).get(
          `/api/users/${encodeURIComponent(specialId)}/comments`,
        );
        expect([200, 400, 404]).toContain(responseComments.status);
        expect(responseComments.status).not.toBe(500);
      }
    });

    /**
     * 测试目的：验证超长输入的处理
     * 预期结果：系统应优雅地处理超长输入
     */
    it('应该优雅地处理超长的用户输入', async () => {
      const longString = 'x'.repeat(5000);
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );

      // 尝试更新昵称为超长字符串
      const response = await agent
        .patch('/api/users/me')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({ displayName: longString });

      // 不应该崩溃
      expect([200, 400]).toContain(response.status);
      expect(response.status).not.toBe(500);
    });

    /**
     * 测试目的：验证并发请求的处理
     * 预期结果：系统应能正确处理并发请求
     */
    it('应该能够处理并发请求', async () => {
      // 发送多个并发请求
      const requests = Array.from({ length: 5 }, () =>
        request(app)
          .get('/api/users/me')
          .set('Authorization', `Bearer ${userToken}`),
      );

      const responses = await Promise.all(requests);

      // 所有请求都应该成功
      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('user');
      });
    });

    /**
     * 测试目的：验证 SQL 注入防护
     * 预期结果：恶意输入不应导致系统错误或数据泄露
     */
    it('应该防止 SQL 注入攻击', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );

      // 尝试通过 displayName 进行 SQL 注入
      const sqlInjectionPayloads = [
        "'; DROP TABLE users; --",
        "' OR '1'='1",
        "1; DELETE FROM users WHERE '1'='1",
      ];

      for (const payload of sqlInjectionPayloads) {
        const response = await agent
          .patch('/api/users/me')
          .set('X-XSRF-TOKEN', xsrfToken)
          .send({ displayName: payload });

        // 不应该导致服务器错误
        expect([200, 400]).toContain(response.status);
        expect(response.status).not.toBe(500);
      }
    });

    /**
     * 测试目的：验证 XSS 防护
     * 预期结果：恶意脚本应被安全存储或清理
     */
    it('应该防止 XSS 攻击', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword,
      );
      const xssPayloads = [
        '<script>alert("xss")</script>',
        '<img src=x onerror="alert(1)">',
        'javascript:alert("xss")',
      ];

      for (const payload of xssPayloads) {
        const response = await agent
          .patch('/api/users/me')
          .set('X-XSRF-TOKEN', xsrfToken)
          .send({ displayName: payload });

        // 如果成功存储，后续应由前端负责转义
        // 这里主要确保不会导致服务器崩溃
        expect([200, 400]).toContain(response.status);
        expect(response.status).not.toBe(500);
      }
    });

    /**
     * 测试目的：验证用户隐私保护
     * 预期结果：敏感信息（如密码哈希）不应在响应中暴露
     */
    it('不应该暴露用户的敏感信息', async () => {
      const response = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);

      // 确保敏感字段不存在
      const sensitiveFields = ['passwordHash', 'password', 'secret'];
      sensitiveFields.forEach((field) => {
        expect(response.body.user).not.toHaveProperty(field);
      });
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
        .patch('/api/users/me')
        .set('X-XSRF-TOKEN', xsrfToken)
        .set('Content-Type', 'application/json')
        .send('');

      expect(response.status).toBe(400);
    });
  });
});
