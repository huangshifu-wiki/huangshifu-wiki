import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../../server'
import { prisma, createTestGallery, createTestUser } from './setup'

const GALLERY_TITLE_PREFIX = 'ROI Gallery EventDate'
const STORAGE_KEY_PREFIX = 'roi-gallery-event-date/'
const PUBLIC_URL_PREFIX = `/uploads/${STORAGE_KEY_PREFIX}`

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

async function cleanupGalleryEventDateData() {
  await prisma.gallery.deleteMany({
    where: { title: { startsWith: GALLERY_TITLE_PREFIX } },
  })
  await prisma.imageMap.deleteMany({
    where: { localUrl: { startsWith: PUBLIC_URL_PREFIX } },
  })
  await prisma.mediaAsset.deleteMany({
    where: { storageKey: { startsWith: STORAGE_KEY_PREFIX } },
  })
  await prisma.user.deleteMany({
    where: { email: { startsWith: 'roi_gallery_event_date_' } },
  })
}

async function createTestImageAsset(ownerUid: string, suffix: string) {
  const fileName = `gallery-event-date-${suffix}.jpg`

  return prisma.mediaAsset.create({
    data: {
      ownerUid,
      storageKey: `${STORAGE_KEY_PREFIX}${fileName}`,
      publicUrl: `${PUBLIC_URL_PREFIX}${fileName}`,
      fileName,
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      status: 'ready',
    },
  })
}

describe('Galleries API eventDate handling', () => {
  let adminUser: Awaited<ReturnType<typeof createTestUser>>

  beforeEach(async () => {
    await cleanupGalleryEventDateData()
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    adminUser = await createTestUser({
      role: 'admin',
      email: `roi_gallery_event_date_${suffix}@example.com`,
      displayName: `RoiGalleryEventDate_${suffix}`,
    })
  })

  afterEach(async () => {
    await cleanupGalleryEventDateData()
  })

  it('creates galleries when eventDate is omitted and when a valid date is provided', async () => {
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const [assetWithoutDate, assetWithDate] = await Promise.all([
      createTestImageAsset(adminUser.user.uid, `${suffix}-empty`),
      createTestImageAsset(adminUser.user.uid, `${suffix}-dated`),
    ])

    const responseWithoutDate = await agent
      .post('/api/galleries')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        title: `${GALLERY_TITLE_PREFIX} Without Date ${suffix}`,
        description: 'Create without eventDate',
        assetIds: [assetWithoutDate.id],
      })

    expect(responseWithoutDate.status).toBe(201)
    expect(responseWithoutDate.body.gallery.eventDate).toBeNull()

    const responseWithDate = await agent
      .post('/api/galleries')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        title: `${GALLERY_TITLE_PREFIX} With Date ${suffix}`,
        description: 'Create with eventDate',
        eventDate: '2024-06-15',
        assetIds: [assetWithDate.id],
      })

    expect(responseWithDate.status).toBe(201)
    expect(responseWithDate.body.gallery.eventDate).toBe('2024-06-15')
  })

  it('updates other fields without eventDate and validates explicit eventDate changes', async () => {
    const gallery = await createTestGallery({
      title: `${GALLERY_TITLE_PREFIX} Patch`,
      authorUid: adminUser.user.uid,
      authorName: adminUser.user.displayName,
    })
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const titleOnlyResponse = await agent
      .patch(`/api/galleries/${gallery.id}`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ title: `${GALLERY_TITLE_PREFIX} Patch Renamed` })

    expect(titleOnlyResponse.status).toBe(200)
    expect(titleOnlyResponse.body.gallery.title).toBe(`${GALLERY_TITLE_PREFIX} Patch Renamed`)
    expect(titleOnlyResponse.body.gallery.eventDate).toBeNull()

    const datedResponse = await agent
      .patch(`/api/galleries/${gallery.id}`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ eventDate: '2024-06-15' })

    expect(datedResponse.status).toBe(200)
    expect(datedResponse.body.gallery.eventDate).toBe('2024-06-15')

    const invalidResponse = await agent
      .patch(`/api/galleries/${gallery.id}`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ eventDate: '2024-02-31' })

    expect(invalidResponse.status).toBe(400)
  })
})
