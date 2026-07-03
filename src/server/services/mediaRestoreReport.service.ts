import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import type { PrismaClient } from '@prisma/client'
import {
  buildUploadPublicUrl,
  extractStorageKeyFromUploadUrl as extractUploadStorageKeyFromUrl,
  resolveUploadPathByStorageKey,
} from '../uploadPath'

const UPLOAD_URL_PATTERN = /\/uploads\/[^\s"'`)<>\\]+/g
const REPORT_FILENAME_PATTERN =
  /^restore-media-report_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d{3})?\.json$/
const MEDIA_RESTORE_REPORT_RETAIN_COUNT = Math.max(
  1,
  Number(process.env.MEDIA_RESTORE_REPORT_RETAIN_COUNT || process.env.BACKUP_RETAIN_COUNT || 20)
)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const defaultUploadsDir =
  process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', '..', 'uploads')
export const defaultBackupsDir =
  process.env.NODE_ENV === 'test'
    ? path.join(os.tmpdir(), 'huangshifu-wiki-test-backups')
    : path.join(__dirname, '..', '..', '..', 'backups')
export const MEDIA_RESTORE_REPORTS_DIR = path.join(defaultBackupsDir, 'media-reports')

export type MediaRestoreSource = {
  type: 'upload' | 'existing'
  filename?: string
}

export type MediaRestoreReportReference = {
  source: string
  id?: string
  field: string
  value: string
}

export type MediaRestoreReport = {
  generatedAt: string
  restoreSource: MediaRestoreSource
  uploadsDir: string
  summary: {
    referencedKeys: number
    scannedFiles: number
    missingFiles: number
    orphanFiles: number
    orphanSizeBytes: number
  }
  missingFiles: Array<{
    storageKey: string
    publicUrl: string
    expectedPath: string
    references: MediaRestoreReportReference[]
  }>
  orphanFiles: Array<{
    storageKey: string
    sizeBytes: number
    mtime: string
  }>
}

const REPORT_PREVIEW_LIMIT = 30

export type MediaRestoreReportSummary = MediaRestoreReport['summary'] & {
  filename: string
  generatedAt: string
  missingFilePreview: MediaRestoreReport['missingFiles']
  orphanFilePreview: MediaRestoreReport['orphanFiles']
  previewLimit: number
}

type UploadFile = {
  storageKey: string
  absolutePath: string
  sizeBytes: number
  mtime: Date
}

type ReferenceMap = Map<string, MediaRestoreReportReference[]>

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function extractStorageKeyFromUploadUrl(value: string) {
  try {
    return extractUploadStorageKeyFromUrl(value)
  } catch {
    return null
  }
}

export function normalizeStorageKey(value: string | null | undefined) {
  if (!value) return null

  const trimmed = value.trim()
  if (!trimmed) return null

  if (/^https?:\/\//i.test(trimmed) && !extractStorageKeyFromUploadUrl(trimmed)) {
    return null
  }

  const extractedKey = extractStorageKeyFromUploadUrl(trimmed)
  const rawKey = extractedKey || trimmed
  const withoutQuery = rawKey.split(/[?#]/, 1)[0]
  const decoded = extractedKey ? withoutQuery : safeDecodeURIComponent(withoutQuery)
  const normalized = decoded
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .join('/')

  if (
    !normalized ||
    normalized.includes('\0') ||
    normalized.startsWith('..') ||
    normalized.includes('/../')
  ) {
    return null
  }

  return normalized
}

function addReference(
  references: ReferenceMap,
  value: string | null | undefined,
  reference: Omit<MediaRestoreReportReference, 'value'>
) {
  const storageKey = normalizeStorageKey(value)
  if (!storageKey || !value) return

  const current = references.get(storageKey) || []
  current.push({ ...reference, value })
  references.set(storageKey, current)
}

function addUploadUrlsFromText(
  references: ReferenceMap,
  value: string | null | undefined,
  reference: Omit<MediaRestoreReportReference, 'value'>
) {
  if (!value) return

  for (const match of value.matchAll(UPLOAD_URL_PATTERN)) {
    addReference(references, match[0], reference)
  }
}

async function collectPagedText<T extends Record<string, string | null>>(
  load: (skip: number) => Promise<T[]>,
  references: ReferenceMap,
  pageSize: number,
  fields: Array<keyof T>,
  getReference: (row: T, field: keyof T) => Omit<MediaRestoreReportReference, 'value'>
) {
  for (let skip = 0; ; skip += pageSize) {
    const rows = await load(skip)
    for (const row of rows) {
      for (const field of fields) {
        addUploadUrlsFromText(references, row[field], getReference(row, field))
      }
    }

    if (rows.length < pageSize) break
  }
}

export async function collectReferencedStorageKeys(prisma: PrismaClient) {
  const references: ReferenceMap = new Map()

  const [
    mediaAssets,
    imageMaps,
    users,
    galleryImages,
    songCovers,
    albumCovers,
    wikiEmbeddings,
    postEmbeddings,
  ] = await Promise.all([
    prisma.mediaAsset.findMany({
      where: { status: { not: 'deleted' } },
      select: { id: true, storageKey: true, publicUrl: true },
    }),
    prisma.imageMap.findMany({
      where: { deletedAt: null },
      select: { id: true, localUrl: true, thumbnailUrl: true },
    }),
    prisma.user.findMany({
      where: { photoURL: { not: null } },
      select: { uid: true, photoURL: true },
    }),
    prisma.galleryImage.findMany({ select: { id: true, url: true } }),
    prisma.songCover.findMany({ select: { id: true, storageKey: true, publicUrl: true } }),
    prisma.albumCover.findMany({ select: { id: true, storageKey: true, publicUrl: true } }),
    prisma.wikiImageEmbedding.findMany({ select: { id: true, imageUrl: true } }),
    prisma.postImageEmbedding.findMany({ select: { id: true, imageUrl: true } }),
  ])

  for (const item of mediaAssets) {
    addReference(references, item.storageKey, {
      source: 'MediaAsset',
      id: item.id,
      field: 'storageKey',
    })
    addReference(references, item.publicUrl, {
      source: 'MediaAsset',
      id: item.id,
      field: 'publicUrl',
    })
  }

  for (const item of imageMaps) {
    addReference(references, item.localUrl, {
      source: 'ImageMap',
      id: item.id,
      field: 'localUrl',
    })
    addReference(references, item.thumbnailUrl, {
      source: 'ImageMap',
      id: item.id,
      field: 'thumbnailUrl',
    })
  }

  for (const item of users) {
    addReference(references, item.photoURL, {
      source: 'User',
      id: item.uid,
      field: 'photoURL',
    })
  }

  for (const item of galleryImages) {
    addReference(references, item.url, {
      source: 'GalleryImage',
      id: item.id,
      field: 'url',
    })
  }

  for (const item of songCovers) {
    addReference(references, item.storageKey, {
      source: 'SongCover',
      id: item.id,
      field: 'storageKey',
    })
    addReference(references, item.publicUrl, {
      source: 'SongCover',
      id: item.id,
      field: 'publicUrl',
    })
  }

  for (const item of albumCovers) {
    addReference(references, item.storageKey, {
      source: 'AlbumCover',
      id: item.id,
      field: 'storageKey',
    })
    addReference(references, item.publicUrl, {
      source: 'AlbumCover',
      id: item.id,
      field: 'publicUrl',
    })
  }

  for (const item of wikiEmbeddings) {
    addReference(references, item.imageUrl, {
      source: 'WikiImageEmbedding',
      id: item.id,
      field: 'imageUrl',
    })
  }

  for (const item of postEmbeddings) {
    addReference(references, item.imageUrl, {
      source: 'PostImageEmbedding',
      id: item.id,
      field: 'imageUrl',
    })
  }

  await collectTextReferences(prisma, references)

  return references
}

async function collectTextReferences(prisma: PrismaClient, references: ReferenceMap) {
  const pageSize = 500

  await collectPagedText(
    (skip) =>
      prisma.wikiPage.findMany({
        skip,
        take: pageSize,
        select: { id: true, content: true },
        orderBy: { id: 'asc' },
      }),
    references,
    pageSize,
    ['content'],
    (row, field) => ({ source: 'WikiPage', id: row.id, field: String(field) })
  )

  await collectPagedText(
    (skip) =>
      prisma.wikiRevision.findMany({
        skip,
        take: pageSize,
        select: { id: true, content: true },
        orderBy: { id: 'asc' },
      }),
    references,
    pageSize,
    ['content'],
    (row, field) => ({ source: 'WikiRevision', id: row.id, field: String(field) })
  )

  await collectPagedText(
    (skip) =>
      prisma.post.findMany({
        skip,
        take: pageSize,
        select: { id: true, content: true },
        orderBy: { id: 'asc' },
      }),
    references,
    pageSize,
    ['content'],
    (row, field) => ({ source: 'Post', id: row.id, field: String(field) })
  )

  await collectPagedText(
    (skip) =>
      prisma.postComment.findMany({
        skip,
        take: pageSize,
        select: { id: true, content: true },
        orderBy: { id: 'asc' },
      }),
    references,
    pageSize,
    ['content'],
    (row, field) => ({ source: 'PostComment', id: row.id, field: String(field) })
  )

  await collectPagedText(
    (skip) =>
      prisma.wikiPullRequestComment.findMany({
        skip,
        take: pageSize,
        select: { id: true, content: true },
        orderBy: { id: 'asc' },
      }),
    references,
    pageSize,
    ['content'],
    (row, field) => ({ source: 'WikiPullRequestComment', id: row.id, field: String(field) })
  )

  await collectPagedText(
    (skip) =>
      prisma.wikiPullRequest.findMany({
        skip,
        take: pageSize,
        select: { id: true, description: true },
        orderBy: { id: 'asc' },
      }),
    references,
    pageSize,
    ['description'],
    (row, field) => ({ source: 'WikiPullRequest', id: row.id, field: String(field) })
  )

  await collectPagedText(
    (skip) =>
      prisma.announcement.findMany({
        skip,
        take: pageSize,
        select: { id: true, content: true, link: true },
        orderBy: { id: 'asc' },
      }),
    references,
    pageSize,
    ['content', 'link'],
    (row, field) => ({ source: 'Announcement', id: row.id, field: String(field) })
  )
}

export async function scanUploadFiles(
  uploadDir = defaultUploadsDir,
  options: { includeVariants?: boolean; olderThanMs?: number } = {}
) {
  const files: UploadFile[] = []
  const includeVariants = options.includeVariants ?? true

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name)
      const storageKey = path.relative(uploadDir, absolutePath).split(path.sep).join('/')

      if (entry.isDirectory()) {
        if (!includeVariants && (storageKey === 'variants' || storageKey.startsWith('variants/'))) {
          continue
        }
        await walk(absolutePath)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      const stat = await fs.stat(absolutePath)
      if (options.olderThanMs !== undefined && stat.mtimeMs > options.olderThanMs) {
        continue
      }
      files.push({ storageKey, absolutePath, sizeBytes: stat.size, mtime: stat.mtime })
    }
  }

  try {
    await fs.access(uploadDir)
  } catch {
    return files
  }

  await walk(uploadDir)
  files.sort((a, b) => a.storageKey.localeCompare(b.storageKey))
  return files
}

export function isMediaRestoreReportFilename(filename: string) {
  return REPORT_FILENAME_PATTERN.test(filename)
}

export function resolveMediaRestoreReportPath(filename: string) {
  if (!isMediaRestoreReportFilename(filename)) {
    throw new Error('Invalid media restore report filename')
  }

  return path.join(MEDIA_RESTORE_REPORTS_DIR, filename)
}

async function cleanupOldMediaRestoreReports() {
  try {
    const filenames = (await fs.readdir(MEDIA_RESTORE_REPORTS_DIR)).filter(
      isMediaRestoreReportFilename
    )
    const files = (
      await Promise.all(
        filenames.map(async (name) => {
          const stat = await fs.stat(resolveMediaRestoreReportPath(name))
          return { name, mtimeMs: stat.mtimeMs }
        })
      )
    ).sort((a, b) => b.mtimeMs - a.mtimeMs)

    await Promise.all(
      files
        .slice(MEDIA_RESTORE_REPORT_RETAIN_COUNT)
        .map((file) => fs.unlink(resolveMediaRestoreReportPath(file.name)))
    )
  } catch {
    // Report cleanup must not hide the restore result or report generation result.
  }
}

export async function generateMediaRestoreReport(
  prisma: PrismaClient,
  restoreSource: MediaRestoreSource,
  options: { uploadDir?: string; now?: Date } = {}
) {
  const uploadDir = options.uploadDir || defaultUploadsDir
  const generatedAtDate = options.now || new Date()
  const generatedAt = generatedAtDate.toISOString()
  const timestamp = generatedAt.slice(0, 23).replace('T', '_').replace(/[:.]/g, '-')
  const filename = `restore-media-report_${timestamp}.json`

  const [references, uploadFiles] = await Promise.all([
    collectReferencedStorageKeys(prisma),
    scanUploadFiles(uploadDir),
  ])

  const existingKeys = new Set(uploadFiles.map((file) => file.storageKey))
  const missingFiles = [...references.entries()]
    .filter(([storageKey]) => !existingKeys.has(storageKey))
    .map(([storageKey, refs]) => ({
      storageKey,
      publicUrl: buildUploadPublicUrl(storageKey),
      expectedPath:
        resolveUploadPathByStorageKey(storageKey, uploadDir) || path.join(uploadDir, storageKey),
      references: refs,
    }))
    .sort((a, b) => a.storageKey.localeCompare(b.storageKey))

  const orphanFiles = uploadFiles
    .filter((file) => !references.has(file.storageKey))
    .map((file) => ({
      storageKey: file.storageKey,
      sizeBytes: file.sizeBytes,
      mtime: file.mtime.toISOString(),
    }))

  const orphanSizeBytes = orphanFiles.reduce((sum, file) => sum + file.sizeBytes, 0)
  const report: MediaRestoreReport = {
    generatedAt,
    restoreSource,
    uploadsDir: uploadDir,
    summary: {
      referencedKeys: references.size,
      scannedFiles: uploadFiles.length,
      missingFiles: missingFiles.length,
      orphanFiles: orphanFiles.length,
      orphanSizeBytes,
    },
    missingFiles,
    orphanFiles,
  }

  await fs.mkdir(MEDIA_RESTORE_REPORTS_DIR, { recursive: true })
  await fs.writeFile(
    path.join(MEDIA_RESTORE_REPORTS_DIR, filename),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf-8'
  )
  await cleanupOldMediaRestoreReports()

  return {
    filename,
    generatedAt,
    ...report.summary,
    missingFilePreview: missingFiles.slice(0, REPORT_PREVIEW_LIMIT),
    orphanFilePreview: orphanFiles.slice(0, REPORT_PREVIEW_LIMIT),
    previewLimit: REPORT_PREVIEW_LIMIT,
  } satisfies MediaRestoreReportSummary
}
