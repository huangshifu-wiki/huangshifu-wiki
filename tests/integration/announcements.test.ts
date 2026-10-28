import { describe, beforeEach, afterEach, it, expect } from 'vitest'
import request from 'supertest'
import { app } from '../../server'
import { prisma, createTestUser } from './setup'

const TEST_CONTENT_PREFIX = 'test-ann-'

async function cleanupTestAnnouncements() {
  await prisma.announcement.deleteMany({
    where: { content: { startsWith: TEST_CONTENT_PREFIX } },
  })
}

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

describe('Announcements API - 公告接口测试', () => {
  let adminUser: Awaited<ReturnType<typeof createTestUser>>

  beforeEach(async () => {
    await cleanupTestAnnouncements()
    adminUser = await createTestUser({ role: 'admin' })
  })

  afterEach(async () => {
    await cleanupTestAnnouncements()
  })

  describe('GET /api/announcements/list 公开列表', () => {
    it('游客可访问，仅返回 active 且未删除的公告并按时间倒序', async () => {
      await prisma.announcement.create({
        data: {
          content: `${TEST_CONTENT_PREFIX}旧`,
          active: true,
          createdAt: new Date('2026-01-01'),
        },
      })
      await prisma.announcement.create({
        data: {
          content: `${TEST_CONTENT_PREFIX}新`,
          active: true,
          createdAt: new Date('2026-01-03'),
        },
      })
      await prisma.announcement.create({
        data: {
          content: `${TEST_CONTENT_PREFIX}停用`,
          active: false,
          createdAt: new Date('2026-01-02'),
        },
      })
      await prisma.announcement.create({
        data: {
          content: `${TEST_CONTENT_PREFIX}已删`,
          active: true,
          deletedAt: new Date(),
          createdAt: new Date('2026-01-04'),
        },
      })

      const response = await request(app).get('/api/announcements/list').expect(200)

      expect(response.body.announcements).toHaveLength(2)
      expect(response.body.announcements.map((a: { content: string }) => a.content)).toEqual([
        `${TEST_CONTENT_PREFIX}新`,
        `${TEST_CONTENT_PREFIX}旧`,
      ])
      // 不泄露软删除等内部字段
      expect(response.body.announcements[0]).toMatchObject({
        content: `${TEST_CONTENT_PREFIX}新`,
      })
      expect(response.body.announcements[0]).not.toHaveProperty('active')
      expect(response.body.announcements[0]).not.toHaveProperty('deletedAt')
      expect(response.body.announcements[0]).not.toHaveProperty('deletedBy')
      expect(response.body.total).toBe(2)
      expect(response.body).toMatchObject({ page: 1, limit: 20, totalPages: 1, hasMore: false })
    })

    it('支持分页并正确输出 hasMore', async () => {
      for (let i = 1; i <= 3; i += 1) {
        await prisma.announcement.create({
          data: {
            content: `${TEST_CONTENT_PREFIX}第${i}条`,
            active: true,
            createdAt: new Date(`2026-01-0${i}`),
          },
        })
      }

      const page1 = await request(app).get('/api/announcements/list?limit=2&page=1').expect(200)
      expect(page1.body.announcements).toHaveLength(2)
      expect(page1.body.hasMore).toBe(true)
      expect(page1.body.totalPages).toBe(2)

      const page2 = await request(app).get('/api/announcements/list?limit=2&page=2').expect(200)
      expect(page2.body.announcements).toHaveLength(1)
      expect(page2.body.hasMore).toBe(false)

      const empty = await request(app).get('/api/announcements/list?limit=2&page=9').expect(200)
      expect(empty.body.announcements).toHaveLength(0)
    })

    it('limit 超出上限时截断为 100', async () => {
      const response = await request(app)
        .get('/api/announcements/list?limit=5000&page=1')
        .expect(200)

      expect(response.body.limit).toBe(100)
    })
  })

  describe('管理端写入与公开列表联动', () => {
    it('管理员创建的公告出现在公开列表，停用后消失', async () => {
      const { agent, xsrfToken } = await createAuthenticatedAgent(
        adminUser.user.email,
        adminUser.plainPassword
      )

      const createResponse = await agent
        .post('/api/announcements')
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({ content: `${TEST_CONTENT_PREFIX}上线`, active: true })
      expect(createResponse.status).toBe(201)
      const createdId = createResponse.body.announcement.id as string

      const listBefore = await request(app).get('/api/announcements/list').expect(200)
      expect(listBefore.body.announcements.map((a: { id: string }) => a.id)).toContain(createdId)

      await agent
        .patch(`/api/announcements/${createdId}`)
        .set('X-XSRF-TOKEN', xsrfToken)
        .send({ active: false })

      const listAfter = await request(app).get('/api/announcements/list').expect(200)
      expect(listAfter.body.announcements.map((a: { id: string }) => a.id)).not.toContain(createdId)
    })

    it('未登录用户无法创建公告', async () => {
      const response = await request(app)
        .post('/api/announcements')
        .send({ content: `${TEST_CONTENT_PREFIX}越权` })
      expect([401, 403]).toContain(response.status)
    })
  })
})
