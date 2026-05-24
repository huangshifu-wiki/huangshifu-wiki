/**
 * 集成测试全局配置
 *
 * 功能：
 * 1. 加载测试环境变量（.env.test）
 * 2. 初始化测试数据库连接
 * 3. 提供全局测试工具函数
 * 4. 测试后清理数据库数据
 */

import { beforeAll, afterAll } from 'vitest';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// 加载测试环境变量
dotenv.config({ path: '.env.test' });

// 创建 Prisma 客户端实例（用于测试数据库操作）
export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

/**
 * 全局设置：在所有测试前执行
 */
beforeAll(async () => {
  console.log('[Integration Test] Starting test suite...');
  console.log('[Integration Test] Database URL:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@'));

  try {
    // 测试数据库连接
    await prisma.$connect();
    console.log('[Integration Test] Database connected successfully');

    // 可选：清理测试数据库（根据需要启用）
    // await cleanupDatabase();
  } catch (error) {
    console.error('[Integration Test] Failed to connect to database:', error);
    throw error;
  }
});

/**
 * 全局清理：在所有测试后执行
 */
afterAll(async () => {
  console.log('[Integration Test] Cleaning up test suite...');

  try {
    // 断开数据库连接
    await prisma.$disconnect();
    console.log('[Integration Test] Database disconnected');
  } catch (error) {
    console.error('[Integration Test] Error during cleanup:', error);
  }
});

/**
 * 清理测试数据库中的所有数据
 * 注意：按依赖顺序删除，避免外键约束错误
 */
export async function cleanupDatabase() {
  console.log('[Integration Test] Cleaning database...');

  // 按照外键依赖顺序删除数据
  const deleteOrder = [
    'postCommentLike',
    'postLike',
    'postDislike',
    'postComment',
    'browsingHistory',
    'favorite',
    'wikiLike',
    'wikiDislike',
    'wikiRevision',
    'wikiPullRequestComment',
    'wikiPullRequest',
    'wikiBranch',
    'moderationLog',
    'userBanLog',
    'notification',
    'Post',
    'WikiPage',
    'User',
  ];

  for (const model of deleteOrder) {
    try {
      // 使用原始 SQL 或 Prisma 删除
      await prisma.$executeRawUnsafe(`DELETE FROM "${model}"`);
      console.log(`[Integration Test] Cleaned table: ${model}`);
    } catch (error) {
      console.warn(`[Integration Test] Failed to clean table ${model}:`, error);
    }
  }

  console.log('[Integration Test] Database cleanup completed');
}

/**
 * 创建测试用户辅助函数
 */
export async function createTestUser(overrides?: {
  email?: string;
  password?: string;
  displayName?: string;
  role?: 'user' | 'admin' | 'super_admin';
}) {
  const bcrypt = (await import('bcryptjs')).default;

  const email = overrides?.email || `test_${Date.now()}@example.com`;
  const password = overrides?.password || 'TestPassword123!';
  const displayName = overrides?.displayName || `TestUser_${Date.now()}`;
  const role = overrides?.role || 'user';

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase().trim(),
      passwordHash,
      displayName,
      role,
      bio: '',
      status: 'active',
    },
  });

  return {
    user,
    plainPassword: password,
  };
}

/**
 * 创建认证 token 辅助函数
 */
export async function createTestToken(userUid: string, role: string = 'user'): Promise<string> {
  const jwt = (await import('jsonwebtoken')).default;
  const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_replace_with_random_string';
  const { createSessionVersion } = await import('../../src/server/utils/auth-session');
  const user = await prisma.user.findUnique({
    where: { uid: userUid },
    select: { passwordHash: true },
  });

  if (!user) {
    throw new Error(`Test user not found: ${userUid}`);
  }

  const token = jwt.sign(
    {
      uid: userUid,
      role,
      sessionVersion: createSessionVersion(user.passwordHash),
    },
    JWT_SECRET,
    { expiresIn: '7d' },
  );

  return token;
}

/**
 * 创建测试 Wiki 页面辅助函数
 */
export interface CreateTestWikiPageInput {
  slug?: string;
  title?: string;
  category?: string;
  content?: string;
  status?: 'draft' | 'pending' | 'published' | 'rejected';
  authorUid: string;
}

export async function createTestWikiPage(input: CreateTestWikiPageInput) {
  const slug = input.slug || `test-wiki-${Date.now()}`;
  const title = input.title || `Test Wiki Page ${Date.now()}`;

  const page = await prisma.wikiPage.create({
    data: {
      slug,
      title,
      titleKey: title.toLowerCase(),
      category: input.category || 'general',
      content: input.content || '# Test Content\n\nThis is a test wiki page.',
      tags: ['test'],
      status: input.status || 'published',
      lastEditorUid: input.authorUid,
    },
  });

  return page;
}

/**
 * 创建测试帖子辅助函数
 */
export interface CreateTestPostInput {
  title?: string;
  section?: string;
  content?: string;
  status?: 'draft' | 'pending' | 'published' | 'rejected';
  authorUid: string;
}

export async function createTestPost(input: CreateTestPostInput) {
  const title = input.title || `Test Post ${Date.now()}`;

  const post = await prisma.post.create({
    data: {
      title,
      section: input.section || 'general',
      content: input.content || 'This is a test post content.',
      tags: ['test'],
      status: input.status || 'published',
      authorUid: input.authorUid,
    },
  });

  return post;
}
