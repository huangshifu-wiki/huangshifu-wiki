import type { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { logger } from '../utils/logger'
import {
  DEFAULT_RATE_LIMIT_CONFIG,
  RATE_LIMIT_BUCKETS,
  type RateLimitAdminConfig,
  type RateLimitAdminConfigUpdate,
  type RateLimitBucketConfig,
  type RateLimitBucketId,
} from '../../lib/rateLimitConfig'

const CONFIG_KEY = 'rate_limit_config'

const MIN_WINDOW_MS = 1000
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000
const MIN_MAX_REQUESTS = 1
const MAX_MAX_REQUESTS = 100_000
const MAX_MESSAGE_LENGTH = 120
const RATE_LIMIT_BUCKET_SET = new Set<string>(RATE_LIMIT_BUCKETS)

export class RateLimitConfigValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RateLimitConfigValidationError'
  }
}

function cloneConfig(config: RateLimitAdminConfig): RateLimitAdminConfig {
  return RATE_LIMIT_BUCKETS.reduce((result, bucket) => {
    result[bucket] = { ...config[bucket] }
    return result
  }, {} as RateLimitAdminConfig)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function normalizeBucketConfig(bucket: RateLimitBucketId, value: unknown): RateLimitBucketConfig {
  const defaults = DEFAULT_RATE_LIMIT_CONFIG[bucket]

  if (!isRecord(value)) {
    return { ...defaults }
  }

  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : defaults.enabled,
    windowMs: isIntegerInRange(value.windowMs, MIN_WINDOW_MS, MAX_WINDOW_MS)
      ? value.windowMs
      : defaults.windowMs,
    max: isIntegerInRange(value.max, MIN_MAX_REQUESTS, MAX_MAX_REQUESTS) ? value.max : defaults.max,
    message:
      typeof value.message === 'string' &&
      value.message.trim() &&
      value.message.trim().length <= MAX_MESSAGE_LENGTH
        ? value.message.trim()
        : defaults.message,
  }
}

function normalizeConfig(value: unknown): RateLimitAdminConfig {
  return RATE_LIMIT_BUCKETS.reduce((result, bucket) => {
    const bucketValue = isRecord(value) ? value[bucket] : undefined
    result[bucket] = normalizeBucketConfig(bucket, bucketValue)
    return result
  }, {} as RateLimitAdminConfig)
}

function validateBucketUpdate(
  bucket: RateLimitBucketId,
  update: unknown
): Partial<RateLimitBucketConfig> {
  if (!isRecord(update)) {
    throw new RateLimitConfigValidationError(`${bucket} 必须是对象`)
  }

  const normalized: Partial<RateLimitBucketConfig> = {}

  if ('enabled' in update) {
    if (typeof update.enabled !== 'boolean') {
      throw new RateLimitConfigValidationError(`${bucket}.enabled 必须是布尔值`)
    }
    normalized.enabled = update.enabled
  }

  if ('windowMs' in update) {
    if (!isIntegerInRange(update.windowMs, MIN_WINDOW_MS, MAX_WINDOW_MS)) {
      throw new RateLimitConfigValidationError(
        `${bucket}.windowMs 必须是 ${MIN_WINDOW_MS} 到 ${MAX_WINDOW_MS} 之间的整数`
      )
    }
    normalized.windowMs = update.windowMs
  }

  if ('max' in update) {
    if (!isIntegerInRange(update.max, MIN_MAX_REQUESTS, MAX_MAX_REQUESTS)) {
      throw new RateLimitConfigValidationError(
        `${bucket}.max 必须是 ${MIN_MAX_REQUESTS} 到 ${MAX_MAX_REQUESTS} 之间的整数`
      )
    }
    normalized.max = update.max
  }

  if ('message' in update) {
    if (typeof update.message !== 'string') {
      throw new RateLimitConfigValidationError(`${bucket}.message 必须是字符串`)
    }

    const trimmed = update.message.trim()
    if (!trimmed || trimmed.length > MAX_MESSAGE_LENGTH) {
      throw new RateLimitConfigValidationError(
        `${bucket}.message 长度必须是 1 到 ${MAX_MESSAGE_LENGTH} 个字符`
      )
    }
    normalized.message = trimmed
  }

  return normalized
}

function normalizeUpdate(update: unknown): RateLimitAdminConfigUpdate {
  if (!isRecord(update)) {
    throw new RateLimitConfigValidationError('请求体必须是对象')
  }

  const unknownBucket = Object.keys(update).find((key) => !RATE_LIMIT_BUCKET_SET.has(key))
  if (unknownBucket) {
    throw new RateLimitConfigValidationError(`未知的限流配置项：${unknownBucket}`)
  }

  return RATE_LIMIT_BUCKETS.reduce((result, bucket) => {
    if (bucket in update) {
      result[bucket] = validateBucketUpdate(bucket, update[bucket])
    }
    return result
  }, {} as RateLimitAdminConfigUpdate)
}

export class RateLimitConfigService {
  private config: RateLimitAdminConfig = cloneConfig(DEFAULT_RATE_LIMIT_CONFIG)

  getConfig(): RateLimitAdminConfig {
    return cloneConfig(this.config)
  }

  async loadConfigFromDB(): Promise<RateLimitAdminConfig> {
    try {
      const record = await prisma.siteConfig.findUnique({ where: { key: CONFIG_KEY } })
      if (!record?.value) {
        await this.saveConfigToDB(this.config)
        return this.getConfig()
      }

      this.config = normalizeConfig(record.value)
      return this.getConfig()
    } catch (error) {
      logger.error({ err: error }, '[RateLimit] Failed to load config from DB, using defaults')
      this.config = cloneConfig(DEFAULT_RATE_LIMIT_CONFIG)
      return this.getConfig()
    }
  }

  async updateConfig(update: unknown): Promise<RateLimitAdminConfig> {
    const normalizedUpdate = normalizeUpdate(update)
    const nextConfig = this.getConfig()

    for (const bucket of RATE_LIMIT_BUCKETS) {
      if (normalizedUpdate[bucket]) {
        nextConfig[bucket] = {
          ...nextConfig[bucket],
          ...normalizedUpdate[bucket],
        }
      }
    }

    await this.saveConfigToDB(nextConfig)
    this.config = nextConfig
    return this.getConfig()
  }

  async resetConfig(): Promise<RateLimitAdminConfig> {
    const defaultConfig = cloneConfig(DEFAULT_RATE_LIMIT_CONFIG)
    await this.saveConfigToDB(defaultConfig)
    this.config = defaultConfig
    return this.getConfig()
  }

  private async saveConfigToDB(config: RateLimitAdminConfig): Promise<void> {
    await prisma.siteConfig.upsert({
      where: { key: CONFIG_KEY },
      update: {
        value: config as unknown as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
      create: {
        key: CONFIG_KEY,
        value: config as unknown as Prisma.InputJsonValue,
      },
    })
  }
}

export const rateLimitConfigService = new RateLimitConfigService()
