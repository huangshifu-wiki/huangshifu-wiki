import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../../server'
import { hashApiKeyToken } from '../../src/server/utils/api-keys'
import { prisma, createTestPost, createTestToken, createTestUser } from './setup'
import { EmailVerificationPurpose } from '@prisma/client'
import type { TestUserCreated } from './setup'
import { hashEmailVerificationToken } from '../../src/server/utils/email-verification'

const USER_EMAIL_PREFIX = 'roi_api_keys_'
const POST_TITLE_PREFIX = 'ROI API Keys'
const ONE_DAY_MS = 24 * 60 * 60 * 1000

function pickCookie(setCookie: string[] | string | undefined, name: string) {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
  return cookies
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split(';')[0]
    .slice(name.length + 1)
}

async function cleanupApiKeyTestData() {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: USER_EMAIL_PREFIX } },
    select: { uid: true },
  })
  const userUids = users.map((user) => user.uid)
  const posts = await prisma.post.findMany({
    where: { title: { startsWith: POST_TITLE_PREFIX } },
    select: { id: true },
  })
  const postIds = posts.map((post) => post.id)

  if (userUids.length || postIds.length) {
    await prisma.moderationLog.deleteMany({
      where: {
        OR: [
          ...(userUids.length ? [{ operatorUid: { in: userUids } }] : []),
          ...(postIds.length ? [{ targetId: { in: postIds } }] : []),
        ],
      },
    })
  }
  if (postIds.length) {
    await prisma.post.deleteMany({ where: { id: { in: postIds } } })
  }
  if (userUids.length) {
    await prisma.uploadSession.deleteMany({ where: { ownerUid: { in: userUids } } })
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: USER_EMAIL_PREFIX } } })
}

async function createCookieSession(user: TestUserCreated) {
  const agent = request.agent(app)
  const login = await agent.post('/api/auth/login').send({
    email: user.user.email,
    password: user.plainPassword,
  })
  expect(login.status).toBe(200)
  const xsrfToken = pickCookie(login.headers['set-cookie'], 'XSRF-TOKEN')
  const authCookie = pickCookie(login.headers['set-cookie'], 'hsf_token')
  expect(xsrfToken).toBeTruthy()
  expect(authCookie).toBeTruthy()
  return { agent, xsrfToken: xsrfToken!, authCookie: authCookie! }
}

async function createApiKey(
  user: TestUserCreated,
  name: string,
  expiry?: '30d' | '90d' | '365d' | 'never'
) {
  const session = await createCookieSession(user)
  const response = await session.agent
    .post('/api/users/me/api-keys')
    .set('X-XSRF-TOKEN', session.xsrfToken)
    .send({ name, ...(expiry ? { expiry } : {}) })
  expect(response.status).toBe(201)
  return { ...session, key: response.body.key, token: response.body.token as string }
}

describe('Personal API keys', () => {
  let normalUser: TestUserCreated
  let otherUser: TestUserCreated
  let adminUser: TestUserCreated
  let superAdminUser: TestUserCreated

  beforeEach(async () => {
    await cleanupApiKeyTestData()
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    normalUser = await createTestUser({
      email: `${USER_EMAIL_PREFIX}normal_${suffix}@example.com`,
      displayName: `RoiApiKeyNormal_${suffix}`,
    })
    otherUser = await createTestUser({
      email: `${USER_EMAIL_PREFIX}other_${suffix}@example.com`,
      displayName: `RoiApiKeyOther_${suffix}`,
    })
    adminUser = await createTestUser({
      role: 'admin',
      email: `${USER_EMAIL_PREFIX}admin_${suffix}@example.com`,
      displayName: `RoiApiKeyAdmin_${suffix}`,
    })
    superAdminUser = await createTestUser({
      role: 'super_admin',
      email: `${USER_EMAIL_PREFIX}super_${suffix}@example.com`,
      displayName: `RoiApiKeySuper_${suffix}`,
    })
  })

  afterEach(cleanupApiKeyTestData)

  it('stores only a digest, lists metadata, and lets a bare key use existing write APIs', async () => {
    const session = await createCookieSession(normalUser)
    const created = await session.agent
      .post('/api/users/me/api-keys')
      .set('X-XSRF-TOKEN', session.xsrfToken)
      .send({ name: '  部署脚本  ', expiry: 'never' })

    expect(created.status).toBe(201)
    expect(created.headers['cache-control']).toBe('no-store')
    expect(created.body.key.name).toBe('部署脚本')
    expect(created.body.key.expiresAt).toBeNull()
    expect(created.body.token).toMatch(/^hsf_api_[A-Za-z0-9_-]{43}$/)

    const stored = await prisma.userApiKey.findUnique({
      where: { tokenHash: hashApiKeyToken(created.body.token) },
    })
    expect(stored).toMatchObject({
      userUid: normalUser.user.uid,
      name: '部署脚本',
      prefix: created.body.token.slice(0, 16),
    })
    expect(JSON.stringify(stored)).not.toContain(created.body.token)

    const listed = await session.agent.get('/api/users/me/api-keys')
    expect(listed.status).toBe(200)
    expect(listed.headers['cache-control']).toBe('no-store')
    expect(listed.body.keys).toEqual([created.body.key])
    expect(listed.body.keys[0]).not.toHaveProperty('token')
    expect(listed.body.keys[0]).not.toHaveProperty('tokenHash')

    const me = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${created.body.token}`)
    expect(me.status).toBe(200)
    expect(me.body.user.uid).toBe(normalUser.user.uid)
    expect(me.headers['set-cookie']).toBeUndefined()

    const upload = await request(app)
      .post('/api/uploads/sessions')
      .set('Authorization', `Bearer ${created.body.token}`)
      .send({ maxFiles: 1 })
    expect(upload.status).toBe(201)
    expect(upload.headers['set-cookie']).toBeUndefined()
    const uploadSession = await prisma.uploadSession.findUnique({
      where: { id: upload.body.session.id },
    })
    expect(uploadSession?.ownerUid).toBe(normalUser.user.uid)
    const afterUse = await prisma.userApiKey.findUnique({
      where: { id: created.body.key.id },
      select: { lastUsedAt: true },
    })
    expect(afterUse?.lastUsedAt).toBeInstanceOf(Date)
  })

  it('applies the selected expiry exactly and defaults omitted expiry to 90 days', async () => {
    const options = [
      { expiry: undefined, days: 90 },
      { expiry: '30d' as const, days: 30 },
      { expiry: '90d' as const, days: 90 },
      { expiry: '365d' as const, days: 365 },
      { expiry: 'never' as const, days: null },
    ]

    for (const [index, option] of options.entries()) {
      const created = await createApiKey(normalUser, `Expiry ${index}`, option.expiry)
      if (option.days === null) {
        expect(created.key.expiresAt).toBeNull()
      } else {
        expect(Date.parse(created.key.expiresAt) - Date.parse(created.key.createdAt)).toBe(
          option.days * ONE_DAY_MS
        )
      }
    }
  })

  it('restricts key management to the owner’s cookie session and revokes only that owner’s key', async () => {
    const key = await createApiKey(normalUser, 'owner key', 'never')
    const otherSession = await createCookieSession(otherUser)
    const userBearer = await createTestToken(otherUser.user.uid, 'user')

    const anonymousList = await request(app).get('/api/users/me/api-keys')
    expect(anonymousList.status).toBe(401)
    expect(anonymousList.headers['cache-control']).toBe('no-store')

    const apiKeyList = await request(app)
      .get('/api/users/me/api-keys')
      .set('Authorization', `Bearer ${key.token}`)
    expect(apiKeyList.status).toBe(403)
    expect(apiKeyList.body.code).toBe('COOKIE_SESSION_REQUIRED')
    expect(apiKeyList.headers['cache-control']).toBe('no-store')

    const jwtList = await request(app)
      .get('/api/users/me/api-keys')
      .set('Authorization', `Bearer ${userBearer}`)
    expect(jwtList.status).toBe(403)

    const crossOwnerDelete = await otherSession.agent
      .delete(`/api/users/me/api-keys/${key.key.id}`)
      .set('X-XSRF-TOKEN', otherSession.xsrfToken)
    expect(crossOwnerDelete.status).toBe(404)
    const stillValid = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${key.token}`)
    expect(stillValid.status).toBe(200)

    const noCsrf = await otherSession.agent
      .post('/api/users/me/api-keys')
      .send({ name: 'missing csrf' })
    expect(noCsrf.status).toBe(403)
    expect(noCsrf.headers['cache-control']).toBe('no-store')
    const mismatchedCsrf = await otherSession.agent
      .post('/api/users/me/api-keys')
      .set('X-XSRF-TOKEN', 'wrong-xsrf-token')
      .send({ name: 'wrong csrf' })
    expect(mismatchedCsrf.status).toBe(403)

    const revoke = await key.agent
      .delete(`/api/users/me/api-keys/${key.key.id}`)
      .set('X-XSRF-TOKEN', key.xsrfToken)
    expect(revoke.status).toBe(200)
    const repeatedRevoke = await key.agent
      .delete(`/api/users/me/api-keys/${key.key.id}`)
      .set('X-XSRF-TOKEN', key.xsrfToken)
    expect(repeatedRevoke.status).toBe(200)
    const afterRevocation = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${key.token}`)
    expect(afterRevocation.status).toBe(401)
    expect(afterRevocation.body.code).toBe('API_KEY_INVALID')
  })

  it('uses an explicit bearer key over cookies and rejects malformed or expired credentials', async () => {
    const normalKey = await createApiKey(normalUser, 'normal key')
    const otherKey = await createApiKey(otherUser, 'other key')

    const explicitOther = await normalKey.agent
      .get('/api/users/me')
      .set('Authorization', `Bearer ${otherKey.token}`)
    expect(explicitOther.status).toBe(200)
    expect(explicitOther.body.user.uid).toBe(otherUser.user.uid)

    const invalidOverCookie = await normalKey.agent
      .get('/api/users/me')
      .set('Authorization', 'Bearer hsf_api_invalid')
    expect(invalidOverCookie.status).toBe(401)
    expect(invalidOverCookie.body.code).toBe('API_KEY_INVALID')

    const missingKey = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer hsf_api_${'x'.repeat(43)}`)
    expect(missingKey.status).toBe(401)
    expect(missingKey.body.code).toBe('API_KEY_INVALID')

    await prisma.userApiKey.update({
      where: { id: normalKey.key.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    })
    const expired = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${normalKey.token}`)
    expect(expired.status).toBe(401)
    expect(expired.body.code).toBe('API_KEY_INVALID')
  })

  it('applies current user roles, ownership checks, and active-user write restrictions', async () => {
    const userKey = await createApiKey(normalUser, 'normal access')
    const ownedPost = await createTestPost({
      title: `${POST_TITLE_PREFIX} Own ${Date.now()}`,
      status: 'published',
      authorUid: normalUser.user.uid,
    })
    const otherPost = await createTestPost({
      title: `${POST_TITLE_PREFIX} Other ${Date.now()}`,
      status: 'published',
      authorUid: otherUser.user.uid,
    })

    const normalAdminList = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${userKey.token}`)
    expect(normalAdminList.status).toBe(403)

    const updateOwn = await request(app)
      .put(`/api/posts/${ownedPost.id}`)
      .set('Authorization', `Bearer ${userKey.token}`)
      .send({ title: `${POST_TITLE_PREFIX} Updated`, section: 'general', content: 'Updated body' })
    expect(updateOwn.status).toBe(200)
    expect((await prisma.post.findUnique({ where: { id: ownedPost.id } }))?.authorUid).toBe(
      normalUser.user.uid
    )

    const updateOther = await request(app)
      .put(`/api/posts/${otherPost.id}`)
      .set('Authorization', `Bearer ${userKey.token}`)
      .send({ title: 'Unauthorized update', section: 'general', content: 'No ownership' })
    expect(updateOther.status).toBe(403)

    const adminKey = await createApiKey(adminUser, 'admin access')
    const adminList = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminKey.token}`)
    expect(adminList.status).toBe(200)
    expect(adminList.body.users[0]).not.toHaveProperty('passwordHash')

    const superAdminKey = await createApiKey(superAdminUser, 'super admin access')
    const superAdminConfig = await request(app)
      .get('/api/admin/rate-limits/config')
      .set('Authorization', `Bearer ${superAdminKey.token}`)
    expect(superAdminConfig.status).toBe(200)
    const adminConfig = await request(app)
      .get('/api/admin/rate-limits/config')
      .set('Authorization', `Bearer ${adminKey.token}`)
    expect(adminConfig.status).toBe(403)

    await prisma.user.update({ where: { uid: normalUser.user.uid }, data: { role: 'admin' } })
    const promoted = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${userKey.token}`)
    expect(promoted.status).toBe(200)
    await prisma.user.update({ where: { uid: normalUser.user.uid }, data: { role: 'user' } })
    const demoted = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${userKey.token}`)
    expect(demoted.status).toBe(403)

    await prisma.user.update({
      where: { uid: normalUser.user.uid },
      data: { status: 'banned', banReason: 'API key integration test' },
    })
    const bannedRead = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${userKey.token}`)
    expect(bannedRead.status).toBe(200)
    const bannedWrite = await request(app)
      .post('/api/uploads/sessions')
      .set('Authorization', `Bearer ${userKey.token}`)
      .send({ maxFiles: 1 })
    expect(bannedWrite.status).toBe(403)
    await prisma.user.update({
      where: { uid: normalUser.user.uid },
      data: { status: 'active', banReason: null, bannedAt: null },
    })
    const unbannedWrite = await request(app)
      .post('/api/uploads/sessions')
      .set('Authorization', `Bearer ${userKey.token}`)
      .send({ maxFiles: 1 })
    expect(unbannedWrite.status).toBe(201)
  })

  it('keeps API keys independent from password changes and blocks session exchange', async () => {
    const key = await createApiKey(normalUser, 'stable key')
    const changedPassword = await request(app)
      .put('/api/users/password')
      .set('Authorization', `Bearer ${key.token}`)
      .send({ currentPassword: normalUser.plainPassword, newPassword: 'NewPassword123!' })
    expect(changedPassword.status).toBe(200)
    expect(changedPassword.body).toEqual({ success: true })
    expect(changedPassword.headers['set-cookie']).toBeUndefined()

    const stillValid = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${key.token}`)
    expect(stillValid.status).toBe(200)

    const loginExchange = await request(app)
      .post('/api/auth/login')
      .set('Authorization', `Bearer ${key.token}`)
      .send({ email: normalUser.user.email, password: 'NewPassword123!' })
    expect(loginExchange.status).toBe(403)
    expect(loginExchange.body.code).toBe('API_KEY_SESSION_FORBIDDEN')
    expect(loginExchange.headers['set-cookie']).toBeUndefined()

    const wechatExchange = await request(app)
      .post('/api/auth/wechat/login')
      .set('Authorization', `Bearer ${key.token}`)
      .send({ code: 'not-used' })
    expect(wechatExchange.status).toBe(403)
    expect(wechatExchange.body.code).toBe('API_KEY_SESSION_FORBIDDEN')

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${key.token}`)
      .set('Cookie', `hsf_token=${key.authCookie}`)
    expect(logout.status).toBe(403)
    expect(logout.headers['set-cookie']).toBeUndefined()

    const newPasswordSession = await createCookieSession({
      user: normalUser.user,
      plainPassword: 'NewPassword123!',
    })
    const deleted = await newPasswordSession.agent
      .delete('/api/users/account')
      .set('X-XSRF-TOKEN', newPasswordSession.xsrfToken)
    const afterAccountDeletion = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${key.token}`)
    expect(afterAccountDeletion.status).toBe(401)
    expect(afterAccountDeletion.body.code).toBe('API_KEY_INVALID')
  })

  it('keeps API keys valid after administrator and email-based password resets', async () => {
    const key = await createApiKey(otherUser, 'reset-safe key')
    const adminSession = await createCookieSession(adminUser)
    const adminReset = await adminSession.agent
      .put(`/api/users/${otherUser.user.uid}/reset-password`)
      .set('X-XSRF-TOKEN', adminSession.xsrfToken)
      .send({ newPassword: 'AdminResetPassword123!' })

    expect(adminReset.status).toBe(200)
    const afterAdminReset = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${key.token}`)
    expect(afterAdminReset.status).toBe(200)
    expect(afterAdminReset.body.user.uid).toBe(otherUser.user.uid)

    const resetToken = `api-key-reset-${Date.now()}`
    await prisma.emailVerificationToken.create({
      data: {
        userUid: otherUser.user.uid,
        email: otherUser.user.email,
        tokenHash: hashEmailVerificationToken(resetToken),
        purpose: EmailVerificationPurpose.reset_password,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    })
    const emailReset = await request(app)
      .post('/api/auth/password-reset/confirm')
      .send({ token: resetToken, newPassword: 'EmailResetPassword123!' })

    expect(emailReset.status).toBe(200)
    const afterEmailReset = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${key.token}`)
    expect(afterEmailReset.status).toBe(200)
    expect(afterEmailReset.body.user.uid).toBe(otherUser.user.uid)
  })

  it('cascades API keys when an administrator permanently deletes their owner', async () => {
    const key = await createApiKey(otherUser, 'hard delete key')
    const superAdminSession = await createCookieSession(superAdminUser)
    const deleted = await superAdminSession.agent
      .delete(`/api/admin/users/${otherUser.user.uid}/permanent`)
      .set('X-XSRF-TOKEN', superAdminSession.xsrfToken)

    expect(deleted.status).toBe(200)
    expect(await prisma.userApiKey.count({ where: { userUid: otherUser.user.uid } })).toBe(0)
    const invalidKey = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${key.token}`)
    expect(invalidKey.status).toBe(401)
    expect(invalidKey.body.code).toBe('API_KEY_INVALID')
  })

  it('revokes keys transactionally on admin soft deletion and does not restore them', async () => {
    const targetKey = await createApiKey(normalUser, 'deleted owner')
    const adminSession = await createCookieSession(adminUser)

    const deleted = await adminSession.agent
      .delete(`/api/admin/users/${normalUser.user.uid}`)
      .set('X-XSRF-TOKEN', adminSession.xsrfToken)
    expect(deleted.status).toBe(200)
    expect(
      (await prisma.userApiKey.findUnique({ where: { id: targetKey.key.id } }))?.revokedAt
    ).toBeTruthy()

    const restored = await adminSession.agent
      .post(`/api/admin/users/${normalUser.user.uid}/restore`)
      .set('X-XSRF-TOKEN', adminSession.xsrfToken)
    expect(restored.status).toBe(200)
    const invalidAfterRestore = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${targetKey.token}`)
    expect(invalidAfterRestore.status).toBe(401)
    expect(invalidAfterRestore.body.code).toBe('API_KEY_INVALID')
  })
})
