/**
 * 图片同步服务
 * 当切换存储策略时，自动将本地图片同步到目标存储（S3/外部图床）
 */

import { setTimeout as delay } from 'node:timers/promises'
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
function getOrCreateSyncTask(strategy: 's3' | 'external'): SyncProgress {
  for (const task of syncTasks.values()) {
    if (task.strategy === strategy && task.status !== 'completed' && task.status !== 'failed') {
      return task
    }
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
  let latest: SyncProgress | undefined
  for (const task of syncTasks.values()) {
    if (!latest || task.startedAt.getTime() > latest.startedAt.getTime()) {
      latest = task
    }
  }
  return latest
}

/**
 * 清理旧的任务记录（保留最近10个）
 */
export function cleanupOldSyncTasks(): void {
  const tasks = Array.from(syncTasks.entries())
  if (tasks.length <= 10) return

  const active = tasks.filter(([, task]) => task.status === 'pending' || task.status === 'running')
  const finished = tasks
    .filter(([, task]) => task.status === 'completed' || task.status === 'failed')
    .sort((a, b) => b[1].startedAt.getTime() - a[1].startedAt.getTime())
  const retained = new Set([
    ...active.map(([id]) => id),
    ...finished.slice(0, Math.max(0, 10 - active.length)).map(([id]) => id),
  ])
  for (const [id] of tasks) {
    if (!retained.has(id)) syncTasks.delete(id)
  }
}

/**
 * 执行图片同步任务
 */
function isSyncCancelled(task: SyncProgress) {
  return task.status === 'failed'
}

async function executeSyncTask(taskId: string): Promise<void> {
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
    const whereClause =
      task.strategy === 's3'
        ? { s3Url: null as null, deletedAt: null, retiredAt: null }
        : {
            OR: [{ externalUrl: null as null }, { s3Url: null as null }],
            deletedAt: null,
            retiredAt: null,
          }

    // Count first so the task can report progress without loading every ID into memory.
    const total = await prisma.imageMap.count({ where: whereClause })
    task.total = total
    console.log(`[ImageSync] 找到 ${task.total} 张需要同步的图片`)

    if (total === 0) {
      task.status = 'completed'
      task.completedAt = new Date()
      cleanupOldSyncTasks()
      return
    }

    // Use the primary-key cursor instead of offset pagination because syncing updates the filter fields.
    const batchSize = 10
    let cursorId: string | undefined
    for (;;) {
      if (isSyncCancelled(task)) return
      const pageWhere = cursorId ? { AND: [whereClause, { id: { gt: cursorId } }] } : whereClause
      const batch = await prisma.imageMap.findMany({
        where: pageWhere,
        select: { id: true },
        orderBy: { id: 'asc' },
        take: batchSize,
      })
      if (batch.length === 0) break
      cursorId = batch[batch.length - 1].id

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
      if (isSyncCancelled(task)) return

      task.processed += batch.length
      console.log(`[ImageSync] 进度: ${task.processed}/${task.total}`)

      // 限制错误记录数量
      if (task.errors.length > 100) {
        task.errors = task.errors.slice(-100)
      }

      if (task.processed >= task.total) break

      await delay(100)
    }

    if (isSyncCancelled(task)) return
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
    cleanupOldSyncTasks()
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
