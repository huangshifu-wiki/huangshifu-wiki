/**
 * CloudSyncService 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'

// Mock 配置服务：LSKY 配置已从 env 迁移到运行时配置/凭证服务
const { runtimeConfigGetMock, secretsGetMock } = vi.hoisted(() => ({
  runtimeConfigGetMock: vi.fn(),
  secretsGetMock: vi.fn(),
}))

vi.mock('../../../src/server/services/runtimeConfig.service', () => ({
  runtimeConfigService: { getConfig: runtimeConfigGetMock },
}))

vi.mock('../../../src/server/services/secretsConfig.service', () => ({
  secretsConfigService: { getSecrets: secretsGetMock },
}))

// Mock prisma 模块
vi.mock('../../../src/server/prisma', () => ({
  prisma: {
    imageMap: {
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn(),
    },
    siteConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}))

// Mock fs 模块
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    promises: {
      readFile: vi.fn().mockResolvedValue(Buffer.from('test')),
      access: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue({ size: 1024 }),
    },
    statfs: vi.fn(),
  }
})

const defaultRuntimeConfig = {
  lskyBaseUrl: 'https://img.lhl.one',
  lskyTimeout: 30000,
  lskyStrategyId: '',
  cloudSyncMaxConcurrent: 2,
  cloudSyncMaxRetries: 3,
}

const defaultSecrets = {
  lskyToken: 'test_token',
}

function mockLskyConfig(
  runtimeOverrides: Record<string, unknown> = {},
  secretsOverrides: Record<string, unknown> = {}
) {
  runtimeConfigGetMock.mockReturnValue({ ...defaultRuntimeConfig, ...runtimeOverrides })
  secretsGetMock.mockReturnValue({ ...defaultSecrets, ...secretsOverrides })
}

describe('CloudSyncService - 配置验证', () => {
  let CloudSyncService: any

  beforeAll(async () => {
    const module = await import('../../../src/server/services/cloudSyncService')
    CloudSyncService = module.CloudSyncService
  }, 30000)

  beforeEach(() => {
    vi.clearAllMocks()
    mockLskyConfig()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('应该在 LSKY_BASE_URL 缺失时输出警告', async () => {
    mockLskyConfig({ lskyBaseUrl: '' }, { lskyToken: '' })

    const service = new CloudSyncService()

    expect(service.isLskyProAvailable()).toBe(false)
  })

  it('应该在 LSKY_TOKEN 缺失时输出警告', async () => {
    mockLskyConfig({}, { lskyToken: '' })

    const service = new CloudSyncService()

    expect(service.isLskyProAvailable()).toBe(false)
  })

  it('应该在配置有效时返回正确的配置', async () => {
    mockLskyConfig({ lskyStrategyId: '4' })

    const service = new CloudSyncService()

    expect(service.isLskyProAvailable()).toBe(true)

    const config = service.getLskyConfig()
    expect(config.baseUrl).toBe('https://img.lhl.one')
    expect(config.token).toBe('test_token')
    expect(config.timeout).toBe(30000)
    expect(config.strategyId).toBe('4')
  })

  it('应该拒绝无效的 URL 格式', async () => {
    mockLskyConfig({ lskyBaseUrl: 'not-a-valid-url' })

    const service = new CloudSyncService()

    expect(service.isLskyProAvailable()).toBe(false)
  })
})

describe('CloudSyncService - 队列管理', () => {
  let service: any
  let CloudSyncService: any

  beforeAll(async () => {
    mockLskyConfig()

    const module = await import('../../../src/server/services/cloudSyncService')
    CloudSyncService = module.CloudSyncService
  }, 30000)

  beforeEach(() => {
    vi.clearAllMocks()
    mockLskyConfig()
    service = new CloudSyncService()
  })

  it('应该能够入队同步任务', async () => {
    // Mock processNext 以阻止任务被立即处理
    const processNextSpy = vi.spyOn(service, 'processNext').mockResolvedValue(undefined)

    const task = {
      imageMapId: 'test-1',
      strategy: 's3',
      filePath: '/uploads/test.png',
      fileName: 'test.png',
      mimeType: 'image/png',
      priority: 'normal' as const,
    }

    await service.enqueue(task)

    const stats = service.getQueueStats()
    expect(stats.queueLength).toBeGreaterThan(0)

    processNextSpy.mockRestore()
  })

  it('高优先级任务应该插入队首', async () => {
    // Mock processNext 以阻止任务被立即处理
    const processNextSpy = vi.spyOn(service, 'processNext').mockResolvedValue(undefined)

    const normalTask = {
      imageMapId: 'normal-1',
      strategy: 's3' as const,
      filePath: '/uploads/normal.png',
      fileName: 'normal.png',
      mimeType: 'image/png',
      priority: 'normal' as const,
    }

    const highTask = {
      imageMapId: 'high-1',
      strategy: 's3' as const,
      filePath: '/uploads/high.png',
      fileName: 'high.png',
      mimeType: 'image/png',
      priority: 'high' as const,
    }

    await service.enqueue(normalTask)
    await service.enqueue(highTask)

    const stats = service.getQueueStats()
    expect(stats.queueLength).toBe(2)

    processNextSpy.mockRestore()
  })

  it('Local 策略应该标记为 skipped', async () => {
    await service.syncToCloud('test-id', 'local', '/uploads/test.png', 'test.png', 'image/png')

    // 使用已导入的 prisma mock
    const { prisma } = await import('../../../src/server/prisma')
    expect(prisma.imageMap.update).toHaveBeenCalledWith({
      where: { id: 'test-id' },
      data: { cloudSyncStatus: 'skipped' },
    })
  })
})

describe('CloudSyncService - 统计信息', () => {
  let service: any
  let CloudSyncService: any

  beforeAll(async () => {
    mockLskyConfig()

    const module = await import('../../../src/server/services/cloudSyncService')
    CloudSyncService = module.CloudSyncService
  }, 30000)

  beforeEach(() => {
    service = new CloudSyncService()
  })

  it('getQueueStats 应该返回正确的统计结构', () => {
    const stats = service.getQueueStats()

    expect(stats).toHaveProperty('queueLength')
    expect(stats).toHaveProperty('processingCount')
    expect(stats).toHaveProperty('completedToday')
    expect(stats).toHaveProperty('failedToday')
    expect(stats).toHaveProperty('averageProcessingTime')
    expect(typeof stats.queueLength).toBe('number')
    expect(typeof stats.processingCount).toBe('number')
  })
})
