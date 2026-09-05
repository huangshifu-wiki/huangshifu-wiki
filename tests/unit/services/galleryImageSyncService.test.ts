import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockEnqueue = vi.hoisted(() => vi.fn())
const mockHasTask = vi.hoisted(() => vi.fn())
const mockResolveUploadPathByUrl = vi.hoisted(() => vi.fn())
const mockResolveUploadPathByStorageKey = vi.hoisted(() => vi.fn())

vi.mock('../../../src/server/prisma', () => ({ prisma: {} }))
vi.mock('../../../src/server/utils/upload', () => ({
  resolveUploadPathByUrl: mockResolveUploadPathByUrl,
}))
vi.mock('../../../src/server/uploadPath', () => ({
  buildUploadPublicUrl: (value: string) => `/uploads/${value}`,
  extractStorageKeyFromUploadUrl: (value: string) => value.replace(/^\/uploads\//, ''),
  resolveUploadPathByStorageKey: mockResolveUploadPathByStorageKey,
}))
vi.mock('../../../src/server/services/mediaAssetService', () => ({
  lockImageContent: vi.fn(),
  lockImageMap: vi.fn(),
  syncAssetToImageMap: vi.fn(),
}))
vi.mock('../../../src/server/services/variantGenerator', () => ({
  variantGenerator: {
    enqueue: mockEnqueue,
    hasTask: mockHasTask,
  },
}))

import { enqueueMissingImageMapThumbnail } from '../../../src/server/services/galleryImageSyncService'
beforeEach(() => {
  vi.clearAllMocks()
})

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  )
})

type TestClient = {
  $transaction: ReturnType<typeof vi.fn>
  imageMap: {
    findUnique: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
  }
  mediaAsset: { findMany: ReturnType<typeof vi.fn> }
}

function createClient(imageMap: object, claims: object[]): TestClient {
  const client = {
    $transaction: vi.fn(),
    imageMap: {
      findUnique: vi.fn().mockResolvedValue(imageMap),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    mediaAsset: {
      findMany: vi.fn().mockResolvedValue(claims),
    },
  }
  client.$transaction.mockImplementation(async (callback: (tx: TestClient) => unknown) =>
    callback(client)
  )
  return client
}

describe('galleryImageSyncService thumbnail repair', () => {
  it('uses a readable claim storage key when the canonical source is missing', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gallery-sync-'))
    temporaryDirectories.push(directory)
    const fallbackPath = path.join(directory, 'fallback.jpg')
    await fs.writeFile(fallbackPath, 'source')

    mockHasTask.mockReturnValue(false)
    mockEnqueue.mockResolvedValue(true)
    mockResolveUploadPathByUrl.mockReturnValue(path.join(directory, 'missing.jpg'))
    mockResolveUploadPathByStorageKey.mockImplementation((key: string) =>
      key === 'fallback.jpg' ? fallbackPath : path.join(directory, key)
    )

    const client = createClient(
      {
        id: 'map-a',
        md5: 'md5-a',
        localUrl: '/uploads/missing.jpg',
        thumbnailUrl: null,
        variantStatus: 'completed',
        deletedAt: null,
      },
      [{ storageKey: 'fallback.jpg', publicUrl: null }]
    )

    const result = await enqueueMissingImageMapThumbnail('map-a', {
      client: client as never,
      uploadDir: directory,
      mode: 'apply',
    })

    expect(result).toMatchObject({ status: 'queued', sourcePath: fallbackPath })
    expect(mockEnqueue).toHaveBeenCalledWith({
      targetType: 'imageMap',
      targetId: 'map-a',
      localFilePath: fallbackPath,
      priority: 'low',
    })
    expect(client.imageMap.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'map-a',
        thumbnailUrl: null,
        variantStatus: { in: ['pending', 'failed', 'completed'] },
      }),
      data: { variantStatus: 'processing' },
    })
  })
  it('uses canonical source from the supplied upload directory without claims', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gallery-sync-custom-root-'))
    temporaryDirectories.push(directory)
    const sourcePath = path.join(directory, 'canonical.jpg')
    await fs.writeFile(sourcePath, 'source')
    mockHasTask.mockReturnValue(false)
    mockResolveUploadPathByStorageKey.mockImplementation((key: string, uploadRoot: string) =>
      path.join(uploadRoot, key)
    )
    mockResolveUploadPathByUrl.mockImplementation(() => {
      throw new Error('default upload directory must not be consulted')
    })
    mockEnqueue.mockResolvedValue(true)
    const client = createClient(
      {
        id: 'map-custom-root',
        md5: 'md5-custom-root',
        localUrl: '/uploads/canonical.jpg',
        thumbnailUrl: null,
        variantStatus: 'completed',
        deletedAt: null,
      },
      []
    )

    const result = await enqueueMissingImageMapThumbnail('map-custom-root', {
      client: client as never,
      uploadDir: directory,
      mode: 'apply',
    })
    expect(result).toMatchObject({ status: 'queued', sourcePath })
  })
  it('keeps dry-run free of state changes and queue operations', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gallery-sync-dry-run-'))
    temporaryDirectories.push(directory)
    const sourcePath = path.join(directory, 'source.jpg')
    await fs.writeFile(sourcePath, 'source')

    mockHasTask.mockReturnValue(false)
    mockResolveUploadPathByUrl.mockReturnValue(sourcePath)
    mockResolveUploadPathByStorageKey.mockReturnValue(sourcePath)
    const client = createClient(
      {
        id: 'map-b',
        md5: 'md5-b',
        localUrl: '/uploads/source.jpg',
        thumbnailUrl: null,
        variantStatus: 'completed',
        deletedAt: null,
      },
      []
    )

    const result = await enqueueMissingImageMapThumbnail('map-b', {
      client: client as never,
      uploadDir: directory,
      mode: 'dry-run',
    })

    expect(result.status).toBe('queued')
    expect(client.imageMap.updateMany).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })
  it('claims a target once when duplicate repairs arrive together', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gallery-sync-concurrent-'))
    temporaryDirectories.push(directory)
    const sourcePath = path.join(directory, 'source.jpg')
    await fs.writeFile(sourcePath, 'source')
    mockHasTask.mockReturnValue(false)
    mockResolveUploadPathByUrl.mockReturnValue(sourcePath)
    mockResolveUploadPathByStorageKey.mockReturnValue(sourcePath)
    mockEnqueue.mockResolvedValue(true)
    const client = createClient(
      {
        id: 'map-concurrent',
        md5: 'md5-concurrent',
        localUrl: '/uploads/source.jpg',
        thumbnailUrl: null,
        variantStatus: 'completed',
        deletedAt: null,
      },
      []
    )

    const results = await Promise.all([
      enqueueMissingImageMapThumbnail('map-concurrent', {
        client: client as never,
        uploadDir: directory,
      }),
      enqueueMissingImageMapThumbnail('map-concurrent', {
        client: client as never,
        uploadDir: directory,
      }),
    ])
    expect(results.map((result) => result.status)).toEqual(['queued', 'queued'])
    expect(client.imageMap.updateMany).toHaveBeenCalledTimes(1)
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
  })
})
