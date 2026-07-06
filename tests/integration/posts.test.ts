import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../../server'
import { prisma, createTestGallery, createTestPost, createTestUser } from './setup'

const POST_TITLE_PREFIX = 'ROI Post'
const GALLERY_TITLE_PREFIX = 'ROI Gallery'

async function cleanupPostTestData() {
  const [postIds, galleryIds] = await Promise.all([
    prisma.post.findMany({
      where: { title: { startsWith: POST_TITLE_PREFIX } },
      select: { id: true },
    }),
    prisma.gallery.findMany({
      where: { title: { startsWith: GALLERY_TITLE_PREFIX } },
      select: { id: true },
    }),
  ])
  const targetIds = [...postIds.map((post) => post.id), ...galleryIds.map((gallery) => gallery.id)]

  await prisma.notification.deleteMany({
    where: {
      OR: [
        { payload: { path: ['title'], string_starts_with: POST_TITLE_PREFIX } },
        { payload: { path: ['title'], string_starts_with: GALLERY_TITLE_PREFIX } },
        ...targetIds.map((targetId) => ({ payload: { path: ['targetId'], equals: targetId } })),
      ],
    },
  })
  await prisma.moderationLog.deleteMany({
    where: {
      OR: [
        { targetType: { in: ['post', 'comment', 'gallery'] }, note: { contains: 'ROI' } },
        ...(targetIds.length > 0 ? [{ targetId: { in: targetIds } }] : []),
      ],
    },
  })
  await prisma.post.deleteMany({
    where: { title: { startsWith: POST_TITLE_PREFIX } },
  })
  await prisma.gallery.deleteMany({
    where: { title: { startsWith: GALLERY_TITLE_PREFIX } },
  })
  await prisma.section.deleteMany({
    where: { id: { startsWith: 'roi-section-' } },
  })
  await prisma.user.deleteMany({
    where: { email: { startsWith: 'roi_posts_' } },
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

describe('Posts API', () => {
  let normalUser: Awaited<ReturnType<typeof createTestUser>>
  let adminUser: Awaited<ReturnType<typeof createTestUser>>

  beforeEach(async () => {
    await cleanupPostTestData()
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    normalUser = await createTestUser({
      role: 'user',
      email: `roi_posts_user_${suffix}@example.com`,
      displayName: `RoiPostsUser_${suffix}`,
    })
    adminUser = await createTestUser({
      role: 'admin',
      email: `roi_posts_admin_${suffix}@example.com`,
      displayName: `RoiPostsAdmin_${suffix}`,
    })
  })

  afterEach(async () => {
    await cleanupPostTestData()
  })

  it('lists public posts without exposing drafts and lets authors view their own drafts', async () => {
    const publishedPost = await createTestPost({
      title: `${POST_TITLE_PREFIX} Published`,
      section: 'general',
      status: 'published',
      authorUid: normalUser.user.uid,
    })
    const draftPost = await createTestPost({
      title: `${POST_TITLE_PREFIX} Draft`,
      section: 'general',
      status: 'draft',
      authorUid: normalUser.user.uid,
    })
    const { agent } = await createAuthenticatedAgent(
      normalUser.user.email,
      normalUser.plainPassword
    )

    const listResponse = await request(app)
      .get('/api/posts')
      .query({ section: 'general', limit: 50 })
    expect(listResponse.status).toBe(200)
    const listedIds = listResponse.body.posts.map((post: { id: string }) => post.id)
    expect(listedIds).toContain(publishedPost.id)
    expect(listedIds).not.toContain(draftPost.id)

    const authorDetailResponse = await agent.get(`/api/posts/${draftPost.slug}`)
    const visitorDetailResponse = await request(app).get(`/api/posts/${draftPost.slug}`)
    expect(authorDetailResponse.status).toBe(200)
    expect(authorDetailResponse.body.post.id).toBe(draftPost.id)
    expect(visitorDetailResponse.status).toBe(404)
  })

  it('creates posts with review-aware defaults and rejects anonymous or invalid writes', async () => {
    const { agent: userAgent, xsrfToken: userXsrfToken } = await createAuthenticatedAgent(
      normalUser.user.email,
      normalUser.plainPassword
    )
    const { agent: adminAgent, xsrfToken: adminXsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const userResponse = await userAgent
      .post('/api/posts')
      .set('X-XSRF-TOKEN', userXsrfToken)
      .send({
        title: `${POST_TITLE_PREFIX} Created By User`,
        section: 'general',
        content: 'User post content',
        tags: ['roi'],
        status: 'pending',
      })
    const adminResponse = await adminAgent
      .post('/api/posts')
      .set('X-XSRF-TOKEN', adminXsrfToken)
      .send({
        title: `${POST_TITLE_PREFIX} Created By Admin`,
        section: 'general',
        content: 'Admin post content',
        tags: [],
        status: 'pending',
      })
    const anonymousResponse = await request(app)
      .post('/api/posts')
      .send({
        title: `${POST_TITLE_PREFIX} Anonymous`,
        section: 'general',
        content: 'Anonymous content',
      })
    const invalidResponse = await userAgent
      .post('/api/posts')
      .set('X-XSRF-TOKEN', userXsrfToken)
      .send({
        title: `${POST_TITLE_PREFIX} Invalid`,
        section: 'general',
      })

    expect(userResponse.status).toBe(201)
    expect(userResponse.body.post.status).toBe('pending')
    expect(adminResponse.status).toBe(201)
    expect(adminResponse.body.post.status).toBe('published')
    expect(anonymousResponse.status).toBe(401)
    expect(invalidResponse.status).toBe(400)
  })

  it('enforces update ownership while allowing admins to edit any post', async () => {
    const otherUser = await createTestUser({
      email: `roi_posts_other_${Date.now()}@example.com`,
      displayName: `RoiPostsOther_${Date.now()}`,
    })
    const post = await createTestPost({
      title: `${POST_TITLE_PREFIX} Update Owned`,
      section: 'general',
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
      .put(`/api/posts/${post.id}`)
      .set('X-XSRF-TOKEN', userXsrfToken)
      .send({
        title: `${POST_TITLE_PREFIX} Hijacked`,
        section: 'general',
        content: 'Nope',
      })
    expect(forbiddenResponse.status).toBe(403)

    const adminResponse = await adminAgent
      .put(`/api/posts/${post.id}`)
      .set('X-XSRF-TOKEN', adminXsrfToken)
      .send({
        title: `${POST_TITLE_PREFIX} Admin Updated`,
        section: 'general',
        content: 'Admin updated content',
      })
    expect(adminResponse.status).toBe(200)
    expect(adminResponse.body.post.title).toBe(`${POST_TITLE_PREFIX} Admin Updated`)
  })

  it('soft deletes posts with correct permission and reason semantics', async () => {
    const post = await createTestPost({
      title: `${POST_TITLE_PREFIX} Delete`,
      section: 'general',
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

    const selfDeleteResponse = await userAgent
      .delete(`/api/posts/${post.id}`)
      .set('X-XSRF-TOKEN', userXsrfToken)
      .send({ reason: 'ROI self delete' })
    expect(selfDeleteResponse.status).toBe(200)
    const selfDeletedPost = await prisma.post.findUnique({ where: { id: post.id } })
    expect(selfDeletedPost?.deletedBy).toBe(normalUser.user.uid)

    const adminPost = await createTestPost({
      title: `${POST_TITLE_PREFIX} Admin Delete`,
      section: 'general',
      status: 'published',
      authorUid: normalUser.user.uid,
    })
    const missingReasonResponse = await adminAgent
      .delete(`/api/posts/${adminPost.id}`)
      .set('X-XSRF-TOKEN', adminXsrfToken)
    expect(missingReasonResponse.status).toBe(400)

    const adminDeleteResponse = await adminAgent
      .delete(`/api/posts/${adminPost.id}`)
      .set('X-XSRF-TOKEN', adminXsrfToken)
      .send({ reason: 'ROI policy violation' })
    expect(adminDeleteResponse.status).toBe(200)
    const adminDeletedPost = await prisma.post.findUnique({ where: { id: adminPost.id } })
    expect(adminDeletedPost?.deletedAt).toBeInstanceOf(Date)
    expect(adminDeletedPost?.deletedBy).toBe(adminUser.user.uid)

    const notification = await prisma.notification.findFirst({
      where: { userUid: normalUser.user.uid, type: 'review_result' },
      orderBy: { createdAt: 'desc' },
    })
    expect(notification?.payload).toMatchObject({
      action: 'deleted',
      targetType: 'post',
      targetId: adminPost.id,
      note: 'ROI policy violation',
    })
  })

  it('preserves comment thread behavior for replies, soft deletion, and likes', async () => {
    const post = await createTestPost({
      title: `${POST_TITLE_PREFIX} Comments`,
      section: 'general',
      status: 'published',
      authorUid: normalUser.user.uid,
    })
    const commenter = await createTestUser({
      email: `roi_posts_commenter_${Date.now()}@example.com`,
      displayName: `RoiPostsCommenter_${Date.now()}`,
    })
    const { agent: commenterAgent, xsrfToken: commenterXsrfToken } = await createAuthenticatedAgent(
      commenter.user.email,
      commenter.plainPassword
    )
    const { agent: adminAgent, xsrfToken: adminXsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const rootResponse = await commenterAgent
      .post(`/api/posts/${post.id}/comments`)
      .set('X-XSRF-TOKEN', commenterXsrfToken)
      .send({ content: 'ROI root comment', parentId: null })
    expect(rootResponse.status).toBe(201)

    const replyResponse = await commenterAgent
      .post(`/api/posts/${post.id}/comments`)
      .set('X-XSRF-TOKEN', commenterXsrfToken)
      .send({ content: 'ROI reply comment', parentId: rootResponse.body.comment.id })
    expect(replyResponse.status).toBe(201)
    expect(replyResponse.body.comment.parentId).toBe(rootResponse.body.comment.id)

    const likeResponse = await commenterAgent
      .post(`/api/posts/comments/${rootResponse.body.comment.id}/like`)
      .set('X-XSRF-TOKEN', commenterXsrfToken)
    expect(likeResponse.status).toBe(200)

    const deleteResponse = await adminAgent
      .delete(`/api/posts/comments/${rootResponse.body.comment.id}`)
      .set('X-XSRF-TOKEN', adminXsrfToken)
      .send({ reason: 'ROI moderation' })
    expect(deleteResponse.status).toBe(200)

    const commentsResponse = await request(app).get(`/api/posts/${post.id}/comments`)
    expect(commentsResponse.status).toBe(200)
    const comments = commentsResponse.body.comments as Array<{
      id: string
      deletedAt?: string | null
      replies?: Array<{ id: string; content: string }>
    }>
    const root = comments.find((comment) => comment.id === rootResponse.body.comment.id)
    expect(root?.deletedAt).toBeTruthy()
    expect(comments.map((comment) => comment.id)).toContain(replyResponse.body.comment.id)
    const reply = comments.find((comment) => comment.id === replyResponse.body.comment.id)
    expect(reply).toMatchObject({
      parentId: rootResponse.body.comment.id,
      content: 'ROI reply comment',
    })
  })

  it('keeps gallery review and deletion rules aligned with posts', async () => {
    const gallery = await createTestGallery({
      title: `${GALLERY_TITLE_PREFIX} Delete`,
      authorUid: normalUser.user.uid,
      authorName: normalUser.user.displayName,
      published: true,
    })
    const { agent: adminAgent, xsrfToken: adminXsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const missingReasonResponse = await adminAgent
      .delete(`/api/galleries/${gallery.id}`)
      .set('X-XSRF-TOKEN', adminXsrfToken)
    expect(missingReasonResponse.status).toBe(400)

    const deleteResponse = await adminAgent
      .delete(`/api/galleries/${gallery.id}`)
      .set('X-XSRF-TOKEN', adminXsrfToken)
      .send({ reason: 'ROI gallery moderation' })
    expect(deleteResponse.status).toBe(200)

    const deletedGallery = await prisma.gallery.findUnique({ where: { id: gallery.id } })
    expect(deletedGallery?.deletedAt).toBeInstanceOf(Date)
    expect(deletedGallery?.deletedBy).toBe(adminUser.user.uid)
  })

  it('sends mention notifications for published content but not drafts', async () => {
    const mentioned = await createTestUser({
      email: `roi_posts_mentioned_${Date.now()}@example.com`,
      displayName: `RoiMentioned_${Date.now()}`,
    })
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      normalUser.user.email,
      normalUser.plainPassword
    )

    const { agent: adminAgent, xsrfToken: adminXsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const publishedResponse = await adminAgent
      .post('/api/posts')
      .set('X-XSRF-TOKEN', adminXsrfToken)
      .send({
        title: `${POST_TITLE_PREFIX} Mention Published`,
        section: 'general',
        content: `Hello @${mentioned.user.displayName}`,
        status: 'published',
      })
    expect(publishedResponse.status).toBe(201)

    const publishedNotification = await prisma.notification.findFirst({
      where: {
        userUid: mentioned.user.uid,
        type: 'mention',
        payload: { path: ['postId'], equals: publishedResponse.body.post.id },
      },
    })
    expect(publishedNotification).not.toBeNull()

    const draftResponse = await agent
      .post('/api/posts')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        title: `${POST_TITLE_PREFIX} Mention Draft`,
        section: 'general',
        content: `Draft hello @${mentioned.user.displayName}`,
        status: 'draft',
      })
    expect(draftResponse.status).toBe(201)

    const draftNotification = await prisma.notification.findFirst({
      where: {
        userUid: mentioned.user.uid,
        type: 'mention',
        payload: { path: ['postId'], equals: draftResponse.body.post.id },
      },
    })
    expect(draftNotification).toBeNull()
  })
})
