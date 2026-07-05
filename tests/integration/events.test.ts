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

  async function createEvent(title: string, tags: string[], deletedAt: Date | null = null) {
    return prisma.event.create({
      data: {
        slug: nextTestNumericSlug(),
        title,
        location: '',
        content: '',
        tags,
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

  it('从未删除活动聚合可筛选标签', async () => {
    await createEvent('Event Tags Test Live', ['现场', '巡演'])
    await createEvent('Event Tags Test More Live', ['现场', '节日'])
    await createEvent('Event Tags Test Deleted', ['隐藏'], new Date())

    const response = await request(app).get('/api/events/tags')

    expect(response.status).toBe(200)
    expect(response.body.tags).toEqual(['节日', '现场', '巡演'])
  })
})
