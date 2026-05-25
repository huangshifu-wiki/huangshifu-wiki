import { describe, beforeEach, afterEach, it, expect } from 'vitest'
import request from 'supertest'
import { app } from '../../server'
import { prisma, createTestUser, createTestPost } from './setup'

describe('Sections API - 版块接口测试', () => {
  let adminUser: Awaited<ReturnType<typeof createTestUser>>
  let normalUser: Awaited<ReturnType<typeof createTestUser>>

  function findCookieValue(setCookieHeader: string | string[] | undefined, cookieName: string) {
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
    const loginResponse = await agent
      .post('/api/auth/login')
      .send({ email, password })

    expect(loginResponse.status).toBe(200)
    const xsrfToken = findCookieValue(loginResponse.headers['set-cookie'], 'XSRF-TOKEN')
    expect(xsrfToken).toBeTruthy()

    return {
      agent,
      xsrfToken: xsrfToken!,
    }
  }

  beforeEach(async () => {
    await prisma.post.deleteMany({
      where: {
        section: {
          startsWith: 'test-section-',
        },
      },
    })

    await prisma.section.deleteMany({
      where: {
        id: {
          startsWith: 'test-section-',
        },
      },
    })

    adminUser = await createTestUser({ role: 'admin' })
    normalUser = await createTestUser({ role: 'user' })
  })

  afterEach(async () => {
    await prisma.post.deleteMany({
      where: {
        section: {
          startsWith: 'test-section-',
        },
      },
    })

    await prisma.section.deleteMany({
      where: {
        id: {
          startsWith: 'test-section-',
        },
      },
    })
  })

  it('管理员应能创建并删除版块', async () => {
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const createResponse = await agent
      .post('/api/sections')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        name: 'Test Section 100',
        description: 'integration test section',
        order: 3,
      })

    expect(createResponse.status).toBe(201)
    expect(createResponse.body.section).toMatchObject({
      id: 'test-section-100',
      name: 'Test Section 100',
      description: 'integration test section',
      order: 3,
    })

    const deleteResponse = await agent
      .delete('/api/sections/test-section-100')
      .set('X-XSRF-TOKEN', xsrfToken)

    expect(deleteResponse.status).toBe(200)
    expect(deleteResponse.body).toEqual({ success: true })

    const deletedSection = await prisma.section.findUnique({
      where: { id: 'test-section-100' },
    })
    expect(deletedSection).toBeNull()
  })

  it('普通用户不应能删除版块', async () => {
    await prisma.section.create({
      data: {
        id: 'test-section-101',
        name: 'Test Section 101',
        description: 'forbidden delete test',
        order: 1,
      },
    })

    const { agent, xsrfToken } = await createAuthenticatedAgent(
      normalUser.user.email,
      normalUser.plainPassword
    )

    const response = await agent
      .delete('/api/sections/test-section-101')
      .set('X-XSRF-TOKEN', xsrfToken)

    expect(response.status).toBe(403)

    const existingSection = await prisma.section.findUnique({
      where: { id: 'test-section-101' },
    })
    expect(existingSection).not.toBeNull()
  })

  it('版块下仍有帖子时应拒绝删除并返回明确错误', async () => {
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    await prisma.section.create({
      data: {
        id: 'test-section-102',
        name: 'Test Section 102',
        description: 'has posts',
        order: 2,
      },
    })

    await createTestPost({
      title: 'Test Section 102 Post',
      section: 'test-section-102',
      authorUid: adminUser.user.uid,
    })

    const response = await agent
      .delete('/api/sections/test-section-102')
      .set('X-XSRF-TOKEN', xsrfToken)

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('请先处理帖子后再删除版块')

    const existingSection = await prisma.section.findUnique({
      where: { id: 'test-section-102' },
    })
    expect(existingSection).not.toBeNull()
  })
})
