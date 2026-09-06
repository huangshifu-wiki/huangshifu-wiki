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
    sortStart: string | null = null
  ) {
    return prisma.event.create({
      data: {
        slug: nextTestNumericSlug(),
        title,
        location: '',
        content: '',
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
      'Event Tags Test New',
      'Event Tags Test Old',
      'Event Tags Test Unknown Time',
    ])
    expect(ascResponse.status).toBe(200)
    expect(ascResponse.body.events.map((event: { title: string }) => event.title)).toEqual([
      'Event Tags Test Old',
      'Event Tags Test New',
      'Event Tags Test Unknown Time',
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
    expect(titles(firstPage)).toEqual(['Event Tags Test Today', 'Event Tags Test Future Near'])
    expect(titles(secondPage)).toEqual([
      'Event Tags Test Future Far',
      'Event Tags Test Past Recent',
    ])
    expect(titles(thirdPage)).toEqual(['Event Tags Test Past Old', 'Event Tags Test No Time'])
  })

  it('从未删除活动聚合可筛选标签', async () => {
    await createEvent('Event Tags Test Live', ['现场', '巡演'])
    await createEvent('Event Tags Test More Live', ['现场', '节日'])
    await createEvent('Event Tags Test Deleted', ['隐藏'], new Date())

    const response = await request(app).get('/api/events/tags')

    expect(response.status).toBe(200)
    expect(response.body.tags).toEqual(['节日', '现场', '巡演'])
  })
})
