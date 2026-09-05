import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { deflateRawSync, inflateRawSync } from 'node:zlib'

import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../prisma'
import { resolveUploadPathByUrl } from '../utils/upload'
import {
  buildUploadPublicUrl,
  extractStorageKeyFromUploadUrl,
  resolveUploadPathByStorageKey,
} from '../uploadPath'
import { uploadsDir as defaultUploadsDir } from '../utils/config'
import { replaceMarkdownLinks } from '../../lib/markdownLinkReplacer'
import {
  collectMediaReferences,
  createAssetClaimForImageMap,
  ensureImageMapForLocalFile,
  releaseMediaAsset,
  syncAssetToImageMap,
} from './mediaAssetService'
import { scanMediaHealth, type MediaHealthScanResult } from './mediaHealth.service'
import { localizeImageUrlAsMediaAsset } from '../utils/remoteImageAsset'
import { normalizeStorageKey, scanUploadFiles } from './mediaRestoreReport.service'
import { enqueueMissingImageMapThumbnail } from './galleryImageSyncService'
import { enqueueMusicCoverThumbnail } from '../utils/music'
export type MaintenanceMode = 'dry-run' | 'apply'
export type MaintenanceType = 'all' | 'gallery' | 'song' | 'album'
export type MaintenanceOperation =
  | 'scan'
  | 'reconcile'
  | 'bind-legacy'
  | 'localize'
  | 'repair-thumbnails'
  | 'orphans/preview'
  | 'orphans/delete'
export type MaintenanceResultMode = MaintenanceMode | 'strict' | 'business'

export type MaintenanceDetail = {
  id: string
  status: 'processed' | 'skipped' | 'failed'
  reason?: string
  type?: MaintenanceType
}

export type MaintenanceBatchResult = {
  operation: MaintenanceOperation
  mode: MaintenanceResultMode
  type: MaintenanceType
  scanned: number
  processed: number
  skipped: number
  failed: number
  nextCursor: string | null
  hasMore: boolean
  details: MaintenanceDetail[]
  queued?: number
  alreadyQueued?: number
  skippedMissingSource?: number
  conflicts?: number
}

export type MediaMaintenanceScanCounts = {
  unboundMediaAssets: number
  legacyUrlOnlyRecords: number
  missingThumbnails: number
  remoteCandidates: number
  orphanFiles: number
  orphanBytes: number
  sharedImageMaps: number
  activeUploadSessions: number
  missingLocalFiles: number
  retiredMedia: number
}

export type MediaMaintenanceScanResult = MaintenanceBatchResult & {
  counts: MediaMaintenanceScanCounts
  health: MediaHealthScanResult
}

export type OrphanPreviewEntry = {
  storageKey: string
  sizeBytes: number
  mtimeMs: number
  sha256: string
}

export type OrphanPreviewResult = MaintenanceBatchResult & {
  previewToken: string
  storageKeys: string[]
  entries: OrphanPreviewEntry[]
  totalBytes: number
  includeVariants: boolean
}

export type OrphanDeleteResult = MaintenanceBatchResult & {
  deletedBytes: number
  deletedKeys: string[]
}

export class MediaMaintenanceRequestError extends Error {
  constructor(
    public readonly statusCode: 400 | 403 | 409 | 413,
    message: string
  ) {
    super(message)
    this.name = 'MediaMaintenanceRequestError'
  }
}

const MAX_DETAILS = 100
const PREVIEW_TOKEN_VERSION = 1
const PREVIEW_TOKEN_TTL_MS = 10 * 60 * 1000

type OrphanTokenPayload = {
  version: number
  operatorUid: string
  expiresAt: number
  cutoffMs: number
  includeVariants: boolean
  entries: OrphanPreviewEntry[]
}

type BatchOptions = {
  cursor?: string
  batchSize?: number
  mode: MaintenanceMode
  type?: MaintenanceType
  operatorUid?: string
}

type UrlMapping = {
  oldUrl: string
  newUrl: string
  assetIds: string[]
  imageMapIds: string[]
}

function clampBatchSize(value: number | undefined) {
  return Math.max(1, Math.min(Math.floor(value || 100), 100))
}
function makeBatchResult(
  rows: MaintenanceDetail[],
  values: { scanned: number; processed: number; skipped: number; failed: number },
  cursor: string | null,
  hasMore: boolean,
  metadata: Pick<MaintenanceBatchResult, 'operation' | 'mode' | 'type'>,
  extras: Pick<
    MaintenanceBatchResult,
    'queued' | 'alreadyQueued' | 'skippedMissingSource' | 'conflicts'
  > = {}
): MaintenanceBatchResult {
  return {
    ...metadata,
    ...values,
    nextCursor: cursor,
    hasMore,
    details: rows.slice(0, MAX_DETAILS),
    ...extras,
  }
}

function pageRows<T>(
  rows: T[],
  limit: number,
  getId: (row: T) => string,
  cursor: string | undefined
) {
  const page = rows.slice(0, limit)
  return {
    page,
    hasMore: rows.length > limit,
    nextCursor: page.length ? getId(page[page.length - 1]) : cursor || null,
  }
}

function assertSafeStorageKey(value: string) {
  const trimmed = value.trim()
  if (
    !trimmed ||
    trimmed.startsWith('/') ||
    path.isAbsolute(trimmed) ||
    /^[A-Za-z]:[\\/]/.test(trimmed) ||
    /^https?:\/\//i.test(trimmed)
  ) {
    throw new MediaMaintenanceRequestError(400, 'storage key 必须是相对上传路径')
  }
  const normalized = normalizeStorageKey(trimmed)
  if (
    trimmed.includes('\0') ||
    trimmed.includes('\\') ||
    normalized?.split('/').some((part) => part === '..') ||
    !normalized ||
    normalized !== trimmed
  ) {
    throw new MediaMaintenanceRequestError(400, 'storage key 包含危险路径')
  }
  return normalized
}

async function readableFile(filePath: string | null) {
  if (!filePath) return false
  try {
    const stat = await fs.stat(filePath)
    return stat.isFile()
  } catch {
    return false
  }
}

async function sha256File(filePath: string) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

function encodeToken(payload: OrphanTokenPayload) {
  const body = deflateRawSync(Buffer.from(JSON.stringify(payload))).toString('base64url')
  const secret = process.env.JWT_SECRET
  if (!secret) throw new MediaMaintenanceRequestError(409, '未配置维护令牌签名密钥')
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${signature}`
}

function decodeToken(token: string, operatorUid: string): OrphanTokenPayload {
  const [body, signature] = token.split('.')
  const secret = process.env.JWT_SECRET
  if (!secret || !body || !signature) {
    throw new MediaMaintenanceRequestError(409, '孤儿文件预览令牌无效')
  }
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    throw new MediaMaintenanceRequestError(409, '孤儿文件预览令牌无效')
  }
  let payload: OrphanTokenPayload
  try {
    payload = JSON.parse(
      inflateRawSync(Buffer.from(body, 'base64url')).toString('utf8')
    ) as OrphanTokenPayload
  } catch {
    throw new MediaMaintenanceRequestError(409, '孤儿文件预览令牌无效')
  }
  const validEntries =
    Array.isArray(payload.entries) &&
    payload.entries.length <= 100 &&
    payload.entries.every(
      (entry) =>
        entry &&
        typeof entry.storageKey === 'string' &&
        entry.storageKey.length <= 512 &&
        typeof entry.sizeBytes === 'number' &&
        Number.isSafeInteger(entry.sizeBytes) &&
        entry.sizeBytes >= 0 &&
        typeof entry.mtimeMs === 'number' &&
        Number.isFinite(entry.mtimeMs) &&
        typeof entry.sha256 === 'string' &&
        /^[a-f0-9]{64}$/i.test(entry.sha256)
    )
  if (
    payload.version !== PREVIEW_TOKEN_VERSION ||
    payload.operatorUid !== operatorUid ||
    payload.expiresAt < Date.now() ||
    !Number.isFinite(payload.cutoffMs) ||
    typeof payload.includeVariants !== 'boolean' ||
    !validEntries
  ) {
    throw new MediaMaintenanceRequestError(409, '孤儿文件预览已过期或操作者不匹配')
  }
  return payload
}

async function rewriteMarkdownFields(
  client: PrismaClient,
  mappings: UrlMapping[],
  apply: boolean
): Promise<{ replacements: number; conflicts: number }> {
  if (!mappings.length) return { replacements: 0, conflicts: 0 }
  const where = { OR: mappings.map((mapping) => ({ content: { contains: mapping.oldUrl } })) }
  const descriptionWhere = {
    OR: mappings.map((mapping) => ({ description: { contains: mapping.oldUrl } })),
  }
  const linkWhere = { OR: mappings.map((mapping) => ({ link: { contains: mapping.oldUrl } })) }
  let replacementCount = 0
  let conflictCount = 0

  async function updateRows(
    rows: Array<{ id: string; value: string | null }>,
    update: (id: string, oldValue: string, value: string) => Promise<unknown>
  ) {
    for (const row of rows) {
      if (!row.value) continue
      const replacement = replaceMarkdownLinks(row.value, mappings)
      if (!replacement.replaced) continue
      replacementCount += replacement.replaceCount
      if (apply) {
        const result = await update(row.id, row.value, replacement.content)
        if (result && typeof result === 'object' && 'count' in result) {
          const count = result.count
          if (typeof count === 'number' && count !== 1) conflictCount++
        }
      }
    }
  }

  await updateRows(
    (
      await client.wikiPage.findMany({
        where,
        select: { id: true, content: true },
        orderBy: { id: 'asc' },
      })
    ).map((row) => ({
      id: row.id,
      value: row.content,
    })),
    (id, oldValue, value) =>
      client.wikiPage.updateMany({ where: { id, content: oldValue }, data: { content: value } })
  )
  await updateRows(
    (
      await client.wikiRevision.findMany({
        where,
        select: { id: true, content: true },
        orderBy: { id: 'asc' },
      })
    ).map((row) => ({
      id: row.id,
      value: row.content,
    })),
    (id, oldValue, value) =>
      client.wikiRevision.updateMany({ where: { id, content: oldValue }, data: { content: value } })
  )
  await updateRows(
    (
      await client.post.findMany({
        where,
        select: { id: true, content: true },
        orderBy: { id: 'asc' },
      })
    ).map((row) => ({
      id: row.id,
      value: row.content,
    })),
    (id, oldValue, value) =>
      client.post.updateMany({ where: { id, content: oldValue }, data: { content: value } })
  )
  await updateRows(
    (
      await client.event.findMany({
        where,
        select: { id: true, content: true },
        orderBy: { id: 'asc' },
      })
    ).map((row) => ({
      id: row.id,
      value: row.content,
    })),
    (id, oldValue, value) =>
      client.event.updateMany({ where: { id, content: oldValue }, data: { content: value } })
  )
  await updateRows(
    (
      await client.postComment.findMany({
        where,
        select: { id: true, content: true },
        orderBy: { id: 'asc' },
      })
    ).map((row) => ({
      id: row.id,
      value: row.content,
    })),
    (id, oldValue, value) =>
      client.postComment.updateMany({ where: { id, content: oldValue }, data: { content: value } })
  )
  await updateRows(
    (
      await client.wikiPullRequestComment.findMany({
        where,
        select: { id: true, content: true },
        orderBy: { id: 'asc' },
      })
    ).map((row) => ({ id: row.id, value: row.content })),
    (id, oldValue, value) =>
      client.wikiPullRequestComment.updateMany({
        where: { id, content: oldValue },
        data: { content: value },
      })
  )
  await updateRows(
    (
      await client.wikiPullRequest.findMany({
        where: descriptionWhere,
        select: { id: true, description: true },
        orderBy: { id: 'asc' },
      })
    ).map((row) => ({ id: row.id, value: row.description })),
    (id, oldValue, value) =>
      client.wikiPullRequest.updateMany({
        where: { id, description: oldValue },
        data: { description: value },
      })
  )
  await updateRows(
    (
      await client.announcement.findMany({
        where: { OR: [...where.OR, ...linkWhere.OR] },
        select: { id: true, content: true, link: true },
        orderBy: { id: 'asc' },
      })
    ).flatMap((row) => [
      { id: `${row.id}:content`, value: row.content },
      { id: `${row.id}:link`, value: row.link },
    ]),
    async (id, oldValue, value) => {
      const [announcementId, field] = id.split(':')
      return client.announcement.updateMany({
        where: { id: announcementId, [field === 'link' ? 'link' : 'content']: oldValue },
        data: { [field === 'link' ? 'link' : 'content']: value },
      })
    }
  )
  return { replacements: replacementCount, conflicts: conflictCount }
}

type LegacyReferenceRow = { id: string; assetId: string | null }
type LegacyReferenceOperation = {
  findRows: () => Promise<LegacyReferenceRow[]>
  update: (id: string) => Promise<{ count: number }>
}

async function updateLegacyUrlReferences(
  client: PrismaClient,
  mappings: UrlMapping[],
  apply: boolean
): Promise<number> {
  if (!apply || !mappings.length) return 0
  let conflicts = 0
  for (const mapping of mappings) {
    const allowedAssetIds = mapping.assetIds
    const galleryAllowed = [{ assetId: null }, ...allowedAssetIds.map((assetId) => ({ assetId }))]
    const eventAllowed = [
      { coverAssetId: null },
      ...allowedAssetIds.map((assetId) => ({ coverAssetId: assetId })),
    ]
    const posterAllowed = galleryAllowed
    const songAllowed = galleryAllowed
    const albumAllowed = galleryAllowed
    const userAllowed = [
      { photoAssetId: null },
      ...allowedAssetIds.map((assetId) => ({ photoAssetId: assetId })),
    ]
    const updates: LegacyReferenceOperation[] = [
      {
        findRows: () =>
          client.galleryImage.findMany({
            where: { url: mapping.oldUrl },
            select: { id: true, assetId: true },
          }),
        update: (id) =>
          client.galleryImage.updateMany({
            where: { id, url: mapping.oldUrl, OR: galleryAllowed },
            data: { url: mapping.newUrl },
          }),
      },
      {
        findRows: () =>
          client.event
            .findMany({
              where: { coverUrl: mapping.oldUrl },
              select: { id: true, coverAssetId: true },
            })
            .then((rows) => rows.map((row) => ({ id: row.id, assetId: row.coverAssetId }))),
        update: (id) =>
          client.event.updateMany({
            where: { id, coverUrl: mapping.oldUrl, OR: eventAllowed },
            data: { coverUrl: mapping.newUrl },
          }),
      },
      {
        findRows: () =>
          client.eventPoster.findMany({
            where: { url: mapping.oldUrl },
            select: { id: true, assetId: true },
          }),
        update: (id) =>
          client.eventPoster.updateMany({
            where: { id, url: mapping.oldUrl, OR: posterAllowed },
            data: { url: mapping.newUrl },
          }),
      },
      {
        findRows: () =>
          client.songCover.findMany({
            where: { publicUrl: mapping.oldUrl },
            select: { id: true, assetId: true },
          }),
        update: (id) =>
          client.songCover.updateMany({
            where: { id, publicUrl: mapping.oldUrl, OR: songAllowed },
            data: { publicUrl: mapping.newUrl },
          }),
      },
      {
        findRows: () =>
          client.albumCover.findMany({
            where: { publicUrl: mapping.oldUrl },
            select: { id: true, assetId: true },
          }),
        update: (id) =>
          client.albumCover.updateMany({
            where: { id, publicUrl: mapping.oldUrl, OR: albumAllowed },
            data: { publicUrl: mapping.newUrl },
          }),
      },
      {
        findRows: () =>
          client.user
            .findMany({
              where: { photoURL: mapping.oldUrl },
              select: { uid: true, photoAssetId: true },
            })
            .then((rows) => rows.map((row) => ({ id: row.uid, assetId: row.photoAssetId }))),
        update: (id) =>
          client.user.updateMany({
            where: { uid: id, photoURL: mapping.oldUrl, OR: userAllowed },
            data: { photoURL: mapping.newUrl },
          }),
      },
    ]
    for (const operation of updates) {
      const rows = await operation.findRows()
      for (const row of rows) {
        if (row.assetId && !allowedAssetIds.includes(row.assetId)) {
          conflicts++
          continue
        }
        const updated = await operation.update(row.id)
        if (updated.count !== 1) conflicts++
      }
    }
  }
  return conflicts
}

async function loadAllReconcileMappings(client: PrismaClient): Promise<UrlMapping[]> {
  const rows = await client.mediaAsset.findMany({
    where: {
      status: { not: 'deleted' },
      imageMapId: { not: null },
      publicUrl: { not: null },
    },
    select: {
      id: true,
      imageMapId: true,
      publicUrl: true,
      imageMap: { select: { localUrl: true } },
    },
    orderBy: { id: 'asc' },
  })
  return rows.flatMap((row) =>
    row.publicUrl && row.imageMap?.localUrl && row.publicUrl !== row.imageMap.localUrl
      ? [
          {
            oldUrl: row.publicUrl,
            newUrl: row.imageMap.localUrl,
            assetIds: [row.id],
            imageMapIds: row.imageMapId ? [row.imageMapId] : [],
          },
        ]
      : []
  )
}

function mergeUrlMappings(mappings: UrlMapping[]) {
  const merged = new Map<string, UrlMapping>()
  for (const mapping of mappings) {
    const key = `${mapping.oldUrl}\u0000${mapping.newUrl}`
    const current = merged.get(key)
    if (current) {
      current.assetIds.push(...mapping.assetIds)
      current.imageMapIds.push(...mapping.imageMapIds)
    } else {
      merged.set(key, {
        ...mapping,
        assetIds: [...mapping.assetIds],
        imageMapIds: [...mapping.imageMapIds],
      })
    }
  }
  return [...merged.values()].map((mapping) => ({
    ...mapping,
    assetIds: [...new Set(mapping.assetIds)],
    imageMapIds: [...new Set(mapping.imageMapIds)],
  }))
}
async function reconcileAssetPage(
  options: BatchOptions,
  client: PrismaClient
): Promise<MaintenanceBatchResult> {
  const limit = clampBatchSize(options.batchSize)
  const rows = await client.mediaAsset.findMany({
    where: {
      status: { not: 'deleted' },
      ...(options.cursor ? { id: { gt: options.cursor } } : {}),
    },
    select: { id: true, ownerUid: true, imageMapId: true, publicUrl: true, storageKey: true },
    orderBy: { id: 'asc' },
    take: limit + 1,
  })
  const { page, hasMore, nextCursor } = pageRows(rows, limit, (row) => row.id, options.cursor)
  const details: MaintenanceDetail[] = []
  const mappings: UrlMapping[] = []
  let processed = 0
  let skipped = 0
  let failed = 0
  let queued = 0
  let alreadyQueued = 0
  let skippedMissingSource = 0

  for (const row of page) {
    try {
      let imageMapId = row.imageMapId
      if (!imageMapId && options.mode === 'dry-run') {
        const sourcePath = row.publicUrl
          ? resolveUploadPathByUrl(row.publicUrl)
          : row.storageKey
            ? resolveUploadPathByStorageKey(row.storageKey, defaultUploadsDir)
            : null
        if (!(await readableFile(sourcePath))) {
          skipped++
          details.push({ id: row.id, status: 'skipped', reason: '本地原图不存在' })
          continue
        }
        processed++
        details.push({ id: row.id, status: 'processed', reason: '待绑定' })
        continue
      }
      if (!imageMapId) imageMapId = await syncAssetToImageMap(row.id, client)
      if (!imageMapId) {
        skipped++
        details.push({ id: row.id, status: 'skipped', reason: '无法确定规范 ImageMap' })
        continue
      }
      const repair = await enqueueMissingImageMapThumbnail(imageMapId, {
        client,
        mode: options.mode,
        fallbackStorageKeys: row.storageKey ? [row.storageKey] : [],
      })
      const repairMissingSource = repair.status === 'missing-source'
      const repairFailed = repair.status === 'failed'
      if (repairMissingSource) {
        skippedMissingSource++
        skipped++
        details.push({ id: row.id, status: 'skipped', reason: repair.reason })
        continue
      }
      if (repair.status === 'deleted' || repair.status === 'not-found') {
        skipped++
        details.push({ id: row.id, status: 'skipped', reason: repair.reason })
        continue
      }
      if (repairFailed) failed++
      else if (repair.status === 'queued') queued++
      else alreadyQueued++
      if (row.publicUrl) {
        const imageMap = await client.imageMap.findUnique({
          where: { id: imageMapId },
          select: { localUrl: true },
        })
        if (!imageMap) {
          failed++
          details.push({ id: row.id, status: 'failed', reason: '规范 ImageMap 不存在' })
          continue
        }
        if (options.mode === 'apply') {
          const updated = await client.mediaAsset.updateMany({
            where: { id: row.id, imageMapId, publicUrl: row.publicUrl },
            data: {
              publicUrl: imageMap.localUrl,
              storageKey: extractStorageKeyFromUploadUrl(imageMap.localUrl),
            },
          })
          if (updated.count !== 1) {
            skipped++
            details.push({ id: row.id, status: 'skipped', reason: '媒体资源已被其他操作修改' })
            continue
          }
        }
        mappings.push({
          oldUrl: row.publicUrl,
          newUrl: imageMap.localUrl,
          assetIds: [row.id],
          imageMapIds: imageMapId ? [imageMapId] : [],
        })
      }
      if (options.mode === 'apply' && row.ownerUid && row.publicUrl) {
        await client.user.updateMany({
          where: {
            uid: row.ownerUid,
            photoURL: row.publicUrl,
            OR: [{ photoAssetId: null }, { photoAssetId: row.id }],
          },
          data: {
            photoAssetId: row.id,
            photoURL: (
              await client.imageMap.findUnique({
                where: { id: imageMapId },
                select: { localUrl: true },
              })
            )?.localUrl,
          },
        })
      }
      if (repairFailed) {
        failed++
        details.push({ id: row.id, status: 'failed', reason: repair.reason })
        continue
      }
      processed++
      details.push({ id: row.id, status: 'processed', reason: `${imageMapId}:${repair.status}` })
    } catch (error) {
      failed++
      details.push({
        id: row.id,
        status: 'failed',
        reason: error instanceof Error ? error.message : '规范化失败',
      })
    }
  }
  const uniqueMappings = mergeUrlMappings(mappings)
  const initialMappings =
    options.mode === 'apply' && !options.cursor ? await loadAllReconcileMappings(client) : []
  const mappingsForReferences = mergeUrlMappings([...initialMappings, ...uniqueMappings])
  const urlConflicts = await updateLegacyUrlReferences(
    client,
    mappingsForReferences,
    options.mode === 'apply'
  )
  // Text references are rewritten only on the initial cursor page. Later
  // pages still update their old URL rows, but must not rescan all text tables.
  const markdownResult =
    options.mode === 'apply' && !options.cursor
      ? await rewriteMarkdownFields(client, mappingsForReferences, true)
      : { replacements: 0, conflicts: 0 }
  const conflicts = urlConflicts + markdownResult.conflicts
  return makeBatchResult(
    details,
    { scanned: page.length, processed, skipped, failed },
    nextCursor,
    hasMore,
    { operation: 'reconcile', mode: options.mode, type: 'all' },
    { queued, alreadyQueued, skippedMissingSource, conflicts }
  )
}

type LegacyPhase = 'mediaAsset' | 'gallery' | 'event' | 'eventPoster' | 'song' | 'album'
const LEGACY_PHASES: LegacyPhase[] = [
  'mediaAsset',
  'gallery',
  'event',
  'eventPoster',
  'song',
  'album',
]
type LegacyTarget = {
  phase: LegacyPhase
  id: string
  url: string
  storageKey: string
  ownerUid: string | null
}

type LegacyCursor = { phase: LegacyPhase; id: string | null }
function getLegacyMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  return extension === '.png'
    ? 'image/png'
    : extension === '.webp'
      ? 'image/webp'
      : extension === '.gif'
        ? 'image/gif'
        : extension === '.bmp'
          ? 'image/bmp'
          : 'image/jpeg'
}

function encodeLegacyCursor(cursor: LegacyCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

function decodeLegacyCursor(cursor?: string): LegacyCursor {
  if (!cursor) return { phase: 'mediaAsset', id: null }
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as LegacyCursor
    if (!LEGACY_PHASES.includes(value.phase) || (value.id !== null && typeof value.id !== 'string'))
      throw new Error()
    return value
  } catch {
    throw new MediaMaintenanceRequestError(400, '维护游标无效')
  }
}

async function loadLegacyPhase(
  client: PrismaClient,
  phase: LegacyPhase,
  id: string | null,
  limit: number
) {
  const after = id ? { id: { gt: id } } : {}
  if (phase === 'mediaAsset') {
    const rows = await client.mediaAsset.findMany({
      where: { ...after, status: { not: 'deleted' }, imageMapId: null },
      select: { id: true, publicUrl: true, storageKey: true, ownerUid: true },
      orderBy: { id: 'asc' },
      take: limit + 1,
    })
    return rows.map((row) => ({
      phase,
      id: row.id,
      url: row.publicUrl || '',
      storageKey: normalizeStorageKey(row.storageKey) || normalizeStorageKey(row.publicUrl) || '',
      ownerUid: row.ownerUid,
    }))
  }

  if (phase === 'gallery') {
    const rows = await client.galleryImage.findMany({
      where: {
        ...after,
        assetId: null,
        url: { startsWith: '/uploads/' },
        gallery: { deletedAt: null },
      },
      select: { id: true, url: true, gallery: { select: { authorUid: true } } },
      orderBy: { id: 'asc' },
      take: limit + 1,
    })
    return rows.map((row) => ({
      phase,
      id: row.id,
      url: row.url,
      storageKey: normalizeStorageKey(row.url) || '',
      ownerUid: row.gallery.authorUid,
    }))
  }
  if (phase === 'event') {
    const rows = await client.event.findMany({
      where: {
        ...after,
        coverAssetId: null,
        coverUrl: { startsWith: '/uploads/' },
        deletedAt: null,
      },
      select: { id: true, coverUrl: true, createdByUid: true },
      orderBy: { id: 'asc' },
      take: limit + 1,
    })
    return rows.map((row) => ({
      phase,
      id: row.id,
      url: row.coverUrl!,
      storageKey: normalizeStorageKey(row.coverUrl) || '',
      ownerUid: row.createdByUid,
    }))
  }
  if (phase === 'eventPoster') {
    const rows = await client.eventPoster.findMany({
      where: {
        ...after,
        assetId: null,
        url: { startsWith: '/uploads/' },
        event: { deletedAt: null },
      },
      select: { id: true, url: true, event: { select: { createdByUid: true } } },
      orderBy: { id: 'asc' },
      take: limit + 1,
    })
    return rows.map((row) => ({
      phase,
      id: row.id,
      url: row.url,
      storageKey: normalizeStorageKey(row.url) || '',
      ownerUid: row.event.createdByUid,
    }))
  }
  if (phase === 'song') {
    const rows = await client.songCover.findMany({
      where: {
        ...after,
        assetId: null,
        song: { deletedAt: null },
        OR: [{ publicUrl: { startsWith: '/uploads/' } }, { storageKey: { not: '' } }],
      },
      select: { id: true, publicUrl: true, storageKey: true },
      orderBy: { id: 'asc' },
      take: limit + 1,
    })
    return rows.map((row) => ({
      phase,
      id: row.id,
      url: row.publicUrl,
      storageKey: normalizeStorageKey(row.storageKey) || normalizeStorageKey(row.publicUrl) || '',
      ownerUid: null,
    }))
  }
  const rows = await client.albumCover.findMany({
    where: {
      ...after,
      assetId: null,
      album: { deletedAt: null },
      OR: [{ publicUrl: { startsWith: '/uploads/' } }, { storageKey: { not: '' } }],
    },
    select: { id: true, publicUrl: true, storageKey: true },
    orderBy: { id: 'asc' },
    take: limit + 1,
  })
  return rows.map((row) => ({
    phase,
    id: row.id,
    url: row.publicUrl,
    storageKey: normalizeStorageKey(row.storageKey) || normalizeStorageKey(row.publicUrl) || '',
    ownerUid: null,
  }))
}

async function loadLegacyPage(client: PrismaClient, cursor: string | undefined, limit: number) {
  const decoded = decodeLegacyCursor(cursor)
  let phaseIndex = LEGACY_PHASES.indexOf(decoded.phase)
  while (phaseIndex < LEGACY_PHASES.length) {
    const phase = LEGACY_PHASES[phaseIndex]
    const rows = await loadLegacyPhase(
      client,
      phase,
      phase === decoded.phase ? decoded.id : null,
      limit
    )
    if (rows.length) {
      const page = rows.slice(0, limit)
      const exhausted = rows.length <= limit
      const nextPhase = phaseIndex + 1
      return {
        page,
        hasMore: rows.length > limit || nextPhase < LEGACY_PHASES.length,
        nextCursor:
          rows.length > limit
            ? encodeLegacyCursor({ phase, id: page[page.length - 1].id })
            : nextPhase < LEGACY_PHASES.length
              ? encodeLegacyCursor({ phase: LEGACY_PHASES[nextPhase], id: null })
              : null,
        exhausted,
      }
    }
    phaseIndex++
    decoded.id = null
    decoded.phase = LEGACY_PHASES[phaseIndex] || 'album'
  }
  return { page: [] as LegacyTarget[], hasMore: false, nextCursor: null, exhausted: true }
}

async function processLegacyTarget(
  client: PrismaClient,
  target: LegacyTarget,
  mode: MaintenanceMode
) {
  let createdAssetId: string | null = null
  const sourceCandidates = [
    resolveUploadPathByUrl(target.url),
    resolveUploadPathByStorageKey(target.storageKey, defaultUploadsDir),
  ]
  const sourcePath = await (async () => {
    for (const candidate of sourceCandidates) {
      if (await readableFile(candidate)) return candidate
    }
    return null
  })()
  if (!sourcePath) {
    return { status: 'skipped' as const, reason: '本地原图不存在', repair: null }
  }

  if (target.phase === 'mediaAsset') {
    if (mode === 'dry-run') {
      return { status: 'processed' as const, reason: '待绑定 ImageMap', repair: null }
    }
    const imageMapId = await syncAssetToImageMap(target.id, client)
    if (!imageMapId) {
      return { status: 'skipped' as const, reason: '无法确定规范 ImageMap', repair: null }
    }
    const repair = await enqueueMissingImageMapThumbnail(imageMapId, {
      client,
      mode,
      fallbackStorageKeys: [target.storageKey],
    })
    return {
      status: repair.status === 'failed' ? ('failed' as const) : ('processed' as const),
      reason: repair.reason || repair.status,
      repair,
    }
  }

  const matchedAsset = await client.mediaAsset.findFirst({
    where: {
      status: { in: ['uploaded', 'ready'] },
      ...(target.ownerUid ? { ownerUid: target.ownerUid } : {}),
      OR: [{ publicUrl: target.url }, { storageKey: target.storageKey }],
    },
    select: { id: true, imageMapId: true },
  })
  let asset = target.ownerUid ? matchedAsset : null
  let imageMapId = matchedAsset?.imageMapId
  if (!imageMapId) {
    imageMapId = (
      await client.imageMap.findFirst({
        where: { localUrl: target.url, deletedAt: null },
        select: { id: true },
      })
    )?.id
  }
  if (!imageMapId && mode === 'dry-run') {
    return { status: 'processed' as const, reason: '待创建 ImageMap', repair: null }
  }
  if (!imageMapId && mode === 'apply' && asset) {
    imageMapId = await syncAssetToImageMap(asset.id, client)
  }
  if (!imageMapId) {
    const localUrl = target.url.startsWith('/uploads/')
      ? target.url
      : buildUploadPublicUrl(target.storageKey)
    imageMapId = (await ensureImageMapForLocalFile(sourcePath, localUrl, client)).id
  }

  const imageMap = await client.imageMap.findUnique({
    where: { id: imageMapId },
    select: { localUrl: true },
  })
  if (!imageMap) {
    return { status: 'failed' as const, reason: '规范 ImageMap 不存在', repair: null }
  }
  if (!asset && mode === 'apply' && target.ownerUid) {
    const claim = await createAssetClaimForImageMap(
      {
        ownerUid: target.ownerUid,
        imageMapId,
        fileName: path.basename(sourcePath),
        mimeType: getLegacyMimeType(sourcePath),
        sizeBytes: (await fs.stat(sourcePath)).size,
      },
      client
    )
    asset = { id: claim.asset.id, imageMapId: claim.asset.imageMapId }
    if (!claim.reused) createdAssetId = claim.asset.id
  } else if (asset && mode === 'apply' && !asset.imageMapId) {
    const attached = await client.mediaAsset.updateMany({
      where: { id: asset.id, imageMapId: null, status: { not: 'deleted' } },
      data: {
        imageMapId,
        storageKey: extractStorageKeyFromUploadUrl(imageMap.localUrl) || target.storageKey,
        publicUrl: imageMap.localUrl,
      },
    })
    if (attached.count !== 1) {
      const current = await client.mediaAsset.findUnique({
        where: { id: asset.id },
        select: { imageMapId: true },
      })
      if (current?.imageMapId !== imageMapId) {
        return { status: 'skipped' as const, reason: '媒体资源已被其他操作绑定', repair: null }
      }
    }
    asset = { ...asset, imageMapId }
  }

  if (mode === 'apply') {
    const update =
      target.phase === 'gallery'
        ? await client.galleryImage.updateMany({
            where: { id: target.id, assetId: null, url: target.url },
            data: { ...(asset?.id ? { assetId: asset.id } : {}), url: imageMap.localUrl },
          })
        : target.phase === 'event'
          ? await client.event.updateMany({
              where: { id: target.id, coverAssetId: null, coverUrl: target.url },
              data: {
                ...(asset?.id ? { coverAssetId: asset.id } : {}),
                coverUrl: imageMap.localUrl,
              },
            })
          : target.phase === 'eventPoster'
            ? await client.eventPoster.updateMany({
                where: { id: target.id, assetId: null, url: target.url },
                data: { ...(asset?.id ? { assetId: asset.id } : {}), url: imageMap.localUrl },
              })
            : target.phase === 'song'
              ? await client.songCover.updateMany({
                  where: { id: target.id, assetId: null, publicUrl: target.url },
                  data: {
                    ...(asset?.id ? { assetId: asset.id } : {}),
                    publicUrl: imageMap.localUrl,
                    storageKey: extractStorageKeyFromUploadUrl(imageMap.localUrl),
                  },
                })
              : await client.albumCover.updateMany({
                  where: { id: target.id, assetId: null, publicUrl: target.url },
                  data: {
                    ...(asset?.id ? { assetId: asset.id } : {}),
                    publicUrl: imageMap.localUrl,
                    storageKey: extractStorageKeyFromUploadUrl(imageMap.localUrl),
                  },
                })
    if (update.count !== 1) {
      if (createdAssetId) await releaseMediaAsset(createdAssetId).catch(() => undefined)
      return { status: 'skipped' as const, reason: '记录已被其他操作修改', repair: null }
    }
  }

  const repair = await enqueueMissingImageMapThumbnail(imageMapId, {
    client,
    mode,
    fallbackStorageKeys: [target.storageKey],
  })
  return {
    status:
      repair.status === 'failed'
        ? ('failed' as const)
        : repair.status === 'missing-source' ||
            repair.status === 'deleted' ||
            repair.status === 'not-found'
          ? ('skipped' as const)
          : ('processed' as const),
    reason: repair.reason || repair.status,
    repair,
  }
}

export async function bindLegacyMediaBatch(
  options: BatchOptions,
  client: PrismaClient = defaultPrisma
) {
  const limit = clampBatchSize(options.batchSize)
  const loaded = await loadLegacyPage(client, options.cursor, limit)
  const details: MaintenanceDetail[] = []
  let processed = 0,
    skipped = 0,
    failed = 0,
    queued = 0,
    alreadyQueued = 0,
    skippedMissingSource = 0
  for (const target of loaded.page) {
    try {
      const result = await processLegacyTarget(client, target, options.mode)
      if (result.status === 'processed') processed++
      else if (result.status === 'skipped') {
        skipped++
        if (result.reason === '本地原图不存在' || result.repair?.status === 'missing-source')
          skippedMissingSource++
      } else failed++
      if (result.repair?.status === 'queued') queued++
      if (
        result.repair &&
        result.repair.status !== 'queued' &&
        result.repair.status !== 'missing-source' &&
        result.repair.status !== 'failed' &&
        result.repair.status !== 'deleted' &&
        result.repair.status !== 'not-found'
      )
        alreadyQueued++
      details.push({
        id: target.id,
        status: result.status,
        reason: result.reason,
        type:
          target.phase === 'gallery'
            ? 'gallery'
            : target.phase === 'song'
              ? 'song'
              : target.phase === 'album'
                ? 'album'
                : undefined,
      })
    } catch (error) {
      failed++
      details.push({
        id: target.id,
        status: 'failed',
        reason: error instanceof Error ? error.message : '绑定失败',
      })
    }
  }
  return makeBatchResult(
    details,
    { scanned: loaded.page.length, processed, skipped, failed },
    loaded.nextCursor,
    loaded.hasMore,
    { operation: 'bind-legacy', mode: options.mode, type: 'all' },
    { queued, alreadyQueued, skippedMissingSource }
  )
}

export async function reconcileMediaAssetsBatch(
  options: BatchOptions,
  client: PrismaClient = defaultPrisma
) {
  return reconcileAssetPage(options, client)
}

async function loadLocalizePage(
  client: PrismaClient,
  type: MaintenanceType,
  cursor: string | undefined,
  limit: number
) {
  const phases: Array<'gallery' | 'song' | 'album'> =
    type === 'gallery'
      ? ['gallery']
      : type === 'song'
        ? ['song']
        : type === 'album'
          ? ['album']
          : ['gallery', 'song', 'album']
  const decoded = type === 'all' && cursor ? decodeLegacyCursor(cursor) : null
  if (
    decoded &&
    !(['gallery', 'song', 'album'] as const).includes(decoded.phase as 'gallery' | 'song' | 'album')
  ) {
    throw new MediaMaintenanceRequestError(400, 'localize 游标无效')
  }
  const start = decoded
    ? Math.max(
        0,
        ['gallery', 'song', 'album'].indexOf(decoded.phase as 'gallery' | 'song' | 'album')
      )
    : 0
  for (let index = start; index < phases.length; index++) {
    const phase = phases[index]
    const after =
      type === 'all' && decoded && phases[index] === decoded.phase
        ? decoded.id
        : type !== 'all'
          ? cursor
          : null
    const rows =
      phase === 'gallery'
        ? await client.galleryImage.findMany({
            where: {
              ...(after ? { id: { gt: after } } : {}),
              assetId: null,
              url: { startsWith: 'http' },
              gallery: { deletedAt: null },
            },
            select: { id: true, url: true },
            orderBy: { id: 'asc' },
            take: limit + 1,
          })
        : phase === 'song'
          ? await client.songCover.findMany({
              where: {
                ...(after ? { id: { gt: after } } : {}),
                assetId: null,
                publicUrl: { startsWith: 'http' },
                song: { deletedAt: null },
              },
              select: { id: true, publicUrl: true },
              orderBy: { id: 'asc' },
              take: limit + 1,
            })
          : await client.albumCover.findMany({
              where: {
                ...(after ? { id: { gt: after } } : {}),
                assetId: null,
                publicUrl: { startsWith: 'http' },
                album: { deletedAt: null },
              },
              select: { id: true, publicUrl: true },
              orderBy: { id: 'asc' },
              take: limit + 1,
            })
    const targets = rows.map((row) => ({
      type: phase,
      id: row.id,
      url: 'url' in row ? row.url || row.publicUrl : row.publicUrl,
    }))
    if (targets.length) {
      const page = targets.slice(0, limit)
      const hasMore = targets.length > limit || index + 1 < phases.length
      const nextCursor =
        targets.length > limit
          ? type === 'all'
            ? encodeLegacyCursor({ phase, id: page[page.length - 1].id })
            : page[page.length - 1].id
          : index + 1 < phases.length
            ? type === 'all'
              ? encodeLegacyCursor({ phase: phases[index + 1] as LegacyPhase, id: null })
              : null
            : null
      return { page, hasMore, nextCursor }
    }
  }
  return {
    page: [] as Array<{ type: 'gallery' | 'song' | 'album'; id: string; url: string }>,
    hasMore: false,
    nextCursor: null,
  }
}

export async function localizeMediaAssetsBatch(
  options: BatchOptions,
  client: PrismaClient = defaultPrisma
): Promise<MaintenanceBatchResult> {
  const type = options.type || 'all'
  if (options.mode === 'apply') {
    if (!options.operatorUid) {
      throw new MediaMaintenanceRequestError(403, '本地化操作缺少有效操作者')
    }
    const owner = await client.user.findFirst({
      where: { uid: options.operatorUid, deletedAt: null },
      select: { uid: true },
    })
    if (!owner) throw new MediaMaintenanceRequestError(403, '媒体资源所有者不存在或已删除')
  }
  const limit = clampBatchSize(options.batchSize)
  const loaded = await loadLocalizePage(client, type, options.cursor, limit)
  const details: MaintenanceDetail[] = []
  let processed = 0,
    skipped = 0,
    failed = 0
  let queued = 0,
    alreadyQueued = 0
  for (const target of loaded.page) {
    let localizedAssetId: string | null = null
    try {
      if (options.mode === 'dry-run') {
        processed++
        details.push({ id: target.id, status: 'processed', reason: '待本地化', type: target.type })
        continue
      }
      const localized = await localizeImageUrlAsMediaAsset(target.url, {
        namespace: `${target.type}s/localized`,
        ownerUid: options.operatorUid,
        requireOwner: true,
        fallbackName: `${target.type}-${target.id}.jpg`,
      })
      localizedAssetId = localized.assetId
      const update =
        target.type === 'gallery'
          ? await client.galleryImage.updateMany({
              where: { id: target.id, assetId: null, url: target.url },
              data: { assetId: localized.assetId, url: localized.publicUrl },
            })
          : target.type === 'song'
            ? await client.songCover.updateMany({
                where: {
                  id: target.id,
                  assetId: null,
                  publicUrl: target.url,
                  variantStatus: { in: ['pending', 'failed', 'completed'] },
                },
                data: {
                  assetId: localized.assetId,
                  storageKey: localized.storageKey,
                  publicUrl: localized.publicUrl,
                  variantStatus: 'pending',
                  lastError: null,
                },
              })
            : await client.albumCover.updateMany({
                where: {
                  id: target.id,
                  assetId: null,
                  publicUrl: target.url,
                  variantStatus: { in: ['pending', 'failed', 'completed'] },
                },
                data: {
                  assetId: localized.assetId,
                  storageKey: localized.storageKey,
                  publicUrl: localized.publicUrl,
                  variantStatus: 'pending',
                  lastError: null,
                },
              })
      if (update.count !== 1) {
        await Promise.resolve(releaseMediaAsset(localizedAssetId)).catch(() => undefined)
        skipped++
        details.push({
          id: target.id,
          status: 'skipped',
          reason: '记录已被其他操作修改',
          type: target.type,
        })
        continue
      }

      let thumbnailQueued = false
      if (target.type === 'gallery') {
        // createOrReuseUploadedAsset always supplies imageMapId in production;
        // keep the row update successful even if a test/dry adapter omits it.
        if (localized.imageMapId) {
          const repair = await enqueueMissingImageMapThumbnail(localized.imageMapId, {
            client,
            mode: 'apply',
            fallbackStorageKeys: [localized.storageKey],
          })
          if (repair.status === 'failed' || repair.status === 'missing-source') {
            failed++
            details.push({
              id: target.id,
              status: 'failed',
              reason: repair.reason || repair.status,
              type: target.type,
            })
            continue
          }
          thumbnailQueued = repair.status === 'queued'
        }
      } else {
        thumbnailQueued = await enqueueMusicCoverThumbnail(
          target.type === 'song' ? 'songCover' : 'albumCover',
          target.id,
          localized.storageKey
        )
      }
      if (thumbnailQueued) queued++
      else alreadyQueued++
      processed++
      details.push({
        id: target.id,
        status: 'processed',
        reason: thumbnailQueued ? '本地化并已入队缩略图' : '本地化，缩略图任务已存在或不可入队',
        type: target.type,
      })
    } catch (error) {
      if (localizedAssetId)
        await Promise.resolve(releaseMediaAsset(localizedAssetId)).catch(() => undefined)
      failed++
      details.push({
        id: target.id,
        status: 'failed',
        reason: error instanceof Error ? error.message : '本地化失败',
        type: target.type,
      })
    }
  }
  return makeBatchResult(
    details,
    { scanned: loaded.page.length, processed, skipped, failed },
    loaded.nextCursor,
    loaded.hasMore,
    { operation: 'localize', mode: options.mode, type },
    { queued, alreadyQueued }
  )
}

export async function repairMissingThumbnailsBatch(
  options: BatchOptions,
  client: PrismaClient = defaultPrisma
) {
  const limit = clampBatchSize(options.batchSize)
  const rows = await client.imageMap.findMany({
    where: {
      deletedAt: null,
      ...(options.cursor ? { id: { gt: options.cursor } } : {}),
      OR: [
        { thumbnailUrl: null, variantStatus: { in: ['pending', 'failed', 'completed'] } },
        { variantStatus: 'processing' },
      ],
    },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: limit + 1,
  })
  const { page, hasMore, nextCursor } = pageRows(rows, limit, (row) => row.id, options.cursor)
  const details: MaintenanceDetail[] = []
  let queued = 0
  let alreadyQueued = 0
  let skippedMissingSource = 0
  let failed = 0

  for (const row of page) {
    try {
      const repair = await enqueueMissingImageMapThumbnail(row.id, {
        client,
        mode: options.mode,
      })
      if (repair.status === 'queued') queued++
      else if (repair.status === 'already-queued' || repair.status === 'already-complete')
        alreadyQueued++
      else if (repair.status === 'missing-source' || repair.status === 'deleted')
        skippedMissingSource++
      else failed++
      details.push({
        id: row.id,
        status:
          repair.status === 'failed'
            ? 'failed'
            : repair.status === 'missing-source' || repair.status === 'deleted'
              ? 'skipped'
              : 'processed',
        reason: repair.reason || repair.status,
      })
    } catch (error) {
      failed++
      details.push({
        id: row.id,
        status: 'failed',
        reason: error instanceof Error ? error.message : '修复失败',
      })
    }
  }
  return makeBatchResult(
    details,
    {
      scanned: page.length,
      processed: queued,
      skipped: alreadyQueued + skippedMissingSource,
      failed,
    },
    nextCursor,
    hasMore,
    { operation: 'repair-thumbnails', mode: options.mode, type: 'all' },
    { queued, alreadyQueued, skippedMissingSource }
  )
}

async function collectMaintenanceReferencedKeys(client: PrismaClient) {
  const references = await collectMediaReferences(client)
  const keys = new Set(references.storageKeys.keys())
  const now = new Date()
  const [assets, maps, sessions] = await Promise.all([
    client.mediaAsset.findMany({
      where: {
        OR: [
          { status: { not: 'deleted' } },
          { session: { status: 'open', expiresAt: { gt: now } } },
        ],
      },
      select: { storageKey: true, publicUrl: true, imageMap: { select: { localUrl: true } } },
      orderBy: { id: 'asc' },
    }),
    client.imageMap.findMany({
      select: { id: true, localUrl: true, thumbnailUrl: true, variantStatus: true },
      orderBy: { id: 'asc' },
    }),
    client.uploadSession.findMany({
      where: { status: 'open', expiresAt: { gt: now } },
      select: {
        assets: {
          select: { storageKey: true, publicUrl: true, imageMap: { select: { localUrl: true } } },
        },
      },
      orderBy: { id: 'asc' },
    }),
  ])
  for (const asset of assets)
    for (const value of [asset.storageKey, asset.publicUrl, asset.imageMap?.localUrl]) {
      const key = normalizeStorageKey(value)
      if (key) keys.add(key)
    }
  for (const map of maps) {
    for (const value of [map.localUrl, map.thumbnailUrl]) {
      const key = normalizeStorageKey(value)
      if (key) keys.add(key)
    }
    if (map.variantStatus === 'processing') keys.add(`variants/${map.id}/1080h.webp`)
  }
  for (const session of sessions)
    for (const asset of session.assets)
      for (const value of [asset.storageKey, asset.publicUrl, asset.imageMap?.localUrl]) {
        const key = normalizeStorageKey(value)
        if (key) keys.add(key)
      }
  return keys
}

export async function scanMediaMaintenance(
  options: { mode?: 'strict' | 'business'; limit?: number; type?: MaintenanceType },
  client: PrismaClient = defaultPrisma
): Promise<MediaMaintenanceScanResult> {
  const limit = clampBatchSize(options.limit)
  const health = await scanMediaHealth(client, {
    uploadDir: defaultUploadsDir,
    mode: options.mode || 'strict',
    limit,
  })
  const [
    unboundMediaAssets,
    missingThumbnails,
    legacyUrlOnlyRecords,
    remoteCandidates,
    activeUploadSessions,
    orphanFiles,
    missingThumbnailRows,
  ] = await Promise.all([
    client.mediaAsset.count({ where: { status: { not: 'deleted' }, imageMapId: null } }),
    client.imageMap.count({ where: { deletedAt: null, thumbnailUrl: null } }),
    Promise.all([
      client.galleryImage.count({
        where: { assetId: null, url: { startsWith: '/uploads/' }, gallery: { deletedAt: null } },
      }),
      client.event.count({
        where: { coverAssetId: null, coverUrl: { startsWith: '/uploads/' }, deletedAt: null },
      }),
      client.eventPoster.count({
        where: { assetId: null, url: { startsWith: '/uploads/' }, event: { deletedAt: null } },
      }),
      client.songCover.count({
        where: {
          assetId: null,
          song: { deletedAt: null },
          OR: [{ publicUrl: { startsWith: '/uploads/' } }, { storageKey: { not: '' } }],
        },
      }),
      client.albumCover.count({
        where: {
          assetId: null,
          album: { deletedAt: null },
          OR: [{ publicUrl: { startsWith: '/uploads/' } }, { storageKey: { not: '' } }],
        },
      }),
    ]).then((values) => values.reduce((sum, value) => sum + value, 0)),
    Promise.all([
      client.galleryImage.count({
        where: { assetId: null, url: { startsWith: 'http' }, gallery: { deletedAt: null } },
      }),
      client.event.count({
        where: { coverAssetId: null, coverUrl: { startsWith: 'http' }, deletedAt: null },
      }),
      client.eventPoster.count({
        where: { assetId: null, url: { startsWith: 'http' }, event: { deletedAt: null } },
      }),
      client.songCover.count({
        where: { assetId: null, publicUrl: { startsWith: 'http' }, song: { deletedAt: null } },
      }),
      client.albumCover.count({
        where: { assetId: null, publicUrl: { startsWith: 'http' }, album: { deletedAt: null } },
      }),
    ]).then((values) => values.reduce((sum, value) => sum + value, 0)),
    client.uploadSession.count({ where: { status: 'open', expiresAt: { gt: new Date() } } }),
    (async () => {
      const files = await scanUploadFiles(defaultUploadsDir, { includeVariants: false })
      const referenced = await collectMaintenanceReferencedKeys(client)
      return files
        .filter((file) => !referenced.has(file.storageKey))
        .map((file) => ({ sizeBytes: file.sizeBytes }))
    })(),
    client.imageMap.findMany({
      where: { deletedAt: null, thumbnailUrl: null },
      select: { id: true, variantStatus: true },
      orderBy: { id: 'asc' },
      take: limit,
    }),
  ])
  const details = [
    ...missingThumbnailRows.map((item) => ({
      id: item.id,
      status: 'skipped' as const,
      reason: item.variantStatus === 'processing' ? '已在处理' : '缺失缩略图',
    })),
    ...health.missingLocalFiles
      .slice(0, MAX_DETAILS)
      .map((item) => ({ id: item.id, status: 'skipped' as const, reason: '本地文件缺失' })),
    ...health.unusedMediaRecords
      .slice(0, MAX_DETAILS)
      .map((item) => ({ id: item.id, status: 'skipped' as const, reason: '未发现业务引用' })),
  ]
  const result = makeBatchResult(
    details,
    {
      scanned:
        missingThumbnails +
        health.summary.missingLocalFiles +
        health.summary.unusedMediaAssets +
        health.summary.unusedImageMaps,
      processed: 0,
      skipped: details.length,
      failed: 0,
    },
    null,
    false,
    { operation: 'scan', mode: options.mode || 'strict', type: options.type || 'all' }
  ) as MediaMaintenanceScanResult
  result.counts = {
    unboundMediaAssets,
    legacyUrlOnlyRecords,
    missingThumbnails,
    remoteCandidates,
    orphanFiles: orphanFiles.length,
    orphanBytes: orphanFiles.reduce((total, file) => total + file.sizeBytes, 0),
    sharedImageMaps: health.sharedImageMaps.length,
    activeUploadSessions,
    missingLocalFiles: health.summary.missingLocalFiles,
    retiredMedia: health.retiredMedia.length,
  }
  result.health = health
  return result
}

export async function previewOrphanMediaBatch(
  options: {
    cursor?: string
    batchSize?: number
    olderThanHours?: number
    includeVariants?: boolean
  },
  client: PrismaClient = defaultPrisma,
  uploadDir = defaultUploadsDir,
  operatorUid = ''
): Promise<OrphanPreviewResult> {
  const limit = clampBatchSize(options.batchSize)
  const cutoffMs = Date.now() - (options.olderThanHours ?? 1) * 60 * 60 * 1000
  const [files, referenced] = await Promise.all([
    scanUploadFiles(uploadDir, {
      includeVariants: options.includeVariants ?? false,
      olderThanMs: cutoffMs,
    }),
    collectMaintenanceReferencedKeys(client),
  ])
  const candidates = files.filter(
    (file) =>
      !referenced.has(file.storageKey) && (!options.cursor || file.storageKey > options.cursor)
  )
  const page = candidates.slice(0, limit)
  const entries = await Promise.all(
    page.map(async (file) => ({
      storageKey: file.storageKey,
      sizeBytes: file.sizeBytes,
      mtimeMs: file.mtime.getTime(),
      sha256: await sha256File(file.absolutePath),
    }))
  )
  const hasMore = candidates.length > page.length
  const nextCursor = page.length ? page[page.length - 1].storageKey : options.cursor || null
  const previewToken = encodeToken({
    version: PREVIEW_TOKEN_VERSION,
    operatorUid,
    expiresAt: Date.now() + PREVIEW_TOKEN_TTL_MS,
    cutoffMs,
    includeVariants: options.includeVariants ?? false,
    entries,
  })
  return {
    operation: 'orphans/preview',
    mode: 'dry-run',
    type: 'all',
    scanned: files.length,
    processed: page.length,
    skipped: candidates.length - page.length,
    failed: 0,
    nextCursor,
    hasMore,
    details: page.map((file) => ({
      id: file.storageKey,
      status: 'processed',
      reason: `${file.sizeBytes} bytes`,
    })),
    previewToken,
    storageKeys: entries.map((entry) => entry.storageKey),
    entries,
    totalBytes: entries.reduce((total, entry) => total + entry.sizeBytes, 0),
    includeVariants: options.includeVariants ?? false,
  }
}

async function removeEmptyParents(filePath: string, uploadDir: string) {
  let current = path.dirname(filePath)
  const root = path.resolve(uploadDir)
  while (path.resolve(current).startsWith(`${root}${path.sep}`)) {
    try {
      await fs.rmdir(current)
    } catch {
      break
    }
    current = path.dirname(current)
  }
}

export async function deleteOrphanMediaBatch(
  options: { previewToken: string; storageKeys: string[] },
  client: PrismaClient = defaultPrisma,
  uploadDir = defaultUploadsDir,
  operatorUid = ''
): Promise<OrphanDeleteResult> {
  const tokenPayload = decodeToken(options.previewToken, operatorUid)
  const entries = tokenPayload.entries
  const requested = options.storageKeys.map(assertSafeStorageKey)
  if (
    new Set(requested).size !== requested.length ||
    requested.some((key) => !entries.some((entry) => entry.storageKey === key))
  )
    throw new MediaMaintenanceRequestError(409, '删除目标不属于当前预览结果')
  const [files, referenced] = await Promise.all([
    scanUploadFiles(uploadDir, {
      includeVariants: tokenPayload.includeVariants,
      olderThanMs: tokenPayload.cutoffMs,
    }),
    collectMaintenanceReferencedKeys(client),
  ])
  const fileByKey = new Map(files.map((file) => [file.storageKey, file]))
  const details: MaintenanceDetail[] = []
  const deletedKeys: string[] = []
  let deletedBytes = 0,
    skipped = 0,
    failed = 0
  for (const key of requested) {
    const file = fileByKey.get(key)
    const entry = entries.find((candidate) => candidate.storageKey === key)
    if (
      !file ||
      !entry ||
      file.sizeBytes !== entry.sizeBytes ||
      file.mtime.getTime() !== entry.mtimeMs
    ) {
      skipped++
      details.push({ id: key, status: 'skipped', reason: '文件已变化、不存在或未达到年龄限制' })
      continue
    }
    if (referenced.has(key)) {
      skipped++
      details.push({ id: key, status: 'skipped', reason: '预览后已产生引用' })
      continue
    }
    const filePath = resolveUploadPathByStorageKey(key, uploadDir)
    if (!filePath) {
      skipped++
      details.push({ id: key, status: 'skipped', reason: '路径校验失败' })
      continue
    }
    try {
      if ((await sha256File(file.absolutePath)) !== entry.sha256) {
        skipped++
        details.push({ id: key, status: 'skipped', reason: '预览后文件已变化' })
        continue
      }
      await fs.rm(filePath)
      deletedKeys.push(key)
      deletedBytes += file.sizeBytes
      details.push({ id: key, status: 'processed' })
      await removeEmptyParents(filePath, uploadDir)
    } catch (error) {
      failed++
      details.push({
        id: key,
        status: 'failed',
        reason: error instanceof Error ? error.message : '删除失败',
      })
    }
  }
  return {
    operation: 'orphans/delete',
    mode: 'apply',
    type: 'all',
    scanned: files.length,
    processed: deletedKeys.length,
    skipped,
    failed,
    nextCursor: null,
    hasMore: false,
    details,
    deletedBytes,
    deletedKeys,
  }
}
