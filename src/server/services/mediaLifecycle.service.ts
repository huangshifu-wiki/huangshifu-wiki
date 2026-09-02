import fs from 'node:fs/promises'

import { Prisma } from '@prisma/client'

import { prisma } from '../prisma'
import { resolveUploadPathByUrl } from '../utils/upload'
import { deleteS3Object } from '../s3/s3Service'
import { logger } from '../utils/logger'
import { collectMediaReferences, isMediaReferenced, releaseMediaAsset } from './mediaAssetService'
import { variantCleanup, CleanupTrigger } from './variantCleanup.service'

export type MediaLifecycleResult = {
  processed: number
  succeeded: number
  skipped: number
  failed: number
  errors: string[]
  externalObjectsPendingManualCleanup: string[]
}

function emptyResult(): MediaLifecycleResult {
  return {
    processed: 0,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    externalObjectsPendingManualCleanup: [],
  }
}

export async function cleanupExpiredUploadSessions(limit = 100, now = new Date()) {
  const sessions = await prisma.uploadSession.findMany({
    where: { status: 'open', expiresAt: { lt: now } },
    select: { id: true, assets: { select: { id: true } } },
    orderBy: { expiresAt: 'asc' },
    take: Math.max(1, Math.min(limit, 500)),
  })
  const result = emptyResult()

  for (const session of sessions) {
    result.processed++
    try {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.uploadSession.updateMany({
          where: { id: session.id, status: 'open', expiresAt: { lt: now } },
          data: { status: 'expired' },
        })
        if (updated.count !== 1) return
        await tx.mediaAsset.updateMany({
          where: { sessionId: session.id, status: { not: 'deleted' } },
          data: { status: 'deleted' },
        })
      })
      for (const asset of session.assets) await releaseMediaAsset(asset.id)
      await prisma.uploadSession.deleteMany({ where: { id: session.id, status: 'expired' } })
      result.succeeded++
    } catch (error) {
      result.failed++
      result.errors.push(`${session.id}: ${error instanceof Error ? error.message : '未知错误'}`)
      logger.error({ err: error, sessionId: session.id }, 'Expired upload session cleanup failed')
    }
  }
  return result
}

export async function garbageCollectRetiredMedia(limit = 100, now = new Date()) {
  const maps = await prisma.imageMap.findMany({
    where: { retiredAt: { lte: now } },
    select: {
      id: true,
      md5: true,
      s3Key: true,
      s3Url: true,
      externalUrl: true,
      thumbnailUrl: true,
      variantStatus: true,
    },
    orderBy: { retiredAt: 'asc' },
    take: Math.max(1, Math.min(limit, 500)),
  })
  const result = emptyResult()
  const references = await collectMediaReferences()

  for (const candidate of maps) {
    result.processed++
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${candidate.md5}, 0))`
        )
        await tx.$executeRaw(
          Prisma.sql`SELECT id FROM "ImageMap" WHERE id = ${candidate.id} FOR UPDATE`
        )
        const imageMap = await tx.imageMap.findUnique({ where: { id: candidate.id } })
        if (!imageMap) return { kind: 'missing' as const }
        if (!imageMap.retiredAt || imageMap.retiredAt > now) return { kind: 'skip' as const }
        const activeClaims = await tx.mediaAsset.count({
          where: { imageMapId: imageMap.id, status: { in: ['uploaded', 'ready'] } },
        })
        if (
          activeClaims > 0 ||
          isMediaReferenced(references, {
            urls: [imageMap.localUrl, imageMap.s3Url, imageMap.externalUrl, imageMap.thumbnailUrl],
          }) ||
          imageMap.variantStatus === 'processing'
        ) {
          return { kind: 'skip' as const }
        }

        const variantResult = await variantCleanup.cleanupByImageMapId(
          imageMap.id,
          CleanupTrigger.ON_DELETE
        )
        if (variantResult.skipped) return { kind: 'skip' as const }
        const localPath = resolveUploadPathByUrl(imageMap.localUrl)
        if (localPath) {
          await fs.unlink(localPath).catch((error) => {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          })
        }
        if (imageMap.s3Url && !imageMap.s3Key) {
          const message = 'S3 对象键未知，保留远端记录待人工处理'
          await tx.imageMap.update({ where: { id: imageMap.id }, data: { retiredAt: null } })
          return { kind: 'preserved' as const, externalUrl: null, error: message }
        }
        if (imageMap.s3Key) await deleteS3Object(imageMap.s3Key)
        if (imageMap.externalUrl) {
          await tx.imageMap.update({ where: { id: imageMap.id }, data: { retiredAt: null } })
          return { kind: 'preserved' as const, externalUrl: imageMap.externalUrl, error: null }
        }
        await tx.mediaAsset.updateMany({
          where: { imageMapId: imageMap.id, status: 'deleted' },
          data: { imageMapId: null },
        })
        await tx.imageMap.delete({ where: { id: imageMap.id } })
        return { kind: 'deleted' as const, externalUrl: null }
      })
      if (outcome.kind === 'missing' || outcome.kind === 'skip') {
        result.skipped++
      } else if (outcome.kind === 'preserved') {
        if (outcome.error) result.errors.push(`${candidate.id}: ${outcome.error}`)
        if (outcome.externalUrl)
          result.externalObjectsPendingManualCleanup.push(outcome.externalUrl)
        result.skipped++
      } else {
        result.succeeded++
      }
    } catch (error) {
      result.failed++
      result.errors.push(`${candidate.id}: ${error instanceof Error ? error.message : '未知错误'}`)
      logger.error(
        { err: error, imageMapId: candidate.id },
        'Retired media garbage collection failed'
      )
    }
  }
  return result
}
