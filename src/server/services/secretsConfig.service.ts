/**
 * 服务凭证配置服务 - 管理面板可动态修改
 *
 * 外部服务凭证（S3 / 外部图床 / 向量库 / 微信 / 高德）统一存放于此：
 * - 存储于 SiteConfig 表（key: secrets_config），AES-256-GCM 加密
 * - 主密钥 SECRETS_ENCRYPTION_KEY（base64 编码的 32 字节）保留在环境变量，
 *   缺失时禁用面板凭证管理（isSecretsEnabled() === false），消费点按未配置运行
 * - getSecrets() 为同步读取（内存副本），面板修改后即时生效
 */

import crypto from 'node:crypto'
import { prisma } from '../prisma'
import { logger } from '../utils/logger'

export interface SecretsConfig {
  superbedApiToken: string
  amapApiKey: string
  qdrantApiKey: string
  lskyToken: string
  s3ReadAccessKeyId: string
  s3ReadSecretAccessKey: string
  s3WriteAccessKeyId: string
  s3WriteSecretAccessKey: string
  wechatMpAppId: string
  wechatMpAppSecret: string
}

export const DEFAULT_SECRETS_CONFIG: SecretsConfig = {
  superbedApiToken: '',
  amapApiKey: '',
  qdrantApiKey: '',
  lskyToken: '',
  s3ReadAccessKeyId: '',
  s3ReadSecretAccessKey: '',
  s3WriteAccessKeyId: '',
  s3WriteSecretAccessKey: '',
  wechatMpAppId: '',
  wechatMpAppSecret: '',
}

const CONFIG_KEY = 'secrets_config'

const SECRET_FIELDS = Object.keys(DEFAULT_SECRETS_CONFIG) as (keyof SecretsConfig)[]

export class SecretsConfigValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretsConfigValidationError'
  }
}

/** 主密钥：base64 编码的 32 字节；缺失时禁用凭证管理 */
function getEncryptionKey(): Buffer | null {
  const raw = process.env.SECRETS_ENCRYPTION_KEY
  if (!raw) return null
  try {
    const key = Buffer.from(raw, 'base64')
    return key.length === 32 ? key : null
  } catch {
    return null
  }
}

export function isSecretsEnabled(): boolean {
  return getEncryptionKey() !== null
}

function encryptSecrets(config: SecretsConfig): string {
  const key = getEncryptionKey()
  if (!key) throw new SecretsConfigValidationError('未配置 SECRETS_ENCRYPTION_KEY，无法管理凭证')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.from(JSON.stringify(config), 'utf8')
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

function decryptSecrets(payload: string): SecretsConfig | null {
  const key = getEncryptionKey()
  if (!key) return null
  try {
    const buffer = Buffer.from(payload, 'base64')
    const iv = buffer.subarray(0, 12)
    const tag = buffer.subarray(12, 28)
    const encrypted = buffer.subarray(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const data = Buffer.concat([decipher.update(encrypted), decipher.final()])
    const parsed: unknown = JSON.parse(data.toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    const result: SecretsConfig = { ...DEFAULT_SECRETS_CONFIG }
    for (const field of SECRET_FIELDS) {
      if (typeof record[field] === 'string') result[field] = record[field]
    }
    return result
  } catch (error) {
    logger.error(
      { err: error },
      '[SecretsConfig] Failed to decrypt secrets config, treating as unconfigured'
    )
    return null
  }
}

/**
 * 掩码视图（供管理端点返回，绝不包含明文）
 */
export function maskSecrets(
  config: SecretsConfig
): Record<string, { configured: boolean; last4: string }> {
  const result: Record<string, { configured: boolean; last4: string }> = {}
  for (const field of SECRET_FIELDS) {
    const value = config[field]
    result[field] =
      value.length > 4
        ? { configured: true, last4: value.slice(-4) }
        : { configured: value.length > 0, last4: '' }
  }
  return result
}

export class SecretsConfigService {
  private static instance: SecretsConfigService

  private current: SecretsConfig = { ...DEFAULT_SECRETS_CONFIG }
  private loading: Promise<void> | null = null

  public static getInstance(): SecretsConfigService {
    if (!SecretsConfigService.instance) {
      SecretsConfigService.instance = new SecretsConfigService()
    }
    return SecretsConfigService.instance
  }

  /** 从数据库加载（幂等；解密失败视为未配置，不覆盖 DB） */
  init(): Promise<void> {
    if (!this.loading) {
      this.loading = this.loadFromDB()
    }
    return this.loading
  }

  private async loadFromDB(): Promise<void> {
    try {
      const record = await prisma.siteConfig.findUnique({
        where: { key: CONFIG_KEY },
      })
      if (record?.value && typeof record.value === 'object' && record.value !== null) {
        const encrypted = (record.value as { encrypted?: unknown }).encrypted
        if (typeof encrypted === 'string') {
          const decrypted = decryptSecrets(encrypted)
          if (decrypted) this.current = decrypted
        }
      }
    } catch (error) {
      logger.error({ err: error }, '[SecretsConfig] Failed to load from DB, using unconfigured')
      this.current = { ...DEFAULT_SECRETS_CONFIG }
    }
  }

  /** 当前凭证（同步浅拷贝，未配置字段为空字符串） */
  getSecrets(): SecretsConfig {
    return { ...this.current }
  }

  // 写串行化：并发 PATCH 基于同一快照会互相覆盖，改为逐个执行
  private writeQueue: Promise<unknown> = Promise.resolve()

  /**
   * 更新凭证：null = 清除该字段，string = 设置（trim 后，空字符串按清除处理）
   */
  async updateSecrets(update: Record<string, string | null | undefined>): Promise<SecretsConfig> {
    if (!isSecretsEnabled()) {
      throw new SecretsConfigValidationError('未配置 SECRETS_ENCRYPTION_KEY，无法管理凭证')
    }

    const task = this.writeQueue.then(async () => {
      const next: SecretsConfig = { ...this.current }
      for (const field of SECRET_FIELDS) {
        const value = update[field]
        if (value === undefined) continue
        if (value === null) {
          next[field] = ''
          continue
        }
        if (typeof value !== 'string') {
          throw new SecretsConfigValidationError(`${field} 必须是字符串或 null`)
        }
        next[field] = value.trim()
      }

      const encrypted = encryptSecrets(next)
      await prisma.siteConfig.upsert({
        where: { key: CONFIG_KEY },
        update: { value: { encrypted }, updatedAt: new Date() },
        create: { key: CONFIG_KEY, value: { encrypted } },
      })
      this.current = next
      return { ...next }
    })
    this.writeQueue = task.catch(() => undefined)
    return task
  }
}

export const secretsConfigService = SecretsConfigService.getInstance()
