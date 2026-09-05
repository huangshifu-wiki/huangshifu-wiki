import { Router, type Response } from 'express'

import { z } from 'zod'
import { requireAdmin, requireSuperAdmin } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import type { AuthenticatedRequest } from '../types'
import {
  bindLegacyMediaBatch,
  deleteOrphanMediaBatch,
  localizeMediaAssetsBatch,
  MediaMaintenanceRequestError,
  previewOrphanMediaBatch,
  reconcileMediaAssetsBatch,
  repairMissingThumbnailsBatch,
  scanMediaMaintenance,
  type MaintenanceBatchResult,
  type MaintenanceOperation,
  type MaintenanceResultMode,
} from '../services/mediaMaintenance.service'
import { uploadsDir } from '../utils/config'
import {
  mediaMaintenanceBatchSchema,
  mediaMaintenanceOrphanDeleteSchema,
  mediaMaintenanceOrphanPreviewSchema,
  mediaMaintenanceScanQuerySchema,
} from '../schemas/mediaMaintenance.schema'
import { logger } from '../utils/logger'
import { prisma } from '../prisma'

const router = Router()
const batchFlights = new Map<string, Promise<MaintenanceBatchResult>>()

type MaintenanceBatchInput = z.infer<typeof mediaMaintenanceBatchSchema>
type BatchMaintenanceOperation = Exclude<
  MaintenanceOperation,
  'scan' | 'orphans/preview' | 'orphans/delete'
>

function sendMaintenanceError(res: Response, error: unknown) {
  if (error instanceof z.ZodError) {
    const isBatchLimitError = error.issues.some(
      (issue) =>
        (issue.path[0] === 'batchSize' || issue.path[0] === 'limit') &&
        (issue.code === 'too_big' || issue.code === 'too_small')
    )
    res.status(isBatchLimitError ? 413 : 400).json({
      success: false,
      error: isBatchLimitError ? '批次大小不能超过 100' : '维护请求参数不合法',
      fields: error.flatten().fieldErrors,
    })
    return
  }
  if (error instanceof MediaMaintenanceRequestError) {
    res.status(error.statusCode).json({ success: false, error: error.message })
    return
  }
  throw error
}

async function logMaintenance(
  req: AuthenticatedRequest,
  operation: MaintenanceOperation,
  mode: MaintenanceResultMode,
  batchSize: number,
  cursor: string | null,
  result: MaintenanceBatchResult & { deletedBytes?: number }
) {
  try {
    await prisma.moderationLog.create({
      data: {
        targetType: 'imageMap',
        targetId: 'media-maintenance',
        action: 'update',
        operatorUid: req.authUser!.uid,
        note: JSON.stringify({
          type: result.type,
          operation,
          mode,
          batchSize,
          cursor,
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
          scanned: result.scanned,
          processed: result.processed,
          skipped: result.skipped,
          failed: result.failed,
          queued: result.queued || 0,
          alreadyQueued: result.alreadyQueued || 0,
          skippedMissingSource: result.skippedMissingSource || 0,
          conflicts: result.conflicts || 0,
          orphanDeleted: operation === 'orphans/delete' ? result.processed : 0,
          orphanSkipped: operation.startsWith('orphans/') ? result.skipped : 0,
          orphanFailed: operation.startsWith('orphans/') ? result.failed : 0,
          orphanDeletedBytes: operation === 'orphans/delete' ? result.deletedBytes || 0 : 0,
        }),
      },
    })
  } catch (error) {
    logger.warn({ err: error, operation }, '维护操作审计日志写入失败')
  }
}

const runMaintenance = <Input, Result extends MaintenanceBatchResult>(
  operation: MaintenanceOperation,
  parse: (req: AuthenticatedRequest) => Input,
  handler: (input: Input, req: AuthenticatedRequest) => Promise<Result>,
  getMode: (input: Input) => MaintenanceResultMode,
  getBatchSize: (input: Input) => number
) =>
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const input = parse(req)
      const result = await handler(input, req)
      const cursor =
        typeof input === 'object' && input !== null && 'cursor' in input
          ? typeof input.cursor === 'string'
            ? input.cursor
            : null
          : null
      await logMaintenance(req, operation, getMode(input), getBatchSize(input), cursor, result)
      res.json({ success: true, data: result })
    } catch (error) {
      sendMaintenanceError(res, error)
    }
  })

const runBatch = (
  operation: BatchMaintenanceOperation,
  handler: (
    input: MaintenanceBatchInput,
    req: AuthenticatedRequest
  ) => Promise<MaintenanceBatchResult>
) =>
  runMaintenance(
    operation,
    (req) => mediaMaintenanceBatchSchema.parse(req.body),
    async (input, req) => {
      if (operation !== 'localize' && input.type !== 'all') {
        throw new MediaMaintenanceRequestError(400, 'type 只对 localize 操作生效')
      }
      const key = [
        operation,
        input.type,
        input.mode,
        input.batchSize,
        input.cursor || '',
        req.authUser!.uid,
      ].join(':')
      const existing = batchFlights.get(key)
      if (existing) return existing
      const promise = handler(input, req)
      batchFlights.set(key, promise)
      void promise
        .finally(() => {
          if (batchFlights.get(key) === promise) batchFlights.delete(key)
        })
        .catch(() => undefined)
      return promise
    },
    (input) => input.mode,
    (input) => input.batchSize
  )

router.get(
  '/scan',
  requireAdmin,
  runMaintenance(
    'scan',
    (req) => mediaMaintenanceScanQuerySchema.parse(req.query),
    (input) => {
      if (input.type !== 'all') {
        throw new MediaMaintenanceRequestError(400, 'type 只对 localize 操作生效')
      }
      return scanMediaMaintenance(input, prisma)
    },
    (input) => input.mode,
    (input) => input.limit
  )
)

router.post(
  '/reconcile',
  requireAdmin,
  runBatch('reconcile', (input) => reconcileMediaAssetsBatch(input))
)
router.post(
  '/bind-legacy',
  requireAdmin,
  runBatch('bind-legacy', (input) => bindLegacyMediaBatch(input))
)
router.post(
  '/localize',
  requireAdmin,
  runBatch('localize', (input, req) =>
    localizeMediaAssetsBatch({ ...input, operatorUid: req.authUser!.uid })
  )
)
router.post(
  '/repair-thumbnails',
  requireAdmin,
  runBatch('repair-thumbnails', (input) => repairMissingThumbnailsBatch(input))
)

router.post(
  '/orphans/preview',
  requireAdmin,
  runMaintenance(
    'orphans/preview',
    (req) => mediaMaintenanceOrphanPreviewSchema.parse(req.body),
    (input, req) => previewOrphanMediaBatch(input, prisma, uploadsDir, req.authUser!.uid),
    () => 'dry-run',
    (input) => input.batchSize
  )
)

router.post(
  '/orphans/delete',
  requireSuperAdmin,
  runMaintenance(
    'orphans/delete',
    (req) => mediaMaintenanceOrphanDeleteSchema.parse(req.body),
    (input, req) => deleteOrphanMediaBatch(input, prisma, uploadsDir, req.authUser!.uid),
    () => 'apply',
    (input) => input.storageKeys.length
  )
)

export function registerAdminMediaMaintenanceRoutes(app: Router) {
  app.use('/api/admin/media-maintenance', router)
}
