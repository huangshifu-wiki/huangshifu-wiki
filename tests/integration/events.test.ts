import { describe, beforeEach, afterEach, it, expect } from 'vitest'
import request from 'supertest'
import { app } from '../../server'
import { prisma, createTestUser, nextTestNumericSlug } from './setup'

async function cleanupEventTestData() {
  await prisma.event.deleteMany({
    where: {
      title: {
        startsWith: 'Event Tags Test',
      },
    },
  })
  await prisma.user.deleteMany({
    where: {
      email: {
        startsWith: 'test_events_',
      },
    },
  })
}

function pickCookie(setCookieHeader: string | string[] | undefined, cookieName: string) {
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
  const xsrfToken = pickCookie(loginResponse.headers['set-cookie'], 'XSRF-TOKEN')
  expect(xsrfToken).toBeTruthy()
  return { agent, xsrfToken: xsrfToken! }
}

describe('Events API - 活动标签筛选', () => {
  let adminUser: Awaited<ReturnType<typeof createTestUser>>

  beforeEach(async () => {
    await cleanupEventTestData()
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    adminUser = await createTestUser({
      role: 'admin',
      email: `test_events_admin_${suffix}@example.com`,
      displayName: `TestEventsAdmin_${suffix}`,
    })
  })

  afterEach(async () => {
    await cleanupEventTestData()
  })

  async function createEvent(
    title: string,
    tags: string[],
    deletedAt: Date | null = null,
    sortStart: string | null = null,
    timeStatus: 'pending' | 'postponed' | null = sortStart ? null : 'pending'
  ) {
    return prisma.event.create({
      data: {
        slug: nextTestNumericSlug(),
        title,
        location: '',
        content: '',
        timeSlots: sortStart ? [{ type: 'date', start: sortStart }] : [],
        timeStatus,
        tags,
        sortStart,
        createdByUid: adminUser.user.uid,
        updatedByUid: adminUser.user.uid,
        deletedAt,
      },
    })
  }

  it('按单个标签筛选活动列表，并在响应中返回标签数组', async () => {
    await createEvent('Event Tags Test Live', ['现场', '巡演'])
    await createEvent('Event Tags Test Online', ['线上'])

    const response = await request(app).get('/api/events').query({ tag: '现场' })

    expect(response.status).toBe(200)
    expect(response.body.events).toHaveLength(1)
    expect(response.body.events[0].title).toBe('Event Tags Test Live')
    expect(response.body.events[0].tags).toEqual(['现场', '巡演'])
    expect(response.body.total).toBe(1)
  })

  it('默认按活动时间倒序排列，也支持显式正序', async () => {
    await createEvent('Event Tags Test Old', ['排序'], null, '2024-01-01')
    await createEvent('Event Tags Test New', ['排序'], null, '2024-02-01')
    await createEvent('Event Tags Test Unknown Time', ['排序'])

    const descResponse = await request(app).get('/api/events').query({ tag: '排序' })
    const ascResponse = await request(app)
      .get('/api/events')
      .query({ tag: '排序', sortOrder: 'asc' })

    expect(descResponse.status).toBe(200)
    expect(descResponse.body.events.map((event: { title: string }) => event.title)).toEqual([
      'Event Tags Test Unknown Time',
      'Event Tags Test New',
      'Event Tags Test Old',
    ])
    expect(ascResponse.status).toBe(200)
    expect(ascResponse.body.events.map((event: { title: string }) => event.title)).toEqual([
      'Event Tags Test Unknown Time',
      'Event Tags Test Old',
      'Event Tags Test New',
    ])
  })

  it('待定和推迟活动始终排在有明确时间的活动之前', async () => {
    await createEvent('Event Tags Test Priority Timed', ['优先级'], null, '2024-02-01')
    await createEvent('Event Tags Test Priority Pending', ['优先级'], null, null, 'pending')
    await createEvent('Event Tags Test Priority Postponed', ['优先级'], null, null, 'postponed')

    const descResponse = await request(app).get('/api/events').query({ tag: '优先级' })
    const ascResponse = await request(app)
      .get('/api/events')
      .query({ tag: '优先级', sortOrder: 'asc' })

    const titles = (response: { body: { events: Array<{ title: string }> } }) =>
      response.body.events.map((event) => event.title)

    expect(titles(descResponse)).toEqual([
      'Event Tags Test Priority Pending',
      'Event Tags Test Priority Postponed',
      'Event Tags Test Priority Timed',
    ])
    expect(titles(ascResponse)).toEqual([
      'Event Tags Test Priority Pending',
      'Event Tags Test Priority Postponed',
      'Event Tags Test Priority Timed',
    ])
  })

  function toSortStart(offsetDays: number) {
    const date = new Date()
    date.setDate(date.getDate() + offsetDays)
    const month = `${date.getMonth() + 1}`.padStart(2, '0')
    const day = `${date.getDate()}`.padStart(2, '0')
    return `${date.getFullYear()}-${month}-${day}`
  }

  it('sortOrder=upcoming 先列未来（近到远），再列过去（近到远），无时间垫底', async () => {
    await createEvent('Event Tags Test Future Far', ['排序'], null, toSortStart(10))
    await createEvent('Event Tags Test Past Recent', ['排序'], null, toSortStart(-1))
    await createEvent('Event Tags Test Future Near', ['排序'], null, toSortStart(1))
    await createEvent('Event Tags Test Past Old', ['排序'], null, toSortStart(-10))
    await createEvent('Event Tags Test No Time', ['排序'])
    await createEvent('Event Tags Test Today', ['排序'], null, toSortStart(0))

    const query = { tag: '排序', sortOrder: 'upcoming', limit: 2 }
    const firstPage = await request(app)
      .get('/api/events')
      .query({ ...query, page: 1 })
    const secondPage = await request(app)
      .get('/api/events')
      .query({ ...query, page: 2 })
    const thirdPage = await request(app)
      .get('/api/events')
      .query({ ...query, page: 3 })

    const titles = (response: { body: { events: Array<{ title: string }> } }) =>
      response.body.events.map((event) => event.title)

    expect(firstPage.status).toBe(200)
    expect(firstPage.body.total).toBe(6)
    expect(titles(firstPage)).toEqual(['Event Tags Test No Time', 'Event Tags Test Today'])
    expect(titles(secondPage)).toEqual([
      'Event Tags Test Future Near',
      'Event Tags Test Future Far',
    ])
    expect(titles(thirdPage)).toEqual(['Event Tags Test Past Recent', 'Event Tags Test Past Old'])
  })

  it('从未删除活动聚合可筛选标签', async () => {
    await createEvent('Event Tags Test Live', ['现场', '巡演'])
    await createEvent('Event Tags Test More Live', ['现场', '节日'])
    await createEvent('Event Tags Test Deleted', ['隐藏'], new Date())

    const response = await request(app).get('/api/events/tags')

    expect(response.status).toBe(200)
    expect(response.body.tags).toEqual(['节日', '现场', '巡演'])
  })
  it('写入时间状态并拒绝缺少时间和状态的活动', async () => {
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const pendingResponse = await agent
      .post('/api/events')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ title: 'Event Tags Test Pending', timeStatus: 'pending' })
      .expect(201)

    expect(pendingResponse.body.event.timeStatus).toBe('pending')
    expect(pendingResponse.body.event.sortStart).toBeNull()

    const missingTimeResponse = await agent
      .post('/api/events')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ title: 'Event Tags Test Missing Time' })

    expect(missingTimeResponse.status).toBe(400)

    const scheduledResponse = await agent
      .post('/api/events')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        title: 'Event Tags Test Scheduled',
        timeSlots: [{ type: 'date', start: '2026-10-01' }],
        timeStatus: null,
      })
      .expect(201)

    expect(scheduledResponse.body.event.timeStatus).toBeNull()
    expect(scheduledResponse.body.event.timeSlots).toEqual([{ type: 'date', start: '2026-10-01' }])
  })
})
