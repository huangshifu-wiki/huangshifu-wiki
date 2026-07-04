import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_RATE_LIMIT_CONFIG } from '../../../src/lib/rateLimitConfig'
import { RateLimitConfigService } from '../../../src/server/services/rateLimitConfig.service'

const mockFindUnique = vi.hoisted(() => vi.fn())
const mockUpsert = vi.hoisted(() => vi.fn())
const mockLogger = vi.hoisted(() => ({
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
}))

describe('RateLimitConfigService', () => {
  let service: RateLimitConfigService

  beforeEach(() => {
    vi.clearAllMocks()
    mockFindUnique.mockResolvedValue(null)
    mockUpsert.mockResolvedValue({})
    service = new RateLimitConfigService()
  })

  it('loads defaults and persists them when database config is missing', async () => {
    const config = await service.loadConfigFromDB()

    expect(config).toEqual(DEFAULT_RATE_LIMIT_CONFIG)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'rate_limit_config' },
        create: expect.objectContaining({ key: 'rate_limit_config' }),
      })
    )
  })

  it('merges partial database config with defaults', async () => {
    mockFindUnique.mockResolvedValue({
      value: {
        global: {
          enabled: false,
          windowMs: 120000,
          max: 300,
          message: '全局限流',
        },
      },
    })

    const config = await service.loadConfigFromDB()

    expect(config.global).toEqual({
      enabled: false,
      windowMs: 120000,
      max: 300,
      message: '全局限流',
    })
    expect(config.search).toEqual(DEFAULT_RATE_LIMIT_CONFIG.search)
  })

  it('falls back to defaults for invalid persisted bucket values', async () => {
    mockFindUnique.mockResolvedValue({
      value: {
        global: {
          enabled: true,
          windowMs: 0,
          max: 0,
          message: '',
        },
      },
    })

    const config = await service.loadConfigFromDB()

    expect(config.global).toEqual(DEFAULT_RATE_LIMIT_CONFIG.global)
  })

  it('rejects invalid updates', async () => {
    await expect(service.updateConfig({ global: { max: 0 } })).rejects.toThrow(
      'global.max 必须是 1 到 100000 之间的整数'
    )
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('rejects unknown bucket updates', async () => {
    await expect(service.updateConfig({ typo: { max: 10 } })).rejects.toThrow(
      '未知的限流配置项：typo'
    )
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('saves valid partial updates and resets to defaults', async () => {
    const updated = await service.updateConfig({
      search: { enabled: false, windowMs: 120000, max: 60 },
    })

    expect(updated.search).toEqual({
      ...DEFAULT_RATE_LIMIT_CONFIG.search,
      enabled: false,
      windowMs: 120000,
      max: 60,
    })
    expect(mockUpsert).toHaveBeenCalledTimes(1)

    const reset = await service.resetConfig()

    expect(reset).toEqual(DEFAULT_RATE_LIMIT_CONFIG)
    expect(mockUpsert).toHaveBeenCalledTimes(2)
  })

  it('does not mutate memory config when persistence fails', async () => {
    mockUpsert.mockRejectedValueOnce(new Error('database failed'))

    await expect(service.updateConfig({ search: { max: 60 } })).rejects.toThrow('database failed')

    expect(service.getConfig().search).toEqual(DEFAULT_RATE_LIMIT_CONFIG.search)
  })
})
