import type { Router } from 'express'
import { Router as createRouter } from 'express'
import { prisma } from '../prisma'
import { requireAdmin } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import type { AuthenticatedRequest } from '../types'
import { uploadsDir } from '../utils'
import {
  cleanupMediaHealthRecords,
  scanMediaHealth,
  type MediaHealthCleanupTarget,
  type MediaHealthRecordType,
  type MediaHealthScanMode,
} from '../services/mediaHealth.service'

const router = createRouter()

function parseMode(value: unknown): MediaHealthScanMode {
  return value === 'business' ? 'business' : 'strict'
}

function parseLimit(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 200
  return Math.max(1, Math.min(Math.floor(parsed), 1000))
}

function isRecordType(value: unknown): value is MediaHealthRecordType {
  return value === 'mediaAsset' || value === 'imageMap'
}

function parseCleanupTargets(value: unknown): MediaHealthCleanupTarget[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const candidate = item as { recordType?: unknown; id?: unknown }
      if (!isRecordType(candidate.recordType) || typeof candidate.id !== 'string') return null
      const id = candidate.id.trim()
      if (!id) return null
      return { recordType: candidate.recordType, id }
    })
    .filter((item): item is MediaHealthCleanupTarget => Boolean(item))
    .slice(0, 100)
}

router.get(
  '/scan',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = await scanMediaHealth(prisma, {
      uploadDir: uploadsDir,
      mode: parseMode(req.query.mode),
      limit: parseLimit(req.query.limit),
    })
    res.json({ success: true, data: result })
  })
)

router.post(
  '/cleanup',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const targets = parseCleanupTargets((req.body as { targets?: unknown })?.targets)
    if (targets.length === 0) {
      res.status(400).json({ success: false, error: '请选择要清理的媒体记录' })
      return
    }

    const results = await cleanupMediaHealthRecords(prisma, {
      mode: parseMode((req.body as { mode?: unknown })?.mode),
      targets,
      deletedBy: req.authUser?.uid || null,
    })
    const summary = results.reduce(
      (current, item) => ({
        cleaned: current.cleaned + (item.success ? 1 : 0),
        skipped: current.skipped + (item.skipped ? 1 : 0),
      }),
      { cleaned: 0, skipped: 0 }
    )

    res.json({
      success: true,
      data: {
        total: results.length,
        ...summary,
        results,
      },
    })
  })
)

export function registerAdminMediaHealthRoutes(app: Router) {
  app.use('/api/admin/media-health', router)
}
