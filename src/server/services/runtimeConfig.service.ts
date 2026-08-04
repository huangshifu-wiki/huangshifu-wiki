/**
 * 运行时行为配置服务 - 管理面板可动态修改
 *
 * 从环境变量迁移过来的运行时行为参数统一存放于此：
 * - 配置存储于 SiteConfig 表（key: runtime_config），管理后台可改
 * - 启动时从 DB 加载，加载完成前使用代码默认值
 * - getConfig() 为同步读取，消费点随请求即时生效
 *
 * 模式参照 diskMonitor.service.ts / rateLimitConfig.service.ts。
 */

import { prisma } from '../prisma'
import { logger } from '../utils/logger'

export interface RuntimeConfig {
  // 功能开关
  semanticSearchEnabled: boolean
  galleryAdminOnly: boolean
  allowSuperAdminManageSuperAdmins: boolean
  // 图片处理
  blurhashEnabled: boolean
  blurhashAutoGenerate: boolean
  blurhashComponentsX: number
  blurhashComponentsY: number
  // 上传与备份
  uploadSessionTtlMinutes: number
  backupRetainCount: number
  // 缓存与搜索
  playUrlCacheTtlSeconds: number
  cacheMaxKeys: number
  qdrantTimeoutMs: number
  imageSearchResultLimit: number
  imageEmbeddingBatchSize: number
  editLockCleanupIntervalMs: number
  // 变体生成
  variantMaxConcurrent: number
  variantTaskTimeoutMs: number
  variantQueueMaxWaitMs: number
  variantSharpMemoryLimitMb: number
  variantMaxRetries: number
  // 云同步
  cloudSyncMaxConcurrent: number
  cloudSyncMaxRetries: number
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  semanticSearchEnabled: false,
  galleryAdminOnly: false,
  allowSuperAdminManageSuperAdmins: false,
  blurhashEnabled: true,
  blurhashAutoGenerate: true,
  blurhashComponentsX: 4,
  blurhashComponentsY: 3,
  uploadSessionTtlMinutes: 45,
  backupRetainCount: 20,
  playUrlCacheTtlSeconds: 600,
  cacheMaxKeys: 5000,
  qdrantTimeoutMs: 2000,
  imageSearchResultLimit: 24,
  imageEmbeddingBatchSize: 100,
  editLockCleanupIntervalMs: 90000,
  variantMaxConcurrent: 3,
  variantTaskTimeoutMs: 30000,
  variantQueueMaxWaitMs: 300000,
  variantSharpMemoryLimitMb: 512,
  variantMaxRetries: 3,
  cloudSyncMaxConcurrent: 2,
  cloudSyncMaxRetries: 3,
}

const CONFIG_KEY = 'runtime_config'

// 数字字段的 [min, max] 约束，key 与 RuntimeConfig 字段一一对应
const NUMBER_LIMITS: Record<string, [number, number]> = {
  blurhashComponentsX: [1, 16],
  blurhashComponentsY: [1, 16],
  uploadSessionTtlMinutes: [5, 1440],
  backupRetainCount: [1, 365],
  playUrlCacheTtlSeconds: [60, 86400],
  cacheMaxKeys: [100, 1_000_000],
  qdrantTimeoutMs: [100, 30000],
  imageSearchResultLimit: [1, 100],
  imageEmbeddingBatchSize: [1, 2000],
  editLockCleanupIntervalMs: [10000, 3_600_000],
  variantMaxConcurrent: [1, 32],
  variantTaskTimeoutMs: [1000, 600_000],
  variantQueueMaxWaitMs: [1000, 86_400_000],
  variantSharpMemoryLimitMb: [64, 8192],
  variantMaxRetries: [0, 20],
  cloudSyncMaxConcurrent: [1, 16],
  cloudSyncMaxRetries: [0, 20],
}

const BOOLEAN_KEYS = new Set([
  'semanticSearchEnabled',
  'galleryAdminOnly',
  'allowSuperAdminManageSuperAdmins',
  'blurhashEnabled',
  'blurhashAutoGenerate',
])

export class RuntimeConfigValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeConfigValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 校验并标准化管理端提交的配置更新。
 * - 未知字段忽略
 * - 布尔字段必须为 boolean，否则抛 RuntimeConfigValidationError
 * - 数字字段必须为有限数，越界时 clamp 到约束范围，类型非法抛 RuntimeConfigValidationError
 */
function normalizeUpdate(update: unknown): Partial<RuntimeConfig> {
  if (!isRecord(update)) {
    throw new RuntimeConfigValidationError('配置更新必须是对象')
  }

  const result: Partial<RuntimeConfig> = {}

  for (const [key, value] of Object.entries(update)) {
    if (BOOLEAN_KEYS.has(key)) {
      if (typeof value !== 'boolean') {
        throw new RuntimeConfigValidationError(`${key} 必须是布尔值`)
      }
      ;(result as Record<string, unknown>)[key] = value
      continue
    }

    if (key in NUMBER_LIMITS) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new RuntimeConfigValidationError(`${key} 必须是数字`)
      }
      const [min, max] = NUMBER_LIMITS[key]
      ;(result as Record<string, unknown>)[key] = Math.min(max, Math.max(min, value))
    }
    // 其余字段名直接忽略
  }

  return result
}

function cloneConfig(config: RuntimeConfig): RuntimeConfig {
  return { ...config }
}

export class RuntimeConfigService {
  private static instance: RuntimeConfigService

  private currentConfig: RuntimeConfig = { ...DEFAULT_RUNTIME_CONFIG }
  private loading: Promise<void> | null = null

  public static getInstance(): RuntimeConfigService {
    if (!RuntimeConfigService.instance) {
      RuntimeConfigService.instance = new RuntimeConfigService()
    }
    return RuntimeConfigService.instance
  }

  /**
   * 从数据库加载配置（幂等，可安全重复调用）
   */
  init(): Promise<void> {
    if (!this.loading) {
      this.loading = this.loadConfigFromDB()
    }
    return this.loading
  }

  private async loadConfigFromDB(): Promise<void> {
    try {
      const configRecord = await prisma.siteConfig.findUnique({
        where: { key: CONFIG_KEY },
      })

      if (configRecord?.value) {
        // 经 normalizeUpdate 校验类型并 clamp 越界值，防止手工改库绕过写路径约束
        this.currentConfig = {
          ...DEFAULT_RUNTIME_CONFIG,
          ...normalizeUpdate(configRecord.value),
        }
        logger.debug({ config: this.currentConfig }, '[RuntimeConfig] Configuration loaded from DB')
      } else {
        logger.debug('[RuntimeConfig] No database config found, using defaults')
        await this.saveConfigToDB()
      }
    } catch (error) {
      logger.error({ err: error }, '[RuntimeConfig] Failed to load config from DB, using defaults')
      this.currentConfig = { ...DEFAULT_RUNTIME_CONFIG }
    }
  }

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
    } catch (error) {
      logger.error({ err: error }, '[RuntimeConfig] Failed to save config to DB')
    }
  }

  /**
   * 获取当前配置（同步，未加载完成时返回默认值）
   */
  getConfig(): RuntimeConfig {
    return cloneConfig(this.currentConfig)
  }

  /**
   * 更新配置（管理 API 调用）
   */
  async updateConfig(partial: Partial<RuntimeConfig>): Promise<RuntimeConfig> {
    this.currentConfig = {
      ...this.currentConfig,
      ...partial,
    }
    await this.saveConfigToDB()
    return cloneConfig(this.currentConfig)
  }

  /**
   * 重置为默认配置
   */
  async resetConfig(): Promise<RuntimeConfig> {
    this.currentConfig = { ...DEFAULT_RUNTIME_CONFIG }
    await this.saveConfigToDB()
    return cloneConfig(this.currentConfig)
  }
}

export const runtimeConfigService = RuntimeConfigService.getInstance()

export { normalizeUpdate as normalizeRuntimeConfigUpdate }
