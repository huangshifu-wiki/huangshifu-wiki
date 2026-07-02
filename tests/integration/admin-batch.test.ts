import { describe, beforeEach, afterEach, it, expect } from 'vitest'
import request from 'supertest'
import { app } from '../../server'
import { prisma, createTestGallery, createTestUser } from './setup'

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
  const loginResponse = await agent.post('/api/auth/login').send({ email, password })

  expect(loginResponse.status).toBe(200)
  const xsrfToken = findCookieValue(loginResponse.headers['set-cookie'], 'XSRF-TOKEN')
  expect(xsrfToken).toBeTruthy()

  return {
    agent,
    xsrfToken: xsrfToken!,
  }
}

describe('Admin batch operations API', () => {
  let adminUser: Awaited<ReturnType<typeof createTestUser>>

  beforeEach(async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    adminUser = await createTestUser({
      role: 'admin',
      email: `test_admin_batch_${suffix}@example.com`,
      displayName: `TestAdminBatch_${suffix}`,
    })
  })

  afterEach(async () => {
    await prisma.editLock.deleteMany({
      where: { recordId: { startsWith: 'test-admin-batch-' } },
    })
    await prisma.gallery.deleteMany({
      where: { title: { startsWith: 'Admin Batch Gallery' } },
    })
    await prisma.album.deleteMany({
      where: { title: { startsWith: 'Batch' } },
    })
    await prisma.musicTrack.deleteMany({
      where: { title: { startsWith: 'Batch' } },
    })
    await prisma.mediaAsset.deleteMany({
      where: { storageKey: { startsWith: 'test-admin-batch/' } },
    })
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'test_admin_batch_' } },
    })
  })

  it('batch deletes gallery images and reorders remaining images', async () => {
    const gallery = await createTestGallery({
      title: `Admin Batch Gallery ${Date.now()}`,
      authorUid: adminUser.user.uid,
      authorName: adminUser.user.displayName,
    })
    const images = await Promise.all(
      [0, 1, 2].map((index) =>
        prisma.galleryImage.create({
          data: {
            galleryId: gallery.id,
            url: `/uploads/test-admin-batch-${index}.jpg`,
            name: `test-admin-batch-${index}.jpg`,
            sortOrder: index,
          },
        })
      )
    )
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const response = await agent
      .delete(`/api/galleries/${gallery.id}/images`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ imageIds: [images[0].id, images[1].id] })

    expect(response.status).toBe(200)
    expect(response.body.deleted).toBe(2)
    const remaining = await prisma.galleryImage.findMany({
      where: { galleryId: gallery.id },
      orderBy: { sortOrder: 'asc' },
    })
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(images[2].id)
    expect(remaining[0].sortOrder).toBe(0)
  })

  it('batch delete gallery images refuses to delete the final image', async () => {
    const gallery = await createTestGallery({
      title: `Admin Batch Gallery ${Date.now()}`,
      authorUid: adminUser.user.uid,
      authorName: adminUser.user.displayName,
    })
    const image = await prisma.galleryImage.create({
      data: {
        galleryId: gallery.id,
        url: '/uploads/test-admin-batch-final.jpg',
        name: 'test-admin-batch-final.jpg',
        sortOrder: 0,
      },
    })
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const response = await agent
      .delete(`/api/galleries/${gallery.id}/images`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ imageIds: [image.id] })

    expect(response.status).toBe(400)
    expect(await prisma.galleryImage.count({ where: { galleryId: gallery.id } })).toBe(1)
  })

  it('appends duplicate gallery asset ids as separate images', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const gallery = await createTestGallery({
      title: `Admin Batch Gallery Duplicate Append ${suffix}`,
      authorUid: adminUser.user.uid,
      authorName: adminUser.user.displayName,
    })
    const asset = await prisma.mediaAsset.create({
      data: {
        ownerUid: adminUser.user.uid,
        storageKey: `test-admin-batch/duplicate-gallery-asset-${suffix}.jpg`,
        publicUrl: `/uploads/test-admin-batch-duplicate-gallery-asset-${suffix}.jpg`,
        fileName: 'duplicate-gallery-asset.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        status: 'ready',
      },
    })
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const response = await agent
      .post(`/api/galleries/${gallery.id}/images`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ assetIds: [asset.id, asset.id] })

    expect(response.status).toBe(200)
    const appended = await prisma.galleryImage.findMany({
      where: { galleryId: gallery.id, assetId: asset.id },
      orderBy: { sortOrder: 'asc' },
    })
    expect(appended).toHaveLength(2)
    expect(appended.map((image) => image.sortOrder)).toEqual([0, 1])
  })

  it('batch deletes song and album covers with default cover fallback', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const [song, album] = await Promise.all([
      prisma.musicTrack.create({
        data: {
          title: 'Batch Cover Song',
          artists: ['Batch Artist'],
          album: 'Batch Album',
        },
      }),
      prisma.album.create({
        data: {
          title: 'Batch Cover Album',
          artist: 'Batch Artist',
        },
      }),
    ])
    const [songCoverA, songCoverB] = await Promise.all([
      prisma.songCover.create({
        data: {
          songDocId: song.docId,
          storageKey: `test-admin-batch/song-cover-a-${suffix}.jpg`,
          publicUrl: `/uploads/test-admin-batch-song-cover-a-${suffix}.jpg`,
          isDefault: true,
          sortOrder: 0,
        },
      }),
      prisma.songCover.create({
        data: {
          songDocId: song.docId,
          storageKey: `test-admin-batch/song-cover-b-${suffix}.jpg`,
          publicUrl: `/uploads/test-admin-batch-song-cover-b-${suffix}.jpg`,
          sortOrder: 1,
        },
      }),
    ])
    const [albumCoverA, albumCoverB] = await Promise.all([
      prisma.albumCover.create({
        data: {
          albumDocId: album.docId,
          storageKey: `test-admin-batch/album-cover-a-${suffix}.jpg`,
          publicUrl: `/uploads/test-admin-batch-album-cover-a-${suffix}.jpg`,
          isDefault: true,
          sortOrder: 0,
        },
      }),
      prisma.albumCover.create({
        data: {
          albumDocId: album.docId,
          storageKey: `test-admin-batch/album-cover-b-${suffix}.jpg`,
          publicUrl: `/uploads/test-admin-batch-album-cover-b-${suffix}.jpg`,
          sortOrder: 1,
        },
      }),
    ])
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const songResponse = await agent
      .delete(`/api/music/${song.docId}/covers`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ coverIds: [songCoverA.id] })
    const albumResponse = await agent
      .delete(`/api/albums/${album.docId}/covers`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ coverIds: [albumCoverA.id] })

    expect(songResponse.status).toBe(200)
    expect(albumResponse.status).toBe(200)
    await expect(prisma.songCover.findUnique({ where: { id: songCoverA.id } })).resolves.toBeNull()
    await expect(
      prisma.albumCover.findUnique({ where: { id: albumCoverA.id } })
    ).resolves.toBeNull()
    await expect(
      prisma.songCover.findUnique({ where: { id: songCoverB.id } })
    ).resolves.toMatchObject({
      isDefault: true,
    })
    await expect(
      prisma.albumCover.findUnique({ where: { id: albumCoverB.id } })
    ).resolves.toMatchObject({
      isDefault: true,
    })

    const finalAlbumResponse = await agent
      .delete(`/api/albums/${album.docId}/covers`)
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ coverIds: [albumCoverB.id] })

    expect(finalAlbumResponse.status).toBe(200)
    await expect(prisma.album.findUnique({ where: { docId: album.docId } })).resolves.toMatchObject(
      {
        coverId: null,
      }
    )
  })

  it('batch releases edit locks', async () => {
    const locks = await Promise.all(
      [0, 1].map((index) =>
        prisma.editLock.create({
          data: {
            collection: 'wiki',
            recordId: `test-admin-batch-lock-${index}-${Date.now()}`,
            userId: adminUser.user.uid,
            username: adminUser.user.displayName,
            expiresAt: new Date(Date.now() + 60_000),
          },
        })
      )
    )
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const response = await agent
      .delete('/api/admin/locks')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({ lockIds: locks.map((lock) => lock.id) })

    expect(response.status).toBe(200)
    expect(response.body.deleted).toBe(2)
    expect(
      await prisma.editLock.count({ where: { id: { in: locks.map((lock) => lock.id) } } })
    ).toBe(0)
  })

  it('batch updates music display info', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const album = await prisma.album.create({
      data: {
        title: 'Batch Display Album',
        artist: 'Batch Artist',
      },
    })
    const songs = await Promise.all(
      [0, 1].map((index) =>
        prisma.musicTrack.create({
          data: {
            title: `Batch Display Song ${index}`,
            artists: ['Batch Artist'],
          },
        })
      )
    )
    await Promise.all(
      songs.map((song, index) =>
        prisma.songAlbumRelation.create({
          data: {
            songDocId: song.docId,
            albumDocId: album.docId,
            trackOrder: index,
            isDisplay: false,
          },
        })
      )
    )
    const { agent, xsrfToken } = await createAuthenticatedAgent(
      adminUser.user.email,
      adminUser.plainPassword
    )

    const manualResponse = await agent
      .patch('/api/admin/music/batch-display')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        songDocIds: songs.map((song) => song.docId),
        displayAlbumMode: 'manual',
        manualAlbumName: '手动展示专辑',
      })
    const linkedResponse = await agent
      .patch('/api/admin/music/batch-display')
      .set('X-XSRF-TOKEN', xsrfToken)
      .send({
        songDocIds: songs.map((song) => song.docId),
        displayAlbumMode: 'linked',
        displayAlbumDocId: album.docId,
      })

    expect(manualResponse.status).toBe(200)
    expect(linkedResponse.status).toBe(200)
    const updatedSongs = await prisma.musicTrack.findMany({
      where: { docId: { in: songs.map((song) => song.docId) } },
      orderBy: { title: 'asc' },
    })
    expect(updatedSongs.every((song) => song.displayAlbumMode === 'linked')).toBe(true)
    expect(updatedSongs.every((song) => song.manualAlbumName === null)).toBe(true)
    const displayRelations = await prisma.songAlbumRelation.findMany({
      where: { songDocId: { in: songs.map((song) => song.docId) }, albumDocId: album.docId },
    })
    expect(displayRelations.every((relation) => relation.isDisplay)).toBe(true)
  })
})
