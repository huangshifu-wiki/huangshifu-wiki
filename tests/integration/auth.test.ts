import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../../server'
import { prisma, createTestToken, createTestUser } from './setup'
import {
  EmailVerificationPurpose,
  hashEmailVerificationToken,
} from '../../src/server/utils/email-verification'

const AUTH_EMAIL_PREFIX = 'roi_auth_'

async function cleanupAuthTestData() {
  await prisma.siteConfig.deleteMany({
    where: { key: { in: ['email_verification', 'registration'] } },
  })
  await prisma.user.deleteMany({
    where: { email: { startsWith: AUTH_EMAIL_PREFIX } },
  })
}

function pickCookie(setCookie: string[] | string | undefined, name: string) {
  const cookieList = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
  return cookieList.find((cookie) => cookie.startsWith(`${name}=`))
}

async function createEmailVerificationToken(input: {
  userUid: string
  email: string
  token: string
  purpose: EmailVerificationPurpose
  expiresAt?: Date
}) {
  return prisma.emailVerificationToken.create({
    data: {
      userUid: input.userUid,
      email: input.email.toLowerCase().trim(),
      tokenHash: hashEmailVerificationToken(input.token),
      purpose: input.purpose,
      expiresAt: input.expiresAt || new Date(Date.now() + 30 * 60 * 1000),
    },
  })
}

describe('Auth API', () => {
  beforeEach(async () => {
    await cleanupAuthTestData()
    await createTestUser({
      email: `${AUTH_EMAIL_PREFIX}admin@example.com`,
      role: 'super_admin',
    })
  })

  afterEach(async () => {
    await cleanupAuthTestData()
  })

  it('returns null for anonymous /me and user details for authenticated sessions', async () => {
    const anonymousResponse = await request(app).get('/api/auth/me')
    expect(anonymousResponse.status).toBe(200)
    expect(anonymousResponse.body.user).toBeNull()

    const { user } = await createTestUser({
      email: `${AUTH_EMAIL_PREFIX}me@example.com`,
      displayName: 'RoiAuthMe',
    })
    const token = await createTestToken(user.uid, user.role)

    const authenticatedResponse = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)

    expect(authenticatedResponse.status).toBe(200)
    expect(authenticatedResponse.body.user).toMatchObject({
      uid: user.uid,
      email: user.email,
      displayName: 'RoiAuthMe',
      role: 'user',
      status: 'active',
    })
  })

  it('logs in with valid credentials, sets auth cookies, and rejects bad credentials', async () => {
    await createTestUser({
      email: `${AUTH_EMAIL_PREFIX}login@example.com`,
      password: 'CorrectPassword123!',
      displayName: 'RoiLogin',
    })

    const successResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: `${AUTH_EMAIL_PREFIX}login@example.com`,
        password: 'CorrectPassword123!',
      })

    expect(successResponse.status).toBe(200)
    expect(successResponse.body.user).toMatchObject({
      email: `${AUTH_EMAIL_PREFIX}login@example.com`,
      displayName: 'RoiLogin',
    })
    expect(pickCookie(successResponse.headers['set-cookie'], 'hsf_token')).toContain('HttpOnly')
    expect(pickCookie(successResponse.headers['set-cookie'], 'XSRF-TOKEN')).toBeTruthy()

    const failureResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: `${AUTH_EMAIL_PREFIX}login@example.com`,
        password: 'WrongPassword123!',
      })

    expect(failureResponse.status).toBe(401)
    expect(failureResponse.body.error).toContain('邮箱或密码错误')
  })

  it('registers users, rejects duplicate emails, and keeps email verification token behavior explicit', async () => {
    await prisma.siteConfig.create({
      data: {
        key: 'email_verification',
        value: {
          enabled: true,
          publicBaseUrl: 'https://example.com',
          tokenTtlMinutes: 30,
        },
      },
    })

    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: `${AUTH_EMAIL_PREFIX}register@example.com`,
        password: 'ValidPassword123!',
        displayName: 'RoiRegister',
      })

    expect(response.status).toBe(201)
    expect(response.body.user).toMatchObject({
      email: `${AUTH_EMAIL_PREFIX}register@example.com`,
      displayName: 'RoiRegister',
      role: 'user',
      emailVerified: false,
    })
    expect(response.body.requiresEmailVerification).toBe(false)
    expect(response.body.verificationEmailSent).toBe(true)
    expect(pickCookie(response.headers['set-cookie'], 'hsf_token')).toBeUndefined()

    const dbUser = await prisma.user.findUnique({
      where: { email: `${AUTH_EMAIL_PREFIX}register@example.com` },
    })
    expect(dbUser?.emailVerifiedAt).toBeNull()
    await expect(
      prisma.emailVerificationToken.count({
        where: {
          userUid: dbUser!.uid,
          email: `${AUTH_EMAIL_PREFIX}register@example.com`,
          purpose: EmailVerificationPurpose.register,
          usedAt: null,
        },
      })
    ).resolves.toBe(1)

    const duplicateResponse = await request(app)
      .post('/api/auth/register')
      .send({
        email: `${AUTH_EMAIL_PREFIX}register@example.com`,
        password: 'ValidPassword123!',
        displayName: 'RoiRegisterAgain',
      })
    expect(duplicateResponse.status).toBe(409)
  })

  it('verifies registration email tokens and allows login afterwards', async () => {
    const { user } = await createTestUser({
      email: `${AUTH_EMAIL_PREFIX}verify@example.com`,
      password: 'VerifyPassword123!',
    })
    await prisma.user.update({
      where: { uid: user.uid },
      data: { emailVerifiedAt: null },
    })
    await createEmailVerificationToken({
      userUid: user.uid,
      email: user.email,
      token: 'valid-register-token',
      purpose: EmailVerificationPurpose.register,
    })

    const verifyResponse = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: 'valid-register-token' })

    expect(verifyResponse.status).toBe(200)
    expect(verifyResponse.body).toMatchObject({
      success: true,
      purpose: EmailVerificationPurpose.register,
    })
    const verifiedUser = await prisma.user.findUnique({ where: { uid: user.uid } })
    expect(verifiedUser?.emailVerifiedAt).toBeInstanceOf(Date)

    const loginResponse = await request(app).post('/api/auth/login').send({
      email: user.email,
      password: 'VerifyPassword123!',
    })
    expect(loginResponse.status).toBe(200)
  })

  it('resets password with a valid token and invalidates the old password', async () => {
    const { user } = await createTestUser({
      email: `${AUTH_EMAIL_PREFIX}reset@example.com`,
      password: 'OldPassword123!',
    })
    await createEmailVerificationToken({
      userUid: user.uid,
      email: user.email,
      token: 'valid-reset-token',
      purpose: EmailVerificationPurpose.reset_password,
    })

    const resetResponse = await request(app).post('/api/auth/password-reset/confirm').send({
      token: 'valid-reset-token',
      newPassword: 'NewPassword123!',
    })

    expect(resetResponse.status).toBe(200)
    expect(resetResponse.body).toEqual({ success: true })

    const oldLoginResponse = await request(app).post('/api/auth/login').send({
      email: user.email,
      password: 'OldPassword123!',
    })
    const newLoginResponse = await request(app).post('/api/auth/login').send({
      email: user.email,
      password: 'NewPassword123!',
    })
    expect(oldLoginResponse.status).toBe(401)
    expect(newLoginResponse.status).toBe(200)
  })

  it('logs out idempotently and clears the auth cookie when authenticated', async () => {
    const { user } = await createTestUser({ email: `${AUTH_EMAIL_PREFIX}logout@example.com` })
    const token = await createTestToken(user.uid, user.role)
    const bootstrap = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)
    const xsrfCookie = pickCookie(bootstrap.headers['set-cookie'], 'XSRF-TOKEN')
    const xsrfToken = xsrfCookie?.split(';')[0].split('=')[1] || ''

    const authenticatedResponse = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', xsrfCookie ? [xsrfCookie] : [])
      .set('X-XSRF-TOKEN', xsrfToken)

    expect(authenticatedResponse.status).toBe(200)
    expect(authenticatedResponse.body).toEqual({ success: true })
    expect(pickCookie(authenticatedResponse.headers['set-cookie'], 'hsf_token')).toContain(
      'hsf_token=;'
    )

    const anonymousResponse = await request(app).post('/api/auth/logout')
    expect(anonymousResponse.status).toBe(200)
    expect(anonymousResponse.body).toEqual({ success: true })
  })
})
