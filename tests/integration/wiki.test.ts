/**
 * Wiki API 集成测试
 *
 * 测试范围：
 * 1. GET /api/wiki - 获取 Wiki 页面列表
 * 2. GET /api/wiki/:slug - 获取单个 Wiki 页面详情
 * 3. POST /api/wiki - 创建新 Wiki 页面（需要认证）
 * 4. PUT /api/wiki/:slug - 更新 Wiki 页面（需要认证）
 *
 * 测试策略：
 * - 使用 supertest 进行 HTTP 请求测试
 * - 测试未认证和已认证两种状态下的访问权限
 * - 验证分页、筛选、排序等查询参数
 * - 包含正常情况和错误情况的完整测试覆盖
 */

import { describe, beforeEach, afterEach, it, expect } from 'vitest'
import request from 'supertest'
import { app } from '../../server'
import {
  prisma,
  createTestUser,
  createTestToken,
  createTestWikiPage,
  ensureTestWikiCategory,
  nextTestNumericSlug,
} from './setup'
import type { CreateTestWikiPageInput } from './setup'

describe('Wiki API - 百科接口测试', () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>
  let adminUser: Awaited<ReturnType<typeof createTestUser>>
  let userToken: string
  let adminToken: string

  function findCookieValue(setCookieHeader: string | string[] | undefined, cookieName: string) {
    const cookies = Array.isArray(setCookieHeader)
      ? setCookieHeader
      : setCookieHeader
        ? [setCookieHeader]
        : []
    const targetCookie = cookies.find((cookie) => cookie?.startsWith(`${cookieName}=`))
    return targetCookie?.split(';')[0].split('=')[1]
  }

  async function createAuthenticatedAgent(email: string, password: string) {
    const agent = request.agent(app)
    const loginResponse = await agent.post('/api/auth/login').send({ email, password })

    expect(loginResponse.status).toBe(200)
    const xsrfToken = findCookieValue(loginResponse.headers['set-cookie'], 'XSRF-TOKEN')
    expect(xsrfToken).toBeTruthy()

    return {
      agent,
      xsrfToken: xsrfToken!,
    }
  }

  async function createCurrentUserWikiPage(overrides: Omit<CreateTestWikiPageInput, 'authorUid'>) {
    return createTestWikiPage({
      ...overrides,
      authorUid: testUser.user.uid,
    })
  }

  async function createCurrentUserNumericWikiPage(
    overrides: Omit<CreateTestWikiPageInput, 'authorUid' | 'slug'>
  ) {
    return createCurrentUserWikiPage({
      ...overrides,
      slug: nextTestNumericSlug(),
    })
  }

  /**
   * 每个测试套件前准备测试数据
   */
  beforeEach(async () => {
    // 清理现有数据
    await prisma.wikiImageEmbedding.deleteMany({
      where: {
        wikiPageSlug: {
          startsWith: 'test-',
        },
      },
    })
    await prisma.textEmbeddingChunk.deleteMany({
      where: {
        sourceType: 'wiki',
        sourceId: {
          startsWith: 'test-',
        },
      },
    })
    await prisma.wikiPage.deleteMany({
      where: {
        slug: {
          startsWith: 'test-',
        },
      },
    })
    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: 'test_',
        },
      },
    })

    // 创建测试用户
    testUser = await createTestUser({ role: 'user' })
    adminUser = await createTestUser({ role: 'admin' })

    // 创建认证 token
    userToken = await createTestToken(testUser.user.uid, testUser.user.role)
    adminToken = await createTestToken(adminUser.user.uid, adminUser.user.role)

    await ensureTestWikiCategory('general', 'General')
  })

  /**
   * 清理测试数据
   */
  afterEach(async () => {
    // 清理创建的 Wiki 页面
    await prisma.wikiImageEmbedding.deleteMany({
      where: {
        wikiPageSlug: {
          startsWith: 'test-',
        },
      },
    })
    await prisma.textEmbeddingChunk.deleteMany({
      where: {
        sourceType: 'wiki',
        sourceId: {
          startsWith: 'test-',
        },
      },
    })
    await prisma.wikiPage.deleteMany({
      where: {
        slug: {
          startsWith: 'test-',
        },
      },
    })
  })

  // ============================================================================
  // 获取 Wiki 列表接口测试
  // ============================================================================
  describe('GET /api/wiki - 获取 Wiki 列表', () => {
    /**
     * 测试目的：验证获取空列表时的响应格式
     * 预期结果：返回空数组和正确的元数据
     */
    it('应该返回空的 Wiki 列表（当没有数据时）', async () => {
      const emptyCategory = `empty-category-${Date.now()}`
      const response = await request(app).get('/api/wiki').query({ category: emptyCategory })

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('pages')
      expect(Array.isArray(response.body.pages)).toBe(true)
      expect(response.body.pages.length).toBe(0)

      // 验证分页元数据
      expect(response.body).toHaveProperty('total', 0)
      expect(response.body).toHaveProperty('page', 1)
      expect(response.body).toHaveProperty('limit', 20)
      expect(response.body).toHaveProperty('hasMore', false)
    })

    /**
     * 测试目的：验证返回包含数据的 Wiki 列表
     * 预期结果：返回正确数量的页面和完整的页面信息
     */
    it('应该返回包含数据的 Wiki 列表', async () => {
      // 创建多个测试 Wiki 页面
      const page1 = await createTestWikiPage({
        slug: 'test-page-1',
        title: 'Test Page 1',
        category: 'general',
        authorUid: testUser.user.uid,
        status: 'published',
      })

      const page2 = await createTestWikiPage({
        slug: 'test-page-2',
        title: 'Test Page 2',
        category: 'music',
        authorUid: testUser.user.uid,
        status: 'published',
      })

      const response = await request(app).get('/api/wiki')

      expect(response.status).toBe(200)
      expect(response.body.pages.length).toBeGreaterThanOrEqual(2)

      // 验证页面结构包含必要字段
      const wikiPage = response.body.pages.find((p: { slug: string }) => p.slug === page1.slug)
      expect(wikiPage).toBeDefined()
      expect(wikiPage).toHaveProperty('slug', page1.slug)
      expect(wikiPage).toHaveProperty('title', page1.title)
      expect(wikiPage).toHaveProperty('category', page1.category)
      expect(wikiPage).toHaveProperty('status')
      expect(wikiPage).toHaveProperty('createdAt')
      expect(wikiPage).toHaveProperty('updatedAt')

      // 验证总数
      expect(response.body.total).toBeGreaterThanOrEqual(2)
    })

    /**
     * 测试目的：验证分页功能是否正常工作
     * 预期结果：返回指定页码的数据和正确的分页信息
     */
    it('应该支持分页参数', async () => {
      const category = `pagination-${Date.now()}`

      // 创建多个测试页面
      for (let i = 0; i < 25; i++) {
        await createCurrentUserWikiPage({
          slug: `test-pagination-${i}`,
          title: `Pagination Test ${i}`,
          category,
          status: 'published',
        })
      }

      // 请求第一页，每页 10 条
      const response1 = await request(app).get('/api/wiki').query({ page: 1, limit: 10, category })

      expect(response1.status).toBe(200)
      expect(response1.body.pages.length).toBe(10)
      expect(response1.body.page).toBe(1)
      expect(response1.body.limit).toBe(10)
      expect(response1.body.hasMore).toBe(true)

      // 请求第二页
      const response2 = await request(app).get('/api/wiki').query({ page: 2, limit: 10, category })

      expect(response2.status).toBe(200)
      expect(response2.body.pages.length).toBe(10)
      expect(response2.body.page).toBe(2)

      // 请求第三页（剩余 5 条）
      const response3 = await request(app).get('/api/wiki').query({ page: 3, limit: 10, category })

      expect(response3.status).toBe(200)
      expect(response3.body.pages.length).toBe(5)
      expect(response3.body.hasMore).toBe(false)
    })

    /**
     * 测试目的：验证分类筛选功能
     * 预期结果：只返回指定分类的 Wiki 页面
     */
    it('应该支持按分类筛选', async () => {
      // 创建不同分类的页面
      await createCurrentUserWikiPage({
        slug: 'test-cat-general',
        title: 'General Page',
        category: 'general',
        status: 'published',
      })

      await createCurrentUserWikiPage({
        slug: 'test-cat-music',
        title: 'Music Page',
        category: 'music',
        status: 'published',
      })

      await createCurrentUserWikiPage({
        slug: 'test-cat-general-2',
        title: 'Another General Page',
        category: 'general',
        status: 'published',
      })

      // 筛选 general 分类
      const response = await request(app).get('/api/wiki').query({ category: 'general' })

      expect(response.status).toBe(200)

      // 验证所有返回的页面都属于 general 分类
      response.body.pages.forEach((page: { category: string }) => {
        expect(page.category).toBe('general')
      })
    })

    /**
     * 测试目的：验证标签筛选功能
     * 预期结果：只包含指定标签的页面
     */
    it('应该支持按标签筛选', async () => {
      await ensureTestWikiCategory('tech', 'Tech')

      // 创建带标签的页面
      await prisma.wikiPage.create({
        data: {
          slug: 'test-tag-javascript',
          title: 'JavaScript Guide',
          titleKey: 'javascript guide',
          category: 'tech',
          content: '# JavaScript',
          tags: ['javascript', 'programming'],
          status: 'published',
          lastEditorUid: testUser.user.uid,
        },
      })

      await prisma.wikiPage.create({
        data: {
          slug: 'test-tag-python',
          title: 'Python Guide',
          titleKey: 'python guide',
          category: 'tech',
          content: '# Python',
          tags: ['python', 'programming'],
          status: 'published',
          lastEditorUid: testUser.user.uid,
        },
      })

      // 按 javascript 标签筛选
      const response = await request(app).get('/api/wiki').query({ tag: 'javascript' })

      expect(response.status).toBe(200)
      expect(response.body.pages.length).toBeGreaterThanOrEqual(1)

      // 验证返回的页面包含该标签
      const hasJavaScriptTag = response.body.pages.some((page: { tags: string[] }) =>
        page.tags?.includes('javascript')
      )
      expect(hasJavaScriptTag).toBe(true)
    })

    /**
     * 测试目的：验证限制每页数量参数
     * 预期结果：返回的数量不超过指定的 limit
     */
    it('应该正确处理 limit 参数边界值', async () => {
      // 创建一些测试数据
      for (let i = 0; i < 5; i++) {
        await createCurrentUserWikiPage({
          slug: `test-limit-${i}`,
          title: `Limit Test ${i}`,
          status: 'published',
        })
      }

      // 测试 limit=1
      const response1 = await request(app).get('/api/wiki').query({ limit: 1 })

      expect(response1.status).toBe(200)
      expect(response1.body.pages.length).toBeLessThanOrEqual(1)

      // 测试超大 limit 值（应被限制在最大值内）
      const response2 = await request(app).get('/api/wiki').query({ limit: 1000 })

      expect(response2.status).toBe(200)
      expect(response2.body.pages.length).toBeLessThanOrEqual(100) // 最大限制为 100

      // 测试 limit=0 或负数（应使用默认值或最小值）
      const response3 = await request(app).get('/api/wiki').query({ limit: 0 })

      expect(response3.status).toBe(200)
      expect(response3.body.pages.length).toBeGreaterThanOrEqual(1) // 应至少返回 1 条
    })

    /**
     * 测试目的：验证缓存控制头是否正确设置
     * 预期结果：响应应包含适当的缓存控制头
     */
    it('应该设置正确的缓存控制头', async () => {
      const response = await request(app).get('/api/wiki')

      expect(response.status).toBe(200)
      // Wiki 列表不应该被缓存（实时性要求高）
      expect(response.headers['cache-control']).toBeDefined()
      expect(response.headers['cache-control']).toContain('no-store')
    })
  })

  // ============================================================================
  // 获取单个 Wiki 详情接口测试
  // ============================================================================
  describe('GET /api/wiki/:slug - 获取 Wiki 详情', () => {
    /**
     * 测试目的：验证获取存在的 Wiki 页面详情
     * 预期结果：返回完整的页面信息包括内容、关系等
     */
    it('应该返回存在的 Wiki 页面详情', async () => {
      // 创建测试页面
      const wikiPage = await createCurrentUserNumericWikiPage({
        title: 'Detail Test Page',
        content: '# Hello World\n\nThis is **detailed** content.',
        category: 'general',
        status: 'published',
      })

      const response = await request(app).get(`/api/wiki/${wikiPage.slug}`)

      expect(response.status).toBe(200)

      // 验证主要字段
      expect(response.body).toHaveProperty('page')
      expect(response.body.page.slug).toBe(wikiPage.slug)
      expect(response.body.page.title).toBe(wikiPage.title)
      expect(response.body.page.content).toBe(wikiPage.content)
      expect(response.body.page.category).toBe(wikiPage.category)

      // 验证额外字段
      expect(response.body).toHaveProperty('backlinks')
      expect(Array.isArray(response.body.backlinks)).toBe(true)
      expect(response.body).toHaveProperty('relations')
      expect(response.body).toHaveProperty('relationGraph')
    })

    /**
     * 测试目的：验证访问不存在的页面
     * 预期结果：返回 404 错误
     */
    it('访问不存在的页面应该返回 404 错误', async () => {
      const response = await request(app).get('/api/wiki/nonexistent-page-slug')

      expect(response.status).toBe(404)
      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toContain('未找到')
    })

    /**
     * 测试目的：验证访问页面时浏览次数是否增加
     * 预期结果：每次访问后 viewCount 应该增加
     */
    it('每次访问应该增加浏览次数', async () => {
      // 创建测试页面
      const wikiPage = await createCurrentUserNumericWikiPage({
        title: 'View Count Test',
        status: 'published',
      })

      // 第一次访问
      const response1 = await request(app).get(`/api/wiki/${wikiPage.slug}`)
      expect(response1.status).toBe(200)

      // 从数据库获取更新后的浏览次数
      const updatedPage = await prisma.wikiPage.findUnique({
        where: { slug: wikiPage.slug },
      })

      expect(updatedPage?.viewCount).toBeGreaterThanOrEqual(1)
    })

    /**
     * 测试目的：验证已认证用户的个性化数据
     * 预期结果：登录用户应看到 favoritedByMe、likedByMe 等字段
     */
    it('已登录用户应该看到个性化交互状态', async () => {
      // 创建测试页面
      const wikiPage = await createTestWikiPage({
        slug: nextTestNumericSlug(),
        title: 'Auth Personalized Test',
        status: 'published',
        authorUid: testUser.user.uid,
      })

      // 用户收藏该页面
      await prisma.favorite.create({
        data: {
          userUid: testUser.user.uid,
          targetType: 'wiki',
          targetId: wikiPage.slug,
        },
      })

      // 已认证用户访问
      const response = await request(app)
        .get(`/api/wiki/${wikiPage.slug}`)
        .set('Authorization', `Bearer ${userToken}`)

      expect(response.status).toBe(200)
      expect(response.body.page).toHaveProperty('favoritedByMe', true)
    })

    /**
     * 测试目的：验证草稿页面的访问权限
     * 预期结果：非作者/管理员不应能查看草稿
     */
    it('未认证用户不能查看草稿状态的页面', async () => {
      // 创建草稿页面
      const draftPage = await createCurrentUserNumericWikiPage({
        title: 'Draft Page',
        status: 'draft',
      })

      // 未认证用户尝试访问草稿
      const response = await request(app).get(`/api/wiki/${draftPage.slug}`)

      expect(response.status).toBe(404)
      expect(response.body).toHaveProperty('error')
    })

    /**
     * 测试目的：验证作者可以查看自己的草稿
     * 预期结果：作者应能看到自己的草稿页面
     */
    it('作者应该能够查看自己的草稿页面', async () => {
      // 创建属于当前用户的草稿页面
      const draftPage = await createTestWikiPage({
        slug: nextTestNumericSlug(),
        title: 'My Draft',
        status: 'draft',
        authorUid: testUser.user.uid,
      })

      // 作者访问自己的草稿
      const response = await request(app)
        .get(`/api/wiki/${draftPage.slug}`)
        .set('Authorization', `Bearer ${userToken}`)

      expect(response.status).toBe(200)
      expect(response.body.page.slug).toBe(draftPage.slug)
      expect(response.body.page.status).toBe('draft')
    })

    /**
     * 测试目的：验证特殊字符的 slug 处理
     * 预期结果：系统应正确处理各种 slug 格式
     */
    it('应该只允许通过数字 slug 获取详情', async () => {
      const wikiPage = await createCurrentUserNumericWikiPage({
        title: 'Special Slug Test',
        status: 'published',
      })

      const response = await request(app).get(`/api/wiki/${wikiPage.slug}`)

      expect(response.status).toBe(200)
      expect(response.body.page.slug).toBe(wikiPage.slug)
    })
  })

  // ============================================================================
  // 创建 Wiki 页面接口测试（需要认证）
  // ============================================================================
  describe('POST /api/wiki - 创建 Wiki 页面', () => {
    /**
     * 测试目的：验证已认证用户能否成功创建 Wiki 页面
     * 预期结果：返回 201 状态码和新创建的页面信息
     */
    it('已认证用户应该能够创建新的 Wiki 页面', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword
      )
      const newPageData = {
        slug: `test-new-${Date.now()}`,
        title: 'New Wiki Page',
        category: 'general',
        content: '# New Page\n\nThis is a new wiki page.',
        tags: ['test', 'new'],
      }

      const response = await agent
        .post('/api/wiki')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send(newPageData)

      expect(response.status).toBe(201)
      expect(response.body).toHaveProperty('page')
      expect(response.body.page.slug).toMatch(/^[1-9]\d*$/)
      expect(response.body.page.title).toBe(newPageData.title)
      expect(response.body.page.category).toBe(newPageData.category)
      expect(response.body.page.content).toBe(newPageData.content)

      // 验证数据库中确实创建了该页面
      const dbPage = await prisma.wikiPage.findUnique({
        where: { slug: response.body.page.slug },
      })
      expect(dbPage).not.toBeNull()
    })

    it('管理员创建时应直接发布，普通用户创建时应进入草稿', async () => {
      const { agent: userAgent, xsrfToken: userXsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword
      )
      const { agent: adminAgent, xsrfToken: adminXsrfToken } = await createAuthenticatedAgent(
        adminUser.user.email,
        adminUser.plainPassword
      )

      const userResponse = await userAgent
        .post('/api/wiki')
        .set('X-XSRF-TOKEN', userXsrfToken)
        .send({
          slug: `test-user-wiki-${Date.now()}`,
          title: 'User Wiki',
          category: 'general',
          content: 'User content',
        })

      const adminResponse = await adminAgent
        .post('/api/wiki')
        .set('X-XSRF-TOKEN', adminXsrfToken)
        .send({
          slug: `test-admin-wiki-${Date.now()}`,
          title: 'Admin Wiki',
          category: 'general',
          content: 'Admin content',
        })

      expect(userResponse.status).toBe(201)
      expect(adminResponse.status).toBe(201)
      expect(userResponse.body.page.status).toBe('draft')
      expect(adminResponse.body.page.status).toBe('published')
    })

    it('普通用户不能提交后续改为仅管理员编辑分类的草稿', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword
      )
      const categoryId = 'test-admin-only-submit'
      await ensureTestWikiCategory(categoryId, 'Submit Admin Only')
      const wikiPage = await createCurrentUserWikiPage({
        slug: 'test-admin-only-submit-page',
        title: 'Admin Only Submit Page',
        category: categoryId,
        status: 'draft',
      })
      await prisma.wikiCategory.update({
        where: { id: categoryId },
        data: { requiresAdminEdit: true },
      })

      const response = await agent
        .post(`/api/wiki/${wikiPage.slug}/submit`)
        .set('X-XSRF-TOKEN', xsrfToken)

      expect(response.status).toBe(403)
      expect(response.body.error).toBe('只有管理员可以编辑该分类内容')
      const unchangedPage = await prisma.wikiPage.findUnique({ where: { slug: wikiPage.slug } })
      expect(unchangedPage?.status).toBe('draft')
    })

    /**
     * 测试目的：验证未认证用户无法创建页面
     * 预期结果：返回 401 认证错误
     */
    it('未认证用户尝试创建页面应该返回 401 错误', async () => {
      const response = await request(app).post('/api/wiki').send({
        slug: 'test-unauthorized',
        title: 'Unauthorized Create',
        category: 'general',
        content: 'Should not be created',
      })

      expect(response.status).toBe(401)
      expect(response.body).toHaveProperty('error')
    })

    /**
     * 测试目的：验证缺少必填字段的创建请求
     * 预期结果：返回 400 错误并提示缺少必要字段
     */
    it('缺少必填字段时应该返回 400 错误', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword
      )

      // 缺少标题
      const response1 = await agent.post('/api/wiki').set('X-XSRF-TOKEN', xsrfToken).send({
        slug: 'test-no-title',
        category: 'general',
        content: 'No title provided',
      })

      expect(response1.status).toBe(400)
      expect(response1.body.error).toBe('Validation failed')
      expect(response1.body.fields).toBeDefined()

      // 缺少内容
      const response2 = await agent.post('/api/wiki').set('X-XSRF-TOKEN', xsrfToken).send({
        slug: 'test-no-content',
        title: 'No Content',
        category: 'general',
      })

      expect(response2.status).toBe(400)
    })

    /**
     * 测试目的：验证服务端创建时统一分配数字 slug
     * 预期结果：忽略客户端传入的重复 slug 并创建成功
     */
    it('创建页面时忽略客户端传入的重复 slug', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword
      )

      // 先创建一个页面
      await createCurrentUserWikiPage({
        slug: 'test-duplicate-slug',
        title: 'Original Page',
        status: 'published',
      })

      // 尝试使用相同 slug 创建
      const response = await agent.post('/api/wiki').set('X-XSRF-TOKEN', xsrfToken).send({
        slug: 'test-duplicate-slug',
        title: 'Duplicate Page',
        category: 'general',
        content: 'Duplicate content',
      })

      expect(response.status).toBe(201)
      expect(response.body.page.slug).toMatch(/^[1-9]\d*$/)
      expect(response.body.page.slug).not.toBe('test-duplicate-slug')
    })
  })

  // ============================================================================
  // 更新 Wiki 页面接口测试（需要认证）
  // ============================================================================
  describe('PUT /api/wiki/:slug - 更新 Wiki 页面', () => {
    /**
     * 测试目的：验证作者能否成功更新自己创建的页面
     * 预期结果：返回更新后的页面信息
     */
    it('作者应该能够成功更新自己的 Wiki 页面', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword
      )

      // 创建属于当前用户的页面
      const wikiPage = await createTestWikiPage({
        slug: 'test-update-mine',
        title: 'Original Title',
        content: 'Original content',
        authorUid: testUser.user.uid,
        status: 'published',
      })

      const updateData = {
        title: 'Updated Title',
        category: 'general',
        content: 'Updated content with new information',
        tags: ['updated'],
      }

      const response = await agent
        .put(`/api/wiki/${wikiPage.slug}`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send(updateData)

      expect(response.status).toBe(200)
      expect(response.body.page.title).toBe(updateData.title)
      expect(response.body.page.content).toBe(updateData.content)

      // 验证数据库中的更新
      const dbPage = await prisma.wikiPage.findUnique({
        where: { slug: wikiPage.slug },
      })
      expect(dbPage?.title).toBe(updateData.title)
    })

    /**
     * 测试目的：验证非作者无法更新他人的页面
     * 预期结果：返回 403 权限错误
     */
    it('非作者尝试更新他人页面应该返回 403 错误', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword
      )

      // 创建属于其他用户的页面
      const otherUser = await createTestUser()
      const wikiPage = await createTestWikiPage({
        slug: 'test-others-page',
        title: "Other User's Page",
        authorUid: otherUser.user.uid,
        status: 'published',
      })

      // 当前用户尝试更新
      const response = await agent
        .put(`/api/wiki/${wikiPage.slug}`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({
          title: 'Hacked Title',
          content: 'Hacked content',
          category: 'general',
        })

      expect(response.status).toBe(403)
      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toContain('无权')
    })

    /**
     * 测试目的：验证管理员可以更新任何页面
     * 预期结果：管理员应能成功更新其他人的页面
     */
    it('管理员应该能够更新任意页面', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        adminUser.user.email,
        adminUser.plainPassword
      )

      // 创建普通用户的页面
      const wikiPage = await createTestWikiPage({
        slug: 'test-admin-update',
        title: "User's Page",
        authorUid: testUser.user.uid,
        status: 'published',
      })

      // 管理员更新
      const response = await agent
        .put(`/api/wiki/${wikiPage.slug}`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({
          title: 'Admin Updated Title',
          content: 'Admin updated this content',
          category: 'general',
        })

      expect(response.status).toBe(200)
      expect(response.body.page.title).toBe('Admin Updated Title')
    })

    it('管理员更新页面时应保留发布状态，普通用户提交已发布页面应回到待审', async () => {
      const { agent: userAgent, xsrfToken: userXsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword
      )
      const { agent: adminAgent, xsrfToken: adminXsrfToken } = await createAuthenticatedAgent(
        adminUser.user.email,
        adminUser.plainPassword
      )

      const userPage = await createTestWikiPage({
        slug: 'test-user-update-status',
        title: 'User Update Status',
        authorUid: testUser.user.uid,
        status: 'published',
      })
      const adminPage = await createTestWikiPage({
        slug: 'test-admin-update-status',
        title: 'Admin Update Status',
        authorUid: adminUser.user.uid,
        status: 'draft',
      })

      const userResponse = await userAgent
        .put(`/api/wiki/${userPage.slug}`)
        .set('X-XSRF-TOKEN', userXsrfToken)
        .send({
          title: 'User Updated Title',
          content: 'User updated content',
          category: 'general',
        })

      const adminResponse = await adminAgent
        .put(`/api/wiki/${adminPage.slug}`)
        .set('X-XSRF-TOKEN', adminXsrfToken)
        .send({
          title: 'Admin Updated Draft',
          content: 'Admin updated content',
          category: 'general',
        })

      expect(userResponse.status).toBe(200)
      expect(adminResponse.status).toBe(200)
      expect(userResponse.body.page.status).toBe('pending')
      expect(adminResponse.body.page.status).toBe('draft')
    })

    it('普通用户更新已发布页面时应允许显式保存草稿', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword
      )
      const wikiPage = await createTestWikiPage({
        slug: 'test-user-save-published-draft',
        title: 'User Save Published Draft',
        authorUid: testUser.user.uid,
        status: 'published',
      })

      const response = await agent
        .put(`/api/wiki/${wikiPage.slug}`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({
          title: 'User Saved Draft Title',
          content: 'User saved a private draft from a published wiki page.',
          category: 'general',
          status: 'draft',
        })

      expect(response.status).toBe(200)
      expect(response.body.page.status).toBe('draft')

      const dbPage = await prisma.wikiPage.findUnique({
        where: { slug: wikiPage.slug },
      })
      expect(dbPage?.status).toBe('draft')
    })

    /**
     * 测试目的：验证更新不存在的页面
     * 预期结果：返回 404 错误
     */
    it('更新不存在的页面应该返回 404 错误', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword
      )

      const response = await agent
        .put('/api/wiki/nonexistent-for-update')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({
          title: 'Update Nonexistent',
          content: 'Content',
          category: 'general',
        })

      expect(response.status).toBe(404)
      expect(response.body).toHaveProperty('error')
    })

    /**
     * 测试目的：验证未认证用户无法更新页面
     * 预期结果：返回 401 认证错误
     */
    it('未认证用户尝试更新应该返回 401 错误', async () => {
      const wikiPage = await createCurrentUserWikiPage({
        slug: 'test-unauth-update',
        title: 'Unauth Update Test',
        status: 'published',
      })

      const response = await request(app).put(`/api/wiki/${wikiPage.slug}`).send({
        title: 'Unauthorized Update',
        content: 'Hacked',
        category: 'general',
      })

      expect(response.status).toBe(401)
    })
  })

  describe('POST /api/wiki/:slug/rollback/:revisionId - 回滚 Wiki 页面', () => {
    it('回滚页面时应新增一条历史修订快照', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        adminUser.user.email,
        adminUser.plainPassword
      )
      const wikiPage = await createTestWikiPage({
        slug: 'test-rollback-history',
        title: 'Rollback Current Title',
        content: 'Current content before rollback',
        authorUid: testUser.user.uid,
        status: 'published',
      })
      const targetRevision = await prisma.wikiRevision.create({
        data: {
          pageSlug: wikiPage.slug,
          title: 'Rollback Target Title',
          content: 'Content restored by rollback',
          slug: wikiPage.slug,
          category: 'general',
          tags: ['rollback'],
          editorUid: testUser.user.uid,
          editorName: testUser.user.displayName,
        },
      })

      const response = await agent
        .post(`/api/wiki/${wikiPage.slug}/rollback/${targetRevision.id}`)
        .set('X-XSRF-TOKEN', xsrfToken)

      expect(response.status).toBe(200)
      expect(response.body.page.title).toBe('Rollback Target Title')
      expect(response.body.page.content).toBe('Content restored by rollback')

      const revisions = await prisma.wikiRevision.findMany({
        where: { pageSlug: wikiPage.slug },
        orderBy: { createdAt: 'desc' },
      })
      expect(revisions).toHaveLength(2)
      const rollbackRevision = revisions.find(
        (revision) => revision.editorUid === adminUser.user.uid
      )
      expect(rollbackRevision).toMatchObject({
        pageSlug: wikiPage.slug,
        title: 'Rollback Target Title',
        content: 'Content restored by rollback',
        editorUid: adminUser.user.uid,
        editorName: adminUser.user.displayName,
      })

      const moderationLog = await prisma.moderationLog.findFirst({
        where: {
          targetType: 'wiki',
          targetId: wikiPage.slug,
          action: 'rollback',
          operatorUid: adminUser.user.uid,
        },
      })
      expect(moderationLog?.note).toBe(`回滚到版本 ${targetRevision.id}`)
    })
  })

  // ============================================================================
  // 删除 Wiki 页面接口测试（管理员）
  // ============================================================================
  describe('DELETE /api/wiki/:slug - 删除 Wiki 页面', () => {
    it('普通用户不能删除自己的 Wiki 页面', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword
      )
      const wikiPage = await createTestWikiPage({
        slug: 'test-user-delete-forbidden',
        title: 'User Delete Forbidden',
        authorUid: testUser.user.uid,
        status: 'published',
      })

      const response = await agent
        .delete(`/api/wiki/${wikiPage.slug}`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({ reason: '用户尝试删除' })

      expect(response.status).toBe(403)
      await expect(
        prisma.wikiPage.findUnique({ where: { slug: wikiPage.slug } })
      ).resolves.not.toBeNull()
    })

    it('管理员可以删除他人的 Wiki 页面并通知最后编辑者', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        adminUser.user.email,
        adminUser.plainPassword
      )
      const wikiPage = await createTestWikiPage({
        slug: 'test-admin-delete-other',
        title: 'Admin Delete Other',
        authorUid: testUser.user.uid,
        status: 'published',
      })

      await prisma.favorite.create({
        data: {
          userUid: testUser.user.uid,
          targetType: 'wiki',
          targetId: wikiPage.slug,
        },
      })
      await prisma.browsingHistory.create({
        data: {
          userUid: testUser.user.uid,
          targetType: 'wiki',
          targetId: wikiPage.slug,
        },
      })
      await prisma.wikiImageEmbedding.create({
        data: {
          wikiPageSlug: wikiPage.slug,
          imageUrl: 'https://example.com/wiki-image.jpg',
        },
      })
      await prisma.textEmbeddingChunk.create({
        data: {
          sourceType: 'wiki',
          sourceId: wikiPage.slug,
          chunkIndex: 0,
          chunkText: 'Admin Delete Other',
          modelName: 'test-model',
          vectorSize: 3,
        },
      })

      const response = await agent
        .delete(`/api/wiki/${wikiPage.slug}`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({ reason: '重复内容' })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ success: true })
      const deletedPage = await prisma.wikiPage.findUnique({ where: { slug: wikiPage.slug } })
      expect(deletedPage?.deletedAt).not.toBeNull()
      expect(deletedPage?.deletedBy).toBe(adminUser.user.uid)
      await expect(
        prisma.favorite.count({ where: { targetType: 'wiki', targetId: wikiPage.slug } })
      ).resolves.toBe(1)
      await expect(
        prisma.browsingHistory.count({ where: { targetType: 'wiki', targetId: wikiPage.slug } })
      ).resolves.toBe(1)
      await expect(
        prisma.wikiImageEmbedding.count({ where: { wikiPageSlug: wikiPage.slug } })
      ).resolves.toBe(1)
      await expect(
        prisma.textEmbeddingChunk.count({
          where: { sourceType: 'wiki', sourceId: wikiPage.slug },
        })
      ).resolves.toBe(1)

      const notification = await prisma.notification.findFirst({
        where: {
          userUid: testUser.user.uid,
          type: 'review_result',
        },
        orderBy: { createdAt: 'desc' },
      })
      expect(notification).not.toBeNull()
      const payload = notification!.payload as Record<string, unknown>
      expect(payload.action).toBe('deleted')
      expect(payload.targetType).toBe('wiki')
      expect(payload.targetId).toBe(wikiPage.slug)
      expect(payload.title).toBe(wikiPage.title)
      expect(payload.note).toBe('重复内容')
      expect(payload.operatorUid).toBe(adminUser.user.uid)

      const moderationLog = await prisma.moderationLog.findFirst({
        where: {
          targetType: 'wiki',
          targetId: wikiPage.slug,
          action: 'delete',
          operatorUid: adminUser.user.uid,
        },
        orderBy: { createdAt: 'desc' },
      })
      expect(moderationLog).not.toBeNull()
      expect(moderationLog?.note).toBe('重复内容')
    })

    it('管理员删除 Wiki 页面时必须提供删除理由', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        adminUser.user.email,
        adminUser.plainPassword
      )
      const wikiPage = await createTestWikiPage({
        slug: 'test-admin-delete-self',
        title: 'Admin Delete Self',
        authorUid: adminUser.user.uid,
        status: 'published',
      })

      const response = await agent
        .delete(`/api/wiki/${wikiPage.slug}`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({})

      expect(response.status).toBe(400)
      expect(response.body.error).toContain('删除理由不能为空')
      const existingPage = await prisma.wikiPage.findUnique({ where: { slug: wikiPage.slug } })
      expect(existingPage?.deletedAt).toBeNull()
    })

    it('管理员删除自己的 Wiki 页面时带理由成功且不通知自己', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        adminUser.user.email,
        adminUser.plainPassword
      )
      const wikiPage = await createTestWikiPage({
        slug: 'test-admin-delete-self-with-reason',
        title: 'Admin Delete Self With Reason',
        authorUid: adminUser.user.uid,
        status: 'published',
      })

      const response = await agent
        .delete(`/api/wiki/${wikiPage.slug}`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({ reason: '管理员删除共建百科' })

      expect(response.status).toBe(200)
      const deletedPage = await prisma.wikiPage.findUnique({ where: { slug: wikiPage.slug } })
      expect(deletedPage?.deletedAt).not.toBeNull()
      expect(deletedPage?.deletedBy).toBe(adminUser.user.uid)
      const moderationLog = await prisma.moderationLog.findFirst({
        where: {
          targetType: 'wiki',
          targetId: wikiPage.slug,
          action: 'delete',
          operatorUid: adminUser.user.uid,
        },
        orderBy: { createdAt: 'desc' },
      })
      expect(moderationLog?.note).toBe('管理员删除共建百科')
      await expect(
        prisma.notification.count({
          where: {
            userUid: adminUser.user.uid,
            type: 'review_result',
          },
        })
      ).resolves.toBe(0)
    })
  })

  describe('DELETE /api/admin/wiki/:id - 后台删除 Wiki 页面', () => {
    it('管理员后台删除 Wiki 页面时记录删除理由并在管理列表返回', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        adminUser.user.email,
        adminUser.plainPassword
      )
      const wikiPage = await createTestWikiPage({
        slug: 'test-admin-list-delete-wiki',
        title: 'Admin List Delete Wiki',
        authorUid: testUser.user.uid,
        status: 'published',
      })

      const response = await agent
        .delete(`/api/admin/wiki/${wikiPage.id}`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({ reason: '后台管理删除重复条目' })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ success: true })

      const moderationLog = await prisma.moderationLog.findFirst({
        where: {
          targetType: 'wiki',
          targetId: wikiPage.slug,
          action: 'delete',
          operatorUid: adminUser.user.uid,
        },
        orderBy: { createdAt: 'desc' },
      })
      expect(moderationLog).not.toBeNull()
      expect(moderationLog?.note).toBe('后台管理删除重复条目')

      const listResponse = await agent
        .get('/api/admin/wiki')
        .query({ includeDeleted: 'true' })
        .set('X-XSRF-TOKEN', xsrfToken)

      expect(listResponse.status).toBe(200)
      const deletedItem = listResponse.body.data.find(
        (item: { slug: string }) => item.slug === wikiPage.slug
      )
      expect(deletedItem).toBeDefined()
      expect(deletedItem.deletionReason).toBe('后台管理删除重复条目')
    })

    it('分类下只有回收站页面时也不能删除分类', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        adminUser.user.email,
        adminUser.plainPassword
      )
      const categoryId = 'test-soft-deleted-page-category'
      await ensureTestWikiCategory(categoryId, 'Soft Deleted Page Category')
      const wikiPage = await createTestWikiPage({
        slug: 'test-soft-deleted-category-page',
        title: 'Soft Deleted Category Page',
        category: categoryId,
        authorUid: testUser.user.uid,
        status: 'published',
      })
      await prisma.wikiPage.update({
        where: { id: wikiPage.id },
        data: { deletedAt: new Date(), deletedBy: adminUser.user.uid },
      })

      const response = await agent
        .delete(`/api/admin/wiki-categories/${categoryId}`)
        .set('X-XSRF-TOKEN', xsrfToken)

      expect(response.status).toBe(400)
      expect(response.body.error).toContain('包括回收站')
      const category = await prisma.wikiCategory.findUnique({ where: { id: categoryId } })
      expect(category?.deletedAt).toBeNull()
    })
  })

  describe('POST /api/admin/wiki/:id/restore - 恢复 Wiki 页面', () => {
    it('管理员恢复他人的 Wiki 页面后通知最后编辑者', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        adminUser.user.email,
        adminUser.plainPassword
      )
      const wikiPage = await createTestWikiPage({
        slug: 'test-admin-restore-other',
        title: 'Admin Restore Other',
        authorUid: testUser.user.uid,
        status: 'published',
      })
      await prisma.wikiPage.update({
        where: { id: wikiPage.id },
        data: { deletedAt: new Date(), deletedBy: adminUser.user.uid },
      })

      const response = await agent
        .post(`/api/admin/wiki/${wikiPage.id}/restore`)
        .set('X-XSRF-TOKEN', xsrfToken)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ success: true })
      const restoredPage = await prisma.wikiPage.findUnique({ where: { id: wikiPage.id } })
      expect(restoredPage?.deletedAt).toBeNull()
      expect(restoredPage?.deletedBy).toBeNull()

      const notification = await prisma.notification.findFirst({
        where: {
          userUid: testUser.user.uid,
          type: 'review_result',
        },
        orderBy: { createdAt: 'desc' },
      })
      expect(notification).not.toBeNull()
      const payload = notification!.payload as Record<string, unknown>
      expect(payload.action).toBe('restored')
      expect(payload.approved).toBe(true)
      expect(payload.targetType).toBe('wiki')
      expect(payload.targetId).toBe(wikiPage.slug)
      expect(payload.title).toBe(wikiPage.title)
      expect(payload.status).toBe(wikiPage.status)
      expect(payload.linkable).toBe(true)
      expect(payload.operatorUid).toBe(adminUser.user.uid)
    })

    it('恢复 rejected Wiki 页面时通知保留状态供前端避免生成不可访问链接', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        adminUser.user.email,
        adminUser.plainPassword
      )
      const wikiPage = await createTestWikiPage({
        slug: 'test-admin-restore-rejected',
        title: 'Admin Restore Rejected',
        authorUid: testUser.user.uid,
        status: 'rejected',
      })
      await prisma.wikiPage.update({
        where: { id: wikiPage.id },
        data: { deletedAt: new Date(), deletedBy: adminUser.user.uid },
      })

      const response = await agent
        .post(`/api/admin/wiki/${wikiPage.id}/restore`)
        .set('X-XSRF-TOKEN', xsrfToken)

      expect(response.status).toBe(200)
      const notification = await prisma.notification.findFirst({
        where: {
          userUid: testUser.user.uid,
          type: 'review_result',
        },
        orderBy: { createdAt: 'desc' },
      })
      expect(notification).not.toBeNull()
      const payload = notification!.payload as Record<string, unknown>
      expect(payload.action).toBe('restored')
      expect(payload.targetType).toBe('wiki')
      expect(payload.targetId).toBe(wikiPage.slug)
      expect(payload.status).toBe('rejected')
      expect(payload.linkable).toBe(false)
    })

    it('恢复 rejected Wiki 页面时管理员收件人仍可通过通知跳转', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        adminUser.user.email,
        adminUser.plainPassword
      )
      const recipientAdmin = await createTestUser({ role: 'admin' })
      const wikiPage = await createTestWikiPage({
        slug: 'test-admin-restore-rejected-admin-recipient',
        title: 'Admin Restore Rejected Admin Recipient',
        authorUid: recipientAdmin.user.uid,
        status: 'rejected',
      })
      await prisma.wikiPage.update({
        where: { id: wikiPage.id },
        data: { deletedAt: new Date(), deletedBy: adminUser.user.uid },
      })

      const response = await agent
        .post(`/api/admin/wiki/${wikiPage.id}/restore`)
        .set('X-XSRF-TOKEN', xsrfToken)

      expect(response.status).toBe(200)
      const notification = await prisma.notification.findFirst({
        where: {
          userUid: recipientAdmin.user.uid,
          type: 'review_result',
        },
        orderBy: { createdAt: 'desc' },
      })
      expect(notification).not.toBeNull()
      const payload = notification!.payload as Record<string, unknown>
      expect(payload.action).toBe('restored')
      expect(payload.targetType).toBe('wiki')
      expect(payload.targetId).toBe(wikiPage.slug)
      expect(payload.status).toBe('rejected')
      expect(payload.linkable).toBe(true)
    })
  })

  // ============================================================================
  // 边界情况和安全性测试
  // ============================================================================
  describe('边界情况和安全性', () => {
    /**
     * 测试目的：验证超长内容的处理
     * 预期结果：系统应优雅地处理超长输入
     */
    it('应该优雅地处理超长内容', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword
      )
      const longContent = 'x'.repeat(100000) // 100KB 内容

      const response = await agent
        .post('/api/wiki')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({
          slug: `test-long-content-${Date.now()}`,
          title: 'Long Content Test',
          category: 'general',
          content: longContent,
        })

      // 不应该崩溃，可能成功或返回错误
      expect([201, 400, 413]).toContain(response.status)
      expect(response.status).not.toBe(500)
    })

    /**
     * 测试目的：验证 HTML/脚本注入防护
     * 预期结果：恶意脚本应被安全存储或清理
     */
    it('应该正确处理包含 HTML/脚本的内容', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        testUser.user.email,
        testUser.plainPassword
      )
      const maliciousContent = '<script>alert("xss")</script><img src=x onerror="alert(1)">'

      const response = await agent
        .post('/api/wiki')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({
          slug: `test-xss-${Date.now()}`,
          title: '<script>alert("xss")</script>',
          category: 'general',
          content: maliciousContent,
        })

      // 不应该导致服务器错误
      if (response.status === 201) {
        // 如果成功创建，内容应该被存储（可能后续由前端清理）
        expect(response.body.page).toBeDefined()
      }
      expect(response.status).not.toBe(500)
    })

    /**
     * 测试目的：验证并发请求的处理
     * 预期结果：系统应能正确处理并发请求
     */
    it('应该能够处理并发请求', async () => {
      // 发送多个并发请求
      const requests = Array.from({ length: 5 }, (_, i) =>
        request(app).get('/api/wiki').query({ limit: 10 })
      )

      const responses = await Promise.all(requests)

      // 所有请求都应该成功
      responses.forEach((response) => {
        expect(response.status).toBe(200)
        expect(response.body).toHaveProperty('pages')
      })
    })

    /**
     * 测试目的：验证特殊字符 slug 的处理
     * 预期结果：特殊字符应被正确编码或拒绝
     */
    it('应该正确处理包含特殊字符的 slug', async () => {
      // URL 编码的特殊字符
      const specialSlug = encodeURIComponent('test/special?param=value&other=123')

      const response = await request(app).get(`/api/wiki/${specialSlug}`)

      // 不应该导致服务器错误
      expect([200, 400, 404]).toContain(response.status)
      expect(response.status).not.toBe(500)
    })
  })
})
