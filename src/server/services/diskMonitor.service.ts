/**
 * 磁盘空间监控服务 - v2.1 增强版（支持后台动态配置）
 *
 * 功能：
 * 1. 定期检查磁盘空间
 * 2. 多级告警阈值（healthy/warning/critical）
 * 3. **后台动态配置** - 阈值可通过 API 实时修改
 * 4. 上传前预检（防止磁盘写满）
 * 5. 目录统计与趋势分析
 */

import { prisma } from '../prisma'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import { logger as defaultLogger } from '../utils/logger'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const uploadsDir = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', '..', 'uploads')

export interface DiskMonitorConfig {
  warningThresholdGB: number // 警告阈值（GB）
  criticalThresholdGB: number // 严重警告阈值（GB）
  checkIntervalMs: number // 检查间隔（毫秒）
  uploadsMinFreeMB: number // 上传最小空闲空间（MB）
}

export interface DirectoryStats {
  path: string
  fileCount: number
  totalSizeMB: number
  oldestFileDate?: Date
  newestFileDate?: Date
}

export interface DiskStatus {
  totalSpaceGB: number
  freeSpaceGB: number
  usedSpaceGB: number
  usagePercent: number
  status: 'healthy' | 'warning' | 'critical'
  lastChecked: Date
  uploadsDir?: DirectoryStats
  originalDir?: DirectoryStats
  variantsDir?: DirectoryStats
}

export interface UploadPrecheckResult {
  allowed: boolean
  reason?: string
  freeSpaceGB: number
  config: DiskMonitorConfig
}

type DiskHealthStatus = DiskStatus['status']
type DiskMonitorLogger = Pick<typeof defaultLogger, 'debug' | 'info' | 'warn' | 'error'>

interface DiskSpaceSnapshot {
  totalSpaceGB: number
  freeSpaceGB: number
}

const DEFAULT_CONFIG: DiskMonitorConfig = {
  warningThresholdGB: 50,
  criticalThresholdGB: 20,
  checkIntervalMs: 300000, // 5 分钟
  uploadsMinFreeMB: 500,
}

const CONFIG_KEY = 'disk_monitor_config'

interface DiskMonitorServiceOptions {
  autoStart?: boolean
  logger?: DiskMonitorLogger
  readDiskSpace?: () => Promise<DiskSpaceSnapshot>
}

export class DiskMonitorService {
  private static instance: DiskMonitorService

  private currentStatus: DiskStatus | null = null
  private currentConfig: DiskMonitorConfig = { ...DEFAULT_CONFIG }
  private checkInterval: ReturnType<typeof setInterval> | null = null
  private isChecking: boolean = false
  private lastLoggedStatus: DiskHealthStatus | null = null
  private lastLoggedErrorMessage: string | null = null
  private hasLoggedStartupSummary: boolean = false
  private readonly logger: DiskMonitorLogger
  private readonly readDiskSpace: () => Promise<DiskSpaceSnapshot>

  private constructor(options: DiskMonitorServiceOptions = {}) {
    this.logger = options.logger ?? defaultLogger
    this.readDiskSpace = options.readDiskSpace ?? this.readLocalDiskSpace.bind(this)

    if (options.autoStart === false) {
      return
    }

    this.loadConfigFromDB().then(() => {
      this.startMonitoring()
    })
  }

  public static getInstance(options?: DiskMonitorServiceOptions): DiskMonitorService {
    if (!DiskMonitorService.instance) {
      DiskMonitorService.instance = new DiskMonitorService(options)
    }
    return DiskMonitorService.instance
  }

  /**
   * 从数据库加载配置（支持后台动态修改）
   */
  private async loadConfigFromDB(): Promise<void> {
    try {
      const configRecord = await prisma.siteConfig.findUnique({
        where: { key: CONFIG_KEY },
      })

      if (configRecord?.value) {
        const dbConfig = configRecord.value as Partial<DiskMonitorConfig>

        this.currentConfig = {
          ...DEFAULT_CONFIG,
          ...dbConfig,
        }

        this.logger.debug(
          { config: this.currentConfig },
          '[DiskMonitor] Configuration loaded from database'
        )
      } else {
        this.logger.debug('[DiskMonitor] No database config found, using defaults')
        await this.saveConfigToDB()
      }
    } catch (error) {
      this.logger.error(
        { err: error },
        '[DiskMonitor] Failed to load config from DB, using defaults'
      )
      this.currentConfig = { ...DEFAULT_CONFIG }
    }
  }

  /**
   * 保存配置到数据库
   */
  private async saveConfigToDB(): Promise<void> {
    try {
      await prisma.siteConfig.upsert({
        where: { key: CONFIG_KEY },
        update: {
          value: this.currentConfig as any,
          updatedAt: new Date(),
        },
        create: {
          key: CONFIG_KEY,
          value: this.currentConfig as any,
        },
      })

      this.logger.debug(
        { config: this.currentConfig },
        '[DiskMonitor] Configuration saved to database'
      )
    } catch (error) {
      this.logger.error({ err: error }, '[DiskMonitor] Failed to save config to DB')
    }
  }

  /**
   * 更新配置（供管理 API 调用）
   */
  async updateConfig(newConfig: Partial<DiskMonitorConfig>): Promise<DiskMonitorConfig> {
    this.currentConfig = {
      ...this.currentConfig,
      ...newConfig,
    }

    await this.saveConfigToDB()

    this.logger.info({ config: this.currentConfig }, '[DiskMonitor] Configuration updated')

    if (this.checkInterval) {
      clearInterval(this.checkInterval)
    }
    this.startMonitoring()

    return { ...this.currentConfig }
  }

  /**
   * 获取当前配置
   */
  getConfig(): DiskMonitorConfig {
    return { ...this.currentConfig }
  }

  /**
   * 重置为默认配置
   */
  async resetConfig(): Promise<DiskMonitorConfig> {
    this.currentConfig = { ...DEFAULT_CONFIG }
    await this.saveConfigToDB()

    this.logger.info(
      { config: this.currentConfig },
      '[DiskMonitor] Configuration reset to defaults'
    )

    return { ...this.currentConfig }
  }

  /**
   * 启动定期监控
   */
  private startMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
    }

    this.checkDiskSpace()

    this.checkInterval = setInterval(() => {
      this.checkDiskSpace()
    }, this.currentConfig.checkIntervalMs)

    if (!this.hasLoggedStartupSummary) {
      this.hasLoggedStartupSummary = true
      this.logger.info({ config: this.currentConfig }, '[DiskMonitor] Monitoring started')
    } else {
      this.logger.debug(
        { intervalMs: this.currentConfig.checkIntervalMs },
        '[DiskMonitor] Monitoring restarted'
      )
    }
  }

  /**
   * 检查磁盘空间
   */
  public async checkDiskSpace(): Promise<DiskStatus> {
    if (this.isChecking && this.currentStatus) {
      return this.currentStatus
    }

    this.isChecking = true
    try {
      const { totalSpaceGB, freeSpaceGB } = await this.readDiskSpace()

      const usedSpaceGB = totalSpaceGB - freeSpaceGB
      const usagePercent = (usedSpaceGB / totalSpaceGB) * 100

      let status: DiskHealthStatus

      if (freeSpaceGB < this.currentConfig.criticalThresholdGB) {
        status = 'critical'
      } else if (freeSpaceGB < this.currentConfig.warningThresholdGB) {
        status = 'warning'
      } else {
        status = 'healthy'
      }

      this.currentStatus = {
        totalSpaceGB: Math.round(totalSpaceGB * 100) / 100,
        freeSpaceGB: Math.round(freeSpaceGB * 100) / 100,
        usedSpaceGB: Math.round(usedSpaceGB * 100) / 100,
        usagePercent: Math.round(usagePercent * 100) / 100,
        status,
        lastChecked: new Date(),
        uploadsDir: await this.getDirectoryStats(uploadsDir),
        originalDir: await this.getDirectoryStats(path.join(uploadsDir, 'original')),
        variantsDir: await this.getDirectoryStats(path.join(uploadsDir, 'variants')),
      }

      this.lastLoggedErrorMessage = null
      this.logStatusChange()

      return this.currentStatus
    } catch (error) {
      this.logCheckError(error)
      throw error
    } finally {
      this.isChecking = false
    }
  }

  private async readLocalDiskSpace(): Promise<DiskSpaceSnapshot> {
    try {
      const stats = await fs.promises.statfs(uploadsDir)
      return {
        totalSpaceGB: (stats.bsize * stats.blocks) / 1024 ** 3,
        freeSpaceGB: (stats.bsize * stats.bfree) / 1024 ** 3,
      }
    } catch {
      return {
        totalSpaceGB: os.totalmem() / 1024 ** 3,
        freeSpaceGB: os.freemem() / 1024 ** 3,
      }
    }
  }

  /**
   * 获取目录统计信息
   */
  private async getDirectoryStats(dirPath: string): Promise<DirectoryStats | undefined> {
    try {
      const files = await this.recursiveReadDir(dirPath)
      let totalSize = 0
      let oldestDate: Date | undefined
      let newestDate: Date | undefined

      for (const file of files) {
        totalSize += file.size
        if (!oldestDate || file.mtime < oldestDate) oldestDate = file.mtime
        if (!newestDate || file.mtime > newestDate) newestDate = file.mtime
      }

      return {
        path: dirPath,
        fileCount: files.length,
        totalSizeMB: Math.round((totalSize / (1024 * 1024)) * 100) / 100,
        oldestFileDate: oldestDate,
        newestFileDate: newestDate,
      }
    } catch {
      return undefined
    }
  }

  /**
   * 递归读取目录
   */
  private async recursiveReadDir(
    dirPath: string,
    depth: number = 0
  ): Promise<Array<{ size: number; mtime: Date }>> {
    if (depth > 5) return []

    const results: Array<{ size: number; mtime: Date }> = []

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name)

        if (entry.isDirectory()) {
          const subFiles = await this.recursiveReadDir(fullPath, depth + 1)
          results.push(...subFiles)
        } else if (entry.isFile()) {
          try {
            const stat = await fs.promises.stat(fullPath)
            results.push({ size: stat.size, mtime: stat.mtime })
          } catch {
            continue
          }
        }
      }
    } catch {
      return []
    }

    return results
  }

  /**
   * 仅在首次检查或状态变化时输出状态日志，避免定时检查刷屏。
   */
  private logStatusChange(): void {
    if (!this.currentStatus) return

    const s = this.currentStatus
    const previousStatus = this.lastLoggedStatus

    if (previousStatus === s.status) {
      return
    }

    this.lastLoggedStatus = s.status

    const payload = {
      status: s.status,
      previousStatus,
      freeSpaceGB: s.freeSpaceGB,
      usagePercent: s.usagePercent,
      originalSizeMB: s.originalDir?.totalSizeMB,
      variantsSizeMB: s.variantsDir?.totalSizeMB,
    }

    if (s.status === 'critical') {
      this.logger.error(payload, '[DiskMonitor] Disk space critical')
    } else if (s.status === 'warning') {
      this.logger.warn(payload, '[DiskMonitor] Disk space low')
    } else if (previousStatus && previousStatus !== 'healthy') {
      this.logger.info(payload, '[DiskMonitor] Disk space recovered')
    } else {
      this.logger.info(payload, '[DiskMonitor] Disk status healthy')
    }
  }

  private logCheckError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)

    if (this.lastLoggedErrorMessage === message) {
      return
    }

    this.lastLoggedErrorMessage = message
    this.logger.error({ err: error }, '[DiskMonitor] Failed to check disk space')
  }

  /**
   * 获取当前状态
   */
  public getStatus(): DiskStatus | null {
    return this.currentStatus
  }

  /**
   * 检查是否允许上传
   */
  public canUpload(requiredBytes: number): boolean {
    if (!this.currentStatus) return true

    const freeBytes = this.currentStatus.freeSpaceGB * 1024 * 1024 * 1024
    const minFreeBytes = this.currentConfig.uploadsMinFreeMB * 1024 * 1024

    return freeBytes - requiredBytes > minFreeBytes
  }

  /**
   * 上传前预检结果
   */
  public getUploadPrecheckResult(): UploadPrecheckResult {
    const status = this.currentStatus

    if (!status) {
      return {
        allowed: true,
        freeSpaceGB: 0,
        config: { ...this.currentConfig },
      }
    }

    if (status.status === 'critical') {
      return {
        allowed: false,
        reason: `磁盘空间严重不足（仅剩 ${status.freeSpaceGB.toFixed(1)} GB），暂时无法上传`,
        freeSpaceGB: status.freeSpaceGB,
        config: { ...this.currentConfig },
      }
    }

    return {
      allowed: true,
      freeSpaceGB: status.freeSpaceGB,
      config: { ...this.currentConfig },
    }
  }

  /**
   * 手动触发检查
   */
  public async manualCheck(): Promise<DiskStatus> {
    return await this.checkDiskSpace()
  }

  /**
   * 停止监控（用于测试或维护）
   */
  public stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
      this.logger.info('[DiskMonitor] Monitoring stopped')
    }
  }

  /**
   * 恢复监控
   */
  public resumeMonitoring(): void {
    if (!this.checkInterval) {
      this.startMonitoring()
      this.logger.info('[DiskMonitor] Monitoring resumed')
    }
  }
}

export const diskMonitor = DiskMonitorService.getInstance({
  autoStart: process.env.NODE_ENV !== 'test',
})
