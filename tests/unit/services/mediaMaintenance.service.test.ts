import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockSyncAssetToImageMap = vi.hoisted(() => vi.fn())
const mockCollectMediaReferences = vi.hoisted(() => vi.fn())
const mockCreateAssetClaimForImageMap = vi.hoisted(() => vi.fn())
const mockScanMediaHealth = vi.hoisted(() => vi.fn())
const mockLocalizeImageUrlAsMediaAsset = vi.hoisted(() => vi.fn())
const mockEnqueueMusicCoverThumbnail = vi.hoisted(() => vi.fn())
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
  resolveUploadPathByStorageKey: mockResolveUploadPathByStorageKey,
  extractStorageKeyFromUploadUrl: (value: string) => value.replace(/^\/uploads\//, ''),
}))
vi.mock('../../../src/server/services/mediaAssetService', () => ({
  collectMediaReferences: mockCollectMediaReferences,
  createAssetClaimForImageMap: mockCreateAssetClaimForImageMap,
  syncAssetToImageMap: mockSyncAssetToImageMap,
  lockImageContent: vi.fn(),
  lockImageMap: vi.fn(),
  releaseMediaAsset: vi.fn(),
  ensureImageMapForLocalFile: vi.fn(),
}))
vi.mock('../../../src/server/services/mediaHealth.service', () => ({
  scanMediaHealth: mockScanMediaHealth,
}))
vi.mock('../../../src/server/utils/remoteImageAsset', () => ({
  localizeImageUrlAsMediaAsset: mockLocalizeImageUrlAsMediaAsset,
}))
vi.mock('../../../src/server/services/variantGenerator', () => ({
  variantGenerator: {
    enqueue: mockEnqueue,
    hasTask: mockHasTask,
  },
}))
vi.mock('../../../src/server/utils/music', () => ({
  enqueueMusicCoverThumbnail: mockEnqueueMusicCoverThumbnail,
}))

import {
  deleteOrphanMediaBatch,
  localizeMediaAssetsBatch,
  previewOrphanMediaBatch,
  reconcileMediaAssetsBatch,
  repairMissingThumbnailsBatch,
  scanMediaMaintenance,
} from '../../../src/server/services/mediaMaintenance.service'

const tempDirs: string[] = []

function createClient() {
  const client = {
    mediaAsset: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    imageMap: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    galleryImage: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    event: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    eventPoster: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      findFirst: vi.fn().mockResolvedValue({ uid: 'admin' }),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    songCover: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    albumCover: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    wikiPage: { findMany: vi.fn(), updateMany: vi.fn() },
    wikiRevision: { findMany: vi.fn(), updateMany: vi.fn() },
    post: { findMany: vi.fn(), updateMany: vi.fn() },
    postComment: { findMany: vi.fn(), updateMany: vi.fn() },
    wikiPullRequestComment: { findMany: vi.fn(), updateMany: vi.fn() },
    wikiPullRequest: { findMany: vi.fn(), updateMany: vi.fn() },
    announcement: { findMany: vi.fn(), updateMany: vi.fn() },
    uploadSession: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    $transaction: vi.fn(),
  }
  client.$transaction.mockImplementation(async (callback: (tx: typeof client) => unknown) =>
    callback(client)
  )
  return client
}

async function createSourceFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-maintenance-'))
  tempDirs.push(dir)
  const filePath = path.join(dir, 'source.jpg')
  await fs.writeFile(filePath, 'source')
  return filePath
}

// 扫描按 mtimeMs > cutoff 排除新文件，而 stat.mtimeMs 是亚毫秒浮点、Date.now() 只到毫秒，
// 刚写完的文件会随机被判成“还不够老”而从结果里消失，所以孤儿文件要显式改老
async function ageFile(filePath: string, mtime = new Date(0)) {
  await fs.utimes(filePath, mtime, mtime)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockHasTask.mockReturnValue(false)
  mockEnqueue.mockResolvedValue(true)
  mockScanMediaHealth.mockResolvedValue({
    missingLocalFiles: [],
    unusedMediaRecords: [],
    sharedImageMaps: [],
    retiredMedia: [],
    summary: {
      missingLocalFiles: 0,
      unusedMediaAssets: 0,
      unusedImageMaps: 0,
    },
  })
  mockCollectMediaReferences.mockResolvedValue({
    storageKeys: new Map(),
    mediaAssetIds: new Map(),
    imageMapIds: new Map(),
    urls: new Map(),
  })
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('mediaMaintenance.service', () => {
  it('keeps dry-run read-only and reports a stable asset cursor', async () => {
    const sourcePath = await createSourceFile()
    mockResolveUploadPathByUrl.mockReturnValue(sourcePath)
    const client = createClient()
    const rows = [
      { id: 'asset-a', publicUrl: '/uploads/a.jpg', storageKey: 'a.jpg' },
      { id: 'asset-b', publicUrl: '/uploads/b.jpg', storageKey: 'b.jpg' },
      { id: 'asset-c', publicUrl: '/uploads/c.jpg', storageKey: 'c.jpg' },
    ]
    client.mediaAsset.findMany.mockImplementation(
      async (args: { where?: { id?: { gt?: string } } }) =>
        rows.filter((row) => !args.where?.id?.gt || row.id > args.where.id.gt).slice(0, 3)
    )

    const first = await reconcileMediaAssetsBatch(
      { mode: 'dry-run', batchSize: 2 },
      client as never
    )

    expect(first).toMatchObject({ scanned: 2, processed: 2, nextCursor: 'asset-b', hasMore: true })
    expect(mockSyncAssetToImageMap).not.toHaveBeenCalled()
    expect(client.$transaction).not.toHaveBeenCalled()

    await reconcileMediaAssetsBatch(
      { mode: 'dry-run', batchSize: 2, cursor: first.nextCursor || undefined },
      client as never
    )
    expect(client.mediaAsset.findMany.mock.calls[1][0].where.id).toEqual({ gt: 'asset-b' })
  })

  it('continues after one failed legacy binding', async () => {
    const client = createClient()
    client.mediaAsset.findMany.mockResolvedValue([
      { id: 'asset-a', publicUrl: null, storageKey: null },
      { id: 'asset-b', publicUrl: null, storageKey: null },
    ])
    mockSyncAssetToImageMap
      .mockRejectedValueOnce(new Error('md5 failed'))
      .mockResolvedValueOnce('map-b')
    client.imageMap.findUnique.mockResolvedValue({ localUrl: '/uploads/canonical.jpg' })
    const result = await reconcileMediaAssetsBatch({ mode: 'apply', batchSize: 2 }, client as never)

    expect(result).toMatchObject({
      scanned: 2,
      processed: 0,
      skipped: 1,
      failed: 1,
      skippedMissingSource: 1,
    })
    expect(result.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'asset-a', status: 'failed' }),
        expect.objectContaining({ id: 'asset-b', status: 'skipped' }),
      ])
    )
  })

  it('resets completed maps with missing thumbnails before enqueueing', async () => {
    const sourcePath = await createSourceFile()
    mockResolveUploadPathByStorageKey.mockReturnValue(sourcePath)
    const client = createClient()
    const imageMap = {
      id: 'map-a',
      localUrl: '/uploads/a.jpg',
      thumbnailUrl: null,
      variantStatus: 'completed' as const,
      deletedAt: null,
    }
    client.imageMap.findMany.mockResolvedValue([imageMap])
    client.imageMap.findUnique.mockResolvedValue(imageMap)
    client.imageMap.updateMany.mockResolvedValue({ count: 1 })

    const result = await repairMissingThumbnailsBatch(
      { mode: 'apply', batchSize: 100 },
      client as never
    )

    expect(result).toMatchObject({ queued: 1, alreadyQueued: 0, skippedMissingSource: 0 })
    expect(client.imageMap.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          variantStatus: { in: ['pending', 'failed', 'completed'] },
        }),
        data: { variantStatus: 'processing' },
      })
    )
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: 'imageMap', targetId: 'map-a' })
    )
  })

  it('replaces legacy URLs in markdown during reconcile apply', async () => {
    const sourcePath = await createSourceFile()
    mockResolveUploadPathByStorageKey.mockReturnValue(sourcePath)
    const client = createClient()
    client.mediaAsset.findMany.mockResolvedValue([
      {
        id: 'asset-a',
        imageMapId: 'map-a',
        publicUrl: '/uploads/legacy.jpg',
        storageKey: 'legacy.jpg',
      },
    ])
    client.imageMap.findUnique.mockResolvedValue({ localUrl: '/uploads/canonical.jpg' })
    client.mediaAsset.updateMany.mockResolvedValue({ count: 1 })
    client.wikiPage.findMany.mockResolvedValue([
      { id: 'page-a', content: '![legacy](/uploads/legacy.jpg)' },
    ])
    for (const delegate of [
      client.wikiRevision,
      client.post,
      client.event,
      client.postComment,
      client.wikiPullRequestComment,
      client.wikiPullRequest,
      client.announcement,
    ]) {
      delegate.findMany.mockResolvedValue([])
    }

    const result = await reconcileMediaAssetsBatch(
      { mode: 'apply', batchSize: 100 },
      client as never
    )

    expect(result.details[0]).toMatchObject({ status: 'processed' })
    expect(result.processed).toBe(1)
    expect(client.wikiPage.updateMany).toHaveBeenCalledWith({
      where: { id: 'page-a', content: '![legacy](/uploads/legacy.jpg)' },
      data: { content: '![legacy](/uploads/canonical.jpg)' },
    })
  })
  it('updates old URLs for null or matching asset bindings only', async () => {
    const sourcePath = await createSourceFile()
    mockResolveUploadPathByStorageKey.mockReturnValue(sourcePath)
    const client = createClient()
    client.mediaAsset.findMany.mockResolvedValue([
      {
        id: 'asset-a',
        imageMapId: 'map-a',
        publicUrl: '/uploads/legacy.jpg',
        storageKey: 'legacy.jpg',
      },
    ])
    client.imageMap.findUnique.mockResolvedValue({
      id: 'map-a',
      md5: 'md5-a',
      localUrl: '/uploads/canonical.jpg',
      thumbnailUrl: '/uploads/thumb.webp',
      variantStatus: 'completed',
      deletedAt: null,
    })
    client.galleryImage.findMany.mockResolvedValue([
      { id: 'same-asset', assetId: 'asset-a' },
      { id: 'different-asset', assetId: 'asset-other' },
      { id: 'unbound', assetId: null },
    ])
    client.mediaAsset.updateMany.mockResolvedValue({ count: 1 })
    for (const delegate of [
      client.wikiPage,
      client.wikiRevision,
      client.post,
      client.event,
      client.postComment,
      client.wikiPullRequestComment,
      client.wikiPullRequest,
      client.announcement,
    ]) {
      delegate.findMany.mockResolvedValue([])
    }

    const result = await reconcileMediaAssetsBatch(
      { mode: 'apply', batchSize: 100 },
      client as never
    )

    expect(result.conflicts).toBe(1)
    expect(client.galleryImage.updateMany).toHaveBeenCalledTimes(2)
    expect(client.galleryImage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'same-asset',
          url: '/uploads/legacy.jpg',
          OR: [{ assetId: null }, { assetId: 'asset-a' }],
        }),
      })
    )
    expect(client.galleryImage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'unbound',
          url: '/uploads/legacy.jpg',
          OR: [{ assetId: null }, { assetId: 'asset-a' }],
        }),
      })
    )
  })

  it('does not overwrite an existing thumbnail or enqueue processing maps', async () => {
    const client = createClient()
    const maps = [
      {
        id: 'map-complete',
        localUrl: '/uploads/a.jpg',
        thumbnailUrl: '/uploads/a.webp',
        variantStatus: 'completed' as const,
      },
      {
        id: 'map-processing',
        localUrl: '/uploads/b.jpg',
        thumbnailUrl: null,
        variantStatus: 'processing' as const,
      },
    ]
    client.imageMap.findMany.mockResolvedValue(maps)
    client.imageMap.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      const row = maps.find((item) => item.id === where.id)
      return row ? { ...row, md5: `md5-${row.id}`, deletedAt: null } : null
    })

    const result = await repairMissingThumbnailsBatch(
      { mode: 'apply', batchSize: 100 },
      client as never
    )

    expect(result).toMatchObject({ queued: 0, alreadyQueued: 2, skippedMissingSource: 0 })
    expect(client.imageMap.updateMany).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('skips missing thumbnail sources without changing status', async () => {
    mockResolveUploadPathByUrl.mockReturnValue('/tmp/does-not-exist.jpg')
    const client = createClient()
    const missingMap = {
      id: 'map-missing',
      localUrl: '/uploads/missing.jpg',
      thumbnailUrl: null,
      variantStatus: 'completed' as const,
    }
    client.imageMap.findMany.mockResolvedValue([missingMap])
    client.imageMap.findUnique.mockResolvedValue({
      ...missingMap,
      md5: 'md5-map-missing',
      deletedAt: null,
    })

    const result = await repairMissingThumbnailsBatch(
      { mode: 'apply', batchSize: 100 },
      client as never
    )

    expect(result).toMatchObject({ queued: 0, skippedMissingSource: 1 })
    expect(client.imageMap.updateMany).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('keeps localize dry-run free of downloads and applies conditional updates', async () => {
    const client = createClient()
    client.galleryImage.findMany.mockResolvedValue([
      { id: 'gallery-a', url: 'https://example.com/a.jpg' },
    ])
    client.songCover.findMany.mockResolvedValue([])
    client.albumCover.findMany.mockResolvedValue([])

    const preview = await localizeMediaAssetsBatch(
      { mode: 'dry-run', batchSize: 100 },
      client as never
    )
    expect(preview.processed).toBe(1)
    expect(mockLocalizeImageUrlAsMediaAsset).not.toHaveBeenCalled()
    expect(client.$transaction).not.toHaveBeenCalled()
  })

  it('continues localization after a remote download fails', async () => {
    const client = createClient()
    client.galleryImage.findMany.mockResolvedValue([
      { id: 'gallery-a', url: 'https://example.com/a.jpg' },
      { id: 'gallery-b', url: 'https://example.com/b.jpg' },
    ])
    client.songCover.findMany.mockResolvedValue([])
    client.albumCover.findMany.mockResolvedValue([])
    client.galleryImage.updateMany.mockResolvedValue({ count: 1 })
    mockLocalizeImageUrlAsMediaAsset
      .mockRejectedValueOnce(new Error('remote unavailable'))
      .mockResolvedValueOnce({
        assetId: 'asset-b',
        publicUrl: '/uploads/b.jpg',
        storageKey: 'b.jpg',
      })

    const result = await localizeMediaAssetsBatch(
      { mode: 'apply', batchSize: 100, operatorUid: 'admin' },
      client as never
    )

    expect(result).toMatchObject({ processed: 1, failed: 1, skipped: 0 })
    expect(mockLocalizeImageUrlAsMediaAsset).toHaveBeenCalledTimes(2)
    expect(client.galleryImage.updateMany).toHaveBeenCalledTimes(1)
  })

  it('queues image map and music thumbnails after apply localization', async () => {
    const client = createClient()
    client.user.findFirst.mockResolvedValue({ uid: 'admin' })
    client.galleryImage.findMany.mockResolvedValue([
      { id: 'gallery-a', url: 'https://example.com/a.jpg' },
    ])
    client.songCover.findMany.mockResolvedValue([
      { id: 'song-a', publicUrl: 'https://example.com/s.jpg' },
    ])
    client.albumCover.findMany.mockResolvedValue([
      { id: 'album-a', publicUrl: 'https://example.com/al.jpg' },
    ])
    client.galleryImage.updateMany.mockResolvedValue({ count: 1 })
    client.songCover.updateMany.mockResolvedValue({ count: 1 })
    client.albumCover.updateMany.mockResolvedValue({ count: 1 })
    mockLocalizeImageUrlAsMediaAsset
      .mockResolvedValueOnce({
        assetId: 'asset-g',
        imageMapId: 'map-g',
        storageKey: 'g.jpg',
        publicUrl: '/uploads/g.jpg',
      })
      .mockResolvedValueOnce({
        assetId: 'asset-s',
        imageMapId: 'map-s',
        storageKey: 's.jpg',
        publicUrl: '/uploads/s.jpg',
      })
      .mockResolvedValueOnce({
        assetId: 'asset-a',
        imageMapId: 'map-a',
        storageKey: 'a.jpg',
        publicUrl: '/uploads/a.jpg',
      })
    client.imageMap.findUnique.mockResolvedValue({
      id: 'map-g',
      md5: 'md5-g',
      localUrl: '/uploads/g.jpg',
      thumbnailUrl: null,
      variantStatus: 'completed',
      deletedAt: null,
    })
    const sourcePath = await createSourceFile()
    mockResolveUploadPathByUrl.mockReturnValue(sourcePath)
    mockResolveUploadPathByStorageKey.mockReturnValue(sourcePath)
    mockEnqueueMusicCoverThumbnail.mockResolvedValue(true)

    const first = await localizeMediaAssetsBatch(
      { mode: 'apply', type: 'all', batchSize: 100, operatorUid: 'admin' },
      client as never
    )
    const second = await localizeMediaAssetsBatch(
      {
        mode: 'apply',
        type: 'all',
        batchSize: 100,
        operatorUid: 'admin',
        cursor: first.nextCursor || undefined,
      },
      client as never
    )
    const third = await localizeMediaAssetsBatch(
      {
        mode: 'apply',
        type: 'all',
        batchSize: 100,
        operatorUid: 'admin',
        cursor: second.nextCursor || undefined,
      },
      client as never
    )
    expect(first.processed + second.processed + third.processed).toBe(3)
    expect(first.queued).toBeGreaterThanOrEqual(1)
    expect(mockEnqueueMusicCoverThumbnail).toHaveBeenCalledWith('songCover', 'song-a', 's.jpg')
    expect(mockEnqueueMusicCoverThumbnail).toHaveBeenCalledWith('albumCover', 'album-a', 'a.jpg')
  })

  it('counts completed and processing ImageMaps without thumbnails', async () => {
    const client = createClient()
    client.imageMap.count.mockResolvedValue(2)
    client.imageMap.findMany.mockResolvedValue([
      { id: 'map-completed', variantStatus: 'completed' },
      { id: 'map-processing', variantStatus: 'processing' },
    ])

    const result = await scanMediaMaintenance({ mode: 'strict', limit: 100 }, client as never)

    expect(result.counts.missingThumbnails).toBe(2)
    expect(result.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'map-completed', reason: '缺失缩略图' }),
        expect.objectContaining({ id: 'map-processing', reason: '已在处理' }),
      ])
    )
  })
  it('does not rescan Markdown tables on later reconciliation cursor pages', async () => {
    const sourcePath = await createSourceFile()
    mockResolveUploadPathByStorageKey.mockReturnValue(sourcePath)
    mockResolveUploadPathByUrl.mockReturnValue(sourcePath)
    mockEnqueue.mockResolvedValue(true)
    const client = createClient()
    const rowA = {
      id: 'asset-markdown-a',
      ownerUid: 'admin',
      imageMapId: 'map-markdown-a',
      publicUrl: '/uploads/legacy-a.jpg',
      storageKey: 'legacy-a.jpg',
    }
    const rowB = {
      id: 'asset-markdown-b',
      ownerUid: 'admin',
      imageMapId: 'map-markdown-b',
      publicUrl: '/uploads/legacy-b.jpg',
      storageKey: 'legacy-b.jpg',
    }
    client.mediaAsset.findMany.mockImplementation(
      async (args: { where?: { id?: { gt?: string } } }) =>
        args.where?.id?.gt ? [rowB] : [rowA, rowB]
    )
    client.imageMap.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      md5: where.id,
      localUrl: `/uploads/${where.id}.jpg`,
      thumbnailUrl: '/uploads/thumb.webp',
      variantStatus: 'completed',
      deletedAt: null,
    }))
    for (const delegate of [
      client.wikiPage,
      client.wikiRevision,
      client.post,
      client.event,
      client.postComment,
      client.wikiPullRequestComment,
      client.wikiPullRequest,
      client.announcement,
    ]) {
      delegate.findMany.mockResolvedValue([])
    }
    const first = await reconcileMediaAssetsBatch({ mode: 'apply', batchSize: 1 }, client as never)
    await reconcileMediaAssetsBatch(
      { mode: 'apply', batchSize: 1, cursor: first.nextCursor || undefined },
      client as never
    )
    expect(client.wikiPage.findMany).toHaveBeenCalledTimes(1)
  })
  it('skips a file referenced after orphan preview and rejects dangerous keys', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-orphan-'))
    tempDirs.push(dir)
    const filePath = path.join(dir, 'orphan.jpg')
    await fs.writeFile(filePath, 'orphan')
    await ageFile(filePath)
    const client = createClient()
    client.mediaAsset.findMany.mockResolvedValue([])
    client.imageMap.findMany.mockResolvedValue([])

    const preview = await previewOrphanMediaBatch(
      { batchSize: 100, olderThanHours: 0 },
      client as never,
      dir
    )
    mockCollectMediaReferences.mockResolvedValue({
      storageKeys: new Map([
        ['orphan.jpg', [{ source: 'GalleryImage', id: 'gallery-a', field: 'url' }]],
      ]),
      mediaAssetIds: new Map(),
      imageMapIds: new Map(),
      urls: new Map(),
    })
    const result = await deleteOrphanMediaBatch(
      { previewToken: preview.previewToken, storageKeys: preview.storageKeys },
      client as never,
      dir
    )

    expect(result.skipped).toBe(1)
    await expect(
      deleteOrphanMediaBatch(
        { previewToken: preview.previewToken, storageKeys: ['../orphan.jpg'] },
        client as never,
        dir
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('continues orphan deletion after one file fails', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-orphan-failure-'))
    tempDirs.push(dir)
    const existingPath = path.join(dir, 'existing.jpg')
    await fs.writeFile(existingPath, 'existing')
    await ageFile(existingPath)
    const missingPath = path.join(dir, 'missing.jpg')
    await fs.writeFile(missingPath, 'missing')
    await ageFile(missingPath)
    mockResolveUploadPathByStorageKey.mockImplementation((key: string, base: string) =>
      path.join(base, key)
    )
    const client = createClient()
    client.mediaAsset.findMany.mockResolvedValue([])
    client.imageMap.findMany.mockResolvedValue([])
    mockCollectMediaReferences.mockResolvedValue({
      storageKeys: new Map(),
      mediaAssetIds: new Map(),
      imageMapIds: new Map(),
      urls: new Map(),
    })

    const preview = await previewOrphanMediaBatch(
      { batchSize: 100, olderThanHours: 0 },
      client as never,
      dir
    )
    const removeSpy = vi.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('permission denied'))
    const result = await deleteOrphanMediaBatch(
      { previewToken: preview.previewToken, storageKeys: preview.storageKeys },
      client as never,
      dir
    )

    expect(result).toMatchObject({ processed: 1, failed: 1, skipped: 0 })
    removeSpy.mockRestore()
  })
  it('supports preview and delete of a full 100-file batch with a bounded token', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-orphan-100-'))
    tempDirs.push(dir)
    await Promise.all(
      Array.from({ length: 100 }, async (_, index) => {
        const absolutePath = path.join(dir, `orphan-${String(index).padStart(3, '0')}.jpg`)
        await fs.writeFile(absolutePath, `file-${index}`)
        await ageFile(absolutePath)
      })
    )
    mockResolveUploadPathByStorageKey.mockImplementation((key: string, base: string) =>
      path.join(base, key)
    )
    mockCollectMediaReferences.mockResolvedValue({
      storageKeys: new Map(),
      mediaAssetIds: new Map(),
      imageMapIds: new Map(),
      urls: new Map(),
    })
    const client = createClient()
    client.mediaAsset.findMany.mockResolvedValue([])
    client.imageMap.findMany.mockResolvedValue([])

    const preview = await previewOrphanMediaBatch(
      { batchSize: 100, olderThanHours: 0 },
      client as never,
      dir,
      'admin'
    )
    expect(preview.storageKeys).toHaveLength(100)
    expect(preview.entries).toHaveLength(100)
    expect(preview.previewToken.length).toBeLessThanOrEqual(32768)

    const result = await deleteOrphanMediaBatch(
      { previewToken: preview.previewToken, storageKeys: preview.storageKeys },
      client as never,
      dir,
      'admin'
    )
    expect(result).toMatchObject({ processed: 100, skipped: 0, failed: 0 })
    await expect(fs.readdir(dir)).resolves.toEqual([])
  })
  it('skips orphan deletion when the file fingerprint changes', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-orphan-fingerprint-'))
    tempDirs.push(dir)
    const filePath = path.join(dir, 'fingerprint.jpg')
    await fs.writeFile(filePath, 'before')
    await ageFile(filePath)
    mockResolveUploadPathByStorageKey.mockImplementation((key: string, base: string) =>
      path.join(base, key)
    )
    mockCollectMediaReferences.mockResolvedValue({
      storageKeys: new Map(),
      mediaAssetIds: new Map(),
      imageMapIds: new Map(),
      urls: new Map(),
    })
    const client = createClient()
    client.mediaAsset.findMany.mockResolvedValue([])
    client.imageMap.findMany.mockResolvedValue([])
    const preview = await previewOrphanMediaBatch(
      { batchSize: 100, olderThanHours: 0 },
      client as never,
      dir,
      'admin'
    )
    // 同时改变字节数和 mtime，指纹比对不依赖文件系统的时间戳粒度
    await fs.writeFile(filePath, 'changed')
    await ageFile(filePath, new Date(1000))
    const result = await deleteOrphanMediaBatch(
      { previewToken: preview.previewToken, storageKeys: preview.storageKeys },
      client as never,
      dir,
      'admin'
    )
    expect(result).toMatchObject({
      processed: 0,
      skipped: 1,
      failed: 0,
      details: [
        { id: 'fingerprint.jpg', status: 'skipped', reason: '文件已变化、不存在或未达到年龄限制' },
      ],
    })
    await expect(fs.readFile(filePath, 'utf8')).resolves.toBe('changed')
  })
})
