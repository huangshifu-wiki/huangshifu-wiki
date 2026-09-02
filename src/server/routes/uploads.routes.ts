import type { Router } from 'express'
import multer from 'multer'
import { prisma } from '../prisma'
import { requireAuth, requireActiveUser, requireAdmin } from '../middleware/auth'
import type { AuthenticatedRequest } from '../types'
import { asyncHandler } from '../middleware/asyncHandler'
import { uploadLimiter } from '../middleware/rateLimiter'
import { createRouter } from '../utils/typed-router'
import {
  createUploadSessionExpiresAt,
  isUploadSessionExpired,
  validateUploadedImage,
  deleteFromSuperbed,
  safeDeleteUploadFileByStorageKey,
  logger,
  toUploadSessionResponse,
} from '../utils'
import {
  createAssetClaimForImageMap,
  createOrReuseUploadedAsset,
  MediaAssetRequestError,
  releaseMediaAsset,
  rollbackUploadSessionSlot,
} from '../services/mediaAssetService'
import { variantGenerator } from '../services/variantGenerator'
import { secretsConfigService } from '../services/secretsConfig.service'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'
import { UPLOAD_MAX_FILE_SIZE_BYTES } from '../../lib/uploadLimits'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// uploads.routes.ts 在 src/server/routes/ 下，向上3级到项目根目录
const uploadsDir = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', '..', 'uploads')

const router = createRouter()

// 配置 multer 用于处理文件上传
// 使用与 validateUploadedImage 一致的扩展名 + MIME 白名单（JPG/PNG/WEBP/GIF/BMP），
// 拒绝 SVG/AVIF/HEIC 等可能携带脚本或服务端不支持的格式。
const ALLOWED_UPLOAD_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
])

class UploadSessionRequestError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message)
    this.name = 'UploadSessionRequestError'
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, uploadsDir)
    },
    filename: (_req, file, cb) => {
      // 使用随机文件名，避免中文和特殊字符问题
      const ext = path.extname(file.originalname).toLowerCase()
      const randomName = `${crypto.randomUUID()}${ext}`
      cb(null, randomName)
    },
  }),
  limits: {
    fileSize: UPLOAD_MAX_FILE_SIZE_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    const mime = (file.mimetype || '').toLowerCase()
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext) || !ALLOWED_UPLOAD_MIME_TYPES.has(mime)) {
      cb(new Error('仅支持 JPG、PNG、WEBP、GIF、BMP 图片上传'))
      return
    }
    cb(null, true)
  },
})

/**
 * POST /api/uploads/sessions - 创建上传会话
 */
router.post(
  '/sessions',
  requireAuth,
  requireActiveUser,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const maxFilesRaw = req.body?.maxFiles
      let maxFiles = 50
      if (maxFilesRaw !== undefined) {
        const parsedMaxFiles = Number(maxFilesRaw)
        if (!Number.isInteger(parsedMaxFiles) || parsedMaxFiles < 1 || parsedMaxFiles > 50) {
          res.status(400).json({ error: 'maxFiles 必须是 1 到 50 之间的整数' })
          return
        }
        maxFiles = parsedMaxFiles
      }

      const session = await prisma.uploadSession.create({
        data: {
          ownerUid: req.authUser!.uid,
          status: 'open',
          expiresAt: createUploadSessionExpiresAt(),
          maxFiles,
        },
      })

      res.status(201).json({
        session: {
          id: session.id,
          ownerUid: session.ownerUid,
          status: session.status,
          expiresAt: session.expiresAt.toISOString(),
          maxFiles: session.maxFiles,
          uploadedFiles: session.uploadedFiles,
        },
      })
    } catch (error) {
      console.error('Create upload session error:', error)
      res.status(500).json({ error: '创建上传会话失败' })
    }
  })
)

router.get(
  '/sessions/:sessionId',
  requireAuth,
  requireActiveUser,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { sessionId } = req.params
      const session = await prisma.uploadSession.findUnique({ where: { id: sessionId } })
      if (!session) {
        res.status(404).json({ error: '上传会话不存在' })
        return
      }
      if (session.ownerUid !== req.authUser!.uid) {
        res.status(403).json({ error: '无权访问该会话' })
        return
      }

      let current = session
      if (current.status !== 'finalized' && isUploadSessionExpired(current.expiresAt)) {
        current = await prisma.uploadSession.update({
          where: { id: current.id },
          data: { status: 'expired' },
        })
      }

      res.json({ session: toUploadSessionResponse(current) })
    } catch (error) {
      logger.error({ err: error }, 'Get upload session error')
      res.status(500).json({ error: '获取上传会话失败' })
    }
  })
)

/**
 * POST /api/uploads/sessions/:sessionId/files - 上传文件到会话
 */
router.post(
  '/sessions/:sessionId/files',
  requireAuth,
  requireActiveUser,
  uploadLimiter,
  upload.single('file'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const file = req.file
    const { sessionId } = req.params
    let createdAssetId: string | undefined
    let cleanedUp = false

    const cleanupTempFile = async () => {
      if (!file || cleanedUp) return
      cleanedUp = true
      await safeDeleteUploadFileByStorageKey(file.filename).catch((error) =>
        logger.debug({ err: error }, 'Temp file cleanup failed')
      )
    }

    try {
      if (!file) {
        res.status(400).json({ error: '请上传文件' })
        return
      }

      const { mimeType } = await validateUploadedImage(file)
      const result = await createOrReuseUploadedAsset({
        ownerUid: req.authUser!.uid,
        tempFilePath: file.path,
        originalFileName: file.originalname,
        mimeType,
        sizeBytes: file.size,
        sessionId,
      })
      createdAssetId = result.assetId

      if (result.localFilePath) {
        try {
          await variantGenerator.enqueue({
            targetType: 'imageMap',
            targetId: result.imageMapId,
            localFilePath: result.localFilePath,
            priority: 'normal',
          })
        } catch (error) {
          await releaseMediaAsset(result.assetId, req.authUser!.uid).catch((releaseError) =>
            logger.error(
              { err: releaseError, assetId: result.assetId },
              'Failed to release upload claim'
            )
          )
          if (sessionId) await rollbackUploadSessionSlot(sessionId)
          await cleanupTempFile()
          res.status(500).json({ error: '上传后处理失败，媒体资源已释放' })
          return
        }
      }

      const session = await prisma.uploadSession.findUnique({ where: { id: sessionId } })
      if (!session) {
        await releaseMediaAsset(result.assetId, req.authUser!.uid)
        res.status(404).json({ error: '上传会话不存在' })
        return
      }

      const response = {
        session: toUploadSessionResponse(session),
        asset: result.asset,
        ...(req.query.tripleStorage === 'true'
          ? {
              tripleStorage: {
                localUrl: result.localUrl,
                ...(result.s3Url ? { s3Url: result.s3Url } : {}),
                ...(result.externalUrl ? { externalUrl: result.externalUrl } : {}),
              },
            }
          : {}),
        storageErrors: result.storageErrors,
      }
      res.status(201).json(response)
    } catch (error) {
      if (createdAssetId) {
        await releaseMediaAsset(createdAssetId, req.authUser!.uid).catch((releaseError) =>
          logger.error(
            { err: releaseError, assetId: createdAssetId },
            'Failed to release upload claim'
          )
        )
        await rollbackUploadSessionSlot(sessionId).catch((rollbackError) =>
          logger.debug({ err: rollbackError, sessionId }, 'Upload session slot rollback failed')
        )
      }
      await cleanupTempFile()

      if (error instanceof MediaAssetRequestError) {
        res.status(error.statusCode).json({ error: error.message })
        return
      }
      const message = error instanceof Error ? error.message : '上传文件失败'
      if (message.includes('图片') || message.includes('文件') || message.includes('超过')) {
        res.status(400).json({ error: message })
        return
      }
      logger.error({ err: error }, 'Upload file to session error')
      res.status(500).json({ error: '上传文件失败' })
    }
  })
)

/**
 * POST /api/uploads/sessions/:sessionId/finalize - 完成上传会话
 */
router.post(
  '/sessions/:sessionId/finalize',
  requireAuth,
  requireActiveUser,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { sessionId } = req.params
      const finalizedSession = await prisma.$transaction(async (tx) => {
        const session = await tx.uploadSession.findUnique({ where: { id: sessionId } })
        if (!session) throw new MediaAssetRequestError(404, '上传会话不存在')
        if (session.ownerUid !== req.authUser!.uid) {
          throw new MediaAssetRequestError(403, '无权操作该会话')
        }
        if (session.status === 'finalized') return session
        if (session.status === 'expired' || isUploadSessionExpired(session.expiresAt)) {
          if (session.status !== 'expired') {
            await tx.uploadSession.update({
              where: { id: session.id },
              data: { status: 'expired' },
            })
          }
          throw new MediaAssetRequestError(410, '上传会话已过期')
        }
        if (session.uploadedFiles < 1) {
          throw new MediaAssetRequestError(400, '不能完成空上传会话')
        }

        const updated = await tx.uploadSession.updateMany({
          where: {
            id: session.id,
            ownerUid: req.authUser!.uid,
            status: 'open',
            expiresAt: { gt: new Date() },
            uploadedFiles: { gt: 0 },
          },
          data: { status: 'finalized' },
        })
        if (updated.count !== 1) throw new MediaAssetRequestError(409, '上传会话状态已变化')

        await tx.mediaAsset.updateMany({
          where: { sessionId: session.id, status: 'uploaded' },
          data: { status: 'ready' },
        })
        return tx.uploadSession.findUniqueOrThrow({ where: { id: session.id } })
      })

      res.json({ session: toUploadSessionResponse(finalizedSession) })
    } catch (error) {
      if (error instanceof MediaAssetRequestError) {
        res.status(error.statusCode).json({ error: error.message })
        return
      }
      logger.error({ err: error }, 'Finalize upload session error')
      res.status(500).json({ error: '完成上传会话失败' })
    }
  })
)

router.post(
  '/assets/reuse',
  requireAuth,
  requireActiveUser,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const body = req.body as {
        imageMapId?: unknown
        fileName?: unknown
        mimeType?: unknown
        sizeBytes?: unknown
      }
      if (
        typeof body.imageMapId !== 'string' ||
        !body.imageMapId.trim() ||
        typeof body.fileName !== 'string' ||
        !body.fileName.trim() ||
        typeof body.mimeType !== 'string' ||
        !ALLOWED_UPLOAD_MIME_TYPES.has(body.mimeType.toLowerCase()) ||
        !Number.isInteger(body.sizeBytes) ||
        Number(body.sizeBytes) < 1 ||
        Number(body.sizeBytes) > UPLOAD_MAX_FILE_SIZE_BYTES
      ) {
        res.status(400).json({ error: '复用媒体资源参数不合法' })
        return
      }

      const result = await createAssetClaimForImageMap({
        ownerUid: req.authUser!.uid,
        imageMapId: body.imageMapId.trim(),
        fileName: body.fileName.trim(),
        mimeType: body.mimeType.toLowerCase(),
        sizeBytes: Number(body.sizeBytes),
      })
      res.status(201).json({ asset: result.asset, storageErrors: result.storageErrors })
    } catch (error) {
      if (error instanceof MediaAssetRequestError) {
        res.status(error.statusCode).json({ error: error.message })
        return
      }
      logger.error({ err: error }, 'Reuse media asset error')
      res.status(500).json({ error: '复用媒体资源失败' })
    }
  })
)

router.delete(
  '/assets/:assetId',
  requireAuth,
  requireActiveUser,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      await releaseMediaAsset(req.params.assetId, req.authUser!.uid)
      res.json({ success: true })
    } catch (error) {
      if (error instanceof MediaAssetRequestError) {
        res.status(error.statusCode).json({ error: error.message })
        return
      }
      logger.error({ err: error, assetId: req.params.assetId }, 'Release media asset error')
      res.status(500).json({ error: '释放媒体资源失败' })
    }
  })
)

/**
 * DELETE /api/uploads/sessions/:sessionId - 删除/取消上传会话
 */
router.delete(
  '/sessions/:sessionId',
  requireAuth,
  requireActiveUser,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { sessionId } = req.params
      const assetIds = await prisma.$transaction(async (tx) => {
        const session = await tx.uploadSession.findUnique({
          where: { id: sessionId },
          select: { id: true, ownerUid: true, status: true, assets: { select: { id: true } } },
        })
        if (!session) throw new MediaAssetRequestError(404, '上传会话不存在')
        if (session.ownerUid !== req.authUser!.uid) {
          throw new MediaAssetRequestError(403, '无权操作该会话')
        }
        if (session.status === 'finalized') {
          throw new MediaAssetRequestError(409, '已完成的上传会话不能取消')
        }
        if (session.status !== 'open' && session.status !== 'expired') {
          throw new MediaAssetRequestError(409, '会话状态不正确')
        }

        await tx.mediaAsset.updateMany({
          where: { sessionId: session.id, status: { not: 'deleted' } },
          data: { status: 'deleted' },
        })
        await tx.uploadSession.delete({ where: { id: session.id } })
        return session.assets.map((asset) => asset.id)
      })

      await Promise.all(
        assetIds.map((assetId) =>
          releaseMediaAsset(assetId, req.authUser!.uid).catch((error) => {
            logger.error({ err: error, assetId }, 'Failed to retire cancelled upload claim')
          })
        )
      )
      res.json({ success: true })
    } catch (error) {
      if (error instanceof MediaAssetRequestError) {
        res.status(error.statusCode).json({ error: error.message })
        return
      }
      logger.error({ err: error }, 'Delete upload session error')
      res.status(500).json({ error: '删除上传会话失败' })
    }
  })
)

/**
 * DELETE /api/uploads/superbed - 从 Superbed 删除图片
 * Body: { imageIds: string[] }
 */
router.delete(
  '/superbed',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
      const { imageIds } = req.body as { imageIds?: string[] }

      if (!imageIds || !Array.isArray(imageIds) || imageIds.length === 0) {
        res.status(400).json({ error: '请提供要删除的图片 ID 列表' })
        return
      }

      if (imageIds.length > 1000) {
        res.status(400).json({ error: '每次最多删除 1000 张图片' })
        return
      }

      const superbedToken = secretsConfigService.getSecrets().superbedApiToken
      if (!superbedToken) {
        res.status(400).json({ error: 'Superbed API Token 未配置' })
        return
      }

      const result = await deleteFromSuperbed(imageIds, superbedToken)

      if (result.success) {
        res.json({ success: true, deletedCount: imageIds.length })
      } else {
        res.status(500).json({ error: result.error || '删除图片失败' })
      }
    } catch (error) {
      console.error('Delete from Superbed error:', error)
      res.status(500).json({ error: '删除图片失败' })
    }
  })
)

export function registerUploadRoutes(app: Router) {
  app.use('/api/uploads', router)
}
