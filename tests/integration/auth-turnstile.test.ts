import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { app } from '../../server'
import { createTestUser, prisma } from './setup'
import { runtimeConfigService } from '../../src/server/services/runtimeConfig.service'
import { secretsConfigService } from '../../src/server/services/secretsConfig.service'

const TURNSTILE_EMAIL_PREFIX = 'roi_turnstile_'

async function cleanupTurnstileTestData() {
  await prisma.user.deleteMany({ where: { email: { startsWith: TURNSTILE_EMAIL_PREFIX } } })
  // 其他用例可能残留“注册关闭/邮件验证开启”配置，注册类用例需要默认状态
  await prisma.siteConfig.deleteMany({
    where: { key: { in: ['secrets_config', 'registration', 'email_verification'] } },
  })
}

function stubSiteverify(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }))
  )
}

describe('Auth Turnstile 人机验证', () => {
  beforeEach(async () => {
    await cleanupTurnstileTestData()
    // 用户表为空时注册开关关闭（待初始化），与其他认证用例一致放一个哨兵用户
    await createTestUser({
      email: `${TURNSTILE_EMAIL_PREFIX}admin@example.com`,
      role: 'super_admin',
    })
    await runtimeConfigService.updateConfig({ turnstileEnabled: true })
    await secretsConfigService.updateSecrets({
      turnstileSiteKey: 'test-site-key',
      turnstileSecretKey: 'test-secret-key',
    })
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await secretsConfigService.updateSecrets({ turnstileSiteKey: null, turnstileSecretKey: null })
    await runtimeConfigService.updateConfig({ turnstileEnabled: false })
    await cleanupTurnstileTestData()
  })

  it('带有效 token 注册成功', async () => {
    stubSiteverify({ success: true })

    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: `${TURNSTILE_EMAIL_PREFIX}ok@example.com`,
        password: 'password123',
        turnstileToken: 'token-ok',
      })

    expect(response.status).toBe(201)
    expect(response.body.success).toBe(true)
  })

  it('缺少 token 时返回 TURNSTILE_REQUIRED', async () => {
    stubSiteverify({ success: true })

    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: `${TURNSTILE_EMAIL_PREFIX}missing@example.com`,
        password: 'password123',
      })

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('TURNSTILE_REQUIRED')
  })

  it('Cloudflare 明确拒绝时返回 TURNSTILE_FAILED 且不创建用户', async () => {
    stubSiteverify({ success: false, 'error-codes': ['invalid-input-response'] })
    const email = `${TURNSTILE_EMAIL_PREFIX}rejected@example.com`

    const response = await request(app).post('/api/auth/register').send({
      email,
      password: 'password123',
      turnstileToken: 'token-bad',
    })

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('TURNSTILE_FAILED')
    await expect(prisma.user.findUnique({ where: { email } })).resolves.toBeNull()
  })

  it('校验服务不可用时放行注册', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      })
    )

    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: `${TURNSTILE_EMAIL_PREFIX}fallback@example.com`,
        password: 'password123',
        turnstileToken: 'token-any',
      })

    expect(response.status).toBe(201)
  })

  it('开关关闭时无 token 也可注册', async () => {
    await runtimeConfigService.updateConfig({ turnstileEnabled: false })

    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: `${TURNSTILE_EMAIL_PREFIX}disabled@example.com`,
        password: 'password123',
      })

    expect(response.status).toBe(201)
  })

  it('重发验证邮件同样要求 token', async () => {
    stubSiteverify({ success: true })

    const response = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: `${TURNSTILE_EMAIL_PREFIX}resend@example.com` })

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('TURNSTILE_REQUIRED')
  })
})
