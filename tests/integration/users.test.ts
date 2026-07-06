import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../../server'
import {
  prisma,
  createTestGallery,
  createTestPost,
  createTestToken,
  createTestUser,
  createTestWikiPage,
  nextTestNumericSlug,
} from './setup'

async function cleanupUserTestData() {
  await prisma.post.deleteMany({
    where: { title: { startsWith: 'ROI User' } },
  })
  await prisma.gallery.deleteMany({
    where: { title: { startsWith: 'ROI User' } },
  })
  await prisma.wikiPage.deleteMany({
    where: { title: { startsWith: 'ROI User' } },
  })
  await prisma.user.deleteMany({
    where: { email: { startsWith: 'roi_users_' } },
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

describe('Users API', () => {
  let normalUser: Awaited<ReturnType<typeof createTestUser>>
  let adminUser: Awaited<ReturnType<typeof createTestUser>>
  let userToken: string
  let adminToken: string

  beforeEach(async () => {
    await cleanupUserTestData()
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    normalUser = await createTestUser({
      role: 'user',
      email: `roi_users_user_${suffix}@example.com`,
      displayName: `RoiUsersUser_${suffix}`,
    })
    adminUser = await createTestUser({
      role: 'admin',
      email: `roi_users_admin_${suffix}@example.com`,
      displayName: `RoiUsersAdmin_${suffix}`,
    })
    userToken = await createTestToken(normalUser.user.uid, normalUser.user.role)
    adminToken = await createTestToken(adminUser.user.uid, adminUser.user.role)
  })

  afterEach(async () => {
    await cleanupUserTestData()
  })

  it('restricts the admin user list and never returns password hashes', async () => {
    const adminResponse = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(adminResponse.status).toBe(200)
    expect(adminResponse.body.users.length).toBeGreaterThanOrEqual(2)
    expect(adminResponse.body.users[0]).not.toHaveProperty('passwordHash')

    const userResponse = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${userToken}`)
    expect(userResponse.status).toBe(403)

    const anonymousResponse = await request(app).get('/api/users')
    expect(anonymousResponse.status).toBe(403)
  })

  it('invalidates stale sessions when admins reset a user password', async () => {
    const oldToken = await createTestToken(normalUser.user.uid, normalUser.user.role)
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const resetResponse = await agent
      .put(`/api/users/${normalUser.user.uid}/reset-password`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ newPassword: 'ResetPassword123!' })

    expect(resetResponse.status).toBe(200)
    const staleSessionResponse = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${oldToken}`)
    expect(staleSessionResponse.status).toBe(401)
  })

  it('renews the current cookie session after self-service password changes', async () => {
    const agent = request.agent(app)
    const loginResponse = await agent.post('/api/auth/login').send({
      email: normalUser.user.email,
      password: normalUser.plainPassword,
    })
    expect(loginResponse.status).toBe(200)
    const xsrfToken = pickCookie(loginResponse.headers['set-cookie'], 'XSRF-TOKEN')
    expect(xsrfToken).toBeTruthy()

    const passwordResponse = await agent
      .put('/api/users/password')
      .set('X-XSRF-TOKEN', xsrfToken!)
      .send({
        currentPassword: normalUser.plainPassword,
        newPassword: 'UpdatedPassword123!',
      })

    expect(passwordResponse.status).toBe(200)
    expect(pickCookie(passwordResponse.headers['set-cookie'], 'hsf_token')).toBeTruthy()
    const meResponse = await agent.get('/api/users/me')
    expect(meResponse.status).toBe(200)
    expect(meResponse.body.user.uid).toBe(normalUser.user.uid)
  })

  it('returns current user details while blocking anonymous and banned sessions', async () => {
    const meResponse = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${userToken}`)
    expect(meResponse.status).toBe(200)
    expect(meResponse.body.user).toMatchObject({
      uid: normalUser.user.uid,
      email: normalUser.user.email,
      role: 'user',
      status: 'active',
    })

    const anonymousResponse = await request(app).get('/api/users/me')
    expect(anonymousResponse.status).toBe(401)

    const bannedUser = await createTestUser({
      email: `roi_users_banned_${Date.now()}@example.com`,
      displayName: `RoiUsersBanned_${Date.now()}`,
    })
    await prisma.user.update({
      where: { uid: bannedUser.user.uid },
      data: { status: 'banned', banReason: 'ROI banned', bannedAt: new Date() },
    })
    const bannedToken = await createTestToken(bannedUser.user.uid, bannedUser.user.role)
    const bannedResponse = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${bannedToken}`)
    expect(bannedResponse.status).toBe(403)
    expect(bannedResponse.body.banReason).toBe('ROI banned')
  })

  it('updates user profiles but rejects unsafe profile input', async () => {
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      normalUser.user.email,
      normalUser.plainPassword
    )
    const newDisplayName = `RoiUsersUpdated_${Date.now()}`

    const updateResponse = await agent.patch('/api/users/me').set('X-XSRF-TOKEN', xsrfToken).send({
      displayName: newDisplayName,
      bio: 'ROI profile bio',
      photoURL: 'https://example.com/avatar.jpg',
    })
    expect(updateResponse.status).toBe(200)
    expect(updateResponse.body.user).toMatchObject({
      displayName: newDisplayName,
      bio: 'ROI profile bio',
      photoURL: 'https://example.com/avatar.jpg',
    })

    const badNameResponse = await agent
      .patch('/api/users/me')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ displayName: 'Bad Name' })
    expect(badNameResponse.status).toBe(400)

    const badAvatarResponse = await agent
      .patch('/api/users/me')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ photoURL: 'javascript:alert("xss")' })
    expect(badAvatarResponse.status).toBe(400)
  })

  it('only active authenticated users can search mention candidates', async () => {
    const target = await createTestUser({
      email: `roi_users_mention_target_${Date.now()}@example.com`,
      displayName: `RoiMentionTarget_${Date.now()}`,
    })
    const banned = await createTestUser({
      email: `roi_users_mention_banned_${Date.now()}@example.com`,
      displayName: `RoiMentionTargetBanned_${Date.now()}`,
    })
    await prisma.user.update({
      where: { uid: banned.user.uid },
      data: { status: 'banned', banReason: 'ROI banned', bannedAt: new Date() },
    })

    const response = await request(app)
      .get('/api/users/mentions')
      .query({ q: 'RoiMentionTarget' })
      .set('Authorization', `Bearer ${userToken}`)
    expect(response.status).toBe(200)
    const names = response.body.users.map((user: { displayName: string }) => user.displayName)
    expect(names).toContain(target.user.displayName)
    expect(names).not.toContain(banned.user.displayName)

    const anonymousResponse = await request(app)
      .get('/api/users/mentions')
      .query({ q: 'RoiMentionTarget' })
    expect(anonymousResponse.status).toBe(401)
  })

  it('returns public profiles without private fields', async () => {
    const response = await request(app).get(`/api/users/${normalUser.user.publicId}/profile`)

    expect(response.status).toBe(200)
    expect(response.body.user.publicId).toBe(normalUser.user.publicId)
    expect(response.body.user).toHaveProperty('displayName')
    expect(response.body.user).not.toHaveProperty('uid')
    expect(response.body.user).not.toHaveProperty('email')
    expect(response.body.user).not.toHaveProperty('preferences')
    expect(response.body.user).not.toHaveProperty('role')
  })

  it('keeps user content visibility private unless the viewer is the owner', async () => {
    const publishedGallery = await createTestGallery({
      title: 'ROI User Published Gallery',
      authorUid: normalUser.user.uid,
      authorName: normalUser.user.displayName,
      published: true,
    })
    const draftGallery = await createTestGallery({
      title: 'ROI User Draft Gallery',
      authorUid: normalUser.user.uid,
      authorName: normalUser.user.displayName,
      published: false,
    })
    const publishedWiki = await createTestWikiPage({
      slug: nextTestNumericSlug(),
      title: 'ROI User Published Wiki',
      status: 'published',
      authorUid: normalUser.user.uid,
    })
    const draftWiki = await createTestWikiPage({
      slug: nextTestNumericSlug(),
      title: 'ROI User Draft Wiki',
      status: 'draft',
      authorUid: normalUser.user.uid,
    })
    const publishedPost = await createTestPost({
      title: 'ROI User Published Post',
      status: 'published',
      authorUid: normalUser.user.uid,
    })
    const draftPost = await createTestPost({
      title: 'ROI User Draft Post',
      status: 'draft',
      authorUid: normalUser.user.uid,
    })

    const publicPostsResponse = await request(app).get(
      `/api/users/${normalUser.user.publicId}/posts`
    )
    expect(publicPostsResponse.status).toBe(200)
    const publicPostIds = publicPostsResponse.body.posts.map((post: { id: string }) => post.id)
    expect(publicPostIds).toContain(publishedPost.id)
    expect(publicPostIds).not.toContain(draftPost.id)

    const selfPostsResponse = await request(app)
      .get(`/api/users/${normalUser.user.publicId}/posts`)
      .set('Authorization', `Bearer ${userToken}`)
    expect(selfPostsResponse.status).toBe(200)
    const selfPostIds = selfPostsResponse.body.posts.map((post: { id: string }) => post.id)
    expect(selfPostIds).toContain(draftPost.id)

    const publicGalleryResponse = await request(app).get(
      `/api/users/${normalUser.user.publicId}/galleries`
    )
    expect(publicGalleryResponse.status).toBe(200)
    const publicGalleryIds = publicGalleryResponse.body.galleries.map(
      (gallery: { id: string }) => gallery.id
    )
    expect(publicGalleryIds).toContain(publishedGallery.id)
    expect(publicGalleryIds).not.toContain(draftGallery.id)

    const selfGalleryResponse = await request(app)
      .get(`/api/users/${normalUser.user.publicId}/galleries`)
      .set('Authorization', `Bearer ${userToken}`)
    const selfGalleryIds = selfGalleryResponse.body.galleries.map(
      (gallery: { id: string }) => gallery.id
    )
    expect(selfGalleryIds).toContain(draftGallery.id)

    const publicWikiResponse = await request(app).get(`/api/users/${normalUser.user.publicId}/wiki`)
    const publicWikiSlugs = publicWikiResponse.body.pages.map((page: { slug: string }) => page.slug)
    expect(publicWikiSlugs).toContain(publishedWiki.slug)
    expect(publicWikiSlugs).not.toContain(draftWiki.slug)

    const selfWikiResponse = await request(app)
      .get(`/api/users/${normalUser.user.publicId}/wiki`)
      .set('Authorization', `Bearer ${userToken}`)
    const selfWikiSlugs = selfWikiResponse.body.pages.map((page: { slug: string }) => page.slug)
    expect(selfWikiSlugs).toContain(draftWiki.slug)
  })
})
