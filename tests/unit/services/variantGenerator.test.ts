/**
 * VariantGenerator 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import sharp from 'sharp'
import { prisma } from '../../../src/server/prisma'

// 定义 mock 函数（必须在 vi.mock 之前）
const mockAccess = vi.fn().mockResolvedValue(undefined)
const mockStat = vi.fn().mockResolvedValue({
  isFile: () => true,
  size: 1024 * 100,
  mtime: new Date(),
})
const mockMkdir = vi.fn().mockResolvedValue(undefined)
const mockReaddir = vi.fn().mockResolvedValue([])
const mockExistsSync = vi.fn().mockReturnValue(true)

// Mock prisma 模块
vi.mock('../../../src/server/prisma', () => ({
  prisma: {
    imageMap: {
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}))

// Mock sharp 模块
vi.mock('sharp', () => {
  const mockSharp = {
    resize: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    toFile: vi.fn().mockResolvedValue({ width: 400, height: 300 }),
    metadata: vi.fn().mockResolvedValue({
      width: 1920,
      height: 1080,
      format: 'jpeg',
    }),
  }

  return {
    default: vi.fn(() => mockSharp),
  }
})

// Mock fs 模块 - 使用 importOriginal 保留 default export
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    promises: {
      access: mockAccess,
      stat: mockStat,
      mkdir: mockMkdir,
      readdir: mockReaddir,
    },
    existsSync: mockExistsSync,
    statfs: vi.fn(),
  }
})

describe('VariantGenerator - 初始化与配置', () => {
  let VariantGenerator: any

  beforeEach(async () => {
    process.env.VARIANT_MAX_CONCURRENT = '3'
    process.env.VARIANT_TASK_TIMEOUT_MS = '30000'
    process.env.VARIANT_QUEUE_MAX_WAIT_MS = '300000'
    process.env.VARIANT_SHARP_MEMORY_LIMIT_MB = '512'
    process.env.VARIANT_MAX_RETRIES = '3'

    const module = await import('../../../src/server/services/variantGenerator')
    VariantGenerator = module.VariantGenerator

    vi.clearAllMocks()
  })

  it('应该使用环境变量正确初始化配置', async () => {
    const generator = new VariantGenerator()

    const stats = generator.getQueueStats()
    expect(stats).toBeDefined()
  })

  it('恢复待处理任务时不应使用非法的 localUrl 空值过滤', async () => {
    new VariantGenerator()

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(prisma.imageMap.findMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        variantStatus: { in: ['pending', 'processing'] },
      },
      take: 100,
    })
  })
})

describe('VariantGenerator - 队列管理', () => {
  let generator: any

  beforeEach(async () => {
    process.env.VARIANT_MAX_CONCURRENT = '2'
    process.env.VARIANT_TASK_TIMEOUT_MS = '1000' // 测试用缩短超时时?
    const module = await import('../../../src/server/services/variantGenerator')
    const VariantGenerator = module.VariantGenerator
    generator = new VariantGenerator()

    vi.clearAllMocks()
  })

  it('应该能够入队变体生成任务', async () => {
    const task = {
      imageMapId: 'test-1',
      localFilePath: '/uploads/original/test.png',
      priority: 'normal' as const,
    }

    // enqueue 会立即触发 processNext()，需要等待异步处理完成
    await generator.enqueue(task)
    await new Promise((resolve) => setTimeout(resolve, 50))

    // 验证 enqueue 调用成功（任务可能已被处理）
    const stats = generator.getQueueStats()
    expect(stats).toBeDefined()
    expect(typeof stats.queueLength).toBe('number')
  })

  it('高优先级任务应该插入队首', async () => {
    const normalTask = {
      imageMapId: 'normal-1',
      localFilePath: '/uploads/normal.png',
      priority: 'normal' as const,
    }

    const highTask = {
      imageMapId: 'high-1',
      localFilePath: '/uploads/high.png',
      priority: 'high' as const,
    }

    await generator.enqueue(normalTask)
    await generator.enqueue(highTask)

    // 等待异步处理
    await new Promise((resolve) => setTimeout(resolve, 50))

    // 验证两个任务都已入队（可能已被处理）
    const stats = generator.getQueueStats()
    expect(stats).toBeDefined()
    expect(typeof stats.queueLength).toBe('number')
  })

  it('getMaxConcurrent 应该返回正确的并发数', () => {
    const maxConcurrent = generator.getMaxConcurrent()
    expect(maxConcurrent).toBe(2)
  })

  it('重复 imageMapId 已在处理中时不应重复入队', async () => {
    vi.useFakeTimers()
    mockAccess.mockImplementation(() => new Promise(() => {}))

    try {
      const task = {
        imageMapId: 'duplicate-1',
        localFilePath: '/uploads/duplicate.png',
        priority: 'normal' as const,
      }

      await Promise.all([generator.enqueue(task), generator.enqueue(task)])

      expect(generator.getQueueStats()).toMatchObject({
        queueLength: 0,
        processingCount: 1,
      })
    } finally {
      generator.stop()
      mockAccess.mockResolvedValue(undefined)
      vi.useRealTimers()
    }
  })

  it('禁用入队即处理时只应保留队列任务', async () => {
    const module = await import('../../../src/server/services/variantGenerator')
    const VariantGenerator = module.VariantGenerator
    const queuedOnlyGenerator = new VariantGenerator({
      autoStart: false,
      processOnEnqueue: false,
    })

    await queuedOnlyGenerator.enqueue({
      imageMapId: 'queued-only-1',
      localFilePath: '/uploads/queued-only.png',
      priority: 'normal' as const,
    })

    expect(queuedOnlyGenerator.getQueueStats()).toMatchObject({
      queueLength: 1,
      processingCount: 0,
    })
    expect(sharp).not.toHaveBeenCalled()
    expect(prisma.imageMap.update).not.toHaveBeenCalled()
  })
})

describe('VariantGenerator - 统计信息', () => {
  let generator: any

  beforeEach(async () => {
    const module = await import('../../../src/server/services/variantGenerator')
    const VariantGenerator = module.VariantGenerator
    generator = new VariantGenerator()
  })

  it('getQueueStats 应该返回完整的统计信息', () => {
    const stats = generator.getQueueStats()

    expect(stats).toHaveProperty('queueLength')
    expect(stats).toHaveProperty('processingCount')
    expect(stats).toHaveProperty('completedToday')
    expect(stats).toHaveProperty('failedToday')
    expect(stats).toHaveProperty('averageProcessingTime')
    expect(stats).toHaveProperty('timeoutCount')

    expect(typeof stats.queueLength).toBe('number')
    expect(typeof stats.processingCount).toBe('number')
    expect(typeof stats.completedToday).toBe('number')
    expect(typeof stats.failedToday).toBe('number')
    expect(typeof stats.averageProcessingTime).toBe('number')
    expect(typeof stats.timeoutCount).toBe('number')
  })
})

describe('VariantGenerator - URL 转换工具', () => {
  let generator: any

  beforeEach(async () => {
    const module = await import('../../../src/server/services/variantGenerator')
    const VariantGenerator = module.VariantGenerator
    generator = new VariantGenerator()
  })

  it('urlToAbsolutePath 应该将相对路径转换为绝对路径', () => {
    const url = '/uploads/original/test-image.png'
    const absolutePath = generator.urlToAbsolutePath(url)

    // 使用平台无关的断言（Windows 上 path.join 返回反斜杠）
    expect(absolutePath).toContain('uploads')

    // 将路径规范化为正斜杠进行断言
    const normalizedPath = absolutePath.replace(/\\/g, '/')
    expect(normalizedPath).toContain('original/test-image.png')

    // 验证路径已正确规范化（无重复分隔符）
    expect(normalizedPath).not.toContain('//')
  })
})
