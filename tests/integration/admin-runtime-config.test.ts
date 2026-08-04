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
    email: `test_runtime_${suffix}@example.com`,
    displayName: `TestRuntime_${suffix}`,
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

describe('Admin runtime config API（env→DB 迁移字段）', () => {
  beforeEach(async () => {
    await prisma.siteConfig.deleteMany({ where: { key: 'runtime_config' } })
  })

  afterEach(async () => {
    await prisma.siteConfig.deleteMany({ where: { key: 'runtime_config' } })
  })

  it('PATCH logLevel 即时生效并持久化', async () => {
    const { agent, xsrfToken } = await createSuperAdminAgent()

    const patchResponse = await agent
      .patch('/api/admin/runtime-config')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ logLevel: 'debug' })
      .expect(200)

    expect(patchResponse.body.data.logLevel).toBe('debug')
    expect(patchResponse.body.data.s3Enabled).toBe(false)

    const getResponse = await agent.get('/api/admin/runtime-config').expect(200)
    expect(getResponse.body.data.logLevel).toBe('debug')
  })

  it('拒绝越界的枚举值', async () => {
    const { agent, xsrfToken } = await createSuperAdminAgent()

    await agent
      .patch('/api/admin/runtime-config')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ logLevel: 'verbose' })
      .expect(400)
  })

  it('迁移字段可通过新端点读写（s3/vector/image-hosting）', async () => {
    const { agent, xsrfToken } = await createSuperAdminAgent()

    const patchResponse = await agent
      .patch('/api/admin/runtime-config')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        s3Enabled: true,
        s3EndpointUrl: 'https://s3.example.com',
        qdrantUrl: 'http://qdrant:6333',
        qdrantCollection: 'img_collection',
        lskyBaseUrl: 'https://lsky.example.com',
        lskyTimeout: 15000,
      })
      .expect(200)

    expect(patchResponse.body.data).toEqual(
      expect.objectContaining({
        s3Enabled: true,
        s3EndpointUrl: 'https://s3.example.com',
        qdrantCollection: 'img_collection',
        lskyTimeout: 15000,
      })
    )

    const getResponse = await agent.get('/api/admin/runtime-config').expect(200)
    expect(getResponse.body.data.lskyBaseUrl).toBe('https://lsky.example.com')
  })
})