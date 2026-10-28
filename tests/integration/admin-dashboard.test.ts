import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../../server'
import { createTestPost, createTestUser, prisma } from './setup'
import type { AdminDashboardResponse } from '../../src/types/api'

function findCookieValue(setCookieHeader: string | string[] | undefined, cookieName: string) {
  const cookies = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : []
  const targetCookie = cookies.find((cookie) => cookie?.startsWith(`${cookieName}=`))
  return targetCookie?.split(';')[0].split('=')[1]
}

async function createLoggedInAgent(role: 'admin' | 'user') {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const created = await createTestUser({
    role,
    email: `test_dashboard_${suffix}@example.com`,
    displayName: `TestDashboard_${suffix}`,
  })
  createdUserEmails.push(created.user.email)

  const agent = request.agent(app)
  const loginResponse = await agent.post('/api/auth/login').send({
    email: created.user.email,
    password: created.plainPassword,
  })
  expect(loginResponse.status).toBe(200)
  const xsrfToken = findCookieValue(loginResponse.headers['set-cookie'], 'XSRF-TOKEN')
  expect(xsrfToken).toBeTruthy()
  return { agent, uid: created.user.uid }
}

const createdUserEmails: string[] = []
const createdPostIds: string[] = []

afterEach(async () => {
  if (createdPostIds.length > 0) {
    await prisma.post.deleteMany({ where: { id: { in: createdPostIds } } })
    createdPostIds.length = 0
  }
  if (createdUserEmails.length > 0) {
    await prisma.user.deleteMany({ where: { email: { in: createdUserEmails } } })
    createdUserEmails.length = 0
  }
})

async function fetchDashboard(agent: request.Agent) {
  const response = await agent.get('/api/admin/dashboard')
  expect(response.status).toBe(200)
  return response.body as AdminDashboardResponse
}

describe('GET /api/admin/dashboard', () => {
  it('未登录返回 401', async () => {
    const response = await request(app).get('/api/admin/dashboard')
    expect(response.status).toBe(401)
  })

  it('普通用户返回 403', async () => {
    const { agent } = await createLoggedInAgent('user')
    const response = await agent.get('/api/admin/dashboard')
    expect(response.status).toBe(403)
  })

  it('管理员获取总览并符合契约结构', async () => {
    const { agent } = await createLoggedInAgent('admin')
    const body = await fetchDashboard(agent)

    expect(body.success).toBe(true)
    expect(typeof body.timestamp).toBe('string')

    const { data } = body
    for (const value of Object.values(data.stats)) {
      expect(typeof value).toBe('number')
      expect(value).toBeGreaterThanOrEqual(0)
    }

    const reviewSum =
      data.reviewQueue.counts.wiki +
      data.reviewQueue.counts.posts +
      data.reviewQueue.counts.galleries +
      data.reviewQueue.counts.tickets
    expect(data.reviewQueue.status).toBe('pending')
    expect(data.reviewQueue.total).toBe(reviewSum)

    expect(data.trends.dates).toHaveLength(30)
    expect(data.trends.rangeStart).toBe(data.trends.dates[0])
    expect(data.trends.rangeEnd).toBe(data.trends.dates[29])
    for (const date of data.trends.dates) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    for (const key of ['posts', 'galleries', 'wiki', 'users'] as const) {
      expect(data.trends.series[key]).toHaveLength(30)
      expect(data.trends.totals[key]).toBe(data.trends.series[key].reduce((a, b) => a + b, 0))
    }

    for (const subsystem of Object.values(data.system)) {
      if ('error' in subsystem) {
        expect(typeof subsystem.error).toBe('string')
      } else {
        expect(subsystem.data).toBeTruthy()
      }
    }
  })

  it('新增待审核帖子后审核计数增加', async () => {
    const { agent, uid } = await createLoggedInAgent('admin')
    const before = await fetchDashboard(agent)

    const post = await createTestPost({ status: 'pending', authorUid: uid })
    createdPostIds.push(post.id)

    const after = await fetchDashboard(agent)
    expect(after.data.reviewQueue.counts.posts).toBe(before.data.reviewQueue.counts.posts + 1)
    expect(after.data.reviewQueue.total).toBe(before.data.reviewQueue.total + 1)
  })

  it('新注册用户进入统计与当日趋势', async () => {
    const { agent } = await createLoggedInAgent('admin')
    const before = await fetchDashboard(agent)

    const newUserEmail = `test_dashboard_user_${Date.now()}_x@example.com`
    await createTestUser({
      email: newUserEmail,
      displayName: `TestDashboardUser_${Date.now()}`,
    })
    createdUserEmails.push(newUserEmail)

    const after = await fetchDashboard(agent)
    expect(after.data.stats.users).toBe(before.data.stats.users + 1)
    expect(after.data.trends.series.users[29]).toBe(before.data.trends.series.users[29] + 1)
    expect(after.data.trends.totals.users).toBe(before.data.trends.totals.users + 1)
  })
})
