import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_RUNTIME_CONFIG,
  normalizeRuntimeConfigUpdate,
} from '../../../src/server/services/runtimeConfig.service'
import { RuntimeConfigValidationError } from '../../../src/server/services/runtimeConfig.service'

const mockFindUnique = vi.hoisted(() => vi.fn())
const mockUpsert = vi.hoisted(() => vi.fn())
const mockSetLogLevel = vi.hoisted(() => vi.fn())
const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

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
  setLogLevel: mockSetLogLevel,
}))

describe('normalizeRuntimeConfigUpdate', () => {
  it('忽略未知字段', () => {
    expect(normalizeRuntimeConfigUpdate({ notARealField: 1 })).toEqual({})
  })

  it('拒绝非对象更新', () => {
    expect(() => normalizeRuntimeConfigUpdate('nope')).toThrow(RuntimeConfigValidationError)
    expect(() => normalizeRuntimeConfigUpdate(null)).toThrow(RuntimeConfigValidationError)
  })

  it('拒绝类型非法的布尔字段', () => {
    expect(() => normalizeRuntimeConfigUpdate({ s3Enabled: 'yes' })).toThrow(
      RuntimeConfigValidationError
    )
  })

  it('数字字段越界时 clamp 到约束范围', () => {
    const result = normalizeRuntimeConfigUpdate({
      s3ExpiresIn: 999999,
      s3MaxFileSize: 0,
      lskyTimeout: 50,
    })
    expect(result.s3ExpiresIn).toBe(86400)
    expect(result.s3MaxFileSize).toBe(1)
    expect(result.lskyTimeout).toBe(1000)
  })

  it('拒绝类型非法的数字字段', () => {
    expect(() => normalizeRuntimeConfigUpdate({ s3ExpiresIn: 'fast' })).toThrow(
      RuntimeConfigValidationError
    )
  })

  it('字符串字段 trim 后存储', () => {
    const result = normalizeRuntimeConfigUpdate({
      qdrantUrl: '  http://qdrant:6333  ',
      s3PublicBucketName: ' my-bucket ',
    })
    expect(result.qdrantUrl).toBe('http://qdrant:6333')
    expect(result.s3PublicBucketName).toBe('my-bucket')
  })

  it('拒绝类型非法的字符串字段', () => {
    expect(() => normalizeRuntimeConfigUpdate({ qdrantUrl: 42 })).toThrow(
      RuntimeConfigValidationError
    )
  })

  it('枚举字段接受合法值并拒绝越界值', () => {
    expect(normalizeRuntimeConfigUpdate({ logLevel: 'debug' }).logLevel).toBe('debug')
    expect(normalizeRuntimeConfigUpdate({ s3SignatureVersion: 'v2' }).s3SignatureVersion).toBe('v2')
    expect(() => normalizeRuntimeConfigUpdate({ logLevel: 'verbose' })).toThrow(
      RuntimeConfigValidationError
    )
    expect(() => normalizeRuntimeConfigUpdate({ s3SignatureVersion: 'v3' })).toThrow(
      RuntimeConfigValidationError
    )
  })
})

describe('RuntimeConfigService 日志挂点', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindUnique.mockResolvedValue(null)
    mockUpsert.mockResolvedValue({})
  })

  it('updateConfig 设置 logLevel 时同步应用日志级别', async () => {
    const { runtimeConfigService } =
      await import('../../../src/server/services/runtimeConfig.service')

    await runtimeConfigService.updateConfig({ logLevel: 'debug' })

    expect(mockSetLogLevel).toHaveBeenCalledWith('debug')
    expect(runtimeConfigService.getConfig().logLevel).toBe('debug')
  })

  it('resetConfig 恢复默认日志级别', async () => {
    const { runtimeConfigService } =
      await import('../../../src/server/services/runtimeConfig.service')

    await runtimeConfigService.updateConfig({ logLevel: 'debug' })
    await runtimeConfigService.resetConfig()

    expect(mockSetLogLevel).toHaveBeenLastCalledWith(DEFAULT_RUNTIME_CONFIG.logLevel)
    expect(runtimeConfigService.getConfig()).toEqual(DEFAULT_RUNTIME_CONFIG)
  })
})
