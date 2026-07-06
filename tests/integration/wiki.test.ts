import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../../server'
import {
  prisma,
  createTestToken,
  createTestUser,
  createTestWikiPage,
  ensureTestWikiCategory,
  nextTestNumericSlug,
} from './setup'

const WIKI_TITLE_PREFIX = 'ROI Wiki'
const WIKI_SLUG_PREFIX = 'roi-wiki-'

async function cleanupWikiTestData() {
  await prisma.wikiImageEmbedding.deleteMany({
    where: { wikiPageSlug: { startsWith: WIKI_SLUG_PREFIX } },
  })
  await prisma.textEmbeddingChunk.deleteMany({
    where: {
      sourceType: 'wiki',
      sourceId: { startsWith: WIKI_SLUG_PREFIX },
    },
  })
  await prisma.notification.deleteMany({
    where: {
      OR: [
        { payload: { path: ['title'], string_starts_with: WIKI_TITLE_PREFIX } },
        { payload: { path: ['targetType'], equals: 'wiki' } },
      ],
    },
  })
  await prisma.moderationLog.deleteMany({
    where: {
      targetType: 'wiki',
      OR: [{ targetId: { startsWith: WIKI_SLUG_PREFIX } }, { note: { contains: 'ROI' } }],
    },
  })
  await prisma.wikiPage.deleteMany({
    where: {
      OR: [
        { slug: { startsWith: WIKI_SLUG_PREFIX } },
        { title: { startsWith: WIKI_TITLE_PREFIX } },
      ],
    },
  })
  await prisma.wikiCategory.deleteMany({
    where: { id: { startsWith: 'roi-wiki-category-' } },
  })
  await prisma.user.deleteMany({
    where: { email: { startsWith: 'roi_wiki_' } },
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

describe('Wiki API', () => {
  let normalUser: Awaited<ReturnType<typeof createTestUser>>
  let adminUser: Awaited<ReturnType<typeof createTestUser>>
  let userToken: string

  beforeEach(async () => {
    await cleanupWikiTestData()
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    normalUser = await createTestUser({
      role: 'user',
      email: `roi_wiki_user_${suffix}@example.com`,
      displayName: `RoiWikiUser_${suffix}`,
    })
    adminUser = await createTestUser({
      role: 'admin',
      email: `roi_wiki_admin_${suffix}@example.com`,
      displayName: `RoiWikiAdmin_${suffix}`,
    })
    userToken = await createTestToken(normalUser.user.uid, normalUser.user.role)
    await ensureTestWikiCategory('general', 'General')
  })

  afterEach(async () => {
    await cleanupWikiTestData()
  })

  it('lists only published pages to visitors', async () => {
    const publishedPage = await createTestWikiPage({
      slug: `${WIKI_SLUG_PREFIX}published`,
      title: `${WIKI_TITLE_PREFIX} Published`,
      status: 'published',
      authorUid: normalUser.user.uid,
    })
    const draftPage = await createTestWikiPage({
      slug: `${WIKI_SLUG_PREFIX}draft`,
      title: `${WIKI_TITLE_PREFIX} Draft`,
      status: 'draft',
      authorUid: normalUser.user.uid,
    })

    const publicResponse = await request(app)
      .get('/api/wiki')
      .query({ category: 'general', limit: 50 })
    expect(publicResponse.status).toBe(200)
    const publicSlugs = publicResponse.body.pages.map((page: { slug: string }) => page.slug)
    expect(publicSlugs).toContain(publishedPage.slug)
    expect(publicSlugs).not.toContain(draftPage.slug)

    const visitorDetailResponse = await request(app).get(`/api/wiki/${draftPage.slug}`)
    expect(visitorDetailResponse.status).toBe(404)
  })

  it('creates pages with review-aware defaults and rejects anonymous writes', async () => {
    const { agent: userAgent, xsrfToken: userXsrfToken } = await createAuthenticatedAgent(
      normalUser.user.email,
      normalUser.plainPassword
    )
    const { agent: adminAgent, xsrfToken: adminXsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const userResponse = await userAgent
      .post('/api/wiki')
      .set('X-XSRF-TOKEN', userXsrfToken)
      .send({
        slug: `${WIKI_SLUG_PREFIX}client-user`,
        title: `${WIKI_TITLE_PREFIX} Created By User`,
        category: 'general',
        content: 'User content',
      })
    const adminResponse = await adminAgent
      .post('/api/wiki')
      .set('X-XSRF-TOKEN', adminXsrfToken)
      .send({
        slug: `${WIKI_SLUG_PREFIX}client-admin`,
        title: `${WIKI_TITLE_PREFIX} Created By Admin`,
        category: 'general',
        content: 'Admin content',
      })
    const anonymousResponse = await request(app)
      .post('/api/wiki')
      .send({
        title: `${WIKI_TITLE_PREFIX} Anonymous`,
        category: 'general',
        content: 'Anonymous content',
      })

    expect(userResponse.status).toBe(201)
    expect(userResponse.body.page.status).toBe('draft')
    expect(userResponse.body.page.slug).toMatch(/^[1-9]\d*$/)
    expect(adminResponse.status).toBe(201)
    expect(adminResponse.body.page.status).toBe('published')
    expect(anonymousResponse.status).toBe(401)
  })

  it('enforces update ownership while allowing admins to edit any page', async () => {
    const otherUser = await createTestUser({
      email: `roi_wiki_other_${Date.now()}@example.com`,
      displayName: `RoiWikiOther_${Date.now()}`,
    })
    const page = await createTestWikiPage({
      slug: `${WIKI_SLUG_PREFIX}update-owned`,
      title: `${WIKI_TITLE_PREFIX} Update Owned`,
      status: 'published',
      authorUid: otherUser.user.uid,
    })
    const { agent: userAgent, xsrfToken: userXsrfToken } = await createAuthenticatedAgent(
      normalUser.user.email,
      normalUser.plainPassword
    )
    const { agent: adminAgent, xsrfToken: adminXsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const forbiddenResponse = await userAgent
      .put(`/api/wiki/${page.slug}`)
      .set('X-XSRF-TOKEN', userXsrfToken)
      .send({
        title: `${WIKI_TITLE_PREFIX} Hijacked`,
        category: 'general',
        content: 'Nope',
      })
    expect(forbiddenResponse.status).toBe(403)

    const adminResponse = await adminAgent
      .put(`/api/wiki/${page.slug}`)
      .set('X-XSRF-TOKEN', adminXsrfToken)
      .send({
        title: `${WIKI_TITLE_PREFIX} Admin Updated`,
        category: 'general',
        content: 'Admin updated content',
      })
    expect(adminResponse.status).toBe(200)
    expect(adminResponse.body.page.title).toBe(`${WIKI_TITLE_PREFIX} Admin Updated`)
    await expect(prisma.wikiPage.findUnique({ where: { slug: page.slug } })).resolves.toMatchObject(
      {
        title: `${WIKI_TITLE_PREFIX} Admin Updated`,
      }
    )
  })

  it('moves user edits of published pages back to review', async () => {
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      normalUser.user.email,
      normalUser.plainPassword
    )
    const page = await createTestWikiPage({
      slug: `${WIKI_SLUG_PREFIX}review-status`,
      title: `${WIKI_TITLE_PREFIX} Review Status`,
      status: 'published',
      authorUid: normalUser.user.uid,
    })

    const pendingResponse = await agent
      .put(`/api/wiki/${page.slug}`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        title: `${WIKI_TITLE_PREFIX} Review Pending`,
        category: 'general',
        content: 'Needs review',
      })
    expect(pendingResponse.status).toBe(200)
    expect(pendingResponse.body.page.status).toBe('pending')

    const explicitDraftResponse = await agent
      .put(`/api/wiki/${page.slug}`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        title: `${WIKI_TITLE_PREFIX} Explicit Draft Still Pending`,
        category: 'general',
        content: 'Published pages still need review after user edits',
        status: 'draft',
      })
    expect(explicitDraftResponse.status).toBe(200)
    expect(explicitDraftResponse.body.page.status).toBe('pending')
  })

  it('prevents non-admin deletion and requires admins to provide a reason', async () => {
    const page = await createTestWikiPage({
      slug: `${WIKI_SLUG_PREFIX}delete`,
      title: `${WIKI_TITLE_PREFIX} Delete`,
      status: 'published',
      authorUid: normalUser.user.uid,
    })
    const { agent: userAgent, xsrfToken: userXsrfToken } = await createAuthenticatedAgent(
      normalUser.user.email,
      normalUser.plainPassword
    )
    const { agent: adminAgent, xsrfToken: adminXsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const userResponse = await userAgent
      .delete(`/api/wiki/${page.slug}`)
      .set('X-XSRF-TOKEN', userXsrfToken)
      .send({ reason: 'ROI self delete' })
    expect(userResponse.status).toBe(403)

    const missingReasonResponse = await adminAgent
      .delete(`/api/wiki/${page.slug}`)
      .set('X-XSRF-TOKEN', adminXsrfToken)
      .send({})
    expect(missingReasonResponse.status).toBe(400)

    const deleteResponse = await adminAgent
      .delete(`/api/wiki/${page.slug}`)
      .set('X-XSRF-TOKEN', adminXsrfToken)
      .send({ reason: 'ROI duplicate content' })
    expect(deleteResponse.status).toBe(200)
    const deletedPage = await prisma.wikiPage.findUnique({ where: { slug: page.slug } })
    expect(deletedPage?.deletedAt).toBeInstanceOf(Date)
    expect(deletedPage?.deletedBy).toBe(adminUser.user.uid)

    const notification = await prisma.notification.findFirst({
      where: { userUid: normalUser.user.uid, type: 'review_result' },
      orderBy: { createdAt: 'desc' },
    })
    expect(notification).not.toBeNull()
    expect(notification!.payload).toMatchObject({
      action: 'deleted',
      targetType: 'wiki',
      targetId: page.slug,
      note: 'ROI duplicate content',
    })
  })

  it('rejects invalid create payloads without creating a page', async () => {
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      normalUser.user.email,
      normalUser.plainPassword
    )
    const response = await agent
      .post('/api/wiki')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        title: `${WIKI_TITLE_PREFIX} Invalid`,
        category: 'general',
      })

    expect(response.status).toBe(400)
    await expect(
      prisma.wikiPage.count({ where: { title: `${WIKI_TITLE_PREFIX} Invalid` } })
    ).resolves.toBe(0)
  })

  it('returns 404 for missing numeric details and rejects non-numeric public slugs', async () => {
    const missingResponse = await request(app).get(`/api/wiki/${nextTestNumericSlug()}`)
    const legacySlugResponse = await request(app).get(`/api/wiki/${WIKI_SLUG_PREFIX}legacy`)

    expect(missingResponse.status).toBe(404)
    expect(legacySlugResponse.status).toBe(404)
  })
})
