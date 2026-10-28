/**
 * 云端同步服务 - v2.1 增强版
 *
 * 功能：
 * 1. 异步上传图片到 S3 / Lsky Pro+
 * 2. Lsky Pro+ 配置验证与健康检查
 * 3. 自动降级机制（External → Local）
 * 4. 失败重试与状态跟踪
 */

import { prisma } from '../prisma'
import { runtimeConfigService } from './runtimeConfig.service'
import { secretsConfigService } from './secretsConfig.service'
import { ensureImageMapStorage } from './mediaAssetService'
import { logger } from '../utils/logger'

export interface CloudSyncTask {
  imageMapId: string
  strategy: 'local' | 's3' | 'external'
  filePath: string
  fileName: string
  mimeType: string
  priority: 'high' | 'normal' | 'low'
  retryCount: number
  maxRetries: number
  createdAt: Date
}

export interface LskyProConfig {
  baseUrl: string
  token: string
  timeout: number
  strategyId?: string
}

export interface CloudSyncStats {
  queueLength: number
  processingCount: number
  completedToday: number
  failedToday: number
  averageProcessingTime: number
}

interface CloudSyncServiceOptions {
  autoStart?: boolean
}

export class CloudSyncService {
  private getTaskKey(task: Pick<CloudSyncTask, 'imageMapId' | 'strategy'>) {
    return `${task.imageMapId}:${task.strategy}`
  }
  private queue: CloudSyncTask[] = []
  private processing = new Set<string>()
  private queued = new Set<string>()
  private syncInterval: NodeJS.Timeout | null = null
  private stopped = false
  private retryTimers = new Set<NodeJS.Timeout>()
  private lskyConfig: LskyProConfig | null = null
  private lskyValidationState: 'unknown' | 'valid' | 'invalid' = 'unknown'

  constructor(options: CloudSyncServiceOptions = {}) {
    if (options.autoStart === false) {
      return
    }

    this.startQueueProcessor()
    logger.info('[CloudSync] Service initialized')
  }

  /**
   * 验证 Lsky Pro+ 配置（惰性：每次可用性判断时重读配置，
   * 面板修改后无需重启即生效；配置来自 DB，晚于本服务构造）
   */
  private validateLskyConfig(): void {
    const baseUrl = runtimeConfigService.getConfig().lskyBaseUrl
    const token = secretsConfigService.getSecrets().lskyToken

    let valid = false
    if (baseUrl && token) {
      try {
        new URL(baseUrl)
        valid = true
      } catch {
        // URL 非法，按无效处理
      }
    }

    if (valid) {
      this.lskyConfig = {
        baseUrl,
        token,
        timeout: runtimeConfigService.getConfig().lskyTimeout,
        strategyId: runtimeConfigService.getConfig().lskyStrategyId || undefined,
      }
      if (this.lskyValidationState !== 'valid') {
        console.log('[CloudSync] ✅ Lsky Pro+ 配置验证通过')
        console.log(`  - Base URL: ${baseUrl}`)
        console.log(`  - Strategy ID: ${this.lskyConfig.strategyId || '(使用默认策略)'}`)
      }
      this.lskyValidationState = 'valid'
      return
    }

    if (this.lskyValidationState !== 'invalid') {
      logger.warn(
        '[CloudSync] Lsky Pro+ not configured\n' +
          `  - LSKY_BASE_URL: ${baseUrl ? 'configured' : 'missing'}\n` +
          `  - LSKY_TOKEN: ${token ? 'configured' : 'missing'}\n` +
          '  Impact: External storage strategy unavailable\n' +
          '  Fix: Configure Lsky settings in the admin panel (站点设置 → 外部图床 / 服务凭证)'
      )
    }
    this.lskyConfig = null
    this.lskyValidationState = 'invalid'
  }

  /**
   * 检查 Lsky Pro+ 是否可用
   */
  public isLskyProAvailable(): boolean {
    this.validateLskyConfig()
    return this.lskyConfig !== null
  }

  /**
   * 获取 Lsky Pro+ 配置
   */
  public getLskyConfig(): LskyProConfig {
    this.validateLskyConfig()
    if (!this.lskyConfig) {
      throw new Error('Lsky Pro+ 未配置或配置无效')
    }
    return this.lskyConfig
  }

  /**
   * 入队同步任务
   */
  async enqueue(
    task: Omit<CloudSyncTask, 'retryCount' | 'maxRetries' | 'createdAt'>
  ): Promise<void> {
    if (this.stopped) return
    const taskKey = this.getTaskKey(task)
    if (this.processing.has(taskKey) || this.queued.has(taskKey)) return
    const fullTask: CloudSyncTask = {
      ...task,
      retryCount: 0,
      maxRetries: runtimeConfigService.getConfig().cloudSyncMaxRetries,
      createdAt: new Date(),
    }
    this.queued.add(taskKey)

    if (task.priority === 'high') {
      this.queue.unshift(fullTask)
    } else {
      this.queue.push(fullTask)
    }

    logger.info(
      { imageMapId: task.imageMapId, strategy: fullTask.strategy },
      '[CloudSync] Task enqueued'
    )
    this.processNext()
  }

  /**
   * 启动队列处理器
   */
  private startQueueProcessor(): void {
    this.stopped = false
    this.syncInterval = setInterval(() => this.processNext(), 1000)
  }

  stop() {
    this.stopped = true
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
    }
    for (const timer of this.retryTimers) clearTimeout(timer)
    this.retryTimers.clear()
    this.queue.length = 0
    this.queued.clear()
  }

  /**
   * 处理下一个任务
   */
  private processNext(): void {
    if (this.stopped) return

    const maxConcurrent = runtimeConfigService.getConfig().cloudSyncMaxConcurrent
    while (this.processing.size < maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift()!
      const taskKey = this.getTaskKey(task)
      this.queued.delete(taskKey)
      if (this.processing.has(taskKey)) continue

      this.processing.add(taskKey)
      void this.processTask(task)
        .catch((error) => console.error(`[CloudSync] ❌ Task processing error:`, error))
        .finally(() => {
          this.processing.delete(taskKey)
          this.processNext()
        })
    }
  }

  /**
   * 处理单个同步任务
   */
  private async processTask(task: CloudSyncTask): Promise<void> {
    logger.debug(
      {
        imageMapId: task.imageMapId,
        strategy: task.strategy,
        retry: `${task.retryCount}/${task.maxRetries}`,
      },
      '[CloudSync] Processing'
    )
    try {
      if (task.strategy === 'local') {
        await prisma.imageMap.updateMany({
          where: { id: task.imageMapId },
          data: { cloudSyncStatus: 'skipped' },
        })
        return
      }

      const result = await ensureImageMapStorage(task.imageMapId, task.strategy, {
        sourceFilePath: task.filePath,
        sourceFileName: task.fileName,
        sourceMimeType: task.mimeType,
      })
      if (result.errors.length > 0) throw new Error(result.errors.join('; '))
      logger.info({ imageMapId: task.imageMapId }, '[CloudSync] Completed')
    } catch (error) {
      logger.error({ err: error, imageMapId: task.imageMapId }, '[CloudSync] Failed')
      if (this.stopped) return
      if (task.retryCount < task.maxRetries) {
        task.retryCount++
        const delay = Math.pow(2, task.retryCount - 1) * 1000
        const taskKey = this.getTaskKey(task)
        this.queued.add(taskKey)
        let retryTimer: NodeJS.Timeout
        retryTimer = setTimeout(() => {
          this.retryTimers.delete(retryTimer)
          this.queue.unshift(task)
          this.processNext()
        }, delay)
        this.retryTimers.add(retryTimer)
      } else {
        await prisma.imageMap.updateMany({
          where: { id: task.imageMapId, cloudSyncStatus: { not: 'failed' } },
          data: { cloudSyncStatus: 'failed' },
        })
      }
    }
  }

  /**
   * 触发同步（供上传流程调用）
   */
  async syncToCloud(
    imageMapId: string,
    strategy: string,
    filePath: string,
    fileName: string,
    mimeType: string
  ): Promise<void> {
    if (strategy === 'local') {
      await prisma.imageMap.update({
        where: { id: imageMapId },
        data: { cloudSyncStatus: 'skipped' },
      })
      return
    }
    if (strategy !== 's3' && strategy !== 'external') {
      throw new Error(`Unsupported cloud storage strategy: ${strategy}`)
    }
    await this.enqueue({
      imageMapId,
      strategy,
      filePath,
      fileName,
      mimeType,
      priority: 'normal',
    })
  }

  /**
   * 获取队列统计信息
   */
  getQueueStats(): CloudSyncStats {
    return {
      queueLength: this.queue.length,
      processingCount: this.processing.size,
      completedToday: 0,
      failedToday: 0,
      averageProcessingTime: 0,
    }
  }

  /**
   * 获取当前处理中的任务数量
   */
  getProcessingCount(): number {
    return this.processing.size
  }

  /**
   * 获取当前队列长度
   */
  getQueueLength(): number {
    return this.queue.length
  }
}

export const cloudSyncService = new CloudSyncService({
  autoStart: process.env.NODE_ENV !== 'test',
})
