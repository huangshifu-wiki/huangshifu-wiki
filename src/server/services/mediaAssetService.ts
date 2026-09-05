import crypto from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import fs from 'node:fs/promises'
import path from 'node:path'

import { prisma } from '../prisma'
import {
  buildUploadPublicUrl,
  extractStorageKeyFromUploadUrl,
  resolveUploadPathByStorageKey,
  resolveUploadPathByUrl,
  uploadFileToS3,
  uploadToSuperbed,
} from '../utils/upload'
import { uploadsDir } from '../utils/config'
import { getStorageKeyFromFilePath } from '../uploadPath'
import { secretsConfigService } from './secretsConfig.service'
import { logger } from '../utils/logger'
import { calculateFileMD5 } from '../utils/hash'
import { collectReferences } from './mediaHealth.service'
import type { MediaReferenceIndex } from './mediaHealth.service'
import { normalizeStorageKey } from './mediaRestoreReport.service'
import { MEDIA_RETIRE_GRACE_MS, getMediaRetiredAt } from './mediaConstants'
export { MEDIA_RETIRE_GRACE_MS, getMediaRetiredAt } from './mediaConstants'

export type MediaStorageStrategy = 'local' | 's3' | 'external'

type TransactionClient = Prisma.TransactionClient

type ImageMapStorageSnapshot = {
  id: string
  md5: string
  localUrl: string
  externalUrl: string | null
  s3Url: string | null
  s3Key: string | null
  storageType: MediaStorageStrategy
  thumbnailUrl: string | null
  blurhash: string | null
  thumbhash: string | null
  variantStatus: string
  cloudSyncStatus: string
  deletedAt: Date | null
  retiredAt: Date | null
}

export type MediaAssetResult = {
  assetId: string
  imageMapId: string
  publicUrl: string | null
  storageKey: string | null
  fileName: string
  mimeType: string
  sizeBytes: number
  md5: string
  status: 'uploaded' | 'ready' | 'deleted'
  reused: boolean
  localUrl: string
  s3Url: string | null
  externalUrl: string | null
  storageType: MediaStorageStrategy
  storageErrors: string[]
  localFilePath: string | null
  asset: {
    id: string
    imageMapId: string
    publicUrl: string | null
    storageKey: string | null
    fileName: string
    mimeType: string
    sizeBytes: number
    md5: string
    status: 'uploaded' | 'ready' | 'deleted'
    reused: boolean
  }
  imageMap: ImageMapStorageSnapshot
}

export type CreateOrReuseUploadedAssetInput = {
  ownerUid: string
  tempFilePath: string
  originalFileName: string
  mimeType: string
  sizeBytes: number
  sessionId?: string
  storageStrategy?: MediaStorageStrategy
}

export type CreateAssetClaimInput = {
  ownerUid: string
  imageMapId: string
  fileName: string
  mimeType: string
  sizeBytes: number
}

export type MediaReferenceCollection = MediaReferenceIndex

export async function collectMediaReferences(
  client: PrismaClient = prisma
): Promise<MediaReferenceCollection> {
  return collectReferences(client, 'strict')
}
export function isMediaReferenced(
  references: MediaReferenceCollection,
  target: MediaReferenceTarget
): boolean {
  if (target.imageMapId && references.imageMapIds.has(target.imageMapId)) return true
  if (target.urls?.some((url) => Boolean(url && references.urls.has(url.trim())))) {
    return true
  }
  return Boolean(
    target.storageKeys?.some((key) =>
      Boolean(key && references.storageKeys.has(normalizeStorageKey(key)))
    )
  )
}

export type MediaReferenceTarget = {
  assetId?: string | null
  imageMapId?: string | null
  urls?: Array<string | null | undefined>
  storageKeys?: Array<string | null | undefined>
}

const IMAGE_MAP_SELECT = {
  id: true,
  md5: true,
  localUrl: true,
  externalUrl: true,
  s3Url: true,
  s3Key: true,
  storageType: true,
  thumbnailUrl: true,
  blurhash: true,
  thumbhash: true,
  variantStatus: true,
  cloudSyncStatus: true,
  deletedAt: true,
  deletedBy: true,
  retiredAt: true,
} as const
export type LocalImageMap = Prisma.ImageMapGetPayload<{ select: typeof IMAGE_MAP_SELECT }>

export async function ensureImageMapForLocalFile(
  filePath: string,
  localUrl: string,
  client: PrismaClient = prisma
): Promise<LocalImageMap> {
  const md5 = await calculateFileMD5(filePath)
  return client.$transaction(async (tx) => {
    await lockImageContent(tx, md5)
    return tx.imageMap.upsert({
      where: { md5 },
      update: { deletedAt: null, deletedBy: null, retiredAt: null },
      create: { id: crypto.randomUUID(), md5, localUrl, storageType: 'local' },
      select: IMAGE_MAP_SELECT,
    })
  })
}

export async function lockImageMap(tx: TransactionClient, imageMapId: string) {
  await tx.$executeRaw(Prisma.sql`
    SELECT id FROM "ImageMap" WHERE id = ${imageMapId} FOR UPDATE
  `)
}
const ASSET_SELECT = {
  id: true,
  ownerUid: true,
  sessionId: true,
  imageMapId: true,
  storageKey: true,
  publicUrl: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  imageMap: { select: IMAGE_MAP_SELECT },
} as const
export type ReadyMediaAsset = Prisma.MediaAssetGetPayload<{ select: typeof ASSET_SELECT }>
export function getMediaStorageSnapshot(asset: ReadyMediaAsset) {
  const publicUrl = getCanonicalMediaUrl(asset)
  const storageKey =
    asset.storageKey ||
    (asset.imageMap?.localUrl ? extractStorageKeyFromUploadUrl(asset.imageMap.localUrl) : null)
  if (!publicUrl) throw new MediaAssetRequestError(409, '媒体资源缺少可用存储位置')
  return { publicUrl, storageKey: storageKey || null }
}

function isStorageStrategy(value: unknown): value is MediaStorageStrategy {
  return value === 'local' || value === 's3' || value === 'external'
}

async function getConfiguredStorageStrategy(client: PrismaClient = prisma) {
  const config = await client.siteConfig.findUnique({
    where: { key: 'image_preference' },
    select: { value: true },
  })
  const strategy = (config?.value as { strategy?: unknown } | null)?.strategy
  return isStorageStrategy(strategy) ? strategy : 'local'
}

export async function lockImageContent(tx: TransactionClient, md5: string) {
  await tx.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${md5}, 0))
  `)
}

function hasAvailableStorage(
  imageMap: Pick<ImageMapStorageSnapshot, 'localUrl' | 's3Url' | 'externalUrl'>
) {
  return Boolean(imageMap.localUrl || imageMap.s3Url || imageMap.externalUrl)
}

function inferStorageType(
  imageMap: Pick<ImageMapStorageSnapshot, 'localUrl' | 's3Url' | 'externalUrl'>,
  preferred: MediaStorageStrategy
): MediaStorageStrategy {
  if (preferred === 'local' && imageMap.localUrl) return 'local'
  if (preferred === 's3' && imageMap.s3Url) return 's3'
  if (preferred === 'external' && imageMap.externalUrl) return 'external'
  if (imageMap.s3Url) return 's3'
  if (imageMap.externalUrl) return 'external'
  return 'local'
}
export function getCanonicalMediaUrl(asset: {
  publicUrl: string | null
  imageMap: { localUrl: string; externalUrl: string | null; s3Url: string | null } | null
}) {
  return (
    asset.imageMap?.localUrl ||
    asset.publicUrl ||
    asset.imageMap?.externalUrl ||
    asset.imageMap?.s3Url ||
    ''
  )
}

function getLocalFilePath(
  localUrl: string | null | undefined,
  storageKey: string | null | undefined
): string | null {
  if (localUrl) {
    const fromUrl = resolveUploadPathByUrl(localUrl)
    if (fromUrl) return fromUrl
  }
  if (storageKey) return resolveUploadPathByStorageKey(storageKey)
  return null
}

function getSnapshotStorageKey(localUrl: string | null | undefined) {
  return localUrl ? extractStorageKeyFromUploadUrl(localUrl) : null
}

function makeS3ObjectKey(md5: string, originalFileName: string) {
  const ext = path
    .extname(originalFileName)
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '')
  return `image-maps/${md5}${ext || '.bin'}`
}

function buildMediaAssetResult(
  asset: {
    id: string
    imageMapId: string | null
    publicUrl: string | null
    storageKey: string | null
    fileName: string
    mimeType: string
    sizeBytes: number
    status: 'uploaded' | 'ready' | 'deleted'
  },
  imageMap: ImageMapStorageSnapshot,
  md5: string,
  reused: boolean,
  storageErrors: string[],
  localFilePath: string | null
): MediaAssetResult {
  const imageMapId = asset.imageMapId || imageMap.id
  const publicUrl = imageMap.localUrl || asset.publicUrl
  const storageKey = getSnapshotStorageKey(imageMap.localUrl) || asset.storageKey
  const storageType = inferStorageType(imageMap, imageMap.storageType)
  return {
    assetId: asset.id,
    imageMapId,
    publicUrl,
    storageKey,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    md5,
    status: asset.status,
    reused,
    localUrl: imageMap.localUrl,
    s3Url: imageMap.s3Url,
    externalUrl: imageMap.externalUrl,
    storageType,
    storageErrors,
    localFilePath,
    asset: {
      id: asset.id,
      imageMapId,
      publicUrl,
      storageKey,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      md5,
      status: asset.status,
      reused,
    },
    imageMap,
  }
}

async function ensureSessionSlot(
  tx: TransactionClient,
  sessionId: string,
  ownerUid: string
): Promise<{ id: string; maxFiles: number; uploadedFiles: number }> {
  const session = await tx.uploadSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      ownerUid: true,
      status: true,
      expiresAt: true,
      maxFiles: true,
      uploadedFiles: true,
    },
  })

  if (!session) throw new MediaAssetRequestError(404, '上传会话不存在')
  if (session.ownerUid !== ownerUid) throw new MediaAssetRequestError(403, '无权访问该会话')
  if (session.status === 'expired' || session.expiresAt <= new Date()) {
    if (session.status !== 'expired') {
      await tx.uploadSession.updateMany({
        where: { id: session.id, status: 'open' },
        data: { status: 'expired' },
      })
    }
    throw new MediaAssetRequestError(410, '上传会话已过期，请重新创建会话')
  }
  if (session.status !== 'open') throw new MediaAssetRequestError(409, '会话状态不正确')

  const reserved = await tx.uploadSession.updateMany({
    where: {
      id: session.id,
      ownerUid,
      status: 'open',
      expiresAt: { gt: new Date() },
      uploadedFiles: { lt: session.maxFiles },
    },
    data: { uploadedFiles: { increment: 1 } },
  })
  if (reserved.count !== 1) throw new MediaAssetRequestError(409, '已达到最大上传数量限制')

  return {
    id: session.id,
    maxFiles: session.maxFiles,
    uploadedFiles: session.uploadedFiles + 1,
  }
}
export async function assertUploadSessionAssets(
  tx: TransactionClient,
  sessionId: string,
  ownerUid: string,
  assetIds: string[]
) {
  const session = await tx.uploadSession.findUnique({
    where: { id: sessionId },
    select: {
      ownerUid: true,
      status: true,
      expiresAt: true,
      assets: { select: { id: true } },
    },
  })
  if (!session || session.ownerUid !== ownerUid) {
    throw new MediaAssetRequestError(400, '上传会话不存在')
  }
  if (session.status === 'expired' || session.expiresAt <= new Date()) {
    throw new MediaAssetRequestError(410, '上传会话已过期，请重新上传')
  }
  if (session.status !== 'finalized') {
    throw new MediaAssetRequestError(400, '请先完成上传会话')
  }
  const sessionAssetIds = new Set(session.assets.map((asset) => asset.id))
  if (assetIds.some((assetId) => !sessionAssetIds.has(assetId))) {
    throw new MediaAssetRequestError(400, '上传会话不包含全部媒体资源')
  }
}

export class MediaAssetRequestError extends Error {
  constructor(
    public readonly statusCode: 400 | 403 | 404 | 409 | 410 | 413,
    message: string
  ) {
    super(message)
    this.name = 'MediaAssetRequestError'
  }
}

export async function createOrReuseUploadedAsset(
  input: CreateOrReuseUploadedAssetInput
): Promise<MediaAssetResult> {
  const strategy = input.storageStrategy || (await getConfiguredStorageStrategy())
  const md5 = await calculateFileMD5(input.tempFilePath)
  const temporaryStorageKey = getStorageKeyFromFilePath(input.tempFilePath, uploadsDir)
  if (!temporaryStorageKey) {
    throw new MediaAssetRequestError(400, '上传文件路径无效')
  }
  const temporaryUrl = buildUploadPublicUrl(temporaryStorageKey)
  let imageMapWasReused = false
  let result: MediaAssetResult
  let createdAssetId: string | null = null

  try {
    const created = await prisma.$transaction(async (tx) => {
      if (input.sessionId) await ensureSessionSlot(tx, input.sessionId, input.ownerUid)

      await lockImageContent(tx, md5)
      const existing = await tx.imageMap.findUnique({ where: { md5 }, select: IMAGE_MAP_SELECT })
      imageMapWasReused = Boolean(existing)
      const imageMap = await tx.imageMap.upsert({
        where: { md5 },
        update: {
          deletedAt: null,
          deletedBy: null,
          retiredAt: null,
        },
        create: {
          id: crypto.randomUUID(),
          md5,
          localUrl: temporaryUrl,
          storageType: 'local',
        },
        select: IMAGE_MAP_SELECT,
      })

      const asset = await tx.mediaAsset.create({
        data: {
          ownerUid: input.ownerUid,
          sessionId: input.sessionId,
          imageMapId: imageMap.id,
          storageKey: getSnapshotStorageKey(imageMap.localUrl),
          publicUrl: imageMap.localUrl,
          fileName: input.originalFileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          status: input.sessionId ? 'uploaded' : 'ready',
        },
        select: {
          id: true,
          imageMapId: true,
          publicUrl: true,
          storageKey: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          status: true,
        },
      })

      return { asset, imageMap }
    })
    createdAssetId = created.asset.id

    const storage = await ensureImageMapStorage(created.imageMap.id, strategy, {
      sourceFilePath: input.tempFilePath,
      sourceFileName: input.originalFileName,
      sourceMimeType: input.mimeType,
    })
    const currentAsset = await prisma.mediaAsset.findUnique({
      where: { id: created.asset.id },
      select: {
        id: true,
        imageMapId: true,
        publicUrl: true,
        storageKey: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
      },
    })
    if (!currentAsset || !currentAsset.imageMapId) {
      throw new Error('创建媒体资源后无法读取资源关系')
    }

    result = buildMediaAssetResult(
      currentAsset,
      storage.imageMap,
      md5,
      imageMapWasReused,
      storage.errors,
      getLocalFilePath(storage.imageMap.localUrl, currentAsset.storageKey)
    )
    return result
  } catch (error) {
    if (createdAssetId) {
      await releaseMediaAsset(createdAssetId, input.ownerUid).catch((cleanupError) =>
        logger.error({ err: cleanupError, assetId: createdAssetId }, '上传失败后的媒体资源释放失败')
      )
      if (input.sessionId) {
        await rollbackUploadSessionSlot(input.sessionId).catch((cleanupError) =>
          logger.error(
            { err: cleanupError, sessionId: input.sessionId },
            '上传失败后的会话槽位回滚失败'
          )
        )
      }
    }
    if (!imageMapWasReused) await fs.unlink(input.tempFilePath).catch(() => undefined)
    throw error
  } finally {
    if (imageMapWasReused) {
      await fs.unlink(input.tempFilePath).catch(() => undefined)
    }
  }
}

export async function createAssetClaimForImageMap(
  input: CreateAssetClaimInput,
  client: PrismaClient = prisma
): Promise<MediaAssetResult> {
  const result = await client.$transaction(async (tx) => {
    let imageMap = await tx.imageMap.findUnique({
      where: { id: input.imageMapId },
      select: IMAGE_MAP_SELECT,
    })
    if (!imageMap || imageMap.deletedAt || !hasAvailableStorage(imageMap)) {
      throw new MediaAssetRequestError(410, '图片映射不存在或没有可用存储位置')
    }

    await lockImageContent(tx, imageMap.md5)
    imageMap = await tx.imageMap.findUnique({
      where: { id: input.imageMapId },
      select: IMAGE_MAP_SELECT,
    })
    if (!imageMap || imageMap.deletedAt || !hasAvailableStorage(imageMap)) {
      throw new MediaAssetRequestError(410, '图片映射不存在或没有可用存储位置')
    }
    if (imageMap.retiredAt !== null) {
      await tx.imageMap.update({ where: { id: imageMap.id }, data: { retiredAt: null } })
    }
    const existing = await tx.mediaAsset.findFirst({
      where: {
        ownerUid: input.ownerUid,
        imageMapId: imageMap.id,
        status: 'ready',
      },
      select: {
        id: true,
        imageMapId: true,
        publicUrl: true,
        storageKey: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
      },
    })
    if (existing) {
      return { asset: existing, imageMap, reused: true }
    }

    const asset = await tx.mediaAsset.create({
      data: {
        ownerUid: input.ownerUid,
        imageMapId: imageMap.id,
        storageKey: getSnapshotStorageKey(imageMap.localUrl),
        publicUrl: imageMap.localUrl,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        status: 'ready',
      },
      select: {
        id: true,
        imageMapId: true,
        publicUrl: true,
        storageKey: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
      },
    })
    return { asset, imageMap, reused: false }
  })

  return buildMediaAssetResult(
    result.asset,
    result.imageMap,
    result.imageMap.md5,
    result.reused,
    [],
    getLocalFilePath(result.imageMap.localUrl, result.asset.storageKey)
  )
}

export async function getReadyAssetForOwner(
  tx: TransactionClient,
  assetId: string,
  ownerUid?: string
) {
  await tx.$executeRaw(Prisma.sql`SELECT id FROM "MediaAsset" WHERE id = ${assetId} FOR UPDATE`)
  const asset = await tx.mediaAsset.findUnique({ where: { id: assetId }, select: ASSET_SELECT })
  if (!asset || (ownerUid && asset.ownerUid !== ownerUid)) {
    throw new MediaAssetRequestError(403, '无权使用该媒体资源')
  }
  if (asset.status !== 'ready' || !asset.imageMap || asset.imageMap.deletedAt) {
    throw new MediaAssetRequestError(409, '媒体资源尚未完成或已失效')
  }
  if (!hasAvailableStorage(asset.imageMap)) {
    throw new MediaAssetRequestError(409, '媒体资源没有可用存储位置')
  }
  return asset
}

export async function getReadyAssetsForOwner(
  tx: TransactionClient,
  assetIds: string[],
  ownerUid: string
) {
  const uniqueAssetIds = [...new Set(assetIds)]
  if (!uniqueAssetIds.length) return []
  await tx.$executeRaw(
    Prisma.sql`SELECT id FROM "MediaAsset" WHERE id IN (${Prisma.join(uniqueAssetIds)}) FOR UPDATE`
  )
  const assets = await tx.mediaAsset.findMany({
    where: { id: { in: uniqueAssetIds }, ownerUid, status: 'ready' },
    select: ASSET_SELECT,
  })
  if (assets.length !== uniqueAssetIds.length) {
    throw new MediaAssetRequestError(403, '无权使用一个或多个媒体资源')
  }
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  for (const asset of assets) {
    if (!asset.imageMap || asset.imageMap.deletedAt || !hasAvailableStorage(asset.imageMap)) {
      throw new MediaAssetRequestError(409, '一个或多个媒体资源尚未完成或已失效')
    }
  }
  return uniqueAssetIds.map((assetId) => assetById.get(assetId)!)
}

export async function syncAssetToImageMap(
  assetId: string,
  client: PrismaClient = prisma
): Promise<string | null> {
  const asset = await client.mediaAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      imageMapId: true,
      storageKey: true,
      publicUrl: true,
      status: true,
    },
  })
  if (!asset || asset.status === 'deleted') return null
  if (asset.imageMapId) return asset.imageMapId

  const filePath = getLocalFilePath(asset.publicUrl, asset.storageKey)
  if (!filePath) return null
  const md5 = await calculateFileMD5(filePath)
  const localUrl =
    (asset.publicUrl && resolveUploadPathByUrl(asset.publicUrl) ? asset.publicUrl : null) ||
    (asset.storageKey ? buildUploadPublicUrl(asset.storageKey) : asset.publicUrl)

  return client.$transaction(async (tx) => {
    await lockImageContent(tx, md5)
    const currentAsset = await tx.mediaAsset.findUnique({
      where: { id: asset.id },
      select: { imageMapId: true, status: true },
    })
    if (!currentAsset || currentAsset.status === 'deleted') return null
    if (currentAsset.imageMapId) return currentAsset.imageMapId

    const imageMap = await tx.imageMap.upsert({
      where: { md5 },
      update: { deletedAt: null, deletedBy: null, retiredAt: null },
      create: { id: crypto.randomUUID(), md5, localUrl, storageType: 'local' },
      select: IMAGE_MAP_SELECT,
    })
    const updated = await tx.mediaAsset.updateMany({
      where: { id: asset.id, imageMapId: null, status: { not: 'deleted' } },
      data: {
        imageMapId: imageMap.id,
        storageKey: getSnapshotStorageKey(imageMap.localUrl),
        publicUrl: imageMap.localUrl,
      },
    })
    if (updated.count === 1) return imageMap.id

    const concurrentAsset = await tx.mediaAsset.findUnique({
      where: { id: asset.id },
      select: { imageMapId: true },
    })
    return concurrentAsset?.imageMapId || null
  })
}

type EnsureImageMapStorageResult = {
  imageMap: ImageMapStorageSnapshot
  errors: string[]
}

const storageEnsureFlights = new Map<string, Promise<EnsureImageMapStorageResult>>()

export function ensureImageMapStorage(
  imageMapId: string,
  strategy: MediaStorageStrategy,
  options: {
    sourceFilePath?: string
    sourceFileName?: string
    sourceMimeType?: string
  } = {}
): Promise<EnsureImageMapStorageResult> {
  const flightKey =
    strategy === 'local'
      ? `${imageMapId}:${strategy}:${options.sourceFilePath || ''}`
      : `${imageMapId}:${strategy}`
  const pending = storageEnsureFlights.get(flightKey)
  if (pending) return pending

  const promise = ensureImageMapStorageInternal(imageMapId, strategy, options)
  storageEnsureFlights.set(flightKey, promise)
  void promise
    .finally(() => {
      if (storageEnsureFlights.get(flightKey) === promise) storageEnsureFlights.delete(flightKey)
    })
    .catch(() => undefined)
  return promise
}

async function ensureImageMapStorageInternal(
  imageMapId: string,
  strategy: MediaStorageStrategy,
  options: {
    sourceFilePath?: string
    sourceFileName?: string
    sourceMimeType?: string
  }
): Promise<EnsureImageMapStorageResult> {
  const errors: string[] = []
  const initial = await prisma.imageMap.findUnique({
    where: { id: imageMapId },
    select: IMAGE_MAP_SELECT,
  })
  if (!initial) throw new MediaAssetRequestError(404, '图片映射不存在')

  const canonicalPath = getLocalFilePath(initial.localUrl, getSnapshotStorageKey(initial.localUrl))
  let sourcePath = canonicalPath
  const sourceFilePath = options.sourceFilePath
  const fileExistsCache = new Map<string, boolean>()
  const checkFileExists = async (filePath: string | null) => {
    if (!filePath) return false
    const cached = fileExistsCache.get(filePath)
    if (cached !== undefined) return cached
    const exists = await fileExists(filePath)
    fileExistsCache.set(filePath, exists)
    return exists
  }
  const sourceAvailable = await checkFileExists(sourceFilePath || null)
  const canonicalAvailable = await checkFileExists(canonicalPath)
  if (
    canonicalPath &&
    sourceFilePath &&
    path.resolve(sourceFilePath) !== path.resolve(canonicalPath) &&
    !canonicalAvailable &&
    sourceAvailable
  ) {
    await fs.mkdir(path.dirname(canonicalPath), { recursive: true })
    try {
      await fs.copyFile(sourceFilePath, canonicalPath, fs.constants.COPYFILE_EXCL)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  if (!sourcePath && sourceAvailable) sourcePath = sourceFilePath
  const sourceFileName =
    options.sourceFileName || path.basename(getSnapshotStorageKey(initial.localUrl) || initial.md5)
  const sourceMimeType = options.sourceMimeType || 'application/octet-stream'
  const canUpload = Boolean(sourcePath && (canonicalAvailable || sourceAvailable))
  const s3ObjectKey = initial.s3Key || makeS3ObjectKey(initial.md5, sourceFileName)
  let s3Url: string | null = initial.s3Url
  let externalUrl: string | null = initial.externalUrl
  let s3Key: string | null = initial.s3Key

  if ((strategy === 's3' || strategy === 'external') && !s3Url) {
    if (!canUpload || !sourcePath) {
      errors.push('S3 上传失败：没有可用本地源文件')
    } else {
      const result = await uploadFileToS3(sourcePath, s3ObjectKey, sourceMimeType)
      if (result.success && result.url) {
        s3Url = result.url
        s3Key = s3ObjectKey
      } else {
        errors.push(`S3 上传失败：${result.error || '未知错误'}`)
      }
    }
  }

  if (strategy === 'external' && !externalUrl) {
    const token = secretsConfigService.getSecrets().superbedApiToken
    if (!token) {
      errors.push('外部图床上传失败：未配置凭证')
    } else if (!canUpload || !sourcePath) {
      errors.push('外部图床上传失败：没有可用本地源文件')
    } else {
      const result = await uploadToSuperbed(sourcePath, sourceFileName, sourceMimeType, token)
      if (result.success && result.url) externalUrl = result.url
      else errors.push(`外部图床上传失败：${result.error || '未知错误'}`)
    }
  }

  return prisma
    .$transaction(async (tx) => {
      await lockImageContent(tx, initial.md5)
      const current = await tx.imageMap.findUnique({
        where: { id: imageMapId },
        select: IMAGE_MAP_SELECT,
      })
      if (!current) throw new MediaAssetRequestError(404, '图片映射不存在')

      const mergedS3Url = current.s3Url || s3Url
      const mergedExternalUrl = current.externalUrl || externalUrl
      const mergedS3Key = current.s3Key || s3Key
      const nextStorageType = inferStorageType(
        { localUrl: current.localUrl, s3Url: mergedS3Url, externalUrl: mergedExternalUrl },
        strategy
      )
      const nextCloudSyncStatus =
        strategy === 'local' ? 'skipped' : errors.length > 0 ? 'failed' : 'completed'
      if (
        mergedS3Url === current.s3Url &&
        mergedExternalUrl === current.externalUrl &&
        mergedS3Key === current.s3Key &&
        nextStorageType === current.storageType &&
        nextCloudSyncStatus === current.cloudSyncStatus &&
        current.deletedAt === null &&
        current.deletedBy === null &&
        current.retiredAt === null
      ) {
        return current
      }
      return tx.imageMap.update({
        where: { id: imageMapId },
        data: {
          ...(mergedS3Url !== current.s3Url ? { s3Url: mergedS3Url } : {}),
          ...(mergedExternalUrl !== current.externalUrl ? { externalUrl: mergedExternalUrl } : {}),
          ...(mergedS3Key !== current.s3Key ? { s3Key: mergedS3Key } : {}),
          storageType: nextStorageType,
          cloudSyncStatus: nextCloudSyncStatus,
          deletedAt: null,
          deletedBy: null,
          retiredAt: null,
        },
        select: IMAGE_MAP_SELECT,
      })
    })
    .then((imageMap) => ({ imageMap, errors }))
}
export async function releaseMediaAsset(assetId: string, ownerUid?: string) {
  const now = new Date()
  const retiredAt = getMediaRetiredAt(now)
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT id FROM "MediaAsset" WHERE id = ${assetId} FOR UPDATE`)
    const asset = await tx.mediaAsset.findUnique({
      where: { id: assetId },
      select: {
        id: true,
        ownerUid: true,
        imageMapId: true,
        publicUrl: true,
        storageKey: true,
        status: true,
        imageMap: {
          select: {
            md5: true,
            localUrl: true,
            externalUrl: true,
            s3Url: true,
            thumbnailUrl: true,
          },
        },
      },
    })
    if (!asset) return { released: false, reason: 'asset_not_found' as const, localUrls: [] }
    const localUrls = [asset.publicUrl, asset.imageMap?.localUrl].filter((value): value is string =>
      Boolean(value)
    )
    const markedAssetDeleted = asset.status !== 'deleted'
    if (ownerUid && asset.ownerUid !== ownerUid) {
      throw new MediaAssetRequestError(403, '无权释放该媒体资源')
    }
    if (!asset.imageMapId || !asset.imageMap) {
      if (asset.status !== 'deleted') {
        await tx.mediaAsset.update({ where: { id: asset.id }, data: { status: 'deleted' } })
      }
      return {
        released: true,
        imageMapId: asset.imageMapId,
        retiredAt: null,
        localUrls,
        markedAssetDeleted,
      }
    }

    await lockImageContent(tx, asset.imageMap.md5)
    await tx.$executeRaw(
      Prisma.sql`SELECT id FROM "ImageMap" WHERE id = ${asset.imageMapId} FOR UPDATE`
    )
    const imageMap = await tx.imageMap.findUnique({
      where: { id: asset.imageMapId },
      select: {
        id: true,
        deletedAt: true,
        localUrl: true,
        externalUrl: true,
        s3Url: true,
        thumbnailUrl: true,
      },
    })
    if (!imageMap) {
      if (asset.status !== 'deleted') {
        await tx.mediaAsset.update({ where: { id: asset.id }, data: { status: 'deleted' } })
      }
      return {
        released: true,
        imageMapId: asset.imageMapId,
        retiredAt: null,
        localUrls,
        markedAssetDeleted,
      }
    }

    const references = await collectMediaReferences()
    const remainingClaims = await tx.mediaAsset.count({
      where: {
        imageMapId: asset.imageMapId,
        status: { in: ['uploaded', 'ready'] },
        id: { not: asset.id },
      },
    })
    const externallyReferenced = isMediaReferenced(references, {
      assetId: asset.id,
      imageMapId: asset.imageMapId,
      urls: [
        asset.publicUrl,
        imageMap.localUrl,
        imageMap.s3Url,
        imageMap.externalUrl,
        imageMap.thumbnailUrl,
      ],
      storageKeys: [asset.storageKey],
    })
    if (externallyReferenced) {
      if (asset.status === 'deleted') {
        await tx.mediaAsset.update({ where: { id: asset.id }, data: { status: 'ready' } })
      }
      return {
        released: false,
        reason: 'still_referenced' as const,
        imageMapId: asset.imageMapId,
        retiredAt: null,
        localUrls,
        markedAssetDeleted: false,
      }
    }

    if (asset.status !== 'deleted') {
      await tx.mediaAsset.update({ where: { id: asset.id }, data: { status: 'deleted' } })
    }
    if (remainingClaims === 0 && !imageMap.deletedAt) {
      await tx.imageMap.updateMany({
        where: { id: asset.imageMapId, deletedAt: null },
        data: { retiredAt },
      })
    }
    return {
      released: true,
      imageMapId: asset.imageMapId,
      retiredAt: remainingClaims === 0 && !imageMap.deletedAt ? retiredAt : null,
      localUrls,
      markedAssetDeleted,
    }
  })
}

export async function rollbackUploadSessionSlot(sessionId: string) {
  await prisma.uploadSession.updateMany({
    where: { id: sessionId, status: 'open', uploadedFiles: { gt: 0 } },
    data: { uploadedFiles: { decrement: 1 } },
  })
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
