import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  collectReferencedStorageKeys,
  extractStorageKeyFromUploadUrl,
  generateMediaRestoreReport,
  isMediaRestoreReportFilename,
  normalizeStorageKey,
  scanUploadFiles,
} from '../../src/server/services/mediaRestoreReport.service'

function createPrismaMock(overrides: Record<string, unknown[]> = {}) {
  const findMany = (name: string) => vi.fn().mockResolvedValue(overrides[name] || [])
  return {
    mediaAsset: { findMany: findMany('mediaAsset') },
    imageMap: { findMany: findMany('imageMap') },
    user: { findMany: findMany('user') },
    galleryImage: { findMany: findMany('galleryImage') },
    songCover: { findMany: findMany('songCover') },
    albumCover: { findMany: findMany('albumCover') },
    wikiImageEmbedding: { findMany: findMany('wikiImageEmbedding') },
    postImageEmbedding: { findMany: findMany('postImageEmbedding') },
    wikiPage: { findMany: findMany('wikiPage') },
    wikiRevision: { findMany: findMany('wikiRevision') },
    post: { findMany: findMany('post') },
    postComment: { findMany: findMany('postComment') },
    wikiPullRequestComment: { findMany: findMany('wikiPullRequestComment') },
    wikiPullRequest: { findMany: findMany('wikiPullRequest') },
    announcement: { findMany: findMany('announcement') },
  }
}

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('media restore report service', () => {
  it('normalizes local upload urls and ignores remote non-upload urls', () => {
    expect(extractStorageKeyFromUploadUrl('https://example.com/uploads/avatars/a.jpg?x=1')).toBe(
      'avatars/a.jpg'
    )
    expect(normalizeStorageKey('/uploads/avatars/a%20b.jpg?size=small')).toBe('avatars/a b.jpg')
    expect(normalizeStorageKey('https://cdn.example.com/image.jpg')).toBeNull()
    expect(normalizeStorageKey('../secret.jpg')).toBeNull()
  })

  it('collects structured and markdown upload references with source metadata', async () => {
    const prisma = createPrismaMock({
      mediaAsset: [
        { id: 'asset1', storageKey: 'gallery/a.jpg', publicUrl: '/uploads/gallery/a.jpg' },
      ],
      user: [{ uid: 'user1', photoURL: 'https://example.com/uploads/avatars/u.jpg' }],
      wikiPage: [{ id: 'wiki1', content: '![x](/uploads/wiki/p.jpg)' }],
    })

    const references = await collectReferencedStorageKeys(prisma as never)

    expect(references.get('gallery/a.jpg')?.some((item) => item.source === 'MediaAsset')).toBe(true)
    expect(references.get('avatars/u.jpg')?.[0]).toMatchObject({ source: 'User', id: 'user1' })
    expect(references.get('wiki/p.jpg')?.[0]).toMatchObject({ source: 'WikiPage', id: 'wiki1' })
  })

  it('queries only active media records as valid references', async () => {
    const prisma = createPrismaMock()

    await collectReferencedStorageKeys(prisma as never)

    expect(prisma.mediaAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { not: 'deleted' } } })
    )
    expect(prisma.imageMap.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } })
    )
  })

  it('does not duplicate markdown upload references from the same field', async () => {
    const prisma = createPrismaMock({
      wikiPage: [{ id: 'wiki1', content: '![x](/uploads/wiki/p.jpg)' }],
    })

    const references = await collectReferencedStorageKeys(prisma as never)

    expect(references.get('wiki/p.jpg')).toHaveLength(1)
  })

  it('generates missing and orphan file lists for local uploads', async () => {
    const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-report-uploads-'))
    tempDirs.push(uploadDir)
    fs.mkdirSync(path.join(uploadDir, 'gallery'), { recursive: true })
    fs.writeFileSync(path.join(uploadDir, 'gallery', 'present.jpg'), 'present')
    fs.writeFileSync(path.join(uploadDir, 'gallery', 'orphan.jpg'), 'orphan')

    const prisma = createPrismaMock({
      mediaAsset: [
        {
          id: 'present',
          storageKey: 'gallery/present.jpg',
          publicUrl: '/uploads/gallery/present.jpg',
        },
        {
          id: 'missing',
          storageKey: 'gallery/missing.jpg',
          publicUrl: '/uploads/gallery/missing.jpg',
        },
      ],
    })

    const summary = await generateMediaRestoreReport(
      prisma as never,
      { type: 'existing', filename: 'backup_2026-06-28_10-00-00-000.zip' },
      { uploadDir, now: new Date('2026-06-28T10:05:01.000Z') }
    )

    expect(summary.filename).toBe('restore-media-report_2026-06-28_10-05-01-000.json')
    expect(summary.missingFiles).toBe(1)
    expect(summary.orphanFiles).toBe(1)
  })

  it('scans upload files and validates report filenames', async () => {
    const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-report-scan-'))
    tempDirs.push(uploadDir)
    fs.mkdirSync(path.join(uploadDir, 'variants'), { recursive: true })
    fs.mkdirSync(path.join(uploadDir, 'gallery'), { recursive: true })
    fs.writeFileSync(path.join(uploadDir, 'variants', 'thumb.webp'), 'thumb')
    fs.writeFileSync(path.join(uploadDir, 'gallery', 'image.jpg'), 'image')

    await expect(scanUploadFiles(uploadDir, { includeVariants: false })).resolves.toEqual([
      expect.objectContaining({ storageKey: 'gallery/image.jpg' }),
    ])
    await expect(scanUploadFiles(uploadDir)).resolves.toEqual([
      expect.objectContaining({ storageKey: 'gallery/image.jpg' }),
      expect.objectContaining({ storageKey: 'variants/thumb.webp' }),
    ])
    expect(isMediaRestoreReportFilename('restore-media-report_2026-06-28_10-05-01-000.json')).toBe(
      true
    )
    expect(
      isMediaRestoreReportFilename('../restore-media-report_2026-06-28_10-05-01-000.json')
    ).toBe(false)
  })
})
