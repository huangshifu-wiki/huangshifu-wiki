import { describe, beforeEach, afterEach, it, expect } from 'vitest'
import request from 'supertest'
import { app } from '../../server'
import { prisma, createTestUser } from './setup'

function findCookieValue(setCookieHeader: string | string[] | undefined, cookieName: string) {
  const cookies = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : []
  const targetCookie = cookies.find((cookie) => cookie?.startsWith(`${cookieName}=`))
  return targetCookie?.split(';')[0].split('=')[1]
}

async function createSuperAdminAgent() {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const user = await createTestUser({
    role: 'super_admin',
    email: `test_secrets_${suffix}@example.com`,
    displayName: `TestSecrets_${suffix}`,
  })
  const agent = request.agent(app)
  const loginResponse = await agent.post('/api/auth/login').send({
    email: user.user.email,
    password: user.plainPassword,
  })
  expect(loginResponse.status).toBe(200)
  const xsrfToken = findCookieValue(loginResponse.headers['set-cookie'], 'XSRF-TOKEN')
  expect(xsrfToken).toBeTruthy()
  return { agent, xsrfToken: xsrfToken! }
}

describe('Admin secrets config API', () => {
  beforeEach(async () => {
    // 清理测试期间写入的 secrets 配置，避免污染其他用例
    await prisma.siteConfig.deleteMany({ where: { key: 'secrets_config' } })
  })

  afterEach(async () => {
    await prisma.siteConfig.deleteMany({ where: { key: 'secrets_config' } })
  })

  it('GET 返回掩码视图且不含明文', async () => {
    const { agent, xsrfToken } = await createSuperAdminAgent()

    await agent
      .patch('/api/admin/secrets-config')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ amapApiKey: 'top-secret-amap-key-9876' })
      .expect(200)

    const response = await agent.get('/api/admin/secrets-config').expect(200)

    expect(response.body.success).toBe(true)
    expect(response.body.data.disabled).toBe(false)
    expect(response.body.data.secrets.amapApiKey).toEqual({
      configured: true,
      last4: '9876',
    })
    expect(JSON.stringify(response.body)).not.toContain('top-secret-amap-key')
  })

  it('PATCH 设置凭证后返回掩码，清除后恢复未配置', async () => {
    const { agent, xsrfToken } = await createSuperAdminAgent()

    const setResponse = await agent
      .patch('/api/admin/secrets-config')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ s3WriteAccessKeyId: 'AKIAEXAMPLEKEY1234' })
      .expect(200)

    expect(setResponse.body.data.secrets.s3WriteAccessKeyId).toEqual({
      configured: true,
      last4: '1234',
    })

    const clearResponse = await agent
      .patch('/api/admin/secrets-config')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ s3WriteAccessKeyId: null })
      .expect(200)

    expect(clearResponse.body.data.secrets.s3WriteAccessKeyId).toEqual({
      configured: false,
      last4: '',
    })
  })

  it('普通管理员无权访问凭证端点', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const { user, plainPassword } = await createTestUser({
      role: 'admin',
      email: `test_secrets_deny_${suffix}@example.com`,
      displayName: `TestSecretsDeny_${suffix}`,
    })
    const agent = request.agent(app)
    const loginResponse = await agent.post('/api/auth/login').send({
      email: user.email,
      password: plainPassword,
    })
    expect(loginResponse.status).toBe(200)

    await agent.get('/api/admin/secrets-config').expect(403)
  })
})
