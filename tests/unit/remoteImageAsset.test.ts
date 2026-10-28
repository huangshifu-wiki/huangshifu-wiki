import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tmpUploadsDir = path.join(os.tmpdir(), `huangshifu-remote-image-${process.pid}`)

const mockPrisma = vi.hoisted(() => ({
  user: {
    findFirst: vi.fn(),
  },
  mediaAsset: {
    create: vi.fn(),
    findUnique: vi.fn(),
  },
  siteConfig: { findUnique: vi.fn() },
  imageMap: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
}))

vi.mock('../../src/server/utils/config', () => ({
  prisma: mockPrisma,
  uploadsDir: tmpUploadsDir,
}))
vi.mock('../../src/server/prisma', () => ({ prisma: mockPrisma }))

describe('remote image asset localization', () => {
  const originalFetch = global.fetch

  beforeEach(async () => {
    vi.clearAllMocks()
    await fs.rm(tmpUploadsDir, { recursive: true, force: true })
    await fs.mkdir(tmpUploadsDir, { recursive: true })
    mockPrisma.siteConfig.findUnique.mockResolvedValue(null)
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma))
    const imageMap = {
      id: 'map-1',
      md5: '0123456789abcdef0123456789abcdef',
      localUrl: '/uploads/music-covers/songs/cover.png',
      externalUrl: null,
      s3Url: null,
      s3Key: null,
      storageType: 'local',
      thumbnailUrl: null,
      blurhash: null,
      thumbhash: null,
      variantStatus: 'pending',
      cloudSyncStatus: 'pending',
      deletedAt: null,
      retiredAt: null,
    }
    mockPrisma.imageMap.findUnique.mockResolvedValueOnce(null).mockResolvedValue(imageMap)
    mockPrisma.imageMap.upsert.mockResolvedValue(imageMap)
    mockPrisma.imageMap.update.mockResolvedValue(imageMap)
    mockPrisma.mediaAsset.findUnique.mockResolvedValue({
      id: 'asset-1',
      imageMapId: 'map-1',
      storageKey: 'music-covers/songs/cover.png',
      publicUrl: '/uploads/music-covers/songs/cover.png',
      fileName: 'cover.png',
      mimeType: 'image/png',
      sizeBytes: 68,
      status: 'ready',
    })
    mockPrisma.user.findFirst.mockResolvedValue({ uid: 'user-1' })
    mockPrisma.mediaAsset.create.mockResolvedValue({
      id: 'asset-1',
      storageKey: 'music-covers/songs/cover.png',
      publicUrl: '/uploads/music-covers/songs/cover.png',
      fileName: 'cover.png',
      mimeType: 'image/png',
      sizeBytes: 68,
    })
  })

  afterEach(async () => {
    global.fetch = originalFetch
    await fs.rm(tmpUploadsDir, { recursive: true, force: true })
  })

  it('only advertises image MIME types accepted by upload validation', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lp9k3wAAAABJRU5ErkJggg==',
      'base64'
    )
    const fetchMock = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      const accept = new Headers(init?.headers).get('accept') || ''
      expect(accept).toContain('image/jpeg')
      expect(accept).toContain('image/png')
      expect(accept).toContain('image/webp')
      expect(accept).toContain('image/gif')
      expect(accept).toContain('image/bmp')
      expect(accept).not.toContain('image/avif')
      expect(accept).not.toContain('image/svg+xml')
      return new Response(png, {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': String(png.length),
        },
      })
    })
    global.fetch = fetchMock as typeof fetch

    const { localizeImageUrlAsMediaAsset } = await import('../../src/server/utils/remoteImageAsset')

    await localizeImageUrlAsMediaAsset('https://example.com/cover.png', {
      namespace: 'music-covers/songs',
    })

    expect(fetchMock).toHaveBeenCalled()
  })
  it('restores a missing canonical local file before removing the temporary upload', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lp9k3wAAAABJRU5ErkJggg==',
      'base64'
    )
    const canonicalUrl = '/uploads/recovered/canonical.png'
    const imageMap = {
      id: 'map-1',
      md5: '0123456789abcdef0123456789abcdef',
      localUrl: canonicalUrl,
      externalUrl: null,
      s3Url: null,
      s3Key: null,
      storageType: 'local',
      thumbnailUrl: null,
      blurhash: null,
      thumbhash: null,
      variantStatus: 'pending',
      cloudSyncStatus: 'pending',
      deletedAt: null,
      retiredAt: null,
    }
    const asset = {
      id: 'asset-1',
      imageMapId: 'map-1',
      storageKey: 'recovered/canonical.png',
      publicUrl: canonicalUrl,
      fileName: 'canonical.png',
      mimeType: 'image/png',
      sizeBytes: png.length,
      status: 'ready',
    }
    mockPrisma.imageMap.findUnique.mockReset().mockResolvedValue(imageMap)
    mockPrisma.imageMap.upsert.mockResolvedValue(imageMap)
    mockPrisma.mediaAsset.findUnique.mockResolvedValue(asset)
    mockPrisma.mediaAsset.create.mockResolvedValue(asset)
    global.fetch = vi.fn(
      async () => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })
    ) as typeof fetch

    await (
      await import('../../src/server/utils/remoteImageAsset')
    ).localizeImageUrlAsMediaAsset('https://example.com/canonical.png', {
      namespace: 'recovery',
      fallbackName: 'canonical.png',
    })

    const canonicalPath = path.join(tmpUploadsDir, 'recovered', 'canonical.png')
    const temporaryPath = path.join(tmpUploadsDir, 'recovery', 'canonical.png')
    await expect(fs.readFile(canonicalPath)).resolves.toEqual(png)
    await expect(fs.access(temporaryPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
