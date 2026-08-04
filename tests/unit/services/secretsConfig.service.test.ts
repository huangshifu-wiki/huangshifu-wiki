import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockFindUnique = vi.hoisted(() => vi.fn())
const mockUpsert = vi.hoisted(() => vi.fn())
const mockLogger = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), debug: vi.fn() }))

vi.mock('../../../src/server/prisma', () => ({
  prisma: {
    siteConfig: {
      findUnique: mockFindUnique,
      upsert: mockUpsert,
    },
  },
}))

vi.mock('../../../src/server/utils/logger', () => ({
  logger: mockLogger,
}))

import { SecretsConfigValidationError } from '../../../src/server/services/secretsConfig.service'
import { maskSecrets } from '../../../src/server/services/secretsConfig.service'
import { secretsConfigService } from '../../../src/server/services/secretsConfig.service'

const TEST_KEY = Buffer.alloc(32, 7).toString('base64')

describe('secretsConfigService', () => {
  const originalKey = process.env.SECRETS_ENCRYPTION_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    mockFindUnique.mockResolvedValue(null)
    mockUpsert.mockResolvedValue({})
    process.env.SECRETS_ENCRYPTION_KEY = TEST_KEY
  })

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.SECRETS_ENCRYPTION_KEY
    } else {
      process.env.SECRETS_ENCRYPTION_KEY = originalKey
    }
  })

  it('updateSecrets 加密持久化并同步内存副本', async () => {
    const saved = await secretsConfigService.updateSecrets({
      amapApiKey: ' amap-key-123 ',
      lskyToken: 'lsky-token-4567',
    })

    expect(saved.amapApiKey).toBe('amap-key-123')
    expect(saved.lskyToken).toBe('lsky-token-4567')

    // 落库的是密文，绝不包含明文
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    const upsertArg = mockUpsert.mock.calls[0][0]
    const storedValue = upsertArg.create.value
    expect(typeof storedValue.encrypted).toBe('string')
    expect(storedValue.encrypted).not.toContain('amap-key-123')

    expect(secretsConfigService.getSecrets().amapApiKey).toBe('amap-key-123')
  })

  it('null 清除凭证、undefined 保持原值', async () => {
    await secretsConfigService.updateSecrets({ amapApiKey: 'key-abc' })
    await secretsConfigService.updateSecrets({ amapApiKey: null, qdrantApiKey: undefined })

    const secrets = secretsConfigService.getSecrets()
    expect(secrets.amapApiKey).toBe('')
    expect(secrets.qdrantApiKey).toBe('')
  })

  it('主密钥缺失时凭证管理 fail-closed', async () => {
    delete process.env.SECRETS_ENCRYPTION_KEY

    await expect(secretsConfigService.updateSecrets({ amapApiKey: 'x' })).rejects.toThrow(
      SecretsConfigValidationError
    )
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('主密钥长度非法时禁用', async () => {
    process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64')

    await expect(secretsConfigService.updateSecrets({ amapApiKey: 'x' })).rejects.toThrow(
      SecretsConfigValidationError
    )
  })
})

describe('maskSecrets', () => {
  it('只暴露配置状态与末 4 位，绝不返回明文', () => {
    const masked = maskSecrets({
      superbedApiToken: '',
      amapApiKey: 'secret-amap-key-1234',
      qdrantApiKey: '',
      lskyToken: '',
      s3ReadAccessKeyId: '',
      s3ReadSecretAccessKey: '',
      s3WriteAccessKeyId: 'AKIAEXAMPLE',
      s3WriteSecretAccessKey: '',
      wechatMpAppId: '',
      wechatMpAppSecret: '',
    })

    expect(masked.amapApiKey).toEqual({ configured: true, last4: '1234' })
    expect(masked.superbedApiToken).toEqual({ configured: false, last4: '' })
    expect(JSON.stringify(masked)).not.toContain('secret-amap')
    expect(JSON.stringify(masked)).not.toContain('AKIAEXAMPLE')
  })
})
