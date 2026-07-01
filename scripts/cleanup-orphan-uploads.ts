#!/usr/bin/env tsx
/**
 * 扫描 uploads 目录中没有数据库引用的本地文件。
 *
 * 默认只做 dry-run，不删除文件。确认输出后再加 --delete 执行删除。
 */

import { PrismaClient } from '@prisma/client'
import dotenv from 'dotenv'
import fs from 'fs/promises'
import path from 'path'
import { pathToFileURL } from 'url'

dotenv.config({ path: '.env.local' })
dotenv.config()

const prisma = new PrismaClient()

type UploadFile = {
  storageKey: string
  absolutePath: string
  sizeBytes: number
}

type Options = {
  deleteFiles: boolean
  includeVariants: boolean
  uploadsDir: string
  olderThanHours: number
  limit: number | null
  verbose: boolean
}

const UPLOAD_URL_PATTERN = /\/uploads\/[^\s"'`)<>\\]+/g
const MARKDOWN_UPLOAD_URL_PATTERN = /\]\((\/uploads\/[^)\s]+)(?:\s+"[^"]*")?\)/g

function parseArgs(args: string[]): Options {
  const getValue = (name: string) => {
    const inline = args.find((arg) => arg.startsWith(`${name}=`))
    if (inline) return inline.slice(name.length + 1)

    const index = args.indexOf(name)
    if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) {
      return args[index + 1]
    }

    return undefined
  }

  const uploadsDir = path.resolve(
    getValue('--uploads-dir') || process.env.UPLOADS_PATH || 'uploads'
  )
  const olderThanHours = parseNumber(getValue('--older-than-hours'), 1, { min: 0 })
  const limitValue = getValue('--limit')
  const limit =
    typeof limitValue === 'string'
      ? parseNumber(limitValue, Number.POSITIVE_INFINITY, { min: 1 })
      : null

  return {
    deleteFiles: args.includes('--delete'),
    includeVariants: args.includes('--include-variants'),
    uploadsDir,
    olderThanHours,
    limit: Number.isFinite(limit) ? limit : null,
    verbose: args.includes('--verbose'),
  }
}

function parseNumber(value: string | undefined, fallback: number, options: { min?: number } = {}) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback

  const min = options.min ?? Number.NEGATIVE_INFINITY
  return Math.max(min, parsed)
}

function normalizeStorageKey(value: string | null | undefined) {
  if (!value) return null

  const trimmed = value.trim()
  if (!trimmed) return null

  const rawKey = extractStorageKeyFromUploadUrl(trimmed) || trimmed
  const withoutQuery = rawKey.split(/[?#]/, 1)[0]
  const decoded = safeDecodeURIComponent(withoutQuery)
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

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function extractStorageKeyFromUploadUrl(value: string) {
  if (value.startsWith('/uploads/')) {
    return value.slice('/uploads/'.length)
  }

  try {
    const parsed = new URL(value)
    if (parsed.pathname.startsWith('/uploads/')) {
      return parsed.pathname.slice('/uploads/'.length)
    }
  } catch {
    return null
  }

  return null
}

function addStorageKey(keys: Set<string>, value: string | null | undefined) {
  const key = normalizeStorageKey(value)
  if (key) keys.add(key)
}

function addUploadUrlsFromText(keys: Set<string>, value: string | null | undefined) {
  if (!value) return

  for (const match of value.matchAll(UPLOAD_URL_PATTERN)) {
    addStorageKey(keys, match[0])
  }

  for (const match of value.matchAll(MARKDOWN_UPLOAD_URL_PATTERN)) {
    addStorageKey(keys, match[1])
  }
}

async function collectReferencedStorageKeys() {
  const keys = new Set<string>()

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
    prisma.mediaAsset.findMany({ select: { storageKey: true, publicUrl: true } }),
    prisma.imageMap.findMany({ select: { localUrl: true, thumbnailUrl: true } }),
    prisma.user.findMany({ where: { photoURL: { not: null } }, select: { photoURL: true } }),
    prisma.galleryImage.findMany({ select: { url: true } }),
    prisma.songCover.findMany({ select: { storageKey: true, publicUrl: true } }),
    prisma.albumCover.findMany({ select: { storageKey: true, publicUrl: true } }),
    prisma.wikiImageEmbedding.findMany({ select: { imageUrl: true } }),
    prisma.postImageEmbedding.findMany({ select: { imageUrl: true } }),
  ])

  for (const item of mediaAssets) {
    addStorageKey(keys, item.storageKey)
    addStorageKey(keys, item.publicUrl)
  }

  for (const item of imageMaps) {
    addStorageKey(keys, item.localUrl)
    addStorageKey(keys, item.thumbnailUrl)
  }

  for (const item of users) addStorageKey(keys, item.photoURL)
  for (const item of galleryImages) addStorageKey(keys, item.url)

  for (const item of songCovers) {
    addStorageKey(keys, item.storageKey)
    addStorageKey(keys, item.publicUrl)
  }

  for (const item of albumCovers) {
    addStorageKey(keys, item.storageKey)
    addStorageKey(keys, item.publicUrl)
  }

  for (const item of wikiEmbeddings) addStorageKey(keys, item.imageUrl)
  for (const item of postEmbeddings) addStorageKey(keys, item.imageUrl)

  await collectTextReferences(keys)

  return keys
}

async function collectTextReferences(keys: Set<string>) {
  const pageSize = 500

  await collectPagedText(
    (skip) =>
      prisma.wikiPage.findMany({
        skip,
        take: pageSize,
        select: { content: true },
        orderBy: { id: 'asc' },
      }),
    keys,
    pageSize
  )

  await collectPagedText(
    (skip) =>
      prisma.wikiRevision.findMany({
        skip,
        take: pageSize,
        select: { content: true },
        orderBy: { id: 'asc' },
      }),
    keys,
    pageSize
  )

  await collectPagedText(
    (skip) =>
      prisma.post.findMany({
        skip,
        take: pageSize,
        select: { content: true },
        orderBy: { id: 'asc' },
      }),
    keys,
    pageSize
  )

  await collectPagedText(
    (skip) =>
      prisma.postComment.findMany({
        skip,
        take: pageSize,
        select: { content: true },
        orderBy: { id: 'asc' },
      }),
    keys,
    pageSize
  )

  await collectPagedText(
    (skip) =>
      prisma.wikiPullRequestComment.findMany({
        skip,
        take: pageSize,
        select: { content: true },
        orderBy: { id: 'asc' },
      }),
    keys,
    pageSize
  )

  await collectPagedText(
    (skip) =>
      prisma.wikiPullRequest.findMany({
        skip,
        take: pageSize,
        select: { description: true },
        orderBy: { id: 'asc' },
      }),
    keys,
    pageSize
  )

  await collectPagedText(
    (skip) =>
      prisma.announcement.findMany({
        skip,
        take: pageSize,
        select: { content: true, link: true },
        orderBy: { id: 'asc' },
      }),
    keys,
    pageSize
  )
}

async function collectPagedText<T extends Record<string, string | null>>(
  load: (skip: number) => Promise<T[]>,
  keys: Set<string>,
  pageSize: number
) {
  for (let skip = 0; ; skip += pageSize) {
    const rows = await load(skip)
    for (const row of rows) {
      for (const value of Object.values(row)) {
        addUploadUrlsFromText(keys, value)
      }
    }

    if (rows.length < pageSize) break
  }
}

async function scanUploadFiles(options: Options) {
  const files: UploadFile[] = []
  const cutoffTime = Date.now() - options.olderThanHours * 60 * 60 * 1000

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name)
      const storageKey = path.relative(options.uploadsDir, absolutePath).split(path.sep).join('/')

      if (
        !options.includeVariants &&
        (storageKey === 'variants' || storageKey.startsWith('variants/'))
      ) {
        continue
      }

      if (entry.isDirectory()) {
        await walk(absolutePath)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      const stat = await fs.stat(absolutePath)
      if (stat.mtimeMs > cutoffTime) {
        continue
      }

      files.push({ storageKey, absolutePath, sizeBytes: stat.size })
    }
  }

  try {
    await fs.access(options.uploadsDir)
  } catch {
    throw new Error(`uploads directory not found: ${options.uploadsDir}`)
  }

  await walk(options.uploadsDir)
  files.sort((a, b) => a.storageKey.localeCompare(b.storageKey))
  return files
}

async function deleteOrphanFiles(files: UploadFile[], options: Options) {
  const deleted: UploadFile[] = []
  const failed: Array<{ file: UploadFile; error: unknown }> = []

  for (const file of files) {
    try {
      await fs.rm(file.absolutePath, { force: true })
      deleted.push(file)
    } catch (error) {
      failed.push({ file, error })
    }

    if (options.limit && deleted.length >= options.limit) {
      break
    }
  }

  await removeEmptyDirs(options.uploadsDir)

  return { deleted, failed }
}

async function removeEmptyDirs(root: string) {
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name))
      }
    }

    if (dir === root) return

    const remaining = await fs.readdir(dir)
    if (remaining.length === 0) {
      await fs.rmdir(dir)
    }
  }

  await walk(root)
}

function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`
}

function printUsage() {
  console.log(`
Usage:
  npm run uploads:cleanup
  npm run uploads:cleanup -- --delete

Options:
  --delete                    Delete orphan files. Default is dry-run.
  --uploads-dir <path>         Override uploads directory. Default: UPLOADS_PATH or ./uploads.
  --older-than-hours <number>  Only scan files older than this many hours. Default: 1.
  --include-variants           Include uploads/variants. Default: skipped.
  --limit <number>             Limit number of files deleted when using --delete.
  --verbose                    Print all orphan file paths.
`)
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    printUsage()
    return
  }

  const options = parseArgs(args)

  console.log('[uploads-cleanup] mode=', options.deleteFiles ? 'delete' : 'dry-run')
  console.log('[uploads-cleanup] uploadsDir=', options.uploadsDir)
  console.log('[uploads-cleanup] olderThanHours=', options.olderThanHours)
  console.log('[uploads-cleanup] includeVariants=', options.includeVariants)

  const [referencedKeys, uploadFiles] = await Promise.all([
    collectReferencedStorageKeys(),
    scanUploadFiles(options),
  ])

  const orphanFiles = uploadFiles.filter((file) => !referencedKeys.has(file.storageKey))
  const targetFiles = options.limit ? orphanFiles.slice(0, options.limit) : orphanFiles
  const totalOrphanBytes = orphanFiles.reduce((sum, file) => sum + file.sizeBytes, 0)
  const targetBytes = targetFiles.reduce((sum, file) => sum + file.sizeBytes, 0)

  console.log('[uploads-cleanup] referencedKeys=', referencedKeys.size)
  console.log('[uploads-cleanup] scannedFiles=', uploadFiles.length)
  console.log('[uploads-cleanup] orphanFiles=', orphanFiles.length)
  console.log('[uploads-cleanup] orphanSize=', formatBytes(totalOrphanBytes))

  if (options.limit) {
    console.log('[uploads-cleanup] limitedTargetFiles=', targetFiles.length)
    console.log('[uploads-cleanup] limitedTargetSize=', formatBytes(targetBytes))
  }

  const preview = orphanFiles.slice(0, options.verbose ? orphanFiles.length : 30)
  for (const file of preview) {
    console.log(
      `[uploads-cleanup] orphan ${formatBytes(file.sizeBytes).padStart(10)}  ${file.storageKey}`
    )
  }

  if (orphanFiles.length > preview.length) {
    console.log(
      `[uploads-cleanup] ... ${orphanFiles.length - preview.length} more. Use --verbose to list all.`
    )
  }

  if (!options.deleteFiles) {
    console.log('[uploads-cleanup] dry-run only. Re-run with --delete to remove orphan files.')
    return
  }

  const result = await deleteOrphanFiles(targetFiles, options)
  const deletedBytes = result.deleted.reduce((sum, file) => sum + file.sizeBytes, 0)

  console.log('[uploads-cleanup] deletedFiles=', result.deleted.length)
  console.log('[uploads-cleanup] freedSize=', formatBytes(deletedBytes))

  if (result.failed.length > 0) {
    console.error('[uploads-cleanup] failedFiles=', result.failed.length)
    for (const item of result.failed.slice(0, 20)) {
      console.error('[uploads-cleanup] delete failed', item.file.storageKey, item.error)
    }
    process.exitCode = 1
  }
}

export {
  collectReferencedStorageKeys,
  extractStorageKeyFromUploadUrl,
  normalizeStorageKey,
  parseArgs,
  scanUploadFiles,
}

const isExecutedAsScript =
  typeof process.argv[1] === 'string' &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isExecutedAsScript) {
  main()
    .catch((error) => {
      console.error('[uploads-cleanup] fatal', error)
      process.exitCode = 1
    })
    .finally(async () => {
      await prisma.$disconnect()
    })
}
