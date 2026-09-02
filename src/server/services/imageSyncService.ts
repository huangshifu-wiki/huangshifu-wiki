/**
 * 图片同步服务
 * 当切换存储策略时，自动将本地图片同步到目标存储（S3/外部图床）
 */

import { prisma } from '../prisma'
import { runtimeConfigService } from './runtimeConfig.service'
import { ensureImageMapStorage } from './mediaAssetService'
import { getPublicConfig } from '../s3/s3Service'
import { secretsConfigService } from './secretsConfig.service'

export interface SyncProgress {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  strategy: 's3' | 'external'
  total: number
  processed: number
  succeeded: number
  failed: number
  errors: string[]
  startedAt: Date
  completedAt?: Date
}

// 内存中存储同步任务进度（生产环境可使用 Redis）
const syncTasks = new Map<string, SyncProgress>()

/**
 * 获取或创建同步任务
 */
export function getOrCreateSyncTask(strategy: 's3' | 'external'): SyncProgress {
  const existing = Array.from(syncTasks.values()).find(
    (task) => task.strategy === strategy && task.status !== 'completed' && task.status !== 'failed'
  )

  if (existing) {
    return existing
  }

  const task: SyncProgress = {
    id: crypto.randomUUID(),
    status: 'pending',
    strategy,
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
    startedAt: new Date(),
  }

  syncTasks.set(task.id, task)
  return task
}

/**
 * 获取同步任务状态
 */
export function getSyncTask(taskId: string): SyncProgress | undefined {
  return syncTasks.get(taskId)
}

/**
 * 获取最新的同步任务
 */
export function getLatestSyncTask(): SyncProgress | undefined {
  const tasks = Array.from(syncTasks.values())
  if (tasks.length === 0) return undefined
  return tasks.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0]
}

/**
 * 清理旧的任务记录（保留最近10个）
 */
export function cleanupOldSyncTasks(): void {
  const tasks = Array.from(syncTasks.entries())
  if (tasks.length <= 10) return

  const sorted = tasks.sort((a, b) => b[1].startedAt.getTime() - a[1].startedAt.getTime())
  const toDelete = sorted.slice(10)
  toDelete.forEach(([id]) => syncTasks.delete(id))
}

/**
 * 执行图片同步任务
 */
export async function executeSyncTask(taskId: string): Promise<void> {
  const task = syncTasks.get(taskId)
  if (!task) {
    console.error(`[ImageSync] 任务不存在: ${taskId}`)
    return
  }

  if (task.status === 'running') {
    console.warn(`[ImageSync] 任务已在运行中: ${taskId}`)
    return
  }

  task.status = 'running'
  console.log(`[ImageSync] 开始同步任务: ${taskId}, 策略: ${task.strategy}`)

  try {
    // 获取需要同步的图片
    const whereClause =
      task.strategy === 's3'
        ? { s3Url: null as null, deletedAt: null, retiredAt: null }
        : { externalUrl: null as null, deletedAt: null, retiredAt: null }
    const imageMaps = await prisma.imageMap.findMany({
      where: whereClause,
      orderBy: { createdAt: 'asc' },
    })

    task.total = imageMaps.length
    console.log(`[ImageSync] 找到 ${task.total} 张需要同步的图片`)

    if (imageMaps.length === 0) {
      task.status = 'completed'
      task.completedAt = new Date()
      return
    }

    // 批量处理，每批10张
    const batchSize = 10
    for (let i = 0; i < imageMaps.length; i += batchSize) {
      const batch = imageMaps.slice(i, i + batchSize)

      await Promise.all(
        batch.map(async (imageMap) => {
          try {
            const result = await ensureImageMapStorage(imageMap.id, task.strategy)
            if (result.errors.length > 0) {
              task.failed++
              task.errors.push(`[${imageMap.id}] ${result.errors.join('; ')}`)
            } else {
              task.succeeded++
            }
          } catch (error) {
            task.failed++
            const errorMsg = error instanceof Error ? error.message : '未知错误'
            task.errors.push(`[${imageMap.id}] ${errorMsg}`)
          }
        })
      )

      task.processed += batch.length
      console.log(`[ImageSync] 进度: ${task.processed}/${task.total}`)

      // 限制错误记录数量
      if (task.errors.length > 100) {
        task.errors = task.errors.slice(-100)
      }

      // 小延迟，避免过载
      if (i + batchSize < imageMaps.length) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }

    task.status = 'completed'
    task.completedAt = new Date()

    console.log(`[ImageSync] 任务完成: ${taskId}, 成功: ${task.succeeded}, 失败: ${task.failed}`)

    // 打印错误信息
    if (task.errors.length > 0) {
      console.log(`[ImageSync] 错误详情:`)
      task.errors.forEach((err) => console.log(`  - ${err}`))
    }

    // 清理旧任务
    cleanupOldSyncTasks()
  } catch (error) {
    task.status = 'failed'
    task.completedAt = new Date()
    const errorMsg = error instanceof Error ? error.message : '未知错误'
    task.errors.push(`[任务执行失败] ${errorMsg}`)
    console.error(`[ImageSync] 任务失败: ${taskId}`, error)
  }
}

/**
 * 启动同步任务（异步执行）
 */
export function startSyncTask(strategy: 's3' | 'external'): SyncProgress {
  // 检查S3是否启用
  if (strategy === 's3') {
    const s3Config = getPublicConfig()
    if (!s3Config.enabled) {
      throw new Error('S3 存储未启用，请先配置 S3')
    }
  }

  // 检查Superbed是否配置
  if (strategy === 'external') {
    const superbedToken = secretsConfigService.getSecrets().superbedApiToken
    if (!superbedToken) {
      throw new Error('Superbed API Token 未配置')
    }
  }

  const task = getOrCreateSyncTask(strategy)

  if (task.status === 'pending') {
    // 异步执行同步任务
    executeSyncTask(task.id).catch((error) => {
      console.error(`[ImageSync] 启动同步任务失败:`, error)
    })
  }

  return task
}

/**
 * 取消同步任务
 */
export function cancelSyncTask(taskId: string): boolean {
  const task = syncTasks.get(taskId)
  if (!task || task.status !== 'running') {
    return false
  }

  // 标记为失败（实际无法真正停止运行中的任务，但会阻止新的处理）
  task.status = 'failed'
  task.completedAt = new Date()
  task.errors.push('[手动取消] 任务已被管理员取消')

  return true
}
