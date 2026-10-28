import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest'
import sharp from 'sharp'
import request from 'supertest'
import { app } from '../../server'
import { variantGenerator } from '../../src/server/services/variantGenerator'
import { prisma, createTestUser } from './setup'
import { uploadsDir } from '../../src/server/utils/config'

function findCookieValue(setCookieHeader: string | string[] | undefined, cookieName: string) {
  const cookies = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : []
  return cookies
    .find((cookie) => cookie?.startsWith(`${cookieName}=`))
    ?.split(';')[0]
    .split('=')[1]
}

async function authenticate(email: string, password: string) {
  const agent = request.agent(app)
  const response = await agent.post('/api/auth/login').send({ email, password })
  expect(response.status).toBe(200)
  const xsrfToken = findCookieValue(response.headers['set-cookie'], 'XSRF-TOKEN')
  expect(xsrfToken).toBeTruthy()
  return { agent, xsrfToken: xsrfToken! }
}

describe('Admin media maintenance API', () => {
  let adminUser: Awaited<ReturnType<typeof createTestUser>>
  let regularUser: Awaited<ReturnType<typeof createTestUser>>
  const imageMapIds: string[] = []
  const assetIds: string[] = []
  const storageKeys: string[] = []

  beforeEach(async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    adminUser = await createTestUser({
      role: 'admin',
      email: `maintenance_admin_${suffix}@example.com`,
      displayName: `MaintenanceAdmin_${suffix}`,
    })
    regularUser = await createTestUser({
      role: 'user',
      email: `maintenance_user_${suffix}@example.com`,
      displayName: `MaintenanceUser_${suffix}`,
    })
  })
  afterEach(async () => {
    const mapsToDelete = imageMapIds.splice(0)
    const assetsToDelete = assetIds.splice(0)
    await prisma.mediaAsset.deleteMany({ where: { id: { in: assetsToDelete } } })
    await prisma.imageMap.deleteMany({ where: { id: { in: mapsToDelete } } })
    await prisma.user.deleteMany({
      where: { uid: { in: [adminUser.user.uid, regularUser.user.uid] } },
    })
    await Promise.all([
      ...storageKeys
        .splice(0)
        .map((storageKey) => fs.rm(path.join(uploadsDir, storageKey), { force: true })),
      ...mapsToDelete.map((id) =>
        fs.rm(path.join(uploadsDir, 'variants', id), { recursive: true, force: true })
      ),
    ])
  })

  it('rejects regular users and allows admins to scan', async () => {
    const regular = await authenticate(regularUser.user.email, regularUser.plainPassword)
    const denied = await regular.agent.get('/api/admin/media-maintenance/scan')
    expect(denied.status).toBe(403)

    const admin = await authenticate(adminUser.user.email, adminUser.plainPassword)
    const allowed = await admin.agent.get('/api/admin/media-maintenance/scan').query({ limit: 1 })
    expect(allowed.status).toBe(200)
    expect(allowed.body.data).toMatchObject({
      scanned: expect.any(Number),
      processed: expect.any(Number),
      skipped: expect.any(Number),
      failed: expect.any(Number),
    })
  })

  it('keeps dry-run read-only and repairs a completed map with a missing thumbnail', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const storageKey = `maintenance-test/${suffix}.jpg`
    const imageMapId = `maintenance-map-${suffix}`
    const sourcePath = path.join(uploadsDir, storageKey)
    storageKeys.push(storageKey)
    imageMapIds.push(imageMapId)
    await fs.mkdir(path.dirname(sourcePath), { recursive: true })
    await sharp({
      create: { width: 40, height: 40, channels: 3, background: { r: 40, g: 100, b: 160 } },
    })
      .png()
      .toFile(sourcePath)
    await prisma.imageMap.create({
      data: {
        id: imageMapId,
        md5: 'abcdefabcdefabcdefabcdefabcdefab',
        localUrl: `/uploads/${storageKey}`,
        variantStatus: 'completed',
        thumbnailUrl: null,
      },
    })
    const claimIds = [`maintenance-claim-a-${suffix}`, `maintenance-claim-b-${suffix}`]
    assetIds.push(...claimIds)
    await prisma.mediaAsset.createMany({
      data: claimIds.map((id) => ({
        id,
        ownerUid: adminUser.user.uid,
        imageMapId,
        storageKey,
        publicUrl: `/uploads/${storageKey}`,
        fileName: `${id}.png`,
        mimeType: 'image/png',
        sizeBytes: 100,
        status: 'ready' as const,
      })),
    })

    const { agent, xsrfToken } = await authenticate(adminUser.user.email, adminUser.plainPassword)
    const dryRun = await agent
      .post('/api/admin/media-maintenance/repair-thumbnails')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ mode: 'dry-run', batchSize: 100 })
    expect(dryRun.status).toBe(200)
    expect(dryRun.body.data.queued).toBeGreaterThanOrEqual(1)
    expect(
      await prisma.imageMap.findUnique({
        where: { id: imageMapId },
        select: { variantStatus: true },
      })
    ).toMatchObject({ variantStatus: 'completed' })

    const apply = await agent
      .post('/api/admin/media-maintenance/repair-thumbnails')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ mode: 'apply', batchSize: 100 })
    expect(apply.status).toBe(200)
    expect(apply.body.data.queued).toBe(1)

    const testGenerator = variantGenerator as unknown as {
      processOnEnqueue: boolean
      processNext: () => void
    }
    testGenerator.processOnEnqueue = true
    testGenerator.processNext()
    await vi.waitFor(
      async () => {
        const current = await prisma.imageMap.findUnique({
          where: { id: imageMapId },
          select: { variantStatus: true, thumbnailUrl: true },
        })
        expect(current?.variantStatus).toBe('completed')
        expect(current?.thumbnailUrl).toBeTruthy()
      },
      { timeout: 10000 }
    )
    const current = await prisma.imageMap.findUnique({
      where: { id: imageMapId },
      select: { thumbnailUrl: true },
    })
    expect(current?.thumbnailUrl).toBeTruthy()
    const thumbnailResponse = await request(app).get(current!.thumbnailUrl!)
    expect(thumbnailResponse.status).toBe(200)
    expect(thumbnailResponse.headers['content-type']).toContain('image/webp')

    const repeat = await agent
      .post('/api/admin/media-maintenance/repair-thumbnails')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ mode: 'apply', batchSize: 100 })
    expect(repeat.status).toBe(200)
    expect(repeat.body.data.queued).toBe(0)
  })

  it('returns skipped for a missing source instead of a server error', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const imageMapId = `maintenance-missing-${suffix}`
    imageMapIds.push(imageMapId)
    await prisma.imageMap.create({
      data: {
        id: imageMapId,
        md5: `maintenance-missing-${suffix}`,
        localUrl: `/uploads/maintenance-test/${suffix}.jpg`,
        variantStatus: 'completed',
        thumbnailUrl: null,
      },
    })
    const { agent, xsrfToken } = await authenticate(adminUser.user.email, adminUser.plainPassword)
    const response = await agent
      .post('/api/admin/media-maintenance/repair-thumbnails')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ mode: 'apply', batchSize: 100 })

    expect(response.status).toBe(200)
    expect(response.body.data.skippedMissingSource).toBeGreaterThanOrEqual(1)
    expect(response.body.data.failed).toBe(0)
  })

  it('requires a super admin and rejects unsafe orphan delete input', async () => {
    const admin = await authenticate(adminUser.user.email, adminUser.plainPassword)
    const denied = await admin.agent
      .post('/api/admin/media-maintenance/orphans/delete')
      .set('X-XSRF-TOKEN', admin.xsrfToken)
      .send({ previewToken: 'invalid', storageKeys: ['../secret'] })
    expect(denied.status).toBe(403)

    const superAdmin = await createTestUser({
      role: 'super_admin',
      email: `maintenance_super_${Date.now()}@example.com`,
      displayName: `MaintenanceSuper_${Date.now()}`,
    })
    try {
      const authenticated = await authenticate(superAdmin.user.email, superAdmin.plainPassword)
      const preview = await authenticated.agent
        .post('/api/admin/media-maintenance/orphans/preview')
        .set('X-XSRF-TOKEN', authenticated.xsrfToken)
        .send({ batchSize: 1, olderThanHours: 0 })
      expect(preview.status).toBe(200)
      const response = await authenticated.agent
        .post('/api/admin/media-maintenance/orphans/delete')
        .set('X-XSRF-TOKEN', authenticated.xsrfToken)
        .send({
          previewToken: preview.body.data.previewToken,
          storageKeys: ['../secret'],
        })
      expect(response.status).toBe(400)
    } finally {
      await prisma.user.delete({ where: { uid: superAdmin.user.uid } })
    }
  })
})
