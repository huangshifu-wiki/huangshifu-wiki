/**
 * 认证 API 集成测试
 *
 * 测试范围：
 * 1. /api/auth/health - 健康检查端点
 * 2. /api/auth/me - 获取当前用户信息（认证和未认证状态）
 * 3. /api/auth/login - 用户登录功能
 * 4. /api/auth/register - 用户注册功能
 * 5. /api/auth/logout - 用户登出功能
 *
 * 测试策略：
 * - 使用 supertest 进行 HTTP 请求测试
 * - 使用实际数据库连接进行集成测试
 * - 包含正常流程和错误情况的测试用例
 */

import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../server';
import { prisma, createTestUser, createTestToken } from './setup';
import { AUTH_DISPLAY_NAME_MAX_LENGTH } from '../../src/server/schemas/auth.schema';
import { EmailVerificationPurpose, hashEmailVerificationToken } from '../../src/server/utils/email-verification';
import { getPasswordSaltRounds } from '../../src/server/utils/password';

const AUTH_TEST_EMAILS = [
  'login_test@example.com',
  'wrong_password@example.com',
  'nonexistent@example.com',
  'duplicate@example.com',
  'new_user@example.com',
  'short_pwd@example.com',
  'no_pwd@example.com',
  'mixedcase@example.com',
  'blank_name@example.com',
  'space_name@example.com',
  'display_name_conflict_owner@example.com',
  'display_name_conflict_new@example.com',
  'alice@example.org',
  'explicit_alice@example.org',
  'special@example.com',
  'test_stale_session@example.com',
  'verify_pending@example.com',
  'verify_success@example.com',
  'change_email_old@example.com',
  'change_email_new@example.com',
  'email_config_super@example.com',
  'email_config_admin@example.com',
  'mock-openid@wechat.local',
  'wechat_common_nick@wechat.local',
  'wechat_reserved_name@wechat.local',
];
const PASSWORD_SALT_ROUNDS = getPasswordSaltRounds();

async function cleanupAuthTestData() {
  await prisma.siteConfig.deleteMany({
    where: { key: 'email_verification' },
  });
  await prisma.user.deleteMany({
    where: {
      OR: [
        { email: { startsWith: 'test_' } },
        { email: { in: AUTH_TEST_EMAILS } },
      ],
    },
  });
}

function pickCookie(setCookie: string[] | string | undefined, name: string) {
  const cookieList = Array.isArray(setCookie)
    ? setCookie
    : setCookie
      ? [setCookie]
      : [];
  return cookieList.find((cookie) => cookie.startsWith(`${name}=`));
}

async function createEmailVerificationToken(input: {
  userUid: string;
  email: string;
  token: string;
  purpose?: EmailVerificationPurpose;
  expiresAt?: Date;
}) {
  return prisma.emailVerificationToken.create({
    data: {
      userUid: input.userUid,
      email: input.email.toLowerCase().trim(),
      tokenHash: hashEmailVerificationToken(input.token),
      purpose: input.purpose || EmailVerificationPurpose.register,
      expiresAt: input.expiresAt || new Date(Date.now() + 30 * 60 * 1000),
    },
  });
}

describe('Auth API - 认证接口测试', () => {
  /**
   * 每个测试前清理用户表，确保测试隔离性
   */
  beforeEach(async () => {
    await cleanupAuthTestData();
  });

  /**
   * 每个测试后不需要特别清理，因为 beforeEach 会处理
   */
  afterEach(async () => {
    await cleanupAuthTestData();
  });

  // ============================================================================
  // 健康检查端点测试
  // ============================================================================
  describe('GET /api/auth/health', () => {
    /**
     * 测试目的：验证健康检查端点是否正常工作
     * 预期结果：返回 200 状态码和包含 status: 'ok' 的响应体
     */
    it('应该返回健康状态 OK', async () => {
      const response = await request(app).get('/api/auth/health');

      // 验证状态码
      expect(response.status).toBe(200);

      // 验证响应体结构
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
      expect(typeof response.body.timestamp).toBe('string');

      // 验证时间戳格式（ISO 8601）
      const timestamp = new Date(response.body.timestamp);
      expect(timestamp.getTime()).not.toBeNaN();
    });

    /**
     * 测试目的：验证健康检查端点的响应时间
     * 预期结果：响应时间应该在合理范围内（< 100ms）
     */
    it('应该快速响应健康检查请求', async () => {
      const startTime = Date.now();

      const response = await request(app).get('/api/auth/health');

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      // 健康检查应该很快，通常 < 100ms
      expect(responseTime).toBeLessThan(100);
    });
  });

  // ============================================================================
  // 获取当前用户信息端点测试
  // ============================================================================
  describe('GET /api/auth/me', () => {
    /**
     * 测试目的：验证未认证用户访问 /me 端点的行为
     * 预期结果：返回 200 状态码，但 user 字段为 null
     */
    it('未登录时应该返回 user: null', async () => {
      const response = await request(app).get('/api/auth/me');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('user', null);
    });

    /**
     * 测试目的：验证已认证用户访问 /me 端点能否正确返回用户信息
     * 预期结果：返回包含完整用户信息的响应体
     */
    it('已登录时应该返回当前用户信息', async () => {
      // 创建测试用户
      const { user } = await createTestUser({
        displayName: 'TestUser_Me',
      });

      // 创建认证 token
      const token = await createTestToken(user.uid, user.role);

      // 发送带认证 token 的请求
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      // 验证状态码
      expect(response.status).toBe(200);

      // 验证用户信息存在
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).not.toBeNull();

      // 验证用户信息字段
      expect(response.body.user).toMatchObject({
        uid: user.uid,
        email: user.email,
        displayName: 'TestUser_Me',
        role: 'user',
        status: 'active',
      });

      // 验证额外字段
      expect(response.body.user).toHaveProperty('emailVerified', false);
      expect(response.body.user).toHaveProperty('isAnonymous', false);
      expect(response.body.user).toHaveProperty('providerData');
      expect(Array.isArray(response.body.user.providerData)).toBe(true);
    });

    /**
     * 测试目的：验证使用 Cookie 认证方式能否正确获取用户信息
     * 预期结果：通过 Cookie 认证能正确返回用户信息
     */
    it('应该支持通过 Cookie 认证获取用户信息', async () => {
      // 创建测试用户
      const { user } = await createTestUser();

      // 创建认证 token
      const token = await createTestToken(user.uid, user.role);

      // 发送带 Cookie 的请求
      const response = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [`hsf_token=${token}`]);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toMatchObject({
        uid: user.uid,
        email: user.email,
      });
    });

    /**
     * 测试目的：验证无效 token 的处理
     * 预期结果：无效 token 应该被视为未认证，返回 user: null
     */
    it('使用无效 token 时应该返回 user: null', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid_token_12345');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('user', null);
    });

    /**
     * 测试目的：验证过期 token 的处理
     * 预期结果：过期 token 应该被视为未认证
     */
    it('使用过期 token 时应该返回 user: null', async () => {
      const jwt = (await import('jsonwebtoken')).default;
      const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_replace_with_random_string';

      // 创建一个立即过期的 token
      const expiredToken = jwt.sign(
        { uid: 'non-existent-user', role: 'user' },
        JWT_SECRET,
        { expiresIn: '-1s' }, // 已过期
      );

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('user', null);
    });

    it('密码变更后旧 token 应该失效', async () => {
      const { user } = await createTestUser({
        email: 'test_stale_session@example.com',
        password: 'OriginalPassword123!',
      });
      const token = await createTestToken(user.uid, user.role);
      const bcrypt = (await import('bcryptjs')).default;
      const nextPasswordHash = await bcrypt.hash('UpdatedPassword123!', PASSWORD_SALT_ROUNDS);

      await prisma.user.update({
        where: { uid: user.uid },
        data: {
          passwordHash: nextPasswordHash,
        },
      });

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('user', null);
    });
  });

  // ============================================================================
  // 用户登录功能测试
  // ============================================================================
  describe('POST /api/auth/login', () => {
    /**
     * 测试目的：验证使用正确的凭据能否成功登录
     * 预期结果：返回 200 状态码、用户信息和认证 Cookie
     */
    it('使用正确的邮箱和密码应该成功登录', async () => {
      // 创建测试用户
      const { user, plainPassword } = await createTestUser({
        email: 'login_test@example.com',
        password: 'CorrectPassword123!',
        displayName: 'LoginTestUser',
      });

      // 发送登录请求
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'login_test@example.com',
          password: 'CorrectPassword123!',
        });

      // 验证状态码
      expect(response.status).toBe(200);

      // 验证返回的用户信息
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toMatchObject({
        uid: user.uid,
        email: 'login_test@example.com',
        displayName: 'LoginTestUser',
      });

      // 验证设置了认证 Cookie
      expect(response.headers['set-cookie']).toBeDefined();
      const cookies = Array.isArray(response.headers['set-cookie'])
        ? response.headers['set-cookie']
        : [response.headers['set-cookie']];
      const authCookie = cookies.find((cookie: string) =>
        cookie.startsWith('hsf_token='),
      );
      expect(authCookie).toBeDefined();
      expect(authCookie).toContain('HttpOnly');
    });

    it('邮箱未验证时应该允许登录', async () => {
      const { user } = await createTestUser({
        email: 'verify_pending@example.com',
        password: 'CorrectPassword123!',
      });
      await prisma.user.update({
        where: { uid: user.uid },
        data: { emailVerifiedAt: null },
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'verify_pending@example.com',
          password: 'CorrectPassword123!',
        });

      expect(response.status).toBe(200);
      expect(response.body.user.emailVerified).toBe(false);
      expect(pickCookie(response.headers['set-cookie'], 'hsf_token')).toBeTruthy();
    });

    /**
     * 测试目的：验证错误密码的处理
     * 预期结果：返回 401 状态码和错误信息
     */
    it('使用错误的密码应该返回 401 错误', async () => {
      // 创建测试用户
      await createTestUser({
        email: 'wrong_password@example.com',
        password: 'CorrectPassword123!',
      });

      // 使用错误密码尝试登录
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'wrong_password@example.com',
          password: 'WrongPassword456!',
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('邮箱或密码错误');
    });

    /**
     * 测试目的：验证不存在的邮箱的处理
     * 预期结果：返回 401 状态码（不泄露用户是否存在的信息）
     */
    it('使用不存在的邮箱应该返回 401 错误', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'SomePassword123!',
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('邮箱或密码错误');
    });

    /**
     * 测试目的：验证缺少必要字段时的处理
     * 预期结果：返回 400 状态码和明确的错误信息
     */
    it('缺少邮箱或密码时应该返回 400 错误', async () => {
      // 缺少密码
      const response1 = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
        });

      expect(response1.status).toBe(400);
      expect(response1.body).toHaveProperty('error');
      expect(response1.body.error).toBe('Validation failed');
      expect(response1.body.fields).toHaveProperty('password');

      // 缺少邮箱
      const response2 = await request(app)
        .post('/api/auth/login')
        .send({
          password: 'password123',
        });

      expect(response2.status).toBe(400);
      expect(response2.body).toHaveProperty('error');
      expect(response2.body.error).toBe('Validation failed');
      expect(response2.body.fields).toHaveProperty('email');

      // 完全为空
      const response3 = await request(app).post('/api/auth/login').send({});

      expect(response3.status).toBe(400);
      expect(response3.body).toHaveProperty('error');
      expect(response3.body.error).toBe('Validation failed');
    });

    /**
     * 测试目的：验证空请求体的处理
     * 预期结果：返回 400 状态码
     */
    it('发送空请求体时应该返回 400 错误', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('');

      expect(response.status).toBe(400);
    });
  });

  // ============================================================================
  // 用户注册功能测试
  // ============================================================================
  describe('POST /api/auth/register', () => {
    /**
     * 测试目的：验证使用有效信息能否成功注册新用户
     * 预期结果：返回 201 状态码、创建的用户信息和认证 Cookie
     */
    it('使用有效信息应该成功注册新用户', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'new_user@example.com',
          password: 'ValidPassword123!',
          displayName: 'NewUser',
        });

      // 验证状态码
      expect(response.status).toBe(201);

      // 验证返回的用户信息
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toMatchObject({
        email: 'new_user@example.com',
        displayName: 'NewUser',
        role: 'user',
        emailVerified: false,
      });
      expect(response.body.requiresEmailVerification).toBe(false);
      expect(response.body.verificationEmailSent).toBe(false);
      expect(pickCookie(response.headers['set-cookie'], 'hsf_token')).toBeUndefined();

      // 验证 UID 已生成
      expect(response.body.user.uid).toBeDefined();
      expect(typeof response.body.user.uid).toBe('string');

      // 验证用户确实被创建到数据库
      const dbUser = await prisma.user.findUnique({
        where: { email: 'new_user@example.com' },
      });
      expect(dbUser).not.toBeNull();
      expect(dbUser?.displayName).toBe('NewUser');
      expect(dbUser?.emailVerifiedAt).toBeNull();

      const tokenCount = await prisma.emailVerificationToken.count({
        where: {
          userUid: dbUser!.uid,
          email: 'new_user@example.com',
          purpose: EmailVerificationPurpose.register,
          usedAt: null,
        },
      });
      expect(tokenCount).toBe(0);
    });

    it('开启邮箱验证时注册会创建验证 token 但不强制验证', async () => {
      await prisma.siteConfig.create({
        data: {
          key: 'email_verification',
          value: {
            enabled: true,
            publicBaseUrl: 'https://example.com',
            tokenTtlMinutes: 30,
          },
        },
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'new_user@example.com',
          password: 'ValidPassword123!',
          displayName: 'NewUser',
        });

      expect(response.status).toBe(201);
      expect(response.body.requiresEmailVerification).toBe(false);
      expect(response.body.verificationEmailSent).toBe(true);

      const dbUser = await prisma.user.findUnique({
        where: { email: 'new_user@example.com' },
      });
      expect(dbUser?.emailVerifiedAt).toBeNull();

      const tokenCount = await prisma.emailVerificationToken.count({
        where: {
          userUid: dbUser!.uid,
          email: 'new_user@example.com',
          purpose: EmailVerificationPurpose.register,
          usedAt: null,
        },
      });
      expect(tokenCount).toBe(1);
    });

    it('重发验证邮件时应该跳过微信占位邮箱', async () => {
      await prisma.siteConfig.create({
        data: {
          key: 'email_verification',
          value: {
            enabled: true,
            publicBaseUrl: 'https://example.com',
            tokenTtlMinutes: 30,
          },
        },
      });
      const { user } = await createTestUser({
        email: 'mock-openid@wechat.local',
      });
      await prisma.user.update({
        where: { uid: user.uid },
        data: { emailVerifiedAt: null },
      });

      const response = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'mock-openid@wechat.local' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ success: true });

      const tokenCount = await prisma.emailVerificationToken.count({
        where: {
          userUid: user.uid,
          email: 'mock-openid@wechat.local',
          purpose: EmailVerificationPurpose.register,
          usedAt: null,
        },
      });
      expect(tokenCount).toBe(0);
    });

    /**
     * 测试目的：验证重复注册的处理
     * 预期结果：返回 409 冲突状态码
     */
    it('使用已存在的邮箱注册应该返回 409 冲突错误', async () => {
      // 先创建一个用户
      await createTestUser({
        email: 'duplicate@example.com',
      });

      // 尝试使用相同邮箱注册
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'duplicate@example.com',
          password: 'Password123!',
          displayName: 'AnotherUser',
        });

      expect(response.status).toBe(409);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('已注册');
    });

    /**
     * 测试目的：验证密码长度限制
     * 预期结果：短于 8 个字符的密码应该被拒绝
     */
    it('使用过短的密码应该返回 400 错误', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'short_pwd@example.com',
          password: 'short', // 少于 8 个字符
          displayName: 'ShortPwdUser',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.fields).toHaveProperty('password');
    });

    /**
     * 测试目的：验证缺少必填字段的注册请求
     * 预期结果：返回 400 状态码
     */
    it('缺少必填字段时应该返回 400 错误', async () => {
      // 缺少密码
      const response1 = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'no_pwd@example.com',
          displayName: 'NoPwdUser',
        });

      expect(response1.status).toBe(400);

      // 缺少邮箱
      const response2 = await request(app)
        .post('/api/auth/register')
        .send({
          password: 'ValidPassword123!',
          displayName: 'NoEmailUser',
        });

      expect(response2.status).toBe(400);
    });

    /**
     * 测试目的：验证邮箱自动小写化和昵称默认值
     * 预期结果：邮箱应转为小写，未提供昵称时应使用邮箱前缀
     */
    it('应该自动将邮箱转为小写并设置默认昵称', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'MixedCase@Example.COM',
          password: 'ValidPassword123!',
          // 不提供 displayName
        });

      expect(response.status).toBe(201);
      expect(response.body.user.email).toBe('mixedcase@example.com');
      expect(response.body.user.displayName).toBe('mixedcase'); // 默认使用邮箱前缀
    });

    it('displayName 只有空白字符时应该回退到邮箱前缀', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'blank_name@example.com',
          password: 'ValidPassword123!',
          displayName: '   ',
        });

      expect(response.status).toBe(201);
      expect(response.body.user.displayName).toBe('blank_name');
    });

    it('displayName 包含空白字符时应该返回 400 错误', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'space_name@example.com',
          password: 'ValidPassword123!',
          displayName: 'Space Name',
        });

      expect(response.status).toBe(400);
    });

    it('displayName 已存在时应该返回 409 错误', async () => {
      await createTestUser({
        email: 'display_name_conflict_owner@example.com',
        displayName: 'DisplayNameConflict',
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'display_name_conflict_new@example.com',
          password: 'ValidPassword123!',
          displayName: 'displaynameconflict',
        });

      expect(response.status).toBe(409);
    });

    it('未提供 displayName 且邮箱前缀已被使用时应该生成唯一备用昵称', async () => {
      await createTestUser({
        email: 'test_existing_alice@example.com',
        displayName: 'alice',
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'alice@example.org',
          password: 'ValidPassword123!',
        });

      expect(response.status).toBe(201);
      expect(response.body.user.displayName).toBe('alice_2');
    });

    it('显式提交已存在 displayName 时仍应该返回 409 错误', async () => {
      await createTestUser({
        email: 'test_explicit_alice_owner@example.com',
        displayName: 'explicit_alice',
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'explicit_alice@example.org',
          password: 'ValidPassword123!',
          displayName: 'Explicit_Alice',
        });

      expect(response.status).toBe(409);
    });

    it('长邮箱前缀备用昵称冲突时生成的名称不应该超过长度上限', async () => {
      const longPrefix = `test_${'a'.repeat(AUTH_DISPLAY_NAME_MAX_LENGTH - 5)}`;
      await createTestUser({
        email: 'test_long_display_name_owner@example.com',
        displayName: longPrefix,
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: `${longPrefix}@example.org`,
          password: 'ValidPassword123!',
        });

      expect(response.status).toBe(201);
      expect(response.body.user.displayName).toBe(`${longPrefix.slice(0, AUTH_DISPLAY_NAME_MAX_LENGTH - 2)}_2`);
      expect(response.body.user.displayName).toHaveLength(AUTH_DISPLAY_NAME_MAX_LENGTH);
    });

    it('邮箱前缀超过 50 个字符时应该截断默认昵称', async () => {
      const longPrefix = `a${Date.now()}${'a'.repeat(AUTH_DISPLAY_NAME_MAX_LENGTH + 10)}`
      const expectedDisplayName = longPrefix.slice(0, AUTH_DISPLAY_NAME_MAX_LENGTH)
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: `${longPrefix}@example.com`,
          password: 'ValidPassword123!',
        });

      expect(response.status).toBe(201);
      expect(response.body.user.displayName).toBe(expectedDisplayName);
    });
  });

  describe('POST /api/auth/verify-email', () => {
    it('验证注册邮箱后应该允许登录', async () => {
      const { user, plainPassword } = await createTestUser({
        email: 'verify_success@example.com',
        password: 'CorrectPassword123!',
      });
      await prisma.user.update({
        where: { uid: user.uid },
        data: { emailVerifiedAt: null },
      });
      await createEmailVerificationToken({
        userUid: user.uid,
        email: user.email,
        token: 'valid-register-token',
      });

      const verifyResponse = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: 'valid-register-token' });

      expect(verifyResponse.status).toBe(200);
      expect(verifyResponse.body).toEqual({
        success: true,
        purpose: 'register',
      });

      const repeatedVerifyResponse = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: 'valid-register-token' });

      expect(repeatedVerifyResponse.status).toBe(200);
      expect(repeatedVerifyResponse.body).toEqual({
        success: true,
        purpose: 'register',
      });

      const dbUser = await prisma.user.findUnique({ where: { uid: user.uid } });
      expect(dbUser?.emailVerifiedAt).toBeInstanceOf(Date);

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: user.email,
          password: plainPassword,
        });
      expect(loginResponse.status).toBe(200);
      expect(pickCookie(loginResponse.headers['set-cookie'], 'hsf_token')).toBeTruthy();
    });

    it('验证过期 token 应该返回错误', async () => {
      const { user } = await createTestUser({
        email: 'verify_pending@example.com',
      });
      await prisma.user.update({
        where: { uid: user.uid },
        data: { emailVerifiedAt: null },
      });
      await createEmailVerificationToken({
        userUid: user.uid,
        email: user.email,
        token: 'expired-register-token',
        expiresAt: new Date(Date.now() - 60 * 1000),
      });

      const response = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: 'expired-register-token' });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        code: 'TOKEN_EXPIRED',
      });
    });

    it('修改邮箱应该立即生效并清空验证状态', async () => {
      const agent = request.agent(app);
      const { user, plainPassword } = await createTestUser({
        email: 'change_email_old@example.com',
        password: 'CorrectPassword123!',
      });
      await createEmailVerificationToken({
        userUid: user.uid,
        email: user.email,
        token: 'old-email-register-token',
      });

      const loginResponse = await agent
        .post('/api/auth/login')
        .send({
          email: user.email,
          password: plainPassword,
        });
      expect(loginResponse.status).toBe(200);
      const xsrfToken = pickCookie(loginResponse.headers['set-cookie'], 'XSRF-TOKEN')
        ?.split(';')[0]
        .split('=')[1];
      expect(xsrfToken).toBeTruthy();

      const updateResponse = await agent
        .put('/api/users/email')
        .set('X-XSRF-TOKEN', xsrfToken!)
        .send({
          currentPassword: plainPassword,
          newEmail: 'change_email_new@example.com',
        });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.requiresEmailVerification).toBe(false);
      const changedUser = await prisma.user.findUnique({ where: { uid: user.uid } });
      expect(changedUser?.email).toBe('change_email_new@example.com');
      expect(changedUser?.emailVerifiedAt).toBeNull();

      const pendingTokenCount = await prisma.emailVerificationToken.count({
        where: {
          userUid: user.uid,
          email: 'change_email_new@example.com',
          usedAt: null,
        },
      });
      expect(pendingTokenCount).toBe(0);

      const oldToken = await prisma.emailVerificationToken.findFirst({
        where: {
          userUid: user.uid,
          email: 'change_email_old@example.com',
          tokenHash: hashEmailVerificationToken('old-email-register-token'),
        },
      });
      expect(oldToken?.usedAt).toBeInstanceOf(Date);

      const oldTokenVerifyResponse = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: 'old-email-register-token' });
      expect(oldTokenVerifyResponse.status).toBe(400);

      const userAfterOldToken = await prisma.user.findUnique({ where: { uid: user.uid } });
      expect(userAfterOldToken?.email).toBe('change_email_new@example.com');
      expect(userAfterOldToken?.emailVerifiedAt).toBeNull();

      const oldLoginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'change_email_old@example.com',
          password: plainPassword,
        });
      expect(oldLoginResponse.status).toBe(401);

      const newLoginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'change_email_new@example.com',
          password: plainPassword,
        });
      expect(newLoginResponse.status).toBe(200);
    });
  });

  describe('POST /api/auth/wechat/login', () => {
    it('微信新用户昵称重复时应该生成唯一备用昵称', async () => {
      await createTestUser({
        email: 'test_wechat_common_name_owner@example.com',
        displayName: '小明',
      });

      const response = await request(app)
        .post('/api/auth/wechat/login')
        .send({
          code: 'mock:wechat_common_nick',
          displayName: '小明',
        });

      expect(response.status).toBe(200);
      expect(response.body.user.displayName).toBe('小明_2');
      expect(response.body.user.email).toBe('wechat_common_nick@wechat.local');
    });

    it('微信新用户昵称包含保留字符时应该使用规范化备用昵称', async () => {
      const response = await request(app)
        .post('/api/auth/wechat/login')
        .send({
          code: 'mock:wechat_reserved_name',
          displayName: '小 明[1]',
        });

      expect(response.status).toBe(200);
      expect(response.body.user.displayName).toBe('小_明_1_');
      expect(response.body.user.email).toBe('wechat_reserved_name@wechat.local');
    });

    it('微信已有用户昵称无效时应该跳过昵称更新但继续登录并更新头像', async () => {
      const { user } = await createTestUser({
        email: 'test_wechat_existing@example.com',
        displayName: 'KeepName',
      });
      await prisma.user.update({
        where: { uid: user.uid },
        data: { wechatOpenId: 'wechat_existing_openid' },
      });

      const response = await request(app)
        .post('/api/auth/wechat/login')
        .send({
          code: 'mock:wechat_existing_openid',
          displayName: 'Bad Name',
          photoURL: 'https://example.com/avatar.png',
        });

      expect(response.status).toBe(200);
      expect(response.body.user.uid).toBe(user.uid);
      expect(response.body.user.displayName).toBe('KeepName');
      expect(response.body.user.photoURL).toBe('https://example.com/avatar.png');

      const updatedUser = await prisma.user.findUnique({ where: { uid: user.uid } });
      expect(updatedUser?.displayName).toBe('KeepName');
      expect(updatedUser?.photoURL).toBe('https://example.com/avatar.png');
    });
  });

  describe('POST /api/auth/password-reset', () => {
    async function enableEmailFeature() {
      await prisma.siteConfig.create({
        data: {
          key: 'email_verification',
          value: {
            enabled: true,
            publicBaseUrl: 'https://example.com',
            tokenTtlMinutes: 30,
          },
        },
      });
    }

    it('默认关闭时应该拒绝发送密码重置邮件', async () => {
      const response = await request(app)
        .post('/api/auth/password-reset/request')
        .send({ email: 'test_password_reset_disabled@example.com' });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        code: 'PASSWORD_RESET_DISABLED',
      });
    });

    it('请求密码重置不应该暴露邮箱是否存在', async () => {
      await enableEmailFeature();
      const { user } = await createTestUser({
        email: 'test_password_reset_request@example.com',
      });

      const existingResponse = await request(app)
        .post('/api/auth/password-reset/request')
        .send({ email: 'TEST_PASSWORD_RESET_REQUEST@EXAMPLE.COM' });
      expect(existingResponse.status).toBe(200);
      expect(existingResponse.body).toMatchObject({ success: true });

      const existingTokenCount = await prisma.emailVerificationToken.count({
        where: {
          userUid: user.uid,
          email: 'test_password_reset_request@example.com',
          purpose: EmailVerificationPurpose.reset_password,
          usedAt: null,
        },
      });
      expect(existingTokenCount).toBe(1);

      const missingResponse = await request(app)
        .post('/api/auth/password-reset/request')
        .send({ email: 'test_password_reset_missing@example.com' });
      expect(missingResponse.status).toBe(200);
      expect(missingResponse.body).toEqual(existingResponse.body);

      const missingTokenCount = await prisma.emailVerificationToken.count({
        where: {
          email: 'test_password_reset_missing@example.com',
          purpose: EmailVerificationPurpose.reset_password,
        },
      });
      expect(missingTokenCount).toBe(0);
    });

    it('有效重置 token 应该更新密码并使旧密码失效', async () => {
      const { user, plainPassword } = await createTestUser({
        email: 'test_password_reset_confirm@example.com',
        password: 'OldPassword123!',
      });
      await prisma.user.update({
        where: { uid: user.uid },
        data: { emailVerifiedAt: null },
      });
      await createEmailVerificationToken({
        userUid: user.uid,
        email: user.email,
        token: 'older-reset-token',
        purpose: EmailVerificationPurpose.reset_password,
      });
      await createEmailVerificationToken({
        userUid: user.uid,
        email: user.email,
        token: 'valid-reset-token',
        purpose: EmailVerificationPurpose.reset_password,
      });

      const response = await request(app)
        .post('/api/auth/password-reset/confirm')
        .send({
          token: 'valid-reset-token',
          newPassword: 'NewPassword123!',
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });

      const pendingResetTokenCount = await prisma.emailVerificationToken.count({
        where: {
          userUid: user.uid,
          purpose: EmailVerificationPurpose.reset_password,
          usedAt: null,
        },
      });
      expect(pendingResetTokenCount).toBe(0);

      const resetToken = await prisma.emailVerificationToken.findUnique({
        where: { tokenHash: hashEmailVerificationToken('valid-reset-token') },
      });
      expect(resetToken?.usedAt).toBeInstanceOf(Date);

      const updatedUser = await prisma.user.findUnique({ where: { uid: user.uid } });
      expect(updatedUser?.emailVerifiedAt).toBeInstanceOf(Date);

      const oldLoginResponse = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: plainPassword });
      expect(oldLoginResponse.status).toBe(401);

      const newLoginResponse = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: 'NewPassword123!' });
      expect(newLoginResponse.status).toBe(200);
      expect(pickCookie(newLoginResponse.headers['set-cookie'], 'hsf_token')).toBeTruthy();
    });

    it('过期重置 token 应该返回错误', async () => {
      const { user } = await createTestUser({
        email: 'test_password_reset_expired@example.com',
      });
      await createEmailVerificationToken({
        userUid: user.uid,
        email: user.email,
        token: 'expired-reset-token',
        purpose: EmailVerificationPurpose.reset_password,
        expiresAt: new Date(Date.now() - 60 * 1000),
      });

      const response = await request(app)
        .post('/api/auth/password-reset/confirm')
        .send({
          token: 'expired-reset-token',
          newPassword: 'NewPassword123!',
        });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        code: 'TOKEN_EXPIRED',
      });
    });

    it('非重置用途 token 不能用于重置密码', async () => {
      const { user, plainPassword } = await createTestUser({
        email: 'test_password_reset_wrong_purpose@example.com',
        password: 'OldPassword123!',
      });
      await createEmailVerificationToken({
        userUid: user.uid,
        email: user.email,
        token: 'register-token-for-reset',
        purpose: EmailVerificationPurpose.register,
      });

      const response = await request(app)
        .post('/api/auth/password-reset/confirm')
        .send({
          token: 'register-token-for-reset',
          newPassword: 'NewPassword123!',
        });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        code: 'INVALID_TOKEN',
      });

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: plainPassword });
      expect(loginResponse.status).toBe(200);
    });

    it('邮箱变更后旧邮箱的重置 token 应该失效', async () => {
      const { user } = await createTestUser({
        email: 'test_password_reset_old_email@example.com',
      });
      await createEmailVerificationToken({
        userUid: user.uid,
        email: user.email,
        token: 'old-email-reset-token',
        purpose: EmailVerificationPurpose.reset_password,
      });
      await prisma.user.update({
        where: { uid: user.uid },
        data: { email: 'test_password_reset_new_email@example.com' },
      });

      const response = await request(app)
        .post('/api/auth/password-reset/confirm')
        .send({
          token: 'old-email-reset-token',
          newPassword: 'NewPassword123!',
        });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        code: 'INVALID_TOKEN',
      });
    });
  });

  describe('邮箱验证配置', () => {
    it('默认关闭且只有超级管理员可以更新', async () => {
      const defaultResponse = await request(app).get('/api/config/email-verification');
      expect(defaultResponse.status).toBe(200);
      expect(defaultResponse.body).toEqual({ enabled: false });

      const adminAgent = request.agent(app);
      const { plainPassword: adminPassword } = await createTestUser({
        email: 'email_config_admin@example.com',
        password: 'CorrectPassword123!',
        role: 'admin',
      });
      const adminLogin = await adminAgent
        .post('/api/auth/login')
        .send({ email: 'email_config_admin@example.com', password: adminPassword });
      const adminXsrf = pickCookie(adminLogin.headers['set-cookie'], 'XSRF-TOKEN')
        ?.split(';')[0]
        .split('=')[1];
      expect(adminXsrf).toBeTruthy();

      const forbiddenResponse = await adminAgent
        .patch('/api/config/email-verification')
        .set('X-XSRF-TOKEN', adminXsrf!)
        .send({ enabled: true });
      expect(forbiddenResponse.status).toBe(403);

      const superAgent = request.agent(app);
      const { plainPassword: superPassword } = await createTestUser({
        email: 'email_config_super@example.com',
        password: 'CorrectPassword123!',
        role: 'super_admin',
      });
      const superLogin = await superAgent
        .post('/api/auth/login')
        .send({ email: 'email_config_super@example.com', password: superPassword });
      const superXsrf = pickCookie(superLogin.headers['set-cookie'], 'XSRF-TOKEN')
        ?.split(';')[0]
        .split('=')[1];
      expect(superXsrf).toBeTruthy();

      const updateResponse = await superAgent
        .patch('/api/config/email-verification')
        .set('X-XSRF-TOKEN', superXsrf!)
        .send({
          enabled: true,
          publicBaseUrl: 'https://wiki.example.com',
          tokenTtlMinutes: 60,
          smtpHost: 'smtp.example.com',
          smtpPort: 587,
          smtpSecure: false,
          smtpUser: 'mailer',
          smtpPass: 'secret',
          smtpFrom: 'Wiki <no-reply@example.com>',
        });
      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.config).toEqual({
        enabled: true,
        publicBaseUrl: 'https://wiki.example.com',
        tokenTtlMinutes: 60,
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpSecure: false,
        smtpUser: 'mailer',
        smtpFrom: 'Wiki <no-reply@example.com>',
        smtpPassSet: true,
      });
      expect(updateResponse.body.config).not.toHaveProperty('smtpPass');

      const adminConfigResponse = await superAgent
        .get('/api/config/email-verification/admin')
        .set('X-XSRF-TOKEN', superXsrf!);
      expect(adminConfigResponse.status).toBe(200);
      expect(adminConfigResponse.body).toEqual(updateResponse.body.config);
    });
  });

  // ============================================================================
  // 用户登出功能测试
  // ============================================================================
  describe('POST /api/auth/logout', () => {
    /**
     * 测试目的：验证登出功能是否能清除认证信息
     * 预期结果：返回成功响应并清除认证 Cookie
     */
    it('已登录用户应该能够成功登出', async () => {
      // 创建并登录测试用户
      const { user } = await createTestUser();
      const token = await createTestToken(user.uid, user.role);

      const bootstrap = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);
      const xsrfCookie = pickCookie(bootstrap.headers['set-cookie'], 'XSRF-TOKEN');
      const xsrfToken = xsrfCookie?.split(';')[0].split('=')[1] || '';

      // 执行登出操作
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .set('Cookie', xsrfCookie ? [xsrfCookie] : [])
        .set('x-xsrf-token', xsrfToken);

      // 验证登出响应
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);

      // 验证 Cookie 被清除
      if (response.headers['set-cookie']) {
        const cookies = Array.isArray(response.headers['set-cookie'])
          ? response.headers['set-cookie']
          : [response.headers['set-cookie']];
        const clearedCookie = cookies.find((cookie: string) =>
          cookie.includes('hsf_token=;'),
        );
        expect(clearedCookie).toBeDefined();
      }
    });

    /**
     * 测试目的：验证未登录用户执行登出的行为
     * 预期结果：登出操作应该始终成功（幂等操作）
     */
    it('未登录时执行登出也应该返回成功', async () => {
      const response = await request(app).post('/api/auth/logout');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
    });
  });

  // ============================================================================
  // 安全性和边界情况测试
  // ============================================================================
  describe('安全性和边界情况', () => {
    /**
     * 测试目的：验证 SQL 注入防护
     * 预期结果：恶意输入不应导致系统错误或数据泄露
     */
    it('应该防止 SQL 注入攻击', async () => {
      // 尝试 SQL 注入
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: "'; DROP TABLE users; --",
          password: "anything",
        });

      // 不应该返回 500 服务器错误
      expect(response.status).not.toBe(500);
      expect([400, 401]).toContain(response.status);
    });

    /**
     * 测试目的：验证超长输入的处理
     * 预期结果：系统应优雅地处理超长输入
     */
    it('应该优雅地处理超长输入', async () => {
      const longString = 'a'.repeat(10000);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: `${longString}@example.com`,
          password: longString,
        });

      // 不应该崩溃
      expect([400, 401, 413]).toContain(response.status);
    });

    /**
     * 测试目的：验证特殊字符在用户名中的处理
     * 预期结果：特殊字符应被正确处理或拒绝
     */
    it('应该正确处理特殊字符输入', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'special@example.com',
          password: 'ValidPassword123!',
          displayName: '<script>alert("xss")</script>',
        });

      // 注册可能成功或失败，但不应该导致服务器错误
      expect([201, 400]).toContain(response.status);
      expect(response.status).not.toBe(500);
    });
  });
});
