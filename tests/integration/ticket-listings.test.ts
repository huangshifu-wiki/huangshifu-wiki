import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../../server'
import { createTestToken, createTestUser, nextTestNumericSlug, prisma } from './setup'

const TEST_PREFIX = 'ROI Ticket'
const EMAIL_PREFIX = 'roi_ticket_'

function pickCookie(setCookie: string[] | string | undefined, name: string) {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
  return values
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split(';')[0]
    .split('=')[1]
}

async function createAuthenticatedAgent(email: string, password: string) {
  const agent = request.agent(app)
  const response = await agent.post('/api/auth/login').send({ email, password })
  expect(response.status).toBe(200)
  const xsrfToken = pickCookie(response.headers['set-cookie'], 'XSRF-TOKEN')
  expect(xsrfToken).toBeTruthy()
  return { agent, xsrfToken: xsrfToken! }
}

async function cleanupTicketTestData() {
  const listings = await prisma.ticketListing.findMany({
    where: {
      OR: [
        { customEventName: { startsWith: TEST_PREFIX } },
        { event: { title: { startsWith: TEST_PREFIX } } },
      ],
    },
    select: { id: true, eventId: true },
  })
  const listingIds = listings.map((listing) => listing.id)
  if (listingIds.length) {
    await prisma.moderationLog.deleteMany({ where: { targetId: { in: listingIds } } })
    await prisma.ticketListing.deleteMany({ where: { id: { in: listingIds } } })
  }
  await prisma.event.deleteMany({ where: { title: { startsWith: TEST_PREFIX } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } })
}

describe('Ticket listings API', () => {
  let user: Awaited<ReturnType<typeof createTestUser>>
  let admin: Awaited<ReturnType<typeof createTestUser>>
  let banned: Awaited<ReturnType<typeof createTestUser>>
  let event: Awaited<ReturnType<typeof prisma.event.create>>

  beforeEach(async () => {
    await cleanupTicketTestData()
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    user = await createTestUser({
      email: `${EMAIL_PREFIX}user_${suffix}@example.com`,
      displayName: 'ROITicketUser',
    })
    admin = await createTestUser({
      email: `${EMAIL_PREFIX}admin_${suffix}@example.com`,
      role: 'admin',
      displayName: 'ROITicketAdmin',
    })
    banned = await createTestUser({
      email: `${EMAIL_PREFIX}banned_${suffix}@example.com`,
      displayName: 'ROITicketBanned',
    })
    await prisma.user.update({ where: { uid: banned.user.uid }, data: { status: 'banned' } })
    event = await prisma.event.create({
      data: {
        slug: nextTestNumericSlug(),
        title: `${TEST_PREFIX} Live`,
        location: '上海',
        content: '',
        createdByUid: admin.user.uid,
        updatedByUid: admin.user.uid,
      },
    })
  })

  afterEach(async () => {
    await cleanupTicketTestData()
  })

  it('supports auth boundaries, drafts, review lifecycle, public visibility, and deletion', async () => {
    const anonymous = await request(app).post('/api/ticket-listings').send({})
    expect(anonymous.status).toBe(401)
    const anonymousMine = await request(app).get('/api/ticket-listings/mine')
    expect(anonymousMine.status).toBe(401)

    const userAgent = await createAuthenticatedAgent(user.user.email, user.plainPassword)
    const adminAgent = await createAuthenticatedAgent(admin.user.email, admin.plainPassword)
    const bannedToken = await createTestToken(banned.user.uid, 'user')

    const draft = await userAgent.agent
      .post('/api/ticket-listings')
      .set('X-XSRF-TOKEN', userAgent.xsrfToken)
      .send({
        type: 'request',
        customEventName: `${TEST_PREFIX} Custom`,
        quantity: 1,
        ticketTier: '内场',
        seat: '',
        description: 'draft **markdown**',
        contact: 'draft-contact',
        status: 'draft',
      })
    expect(draft.status).toBe(201)
    expect(draft.body.listing.status).toBe('draft')

    const pending = await userAgent.agent
      .post('/api/ticket-listings')
      .set('X-XSRF-TOKEN', userAgent.xsrfToken)
      .send({
        type: 'offer',
        eventId: event.id,
        quantity: 2,
        ticketTier: '看台',
        seat: 'A区',
        description: '**详情**',
        contact: 'contact@example.com',
        status: 'pending',
      })
    expect(pending.status).toBe(201)
    expect(pending.body.listing.status).toBe('pending')
    expect(pending.body.listing.eventName).toBe(event.title)
    expect(pending.body.listing.eventSlug).toBe(event.slug)

    const bannedResponse = await request(app)
      .post('/api/ticket-listings')
      .set('Authorization', `Bearer ${bannedToken}`)
      .send({
        type: 'offer',
        customEventName: `${TEST_PREFIX} Banned`,
        quantity: 1,
        ticketTier: '看台',
        contact: 'contact',
      })
    expect(bannedResponse.status).toBe(403)

    const hidden = await request(app).get('/api/ticket-listings').query({ q: TEST_PREFIX })
    expect(hidden.status).toBe(200)
    expect(hidden.body.listings).toHaveLength(0)

    const rejectedWithoutNote = await adminAgent.agent
      .put(`/api/admin/review-queue/${pending.body.listing.id}/reject`)
      .set('X-XSRF-TOKEN', adminAgent.xsrfToken)
      .send({ type: 'ticket' })
    expect(rejectedWithoutNote.status).toBe(400)

    const rejection = await adminAgent.agent
      .put(`/api/admin/review-queue/${pending.body.listing.id}/reject`)
      .set('X-XSRF-TOKEN', adminAgent.xsrfToken)
      .send({ type: 'ticket', note: 'ROI 请补充座位信息' })

    expect(rejection.status).toBe(200)
    expect(rejection.body.item.status).toBe('rejected')

    const rejectionNotification = await prisma.notification.findFirst({
      where: { userUid: user.user.uid, type: 'review_result' },
      orderBy: { createdAt: 'desc' },
    })
    expect(rejectionNotification?.payload).toMatchObject({
      targetType: 'ticketListing',
      targetId: pending.body.listing.id,
      approved: false,
    })
    const resubmitted = await userAgent.agent
      .put(`/api/ticket-listings/${pending.body.listing.id}`)
      .set('X-XSRF-TOKEN', userAgent.xsrfToken)
      .send({
        type: 'offer',
        eventId: event.id,
        quantity: 2,
        ticketTier: '看台',
        seat: 'A区',
        description: '**详情**',
        contact: 'contact@example.com',
        status: 'pending',
      })
    expect(resubmitted.status).toBe(200)
    expect(resubmitted.body.listing.status).toBe('pending')

    const approved = await adminAgent.agent
      .put(`/api/admin/review-queue/${pending.body.listing.id}/approve`)
      .set('X-XSRF-TOKEN', adminAgent.xsrfToken)
      .send({ type: 'ticket' })
    expect(approved.status).toBe(200)
    expect(approved.body.item.status).toBe('published')
    const filteredList = await request(app).get('/api/ticket-listings').query({
      type: 'offer',
      eventId: event.id,
      q: 'Live',
      limit: 1,
    })
    expect(filteredList.status).toBe(200)
    expect(filteredList.body.listings.map((item: { id: string }) => item.id)).toContain(
      pending.body.listing.id
    )
    expect(filteredList.body.total).toBeGreaterThanOrEqual(1)

    const publicDetail = await request(app).get(`/api/ticket-listings/${pending.body.listing.slug}`)
    expect(publicDetail.status).toBe(200)
    expect(publicDetail.body.listing).toMatchObject({
      description: '**详情**',
      contact: 'contact@example.com',
      eventName: event.title,
    })

    const edited = await userAgent.agent
      .put(`/api/ticket-listings/${pending.body.listing.id}`)
      .set('X-XSRF-TOKEN', userAgent.xsrfToken)
      .send({
        type: 'offer',
        eventId: event.id,
        quantity: 3,
        ticketTier: '看台',
        seat: 'B区',
        description: 'updated',
        contact: 'updated@example.com',
        status: 'draft',
      })
    expect(edited.status).toBe(200)
    expect(edited.body.listing.status).toBe('pending')

    const otherUser = await createTestUser({
      email: `${EMAIL_PREFIX}other_${Date.now()}@example.com`,
    })
    const otherToken = await createTestToken(otherUser.user.uid, 'user')
    const forbidden = await request(app)
      .put(`/api/ticket-listings/${pending.body.listing.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({
        type: 'offer',
        eventId: event.id,
        quantity: 1,
        ticketTier: '看台',
        contact: 'nope',
      })
    expect(forbidden.status).toBe(403)

    const deleted = await userAgent.agent
      .delete(`/api/ticket-listings/${pending.body.listing.id}`)
      .set('X-XSRF-TOKEN', userAgent.xsrfToken)
      .send({ reason: 'ROI 作者主动删除' })
    expect(deleted.status).toBe(200)
    expect(
      (await request(app).get(`/api/ticket-listings/${pending.body.listing.slug}`)).status
    ).toBe(404)

    const restored = await adminAgent.agent
      .post(`/api/admin/ticket-listings/${pending.body.listing.id}/restore`)
      .set('X-XSRF-TOKEN', adminAgent.xsrfToken)
    expect(restored.status).toBe(200)
    const permanentlyDeleted = await adminAgent.agent
      .delete(`/api/admin/ticket-listings/${pending.body.listing.id}/permanent`)
      .set('X-XSRF-TOKEN', adminAgent.xsrfToken)
    expect(permanentlyDeleted.status).toBe(200)
    expect(
      await prisma.ticketListing.findUnique({ where: { id: pending.body.listing.id } })
    ).toBeNull()
  })

  it('preserves a linked event name when the event is permanently deleted', async () => {
    const adminAgent = await createAuthenticatedAgent(admin.user.email, admin.plainPassword)
    const created = await adminAgent.agent
      .post('/api/ticket-listings')
      .set('X-XSRF-TOKEN', adminAgent.xsrfToken)
      .send({
        type: 'offer',
        eventId: event.id,
        quantity: 1,
        ticketTier: '看台',
        contact: 'event-preservation',
        status: 'published',
      })
    expect(created.status).toBe(201)

    const deletedEvent = await adminAgent.agent
      .delete(`/api/admin/events/${event.id}/permanent`)
      .set('X-XSRF-TOKEN', adminAgent.xsrfToken)
    expect(deletedEvent.status).toBe(200)

    const preserved = await prisma.ticketListing.findUnique({
      where: { id: created.body.listing.id },
    })
    expect(preserved).toMatchObject({ eventId: null, customEventName: event.title })
  })
})
