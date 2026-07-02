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
  },
}))

vi.mock('../../src/server/utils/config', () => ({
  prisma: mockPrisma,
  uploadsDir: tmpUploadsDir,
}))

describe('remote image asset localization', () => {
  const originalFetch = global.fetch

  beforeEach(async () => {
    vi.clearAllMocks()
    await fs.rm(tmpUploadsDir, { recursive: true, force: true })
    await fs.mkdir(tmpUploadsDir, { recursive: true })
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
})
