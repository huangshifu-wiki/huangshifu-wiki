import fs from 'fs/promises'
import path from 'path'
import type { PrismaClient } from '@prisma/client'
import { buildUploadPublicUrl, resolveUploadPathByStorageKey } from '../uploadPath'
import { isUploadSessionExpired, safeDeleteUploadFileByStorageKey } from '../utils/upload'
import { CleanupTrigger, variantCleanup } from './variantCleanup.service'
import { extractStorageKeyFromUploadUrl, normalizeStorageKey } from './mediaRestoreReport.service'

export type MediaHealthScanMode = 'strict' | 'business'
export type MediaHealthRecordType = 'mediaAsset' | 'imageMap'
export type MediaHealthBlockReason =
  | 'referenced'
  | 'shared_image_map'
  | 'processing'
  | 'not_found'
  | 'already_deleted'
  | 'active_upload_session'

export type MediaHealthReference = {
  source: string
  id?: string
  field: string
  value: string
}

export type MediaHealthMissingLocalFile = {
  recordType: MediaHealthRecordType
  id: string
  storageKey: string
  publicUrl: string
  expectedPath: string
  label: string
  references: MediaHealthReference[]
  canCleanup: boolean
  blockedReasons: MediaHealthBlockReason[]
}

export type MediaHealthUnusedRecord = {
  recordType: MediaHealthRecordType
  id: string
  storageKey?: string
  publicUrl?: string
  localUrl?: string
  label: string
  canCleanup: boolean
  blockedReasons: MediaHealthBlockReason[]
}

export type MediaHealthScanResult = {
  generatedAt: string
  mode: MediaHealthScanMode
  summary: {
    missingLocalFiles: number
    unusedMediaAssets: number
    unusedImageMaps: number
    cleanupCandidates: number
    blockedRecords: number
  }
  missingLocalFiles: MediaHealthMissingLocalFile[]
  unusedMediaRecords: MediaHealthUnusedRecord[]
}

export type MediaHealthCleanupTarget = {
  recordType: MediaHealthRecordType
  id: string
}

export type MediaHealthCleanupResult = {
  recordType: MediaHealthRecordType
  id: string
  success: boolean
  skipped: boolean
  blockedReasons: MediaHealthBlockReason[]
  message: string
}

type ReferenceMap = Map<string, MediaHealthReference[]>

type ReferenceIndex = {
  storageKeys: ReferenceMap
  mediaAssetIds: ReferenceMap
  urls: ReferenceMap
}

type MediaAssetReferenceTarget = {
  id: string
  storageKey: string
  publicUrl: string
  session: {
    status: string
    expiresAt: Date
  } | null
}

type ImageMapReferenceTarget = {
  id: string
  localUrl: string
  externalUrl: string | null
  s3Url: string | null
  thumbnailUrl: string | null
}

function createReferenceIndex(): ReferenceIndex {
  return {
    storageKeys: new Map(),
    mediaAssetIds: new Map(),
    urls: new Map(),
  }
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function uniqueReferences(references: MediaHealthReference[]) {
  return [
    ...new Map(
      references.map((reference) => [
        `${reference.source}:${reference.id || ''}:${reference.field}:${reference.value}`,
        reference,
      ])
    ).values(),
  ]
}

function addReferenceToMap(
  references: ReferenceMap,
  key: string | null | undefined,
  value: string | null | undefined,
  reference: Omit<MediaHealthReference, 'value'>
) {
  if (!key || !value) return

  const current = references.get(key) || []
  current.push({ ...reference, value })
  references.set(key, current)
}

function addStorageKeyReference(
  references: ReferenceIndex,
  value: string | null | undefined,
  reference: Omit<MediaHealthReference, 'value'>
) {
  addReferenceToMap(references.storageKeys, normalizeStorageKey(value), value, reference)
}

function normalizeReferenceUrl(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized || null
}

function addUrlReference(
  references: ReferenceIndex,
  value: string | null | undefined,
  reference: Omit<MediaHealthReference, 'value'>
) {
  addReferenceToMap(references.urls, normalizeReferenceUrl(value), value, reference)
}

function addUrlFieldReference(
  references: ReferenceIndex,
  value: string | null | undefined,
  reference: Omit<MediaHealthReference, 'value'>
) {
  addStorageKeyReference(references, value, reference)
  addUrlReference(references, value, reference)
}

function addMediaAssetReference(
  references: ReferenceIndex,
  assetId: string | null | undefined,
  reference: Omit<MediaHealthReference, 'value'>
) {
  addReferenceToMap(references.mediaAssetIds, assetId, assetId, reference)
}

function addUrlsFromText(
  references: ReferenceIndex,
  value: string | null | undefined,
  reference: Omit<MediaHealthReference, 'value'>
) {
  if (!value) return

  for (const match of value.matchAll(/https?:\/\/[^\s"'`)<>\\]+|\/uploads\/[^\s"'`)<>\\]+/g)) {
    addUrlFieldReference(references, match[0], reference)
  }
}

async function collectPagedText<T extends Record<string, string | null>>(
  load: (skip: number) => Promise<T[]>,
  references: ReferenceIndex,
  pageSize: number,
  fields: Array<keyof T>,
  getReference: (row: T, field: keyof T) => Omit<MediaHealthReference, 'value'>
) {
  for (let skip = 0; ; skip += pageSize) {
    const rows = await load(skip)
    for (const row of rows) {
      for (const field of fields) {
        addUrlsFromText(references, row[field], getReference(row, field))
      }
    }

    if (rows.length < pageSize) break
  }
}

async function collectBusinessReferences(prisma: PrismaClient) {
  const references = createReferenceIndex()
  const [users, galleryImages, events, eventPosters, songCovers, albumCovers] = await Promise.all([
    prisma.user.findMany({
      where: { photoURL: { not: null }, deletedAt: null },
      select: { uid: true, photoURL: true },
    }),
    prisma.galleryImage.findMany({
      select: { id: true, url: true, assetId: true },
    }),
    prisma.event.findMany({
      where: { deletedAt: null },
      select: { id: true, coverUrl: true, coverAssetId: true },
    }),
    prisma.eventPoster.findMany({
      where: { event: { deletedAt: null } },
      select: { id: true, url: true, assetId: true },
    }),
    prisma.songCover.findMany({
      select: { id: true, storageKey: true, publicUrl: true, thumbnailUrl: true, assetId: true },
    }),
    prisma.albumCover.findMany({
      select: { id: true, storageKey: true, publicUrl: true, thumbnailUrl: true, assetId: true },
    }),
  ])

  for (const item of users) {
    addUrlFieldReference(references, item.photoURL, {
      source: 'User',
      id: item.uid,
      field: 'photoURL',
    })
  }
  for (const item of galleryImages) {
    addUrlFieldReference(references, item.url, {
      source: 'GalleryImage',
      id: item.id,
      field: 'url',
    })
    addMediaAssetReference(references, item.assetId, {
      source: 'GalleryImage',
      id: item.id,
      field: 'assetId',
    })
  }
  for (const item of events) {
    addUrlFieldReference(references, item.coverUrl, {
      source: 'Event',
      id: item.id,
      field: 'coverUrl',
    })
    addMediaAssetReference(references, item.coverAssetId, {
      source: 'Event',
      id: item.id,
      field: 'coverAssetId',
    })
  }
  for (const item of eventPosters) {
    addUrlFieldReference(references, item.url, {
      source: 'EventPoster',
      id: item.id,
      field: 'url',
    })
    addMediaAssetReference(references, item.assetId, {
      source: 'EventPoster',
      id: item.id,
      field: 'assetId',
    })
  }
  for (const item of songCovers) {
    addStorageKeyReference(references, item.storageKey, {
      source: 'SongCover',
      id: item.id,
      field: 'storageKey',
    })
    addUrlFieldReference(references, item.publicUrl, {
      source: 'SongCover',
      id: item.id,
      field: 'publicUrl',
    })
    addUrlFieldReference(references, item.thumbnailUrl, {
      source: 'SongCover',
      id: item.id,
      field: 'thumbnailUrl',
    })
    addMediaAssetReference(references, item.assetId, {
      source: 'SongCover',
      id: item.id,
      field: 'assetId',
    })
  }
  for (const item of albumCovers) {
    addStorageKeyReference(references, item.storageKey, {
      source: 'AlbumCover',
      id: item.id,
      field: 'storageKey',
    })
    addUrlFieldReference(references, item.publicUrl, {
      source: 'AlbumCover',
      id: item.id,
      field: 'publicUrl',
    })
    addUrlFieldReference(references, item.thumbnailUrl, {
      source: 'AlbumCover',
      id: item.id,
      field: 'thumbnailUrl',
    })
    addMediaAssetReference(references, item.assetId, {
      source: 'AlbumCover',
      id: item.id,
      field: 'assetId',
    })
  }

  await collectCurrentTextReferences(prisma, references)
  return references
}

async function collectStrictReferences(prisma: PrismaClient) {
  const references = await collectBusinessReferences(prisma)
  const pageSize = 500

  const [wikiEmbeddings, postEmbeddings] = await Promise.all([
    prisma.wikiImageEmbedding.findMany({ select: { id: true, imageUrl: true } }),
    prisma.postImageEmbedding.findMany({ select: { id: true, imageUrl: true } }),
  ])

  for (const item of wikiEmbeddings) {
    addUrlFieldReference(references, item.imageUrl, {
      source: 'WikiImageEmbedding',
      id: item.id,
      field: 'imageUrl',
    })
  }
  for (const item of postEmbeddings) {
    addUrlFieldReference(references, item.imageUrl, {
      source: 'PostImageEmbedding',
      id: item.id,
      field: 'imageUrl',
    })
  }

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

  return references
}

async function collectCurrentTextReferences(prisma: PrismaClient, references: ReferenceIndex) {
  const pageSize = 500

  await collectPagedText(
    (skip) =>
      prisma.wikiPage.findMany({
        skip,
        take: pageSize,
        where: { deletedAt: null },
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
      prisma.post.findMany({
        skip,
        take: pageSize,
        where: { deletedAt: null },
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
      prisma.event.findMany({
        skip,
        take: pageSize,
        where: { deletedAt: null },
        select: { id: true, content: true },
        orderBy: { id: 'asc' },
      }),
    references,
    pageSize,
    ['content'],
    (row, field) => ({ source: 'Event', id: row.id, field: String(field) })
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
        where: { deletedAt: null },
        select: { id: true, content: true, link: true },
        orderBy: { id: 'asc' },
      }),
    references,
    pageSize,
    ['content', 'link'],
    (row, field) => ({ source: 'Announcement', id: row.id, field: String(field) })
  )
}

function collectReferences(prisma: PrismaClient, mode: MediaHealthScanMode) {
  return mode === 'business' ? collectBusinessReferences(prisma) : collectStrictReferences(prisma)
}

function refsForAsset(asset: MediaAssetReferenceTarget, references: ReferenceIndex) {
  const keys = uniqueStrings([
    normalizeStorageKey(asset.storageKey),
    normalizeStorageKey(asset.publicUrl),
  ])
  return [
    ...keys.flatMap((key) => references.storageKeys.get(key) || []),
    ...(references.mediaAssetIds.get(asset.id) || []),
  ]
}

function refsForImageMap(imageMap: ImageMapReferenceTarget, references: ReferenceIndex) {
  const keys = uniqueStrings([
    normalizeStorageKey(imageMap.localUrl),
    normalizeStorageKey(imageMap.externalUrl || undefined),
    normalizeStorageKey(imageMap.s3Url || undefined),
    normalizeStorageKey(imageMap.thumbnailUrl || undefined),
  ])
  const urls = uniqueStrings([
    imageMap.localUrl,
    imageMap.externalUrl,
    imageMap.s3Url,
    imageMap.thumbnailUrl,
  ])

  const refs = [
    ...keys.flatMap((key) => references.storageKeys.get(key) || []),
    ...urls.flatMap((url) => references.urls.get(normalizeReferenceUrl(url)!) || []),
  ]

  return uniqueReferences(refs)
}

function hasActiveUploadSession(asset: MediaAssetReferenceTarget) {
  return Boolean(
    asset.session &&
    asset.session.status === 'open' &&
    !isUploadSessionExpired(asset.session.expiresAt)
  )
}

function buildAssetBlockReasons(
  asset: MediaAssetReferenceTarget,
  references: MediaHealthReference[]
): MediaHealthBlockReason[] {
  const reasons: MediaHealthBlockReason[] = []
  if (references.length > 0) reasons.push('referenced')
  if (hasActiveUploadSession(asset)) reasons.push('active_upload_session')
  return reasons
}

async function existsByStorageKey(storageKey: string, uploadDir: string) {
  const filePath = resolveUploadPathByStorageKey(storageKey, uploadDir)
  if (!filePath) return { exists: false, expectedPath: path.join(uploadDir, storageKey) }

  try {
    await fs.access(filePath)
    return { exists: true, expectedPath: filePath }
  } catch {
    return { exists: false, expectedPath: filePath }
  }
}

function buildSummary(
  missingLocalFiles: MediaHealthMissingLocalFile[],
  unusedMediaRecords: MediaHealthUnusedRecord[]
) {
  const records = new Map<string, MediaHealthMissingLocalFile | MediaHealthUnusedRecord>()
  for (const item of [...missingLocalFiles, ...unusedMediaRecords]) {
    records.set(`${item.recordType}:${item.id}`, item)
  }

  const cleanupCandidates = [...records.values()].filter((item) => item.canCleanup).length
  const blockedRecords = [...records.values()].filter((item) => !item.canCleanup).length

  return {
    missingLocalFiles: missingLocalFiles.length,
    unusedMediaAssets: unusedMediaRecords.filter((item) => item.recordType === 'mediaAsset').length,
    unusedImageMaps: unusedMediaRecords.filter((item) => item.recordType === 'imageMap').length,
    cleanupCandidates,
    blockedRecords,
  }
}

function limitScanDetails(result: MediaHealthScanResult, limit?: number) {
  if (!limit) return result

  return {
    ...result,
    missingLocalFiles: result.missingLocalFiles.slice(0, limit),
    unusedMediaRecords: result.unusedMediaRecords.slice(0, limit),
  }
}

export async function scanMediaHealth(
  prisma: PrismaClient,
  options: { uploadDir: string; mode?: MediaHealthScanMode; limit?: number }
): Promise<MediaHealthScanResult> {
  const mode = options.mode || 'strict'
  const detailLimit =
    options.limit === undefined ? undefined : Math.max(1, Math.min(options.limit, 1000))
  const references = await collectReferences(prisma, mode)

  const [mediaAssets, imageMaps] = await Promise.all([
    prisma.mediaAsset.findMany({
      where: { status: { not: 'deleted' } },
      select: {
        id: true,
        storageKey: true,
        publicUrl: true,
        fileName: true,
        session: {
          select: {
            status: true,
            expiresAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.imageMap.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        localUrl: true,
        externalUrl: true,
        s3Url: true,
        thumbnailUrl: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const missingLocalFiles: MediaHealthMissingLocalFile[] = []
  const unusedMediaRecords: MediaHealthUnusedRecord[] = []

  for (const asset of mediaAssets) {
    const refs = refsForAsset(asset, references)
    const storageKey = normalizeStorageKey(asset.storageKey) || asset.storageKey
    const fileState = await existsByStorageKey(storageKey, options.uploadDir)
    const blockedReasons = buildAssetBlockReasons(asset, refs)
    const canCleanup = blockedReasons.length === 0

    if (!fileState.exists) {
      missingLocalFiles.push({
        recordType: 'mediaAsset',
        id: asset.id,
        storageKey,
        publicUrl: buildUploadPublicUrl(storageKey),
        expectedPath: fileState.expectedPath,
        label: asset.fileName || storageKey,
        references: refs,
        canCleanup,
        blockedReasons,
      })
    }

    if (refs.length === 0) {
      unusedMediaRecords.push({
        recordType: 'mediaAsset',
        id: asset.id,
        storageKey,
        publicUrl: asset.publicUrl,
        label: asset.fileName || storageKey,
        canCleanup,
        blockedReasons,
      })
    }
  }

  for (const imageMap of imageMaps) {
    const refs = refsForImageMap(imageMap, references)
    const storageKey = extractStorageKeyFromUploadUrl(imageMap.localUrl)
    const fileState = storageKey
      ? await existsByStorageKey(storageKey, options.uploadDir)
      : { exists: true, expectedPath: '' }
    const canCleanup = refs.length === 0

    if (storageKey && !fileState.exists) {
      missingLocalFiles.push({
        recordType: 'imageMap',
        id: imageMap.id,
        storageKey,
        publicUrl: buildUploadPublicUrl(storageKey),
        expectedPath: fileState.expectedPath,
        label: imageMap.localUrl,
        references: refs,
        canCleanup,
        blockedReasons: canCleanup ? [] : ['referenced'],
      })
    }

    if (refs.length === 0) {
      unusedMediaRecords.push({
        recordType: 'imageMap',
        id: imageMap.id,
        storageKey: storageKey || undefined,
        localUrl: imageMap.localUrl,
        label: imageMap.localUrl,
        canCleanup: true,
        blockedReasons: [],
      })
    }
  }

  return limitScanDetails(
    {
      generatedAt: new Date().toISOString(),
      mode,
      summary: buildSummary(missingLocalFiles, unusedMediaRecords),
      missingLocalFiles,
      unusedMediaRecords,
    },
    detailLimit
  )
}

async function cleanupMediaAsset(prisma: PrismaClient, id: string, references: ReferenceIndex) {
  const asset = await prisma.mediaAsset.findUnique({
    where: { id },
    select: {
      id: true,
      storageKey: true,
      publicUrl: true,
      status: true,
      session: { select: { status: true, expiresAt: true } },
    },
  })
  if (!asset)
    return { success: false, skipped: true, reasons: ['not_found'] as MediaHealthBlockReason[] }
  if (asset.status === 'deleted') {
    return {
      success: false,
      skipped: true,
      reasons: ['already_deleted'] as MediaHealthBlockReason[],
    }
  }

  const blockedReasons = buildAssetBlockReasons(asset, refsForAsset(asset, references))
  if (blockedReasons.length > 0) {
    return { success: false, skipped: true, reasons: blockedReasons }
  }

  await safeDeleteUploadFileByStorageKey(asset.storageKey)
  await prisma.mediaAsset.update({ where: { id }, data: { status: 'deleted' } })
  return { success: true, skipped: false, reasons: [] as MediaHealthBlockReason[] }
}

async function cleanupImageMap(
  prisma: PrismaClient,
  id: string,
  deletedBy: string | null,
  references: ReferenceIndex
) {
  const imageMap = await prisma.imageMap.findUnique({
    where: { id },
    select: {
      id: true,
      localUrl: true,
      externalUrl: true,
      s3Url: true,
      thumbnailUrl: true,
      deletedAt: true,
    },
  })
  if (!imageMap)
    return { success: false, skipped: true, reasons: ['not_found'] as MediaHealthBlockReason[] }
  if (imageMap.deletedAt) {
    return {
      success: false,
      skipped: true,
      reasons: ['already_deleted'] as MediaHealthBlockReason[],
    }
  }

  if (refsForImageMap(imageMap, references).length > 0) {
    return { success: false, skipped: true, reasons: ['referenced'] as MediaHealthBlockReason[] }
  }

  const sharedAssetCount = await prisma.mediaAsset.count({
    where: { publicUrl: imageMap.localUrl, status: { not: 'deleted' } },
  })
  if (sharedAssetCount > 0) {
    return {
      success: false,
      skipped: true,
      reasons: ['shared_image_map'] as MediaHealthBlockReason[],
    }
  }

  const cleanupResult = await variantCleanup.cleanupByImageMapId(id, CleanupTrigger.ON_DELETE)
  if (cleanupResult.skipped) {
    return { success: false, skipped: true, reasons: ['processing'] as MediaHealthBlockReason[] }
  }

  await prisma.imageMap.update({
    where: { id },
    data: { deletedAt: new Date(), deletedBy },
  })
  return { success: true, skipped: false, reasons: [] as MediaHealthBlockReason[] }
}

export async function cleanupMediaHealthRecords(
  prisma: PrismaClient,
  options: {
    mode?: MediaHealthScanMode
    targets: MediaHealthCleanupTarget[]
    deletedBy: string | null
  }
): Promise<MediaHealthCleanupResult[]> {
  const results: MediaHealthCleanupResult[] = []
  const references = await collectReferences(prisma, options.mode || 'strict')

  for (const target of options.targets) {
    const result =
      target.recordType === 'mediaAsset'
        ? await cleanupMediaAsset(prisma, target.id, references)
        : await cleanupImageMap(prisma, target.id, options.deletedBy, references)

    results.push({
      recordType: target.recordType,
      id: target.id,
      success: result.success,
      skipped: result.skipped,
      blockedReasons: result.reasons,
      message: result.success ? '已清理' : '已跳过',
    })
  }

  return results
}
