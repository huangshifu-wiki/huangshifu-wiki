/**
 * 变体生成器 - v2.2 统一引擎（图片变体 + 音乐封面缩略图）
 *
 * 功能：
 * 1. 统一生成图片变体（1080h WebP）与音乐封面缩略图（320px WebP）
 * 2. 任务超时保护（防止单个任务卡死）
 * 3. 队列等待时间限制
 * 4. Sharp 内存限制（防止 OOM）
 * 5. 失败重试与状态跟踪
 */

import { prisma } from '../prisma'
import { runtimeConfigService } from './runtimeConfig.service'
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolveUploadPathByUrl } from '../utils/upload'
import { getSharpInputPixelLimit, isSharpPixelLimitError } from '../utils/sharpSafe'
import {
  buildUploadPublicUrl,
  createUploadStorageInfo,
  resolveUploadPathByStorageKey,
} from '../uploadPath'
import {
  MUSIC_COVER_THUMBNAIL_SIZE,
  MUSIC_COVER_THUMBNAIL_QUALITY,
  deleteMusicCoverThumbnail,
} from './musicCoverThumbnail.service'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const uploadsDir = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', '..', 'uploads')

export type VariantTargetType = 'imageMap' | 'songCover' | 'albumCover'

export interface VariantTask {
  targetType: VariantTargetType
  targetId: string
  localFilePath: string
  priority: 'high' | 'normal' | 'low'
  createdAt: Date
  retryCount: number
  maxRetries: number
  /** Set only after a database-backed maintenance claim. */
  databaseClaimed?: boolean
}

export interface VariantMetadata {
  name: string
  path: string
  sizeBytes: number
  width: number
  height: number
}

export interface VariantGeneratorStats {
  queueLength: number
  processingCount: number
  completedToday: number
  failedToday: number
  averageProcessingTime: number
  timeoutCount: number
}

interface VariantSpec {
  name: string
  maxWidth: number | null
  maxHeight: number | null
  quality: number
}

interface VariantGeneratorOptions {
  autoStart?: boolean
  processOnEnqueue?: boolean
}

function getVariantConfig() {
  return runtimeConfigService.getConfig()
}
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class VariantGenerator {
  private queue: VariantTask[] = []
  private processing = new Set<string>()
  private queued = new Set<string>()
  private tasks = new Map<string, VariantTask>()
  private processOnEnqueue: boolean

  private imageMapVariantSpecs: VariantSpec[] = [
    { name: '1080h', maxWidth: null, maxHeight: 1080, quality: 85 },
  ]

  private stats = {
    completedToday: 0,
    failedToday: 0,
    totalProcessingTime: 0,
    processedCount: 0,
    timeoutCount: 0,
  }

  private processInterval: NodeJS.Timeout | null = null
  private retryTimers = new Set<NodeJS.Timeout>()

  constructor(options: VariantGeneratorOptions = {}) {
    this.processOnEnqueue = options.processOnEnqueue ?? true

    if (options.autoStart === false) {
      return
    }

    this.startQueueProcessor()
    this.recoverPendingTasks()

    console.log(`[Variant] ✅ Generator initialized`)
  }

  /**
   * 生成任务去重键
   */
  getTaskKey(task: { targetType: VariantTargetType; targetId: string }): string {
    return `${task.targetType}:${task.targetId}`
  }
  hasTask(targetType: VariantTargetType, targetId: string): boolean {
    const taskKey = this.getTaskKey({ targetType, targetId })
    return this.processing.has(taskKey) || this.queued.has(taskKey)
  }

  private async resetRecoveredProcessingState(targetType: VariantTargetType, targetId: string) {
    if (this.hasTask(targetType, targetId)) return
    if (targetType === 'imageMap') {
      await prisma.imageMap.updateMany({
        where: { id: targetId, deletedAt: null, thumbnailUrl: null, variantStatus: 'processing' },
        data: { variantStatus: 'pending' },
      })
      return
    }
    if (targetType === 'songCover') {
      await prisma.songCover.updateMany({
        where: { id: targetId, thumbnailUrl: null, variantStatus: 'processing' },
        data: { variantStatus: 'pending' },
      })
      return
    }
    await prisma.albumCover.updateMany({
      where: { id: targetId, thumbnailUrl: null, variantStatus: 'processing' },
      data: { variantStatus: 'pending' },
    })
  }

  private async recoverCoverTasks(
    targetType: 'songCover' | 'albumCover',
    covers: Array<{ id: string; storageKey: string }>
  ): Promise<void> {
    await Promise.all(
      covers.map(async (cover) => {
        await this.resetRecoveredProcessingState(targetType, cover.id)
        await this.recoverTask(
          targetType,
          cover.id,
          resolveUploadPathByStorageKey(cover.storageKey, uploadsDir)
        )
      })
    )
  }

  /**
   * 恢复未完成的任务（图片 + 音乐封面，三表查询）
   */
  private async recoverPendingTasks(): Promise<void> {
    try {
      const [imageMaps, songCovers, albumCovers] = await Promise.all([
        prisma.imageMap.findMany({
          where: {
            deletedAt: null,
            OR: [
              { variantStatus: { in: ['pending', 'processing'] } },
              { variantStatus: 'completed', thumbnailUrl: null },
            ],
          },
          select: {
            id: true,
            localUrl: true,
            mediaAssets: {
              where: { status: { in: ['uploaded', 'ready'] } },
              select: { storageKey: true, publicUrl: true },
              orderBy: { id: 'asc' },
            },
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
        prisma.songCover.findMany({
          where: {
            variantStatus: { in: ['pending', 'processing'] },
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
        prisma.albumCover.findMany({
          where: {
            variantStatus: { in: ['pending', 'processing'] },
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      ])

      const pendingCount = imageMaps.length + songCovers.length + albumCovers.length

      if (pendingCount > 0) {
        console.log(`[Variant] 🔄 Recovering ${pendingCount} pending tasks...`)
      }
      await Promise.all([
        ...imageMaps.map(async (imageMap) => {
          await this.resetRecoveredProcessingState('imageMap', imageMap.id)
          return this.recoverTask(
            'imageMap',
            imageMap.id,
            await this.findReadableSource([
              this.urlToAbsolutePath(imageMap.localUrl),
              ...(imageMap.mediaAssets || []).map((asset) =>
                resolveUploadPathByStorageKey(asset.storageKey || '', uploadsDir)
              ),
              ...(imageMap.mediaAssets || []).map((asset) =>
                resolveUploadPathByUrl(asset.publicUrl || '')
              ),
            ])
          )
        }),
        this.recoverCoverTasks('songCover', songCovers),
        this.recoverCoverTasks('albumCover', albumCovers),
      ])
    } catch (error) {
      console.error('[Variant] ❌ Error recovering pending tasks:', error)
    }
  }
  private async findReadableSource(candidates: Array<string | null>) {
    for (const candidate of candidates) {
      if (!candidate) continue
      try {
        const stat = await fs.promises.stat(candidate)
        if (stat.isFile()) return candidate
      } catch {
        // Try the next canonical or claim-backed source.
      }
    }
    return null
  }

  private async recoverTask(
    targetType: VariantTargetType,
    targetId: string,
    filePath: string | null
  ): Promise<void> {
    try {
      if (!filePath) {
        throw new Error('Source file path invalid')
      }
      await fs.promises.access(filePath, fs.constants.R_OK)

      const accepted = await this.enqueue({
        targetType,
        targetId,
        localFilePath: filePath,
        priority: 'low',
      })
      if (!accepted) return
    } catch {
      console.warn(`[Variant] ⚠️ Skipping recovery for ${targetType}:${targetId}: file not found`)
      await this.markAsFailed(targetType, targetId, 'Source file missing', true)
    }
  }

  /**
   * 入队变体生成任务
   */
  async enqueue(
    task: Omit<VariantTask, 'retryCount' | 'maxRetries' | 'createdAt'>
  ): Promise<boolean> {
    return this.enqueueInternal(task, false)
  }

  /**
   * Enqueue a task whose target row was already transitioned to processing by
   * a short database transaction. This is intentionally separate from the
   * normal entry point so ordinary callers cannot bypass their state claim.
   */
  async enqueueClaimed(
    task: Omit<VariantTask, 'retryCount' | 'maxRetries' | 'createdAt' | 'databaseClaimed'>
  ): Promise<boolean> {
    return this.enqueueInternal(task, true)
  }

  private async enqueueInternal(
    task: Omit<VariantTask, 'retryCount' | 'maxRetries' | 'createdAt'>,
    databaseClaimed: boolean
  ): Promise<boolean> {
    const taskKey = this.getTaskKey(task)
    const existingTask = this.tasks.get(taskKey)
    if (existingTask || this.processing.has(taskKey) || this.queued.has(taskKey)) {
      if (databaseClaimed && existingTask) {
        existingTask.databaseClaimed = true
        existingTask.localFilePath = task.localFilePath
      }
      console.log(`[Variant] ⏭️ Task already queued or processing: ${taskKey}`)
      return false
    }
    const fullTask: VariantTask = {
      ...task,
      ...(databaseClaimed ? { databaseClaimed: true } : {}),
      retryCount: 0,
      maxRetries: getVariantConfig().variantMaxRetries,
      createdAt: new Date(),
    }
    this.tasks.set(taskKey, fullTask)
    this.queued.add(taskKey)

    if (task.priority === 'high') {
      this.queue.unshift(fullTask)
    } else {
      this.queue.push(fullTask)
    }

    console.log(`[Variant] 📥 Task enqueued: ${taskKey}`)
    if (this.processOnEnqueue) {
      this.processNext()
    }
    return true
  }

  /**
   * 启动队列处理器
   */
  private startQueueProcessor(): void {
    this.processInterval = setInterval(() => this.processNext(), 500)
    this.processNext()
  }

  stop() {
    if (this.processInterval) {
      clearInterval(this.processInterval)
      this.processInterval = null
    }
    for (const timer of this.retryTimers) clearTimeout(timer)
    this.retryTimers.clear()
  }

  /**
   * 处理下一个任务
   */
  private processNext(): void {
    const maxConcurrent = getVariantConfig().variantMaxConcurrent
    while (this.processing.size < maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift()!
      const taskKey = this.getTaskKey(task)
      this.queued.delete(taskKey)
      if (this.processing.has(taskKey)) continue
      this.processing.add(taskKey)
      void this.processTask(task)
        .catch((error) => console.error('[Variant] ❌ Task processing error:', error))
        .finally(() => {
          this.processing.delete(taskKey)
          if (!this.queued.has(taskKey)) this.tasks.delete(taskKey)
          this.processNext()
        })
    }
  }

  /**
   * 处理单个变体生成任务（带超时保护）
   */
  private async processTask(task: VariantTask): Promise<void> {
    const taskKey = this.getTaskKey(task)

    console.log(
      `[Variant] ⚙️ Processing: ${taskKey} ` + `(retry=${task.retryCount}/${task.maxRetries})`
    )

    const startTime = Date.now()
    let claimed = false

    try {
      // ===== 检查 1: 队列等待时间超限 =====
      const waitTime = Date.now() - task.createdAt.getTime()
      if (waitTime > getVariantConfig().variantQueueMaxWaitMs) {
        console.warn(
          `[Variant] ⏰ Task ${taskKey} exceeded max wait time (${waitTime}ms), skipping`
        )
        await this.markAsFailed(
          task.targetType,
          task.targetId,
          'Queue wait timeout',
          task.databaseClaimed === true
        )
        return
      }

      // ===== 检查 2: 文件是否存在 =====
      try {
        await fs.promises.access(task.localFilePath, fs.constants.R_OK)
      } catch {
        console.error(`[Variant] ❌ File not found: ${task.localFilePath}`)
        await this.markAsFailed(
          task.targetType,
          task.targetId,
          'Source file missing',
          task.databaseClaimed === true
        )
        return
      }

      // ===== 更新状态为 processing =====
      claimed = await this.markAsProcessing(task)
      if (!claimed) return

      // ===== 执行变体生成（带超时保护）=====
      const taskTimeoutMs = getVariantConfig().variantTaskTimeoutMs
      let timeoutId: NodeJS.Timeout

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Variant generation timeout (${taskTimeoutMs}ms)`))
        }, taskTimeoutMs)
      })

      try {
        await Promise.race([this.generateVariantsWithSharp(task), timeoutPromise])

        clearTimeout(timeoutId)

        // 更新统计信息
        const processingTime = Date.now() - startTime
        this.stats.completedToday++
        this.stats.totalProcessingTime += processingTime
        this.stats.processedCount++

        console.log(`[Variant] ✅ Completed: ${taskKey} (${processingTime}ms)`)
      } catch (error) {
        clearTimeout(timeoutId)
        const reason = getErrorMessage(error)

        if (reason.includes('timeout')) {
          this.stats.timeoutCount++
          console.error(`[Variant] ⏰ Timeout: ${taskKey}`)

          // 触发垃圾回收（如果可用）
          const gc = (globalThis as { gc?: () => void }).gc
          if (gc) gc()

          throw error // 让外层重试逻辑处理
        }
        throw error
      }
    } catch (error) {
      const reason = getErrorMessage(error)
      console.error(`[Variant] ❌ Failed: ${taskKey}:`, error)

      this.stats.failedToday++

      await this.markAsFailed(
        task.targetType,
        task.targetId,
        reason,
        claimed || task.databaseClaimed === true
      )
      if (task.retryCount < task.maxRetries) {
        const delay = Math.pow(2, task.retryCount) * 1000
        console.log(
          `[Variant] 🔄 Retrying in ${delay}ms... ` + `(${task.retryCount + 1}/${task.maxRetries})`
        )

        task.retryCount++

        this.queued.add(taskKey)
        let retryTimer: NodeJS.Timeout
        retryTimer = setTimeout(() => {
          this.retryTimers.delete(retryTimer)
          this.queue.unshift(task) // 插到队首优先重试
          this.processNext()
        }, delay)
        this.retryTimers.add(retryTimer)
      } else {
        console.error(`[Variant] 💀 Gave up after ${task.maxRetries} retries`)
      }
    }
  }

  /**
   * 使用 Sharp 生成变体
   */
  private async generateVariantsWithSharp(
    task: VariantTask
  ): Promise<Map<string, VariantMetadata>> {
    const variants = new Map<string, VariantMetadata>()
    const generatedPaths = new Set<string>()
    const pixelLimit = getSharpInputPixelLimit()

    try {
      const metadata = await sharp(task.localFilePath, {
        limitInputPixels: pixelLimit,
      }).metadata()

      console.log(
        `[Variant] Processing ${task.targetType}:${task.targetId}: ` +
          `${metadata.width}x${metadata.height} ${metadata.format}`
      )

      if (task.targetType === 'imageMap') {
        // 图片变体：单一 1080h WebP → uploads/variants/{id}/
        const outputDir = path.join(uploadsDir, 'variants', task.targetId)
        await fs.promises.mkdir(outputDir, { recursive: true })

        const variantPromises = this.imageMapVariantSpecs.map(async (spec) => {
          const outputPath = path.join(outputDir, `${spec.name}.webp`)
          generatedPaths.add(outputPath)
          const result = await sharp(task.localFilePath, {
            limitInputPixels: pixelLimit,
          })
            .resize(spec.maxWidth ?? undefined, spec.maxHeight ?? undefined, {
              fit: 'inside',
              withoutEnlargement: true,
            })
            .webp({ quality: spec.quality })
            .toFile(outputPath)

          const stat = await fs.promises.stat(outputPath)

          const variantMeta: VariantMetadata = {
            name: spec.name,
            path: `/uploads/variants/${task.targetId}/${spec.name}.webp`,
            sizeBytes: stat.size,
            width: result.width,
            height: result.height,
          }

          variants.set(spec.name, variantMeta)

          console.log(
            `[Variant] Generated ${spec.name}: ${result.width}x${result.height} ` +
              `(${this.formatBytes(stat.size)})`
          )
        })

        await Promise.all(variantPromises)
      } else {
        // 音乐封面缩略图：320px/quality80 WebP → uploads/music-covers/thumbnails/
        const sourceBaseName =
          path.basename(task.localFilePath, path.extname(task.localFilePath)) || 'cover'
        const storageInfo = createUploadStorageInfo(
          uploadsDir,
          'music-covers/thumbnails',
          `${sourceBaseName}.webp`
        )
        const outputPath = path.join(storageInfo.absoluteDir, storageInfo.fileName)
        generatedPaths.add(outputPath)
        const result = await sharp(task.localFilePath, {
          limitInputPixels: pixelLimit,
        })
          .resize(MUSIC_COVER_THUMBNAIL_SIZE, MUSIC_COVER_THUMBNAIL_SIZE, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: MUSIC_COVER_THUMBNAIL_QUALITY })
          .toFile(outputPath)

        const stat = await fs.promises.stat(outputPath)

        variants.set('thumb', {
          name: 'thumb',
          path: buildUploadPublicUrl(storageInfo.storageKey),
          sizeBytes: stat.size,
          width: result.width,
          height: result.height,
        })

        console.log(
          `[Variant] Generated thumb: ${result.width}x${result.height} ` +
            `(${this.formatBytes(stat.size)})`
        )
      }

      try {
        await this.saveVariantUrls(task, variants)
      } catch (error) {
        await this.removeGeneratedFiles(generatedPaths)
        generatedPaths.clear()
        throw error
      }

      return variants
    } catch (error) {
      await this.removeGeneratedFiles(generatedPaths)
      if (isSharpPixelLimitError(error)) {
        throw new Error(`Image too large (max ${getSharpInputPixelLimit()} pixels)`)
      }
      throw error
    }
  }

  private async removeGeneratedFiles(paths: Set<string>) {
    await Promise.all(
      [...paths].map((filePath) => fs.promises.unlink(filePath).catch(() => undefined))
    )
  }

  /**
   * 保存变体 URL 到数据库（按目标类型分发）
   */
  private async saveVariantUrls(
    task: VariantTask,
    variants: Map<string, VariantMetadata>
  ): Promise<void> {
    if (task.targetType === 'imageMap') {
      const variant = variants.get('1080h')
      if (!variant?.path) throw new Error('变体生成未产生缩略图')
      const updated = await prisma.imageMap.updateMany({
        where: {
          id: task.targetId,
          deletedAt: null,
          variantStatus: 'processing',
          thumbnailUrl: null,
        },
        data: { thumbnailUrl: variant.path, variantStatus: 'completed' },
      })
      if (updated.count !== 1) throw new Error('变体目标状态已变化')
      return
    }
    const thumbnailUrl = variants.get('thumb')?.path || null
    try {
      const data = {
        thumbnailUrl,
        variantStatus: 'completed' as const,
        variantGeneratedAt: new Date(),
        lastError: null,
      }
      const updated =
        task.targetType === 'songCover'
          ? await prisma.songCover.updateMany({
              where: { id: task.targetId, variantStatus: 'processing', thumbnailUrl: null },
              data,
            })
          : await prisma.albumCover.updateMany({
              where: { id: task.targetId, variantStatus: 'processing', thumbnailUrl: null },
              data,
            })
      if (updated.count !== 1) throw new Error('变体目标状态已变化')
    } catch (error) {
      if (thumbnailUrl) await deleteMusicCoverThumbnail(thumbnailUrl)
      throw error
    }
  }

  /**
   * 标记任务为 processing
   */
  private async markAsProcessing(task: VariantTask): Promise<boolean> {
    if (task.targetType === 'imageMap') {
      if (task.databaseClaimed && task.retryCount === 0) {
        const updated = await prisma.imageMap.updateMany({
          where: {
            id: task.targetId,
            deletedAt: null,
            thumbnailUrl: null,
            variantStatus: 'processing',
          },
          data: { variantStatus: 'processing' },
        })
        return updated.count === 1
      }
      const updated = await prisma.imageMap.updateMany({
        where: {
          id: task.targetId,
          deletedAt: null,
          thumbnailUrl: null,
          variantStatus: { in: ['pending', 'failed', 'completed'] },
        },
        data: { variantStatus: 'processing' },
      })
      return updated.count === 1
    }
    if (task.targetType === 'songCover') {
      if (task.databaseClaimed && task.retryCount === 0) {
        const updated = await prisma.songCover.updateMany({
          where: { id: task.targetId, thumbnailUrl: null, variantStatus: 'processing' },
          data: { variantStatus: 'processing' },
        })
        return updated.count === 1
      }
      const updated = await prisma.songCover.updateMany({
        where: {
          id: task.targetId,
          thumbnailUrl: null,
          variantStatus: { in: ['pending', 'failed'] },
        },
        data: { variantStatus: 'processing' },
      })
      return updated.count === 1
    }
    if (task.databaseClaimed && task.retryCount === 0) {
      const updated = await prisma.albumCover.updateMany({
        where: { id: task.targetId, thumbnailUrl: null, variantStatus: 'processing' },
        data: { variantStatus: 'processing' },
      })
      return updated.count === 1
    }
    const updated = await prisma.albumCover.updateMany({
      where: {
        id: task.targetId,
        thumbnailUrl: null,
        variantStatus: { in: ['pending', 'failed'] },
      },
      data: { variantStatus: 'processing' },
    })
    return updated.count === 1
  }
  private async markAsFailed(
    targetType: VariantTargetType,
    targetId: string,
    reason: string,
    allowProcessing = false
  ): Promise<void> {
    const statuses: Array<'pending' | 'processing'> = allowProcessing
      ? ['pending', 'processing']
      : ['pending']
    if (targetType === 'imageMap') {
      await prisma.imageMap.updateMany({
        where: allowProcessing
          ? { id: targetId, variantStatus: { in: statuses } }
          : {
              id: targetId,
              OR: [
                { variantStatus: 'pending' },
                { variantStatus: 'completed', thumbnailUrl: null },
              ],
            },
        data: { variantStatus: 'failed' },
      })
    } else if (targetType === 'songCover') {
      await prisma.songCover.updateMany({
        where: { id: targetId, variantStatus: { in: statuses } },
        data: { variantStatus: 'failed', lastError: reason },
      })
    } else {
      await prisma.albumCover.updateMany({
        where: { id: targetId, variantStatus: { in: statuses } },
        data: { variantStatus: 'failed', lastError: reason },
      })
    }

    console.error(`[Variant] ❌ Marked as failed: ${targetType}:${targetId} - ${reason}`)
  }

  /**
   * 将 URL 转换为绝对路径
   */
  urlToAbsolutePath(url: string): string {
    return resolveUploadPathByUrl(url) || ''
  }

  /**
   * 格式化字节数
   */
  private formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  /**
   * 获取队列统计信息
   */
  getQueueStats(): VariantGeneratorStats {
    return {
      queueLength: this.queue.length,
      processingCount: this.processing.size,
      completedToday: this.stats.completedToday,
      failedToday: this.stats.failedToday,
      averageProcessingTime:
        this.stats.processedCount > 0
          ? Math.round(this.stats.totalProcessingTime / this.stats.processedCount)
          : 0,
      timeoutCount: this.stats.timeoutCount,
    }
  }

  /**
   * 获取当前正在处理的 taskKey 集合（供 VariantCleanup 互斥使用）
   */
  getProcessingIds(): Set<string> {
    return this.processing
  }

  /**
   * 获取最大并发数
   */
  getMaxConcurrent(): number {
    return getVariantConfig().variantMaxConcurrent
  }
}

export const variantGenerator = new VariantGenerator({
  autoStart: process.env.NODE_ENV !== 'test',
  processOnEnqueue: process.env.NODE_ENV !== 'test',
})
