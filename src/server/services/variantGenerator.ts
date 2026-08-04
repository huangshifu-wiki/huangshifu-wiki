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

export class VariantGenerator {
  private queue: VariantTask[] = []
  private processing = new Set<string>()
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

  private isProcessing = false
  private processInterval: NodeJS.Timeout | null = null

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

  /**
   * 恢复未完成的任务（图片 + 音乐封面，三表查询）
   */
  private async recoverPendingTasks(): Promise<void> {
    try {
      const [imageMaps, songCovers, albumCovers] = await Promise.all([
        prisma.imageMap.findMany({
          where: {
            deletedAt: null,
            variantStatus: { in: ['pending', 'processing'] },
          },
          take: 100,
        }),
        prisma.songCover.findMany({
          where: {
            variantStatus: { in: ['pending', 'processing'] },
          },
          take: 100,
        }),
        prisma.albumCover.findMany({
          where: {
            variantStatus: { in: ['pending', 'processing'] },
          },
          take: 100,
        }),
      ])

      const pendingCount = imageMaps.length + songCovers.length + albumCovers.length

      if (pendingCount > 0) {
        console.log(`[Variant] 🔄 Recovering ${pendingCount} pending tasks...`)
      }

      for (const imageMap of imageMaps) {
        await this.recoverTask('imageMap', imageMap.id, this.urlToAbsolutePath(imageMap.localUrl))
      }
      for (const cover of songCovers) {
        await this.recoverTask(
          'songCover',
          cover.id,
          resolveUploadPathByStorageKey(cover.storageKey, uploadsDir)
        )
      }
      for (const cover of albumCovers) {
        await this.recoverTask(
          'albumCover',
          cover.id,
          resolveUploadPathByStorageKey(cover.storageKey, uploadsDir)
        )
      }
    } catch (error) {
      console.error('[Variant] ❌ Error recovering pending tasks:', error)
    }
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

      await this.enqueue({
        targetType,
        targetId,
        localFilePath: filePath,
        priority: 'low',
      })
    } catch {
      console.warn(`[Variant] ⚠️ Skipping recovery for ${targetType}:${targetId}: file not found`)
      await this.markAsFailed(targetType, targetId, 'Source file missing')
    }
  }

  /**
   * 入队变体生成任务
   */
  async enqueue(task: Omit<VariantTask, 'retryCount' | 'maxRetries' | 'createdAt'>): Promise<void> {
    const taskKey = this.getTaskKey(task)

    if (
      this.processing.has(taskKey) ||
      this.queue.some((queuedTask) => this.getTaskKey(queuedTask) === taskKey)
    ) {
      console.log(`[Variant] ⏭️ Task already queued or processing: ${taskKey}`)
      return
    }

    const fullTask: VariantTask = {
      ...task,
      retryCount: 0,
      maxRetries: getVariantConfig().variantMaxRetries,
      createdAt: new Date(),
    }

    if (task.priority === 'high') {
      this.queue.unshift(fullTask)
    } else {
      this.queue.push(fullTask)
    }

    console.log(`[Variant] 📥 Task enqueued: ${taskKey}`)
    if (this.processOnEnqueue) {
      this.processNext()
    }
  }

  /**
   * 启动队列处理器
   */
  private startQueueProcessor(): void {
    this.processInterval = setInterval(() => {
      if (!this.isProcessing) {
        this.processNext()
      }
    }, 500)
  }

  stop() {
    if (this.processInterval) {
      clearInterval(this.processInterval)
      this.processInterval = null
    }
  }

  /**
   * 处理下一个任务
   */
  private async processNext(): Promise<void> {
    if (this.processing.size >= getVariantConfig().variantMaxConcurrent) return
    if (this.queue.length === 0) return

    const task = this.queue.shift()!
    const taskKey = this.getTaskKey(task)
    this.processing.add(taskKey)
    this.isProcessing = true

    try {
      await this.processTask(task)
    } catch (error) {
      console.error('[Variant] ❌ Task processing error:', error)
    } finally {
      this.processing.delete(taskKey)
      this.isProcessing = false

      if (this.queue.length > 0 || this.processing.size < getVariantConfig().variantMaxConcurrent) {
        setTimeout(() => this.processNext(), 100)
      }
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

    try {
      // ===== 检查 1: 队列等待时间超限 =====
      const waitTime = Date.now() - task.createdAt.getTime()
      if (waitTime > getVariantConfig().variantQueueMaxWaitMs) {
        console.warn(
          `[Variant] ⏰ Task ${taskKey} exceeded max wait time (${waitTime}ms), skipping`
        )
        await this.markAsFailed(task.targetType, task.targetId, 'Queue wait timeout')
        return
      }

      // ===== 检查 2: 文件是否存在 =====
      try {
        await fs.promises.access(task.localFilePath, fs.constants.R_OK)
      } catch {
        console.error(`[Variant] ❌ File not found: ${task.localFilePath}`)
        await this.markAsFailed(task.targetType, task.targetId, 'Source file missing')
        return
      }

      // ===== 更新状态为 processing =====
      await this.markAsProcessing(task)

      // ===== 执行变体生成（带超时保护）=====
      let timeoutId: NodeJS.Timeout

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(`Variant generation timeout (${getVariantConfig().variantTaskTimeoutMs}ms)`)
          )
        }, getVariantConfig().variantTaskTimeoutMs)
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

        if (error.message.includes('timeout')) {
          this.stats.timeoutCount++
          console.error(`[Variant] ⏰ Timeout: ${taskKey}`)

          // 触发垃圾回收（如果可用）
          if ((global as any).gc) {
            ;(global as any).gc()
          }

          throw error // 让外层重试逻辑处理
        } else {
          throw error
        }
      }
    } catch (error) {
      console.error(`[Variant] ❌ Failed: ${taskKey}:`, error)

      this.stats.failedToday++

      if (task.retryCount < task.maxRetries) {
        const delay = Math.pow(2, task.retryCount) * 1000
        console.log(
          `[Variant] 🔄 Retrying in ${delay}ms... ` + `(${task.retryCount + 1}/${task.maxRetries})`
        )

        task.retryCount++

        setTimeout(() => {
          this.queue.unshift(task) // 插到队首优先重试
          this.processNext()
        }, delay)
      } else {
        console.error(`[Variant] 💀 Gave up after ${task.maxRetries} retries`)
        await this.markAsFailed(task.targetType, task.targetId, error.message)
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

    // 设置 Sharp 内存限制
    const maxPixels = (getVariantConfig().variantSharpMemoryLimitMb * 1024 * 1024) / 4

    try {
      const metadata = await sharp(task.localFilePath, {
        limitInputPixels: maxPixels,
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

          const result = await sharp(task.localFilePath)
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

        const result = await sharp(task.localFilePath)
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

      // 保存到数据库
      await this.saveVariantUrls(task, variants)

      return variants
    } catch (error) {
      if (error.message?.includes('Input image exceeds pixel limit')) {
        throw new Error(
          `Image too large (max ${getVariantConfig().variantSharpMemoryLimitMb}MB memory limit)`
        )
      }
      throw error
    }
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

      await prisma.imageMap.update({
        where: { id: task.targetId },
        data: {
          thumbnailUrl: variant?.path || null,
          variantStatus: 'completed',
        },
      })
      return
    }

    const thumbnailUrl = variants.get('thumb')?.path || null

    // 先读旧 URL：成功后删除被替换的旧缩略图，避免 force 重建产生孤儿文件
    const previousThumbnailUrl = await this.readCoverThumbnailUrl(task.targetType, task.targetId)

    try {
      await this.updateCover(task.targetType, task.targetId, {
        thumbnailUrl,
        variantStatus: 'completed',
        variantGeneratedAt: new Date(),
        lastError: null,
      })
    } catch (error) {
      // 写库失败：清理本次生成的未引用文件后重抛，交给重试逻辑
      if (thumbnailUrl) {
        await deleteMusicCoverThumbnail(thumbnailUrl)
      }
      throw error
    }

    if (previousThumbnailUrl && previousThumbnailUrl !== thumbnailUrl) {
      await deleteMusicCoverThumbnail(previousThumbnailUrl)
    }
  }

  /**
   * 读取封面当前缩略图 URL（songCover / albumCover）
   */
  private async readCoverThumbnailUrl(
    targetType: 'songCover' | 'albumCover',
    targetId: string
  ): Promise<string | null> {
    if (targetType === 'songCover') {
      const cover = await prisma.songCover.findUnique({
        where: { id: targetId },
        select: { thumbnailUrl: true },
      })
      return cover?.thumbnailUrl ?? null
    }
    const cover = await prisma.albumCover.findUnique({
      where: { id: targetId },
      select: { thumbnailUrl: true },
    })
    return cover?.thumbnailUrl ?? null
  }

  /**
   * 标记任务为 processing
   */
  private async markAsProcessing(task: VariantTask): Promise<void> {
    if (task.targetType === 'imageMap') {
      await prisma.imageMap.update({
        where: { id: task.targetId },
        data: { variantStatus: 'processing' },
      })
    } else {
      await this.updateCover(task.targetType, task.targetId, {
        variantStatus: 'processing',
      })
    }
  }

  /**
   * 标记任务为失败
   */
  private async markAsFailed(
    targetType: VariantTargetType,
    targetId: string,
    reason: string
  ): Promise<void> {
    if (targetType === 'imageMap') {
      await prisma.imageMap.update({
        where: { id: targetId },
        data: { variantStatus: 'failed' as const },
      })
    } else {
      await this.updateCover(targetType, targetId, {
        variantStatus: 'failed',
        lastError: reason,
      })
    }

    console.error(`[Variant] ❌ Marked as failed: ${targetType}:${targetId} - ${reason}`)
  }

  /**
   * 按目标类型更新封面变体状态（songCover / albumCover）
   */
  private async updateCover(
    targetType: 'songCover' | 'albumCover',
    targetId: string,
    data: {
      thumbnailUrl?: string | null
      variantStatus?: 'pending' | 'processing' | 'completed' | 'failed'
      variantGeneratedAt?: Date | null
      lastError?: string | null
    }
  ): Promise<void> {
    if (targetType === 'songCover') {
      await prisma.songCover.update({ where: { id: targetId }, data })
    } else {
      await prisma.albumCover.update({ where: { id: targetId }, data })
    }
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
