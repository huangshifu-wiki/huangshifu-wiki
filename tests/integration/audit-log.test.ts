import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../../server'
import { runtimeConfigService } from '../../src/server/services/runtimeConfig.service'
import { createTestUser, createTestWikiPage, prisma } from './setup'

const EMAIL_PREFIX = 'audit-log-'
const WIKI_SLUG_PREFIX = 'audit-wiki-'
const EVENT_SLUG_PREFIX = 'audit-event-'
const ANN_CONTENT_PREFIX = 'audit-ann-'

function pickCookie(setCookieHeader: string | string[] | undefined, cookieName: string) {
  const cookies = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : []
  const targetCookie = cookies.find((cookie) => cookie?.startsWith(`${cookieName}=`))
  return targetCookie?.split(';')[0].split('=')[1]
}

async function createAgent(role: 'admin' | 'super_admin', tag: string) {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const user = await createTestUser({
    role,
    email: `${EMAIL_PREFIX}${tag}_${suffix}@example.com`,
    displayName: `${EMAIL_PREFIX}${tag}_${suffix}`,
  })
  const agent = request.agent(app)
  const loginResponse = await agent.post('/api/auth/login').send({
    email: user.user.email,
    password: user.plainPassword,
  })
  expect(loginResponse.status).toBe(200)
  const xsrfToken = pickCookie(loginResponse.headers['set-cookie'], 'XSRF-TOKEN')
  expect(xsrfToken).toBeTruthy()
  return { agent, xsrfToken: xsrfToken!, uid: user.user.uid }
}

async function fetchModerationLogs(agent: request.Agent) {
  const res = await agent.get('/api/admin/moderation_logs').expect(200)
  return res.body.logs as Array<{
    targetType: string
    targetId: string
    action: string
    operatorUid: string
    note: string | null
  }>
}

const operatorUids: string[] = []

describe('操作日志扩展（删除/恢复/配置/角色审计）', () => {
  afterEach(async () => {
    await prisma.moderationLog.deleteMany({
      where: { operatorUid: { in: operatorUids } },
    })
    await prisma.wikiPage.deleteMany({ where: { slug: { startsWith: WIKI_SLUG_PREFIX } } })
    await prisma.event.deleteMany({ where: { slug: { startsWith: EVENT_SLUG_PREFIX } } })
    await prisma.announcement.deleteMany({
      where: { content: { startsWith: ANN_CONTENT_PREFIX } },
    })
    await prisma.user.deleteMany({
      where: {
        OR: [{ email: { startsWith: EMAIL_PREFIX } }, { uid: { in: operatorUids } }],
      },
    })
    operatorUids.length = 0
    await runtimeConfigService.updateConfig({ logLevel: 'info' })
  })

  it('物理删除 wiki 页面写入 permanentDelete 日志', async () => {
    const { agent, xsrfToken, uid } = await createAgent('admin', 'admin')
    operatorUids.push(uid)
    const page = await createTestWikiPage({
      slug: `${WIKI_SLUG_PREFIX}permanent`,
      title: 'Audit Permanent Delete',
      status: 'published',
      authorUid: uid,
    })

    await agent
      .delete(`/api/admin/wiki/${page.id}/permanent`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .expect(200)

    const logs = await fetchModerationLogs(agent)
    const match = logs.find(
      (log) =>
        log.targetType === 'wiki' && log.targetId === page.slug && log.action === 'permanentDelete'
    )
    expect(match).toBeTruthy()
    expect(match!.operatorUid).toBe(uid)
  })

  it('恢复软删除的 wiki 页面写入 restore 日志', async () => {
    const { agent, xsrfToken, uid } = await createAgent('admin', 'admin')
    operatorUids.push(uid)
    const page = await createTestWikiPage({
      slug: `${WIKI_SLUG_PREFIX}restore`,
      title: 'Audit Restore',
      status: 'published',
      authorUid: uid,
    })

    await agent
      .delete(`/api/admin/wiki/${page.id}`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ reason: 'ROI audit delete' })
      .expect(200)

    await agent
      .post(`/api/admin/wiki/${page.id}/restore`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .expect(200)

    const logs = await fetchModerationLogs(agent)
    const match = logs.find(
      (log) => log.targetType === 'wiki' && log.targetId === page.slug && log.action === 'restore'
    )
    expect(match).toBeTruthy()
    expect(match!.operatorUid).toBe(uid)
  })

  it('运行时配置变更写入 config/runtime/update 日志', async () => {
    const { agent, xsrfToken, uid } = await createAgent('super_admin', 'super')
    operatorUids.push(uid)

    await agent
      .patch('/api/admin/runtime-config')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ logLevel: 'debug' })
      .expect(200)

    const logs = await fetchModerationLogs(agent)
    const match = logs.find(
      (log) => log.targetType === 'config' && log.targetId === 'runtime' && log.action === 'update'
    )
    expect(match).toBeTruthy()
    expect(match!.operatorUid).toBe(uid)
    expect(match!.note).toContain('logLevel')
  })

  it('角色变更写入 user/update 日志', async () => {
    const { agent, xsrfToken, uid } = await createAgent('super_admin', 'super')
    operatorUids.push(uid)
    const target = await createTestUser({
      role: 'user',
      email: `${EMAIL_PREFIX}target@example.com`,
      displayName: 'AuditRoleTarget',
    })

    await agent
      .put(`/api/users/${target.user.uid}/role`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ role: 'admin' })
      .expect(200)

    const logs = await fetchModerationLogs(agent)
    const match = logs.find(
      (log) =>
        log.targetType === 'user' && log.targetId === target.user.uid && log.action === 'update'
    )
    expect(match).toBeTruthy()
    expect(match!.operatorUid).toBe(uid)
    expect(match!.note).toBe('角色变更: user -> admin')
  })

  it('恢复未删除的条目返回 400 且不产生日志', async () => {
    const { agent, xsrfToken, uid } = await createAgent('admin', 'admin')
    operatorUids.push(uid)
    const page = await createTestWikiPage({
      slug: `${WIKI_SLUG_PREFIX}never-deleted`,
      title: 'Audit Never Deleted',
      status: 'published',
      authorUid: uid,
    })

    await agent
      .post(`/api/admin/wiki/${page.id}/restore`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .expect(400)

    const logs = await fetchModerationLogs(agent)
    const match = logs.find(
      (log) => log.targetType === 'wiki' && log.targetId === page.slug && log.action === 'restore'
    )
    expect(match).toBeUndefined()
  })

  it('重复删除公告返回 404 且只产生一条删除日志', async () => {
    const { agent, xsrfToken, uid } = await createAgent('admin', 'admin')
    operatorUids.push(uid)
    const created = await agent
      .post('/api/announcements')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ content: `${ANN_CONTENT_PREFIX}${Date.now()}` })
      .expect(201)
    const announcementId = created.body.announcement.id

    await agent
      .delete(`/api/announcements/${announcementId}`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .expect(200)
    await agent
      .delete(`/api/announcements/${announcementId}`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .expect(404)

    const logs = await fetchModerationLogs(agent)
    const matches = logs.filter(
      (log) =>
        log.targetType === 'announcement' &&
        log.targetId === announcementId &&
        log.action === 'delete'
    )
    expect(matches).toHaveLength(1)
  })

  it('活动领域路由的恢复与彻底删除均写入日志', async () => {
    const { agent, xsrfToken, uid } = await createAgent('admin', 'admin')
    operatorUids.push(uid)
    const slug = `${EVENT_SLUG_PREFIX}${Date.now()}`
    const event = await prisma.event.create({
      data: {
        slug,
        title: 'Audit Event',
        location: '测试地点',
        content: '测试内容',
        createdByUid: uid,
      },
    })

    await agent.delete(`/api/events/${event.id}`).set('X-XSRF-TOKEN', xsrfToken).expect(200)
    await agent.post(`/api/events/${event.id}/restore`).set('X-XSRF-TOKEN', xsrfToken).expect(200)
    await agent.delete(`/api/events/${event.id}`).set('X-XSRF-TOKEN', xsrfToken).expect(200)
    await agent
      .delete(`/api/events/${event.id}/permanent`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .expect(200)

    const logs = await fetchModerationLogs(agent)
    const restoreLog = logs.find(
      (log) => log.targetType === 'event' && log.targetId === event.id && log.action === 'restore'
    )
    const permanentLog = logs.find(
      (log) =>
        log.targetType === 'event' && log.targetId === event.id && log.action === 'permanentDelete'
    )
    expect(restoreLog).toBeTruthy()
    expect(permanentLog).toBeTruthy()
    expect(restoreLog!.operatorUid).toBe(uid)
    expect(permanentLog!.operatorUid).toBe(uid)
  })
})
