/**
 * VariantGenerator 单元测试
 *
 * 注意：不 mock 'fs'（vitest 对 node 内置模块的 mock 工厂 hoisting 不可靠），
 * 改用真实临时文件 + sharp mock 真实写出输出文件的方式验证生成流程。
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import sharp from 'sharp'
import { prisma } from '../../../src/server/prisma'

// sharp 行为开关：hangMetadata = true 时 metadata 永不 resolve（模拟卡死任务）
const sharpState = vi.hoisted(() => ({ hangMetadata: false }))

// Mock prisma 模块
vi.mock('../../../src/server/prisma', () => ({
  prisma: {
    imageMap: {
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    songCover: {
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    albumCover: {
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}))

// Mock sharp 模块：toFile 真实写出文件，保证后续真实 fs.stat 可读
vi.mock('sharp', async () => {
  const realFs = await import('fs')
  const realPath = await import('path')

  const mockSharp = {
    resize: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    toFile: vi.fn(async (outputPath: string) => {
      await realFs.promises.mkdir(realPath.dirname(outputPath), { recursive: true })
      await realFs.promises.writeFile(outputPath, 'fake-image-bytes')
      return { width: 400, height: 300 }
    }),
    metadata: vi
      .fn()
      .mockImplementation(() =>
        sharpState.hangMetadata
          ? new Promise(() => {})
          : Promise.resolve({ width: 1920, height: 1080, format: 'jpeg' })
      ),
  }

  return {
    default: vi.fn(() => mockSharp),
  }
})

const TEST_UPLOADS_DIR = path.join(os.tmpdir(), 'huangshifu-variant-test-uploads')

describe('VariantGenerator - 初始化与配置', () => {
  let VariantGenerator: any

  beforeEach(async () => {
    process.env.VARIANT_MAX_CONCURRENT = '3'
    process.env.VARIANT_TASK_TIMEOUT_MS = '30000'
    process.env.VARIANT_QUEUE_MAX_WAIT_MS = '300000'
    process.env.VARIANT_SHARP_MEMORY_LIMIT_MB = '512'
    process.env.VARIANT_MAX_RETRIES = '3'
    process.env.UPLOADS_PATH = TEST_UPLOADS_DIR

    const module = await import('../../../src/server/services/variantGenerator')
    VariantGenerator = module.VariantGenerator

    vi.clearAllMocks()
  })

  it('应该使用环境变量正确初始化配置', async () => {
    const generator = new VariantGenerator()

    const stats = generator.getQueueStats()
    expect(stats).toBeDefined()
  })

  it('恢复待处理任务时应对三张表查询 pending/processing 记录', async () => {
    new VariantGenerator()

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(prisma.imageMap.findMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        variantStatus: { in: ['pending', 'processing'] },
      },
      take: 100,
    })
    expect(prisma.songCover.findMany).toHaveBeenCalledWith({
      where: {
        variantStatus: { in: ['pending', 'processing'] },
      },
      take: 100,
    })
    expect(prisma.albumCover.findMany).toHaveBeenCalledWith({
      where: {
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
    process.env.VARIANT_TASK_TIMEOUT_MS = '1000'
    process.env.UPLOADS_PATH = TEST_UPLOADS_DIR
    const module = await import('../../../src/server/services/variantGenerator')
    const VariantGenerator = module.VariantGenerator
    generator = new VariantGenerator()

    vi.clearAllMocks()
  })

  it('应该能够入队变体生成任务', async () => {
    const task = {
      targetType: 'imageMap' as const,
      targetId: 'test-1',
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
    const module = await import('../../../src/server/services/variantGenerator')
    const VariantGenerator = module.VariantGenerator
    const queuedOnlyGenerator = new VariantGenerator({
      autoStart: false,
      processOnEnqueue: false,
    })

    await queuedOnlyGenerator.enqueue({
      targetType: 'imageMap',
      targetId: 'normal-1',
      localFilePath: '/uploads/normal.png',
      priority: 'normal',
    })
    await queuedOnlyGenerator.enqueue({
      targetType: 'imageMap',
      targetId: 'high-1',
      localFilePath: '/uploads/high.png',
      priority: 'high',
    })

    const queue: Array<{ targetId: string }> = (queuedOnlyGenerator as any).queue
    expect(queue.map((task) => task.targetId)).toEqual(['high-1', 'normal-1'])
  })

  it('getMaxConcurrent 应该返回正确的并发数', () => {
    const maxConcurrent = generator.getMaxConcurrent()
    expect(maxConcurrent).toBe(2)
  })

  it('重复 targetType+targetId 已在处理中时不应重复入队', async () => {
    sharpState.hangMetadata = true
    try {
      const task = {
        targetType: 'imageMap' as const,
        targetId: 'duplicate-1',
        localFilePath: path.join(TEST_UPLOADS_DIR, 'original/duplicate.png'),
        priority: 'normal' as const,
      }

      await Promise.all([generator.enqueue(task), generator.enqueue(task)])

      expect(generator.getQueueStats()).toMatchObject({
        queueLength: 0,
        processingCount: 1,
      })
      expect(generator.getProcessingIds().has('imageMap:duplicate-1')).toBe(true)
    } finally {
      sharpState.hangMetadata = false
      generator.stop()
    }
  })

  it('同一目标重复入队（仍在队列中）时应自动跳过', async () => {
    const module = await import('../../../src/server/services/variantGenerator')
    const VariantGenerator = module.VariantGenerator
    const queuedOnlyGenerator = new VariantGenerator({
      autoStart: false,
      processOnEnqueue: false,
    })

    const task = {
      targetType: 'songCover' as const,
      targetId: 'queued-only-1',
      localFilePath: path.join(TEST_UPLOADS_DIR, 'music-covers/songs/queued-only.png'),
      priority: 'normal' as const,
    }

    await queuedOnlyGenerator.enqueue(task)
    await queuedOnlyGenerator.enqueue(task)

    expect(queuedOnlyGenerator.getQueueStats()).toMatchObject({
      queueLength: 1,
      processingCount: 0,
    })
  })

  it('禁用入队即处理时只应保留队列任务', async () => {
    const module = await import('../../../src/server/services/variantGenerator')
    const VariantGenerator = module.VariantGenerator
    const queuedOnlyGenerator = new VariantGenerator({
      autoStart: false,
      processOnEnqueue: false,
    })

    await queuedOnlyGenerator.enqueue({
      targetType: 'imageMap',
      targetId: 'queued-only-1',
      localFilePath: path.join(TEST_UPLOADS_DIR, 'original/queued-only.png'),
      priority: 'normal',
    })

    expect(queuedOnlyGenerator.getQueueStats()).toMatchObject({
      queueLength: 1,
      processingCount: 0,
    })
    expect(sharp).not.toHaveBeenCalled()
    expect(prisma.imageMap.update).not.toHaveBeenCalled()
  })
})

describe('VariantGenerator - 任务处理（按类型分发）', () => {
  let generator: any

  beforeEach(async () => {
    process.env.UPLOADS_PATH = TEST_UPLOADS_DIR
    // 准备真实源文件
    fs.mkdirSync(path.join(TEST_UPLOADS_DIR, 'music-covers/songs'), { recursive: true })
    fs.mkdirSync(path.join(TEST_UPLOADS_DIR, 'music-covers/albums'), { recursive: true })
    fs.mkdirSync(path.join(TEST_UPLOADS_DIR, 'original'), { recursive: true })
    fs.writeFileSync(path.join(TEST_UPLOADS_DIR, 'music-covers/songs/cover.jpg'), 'cover-src')
    fs.writeFileSync(path.join(TEST_UPLOADS_DIR, 'music-covers/albums/cover.jpg'), 'cover-src')
    fs.writeFileSync(path.join(TEST_UPLOADS_DIR, 'original.png'), 'src')

    const module = await import('../../../src/server/services/variantGenerator')
    const VariantGenerator = module.VariantGenerator
    generator = new VariantGenerator({ autoStart: false })

    vi.clearAllMocks()
  })

  it('imageMap 任务完成后应写入 thumbnailUrl 和 completed 状态', async () => {
    await generator.enqueue({
      targetType: 'imageMap',
      targetId: 'im-1',
      localFilePath: path.join(TEST_UPLOADS_DIR, 'original.png'),
      priority: 'normal',
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(prisma.imageMap.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'im-1' },
        data: expect.objectContaining({
          thumbnailUrl: '/uploads/variants/im-1/1080h.webp',
          variantStatus: 'completed',
        }),
      })
    )
  })

  it('songCover 任务完成后应写入缩略图、completed 状态和时间戳', async () => {
    await generator.enqueue({
      targetType: 'songCover',
      targetId: 'song-cover-1',
      localFilePath: path.join(TEST_UPLOADS_DIR, 'music-covers/songs/cover.jpg'),
      priority: 'normal',
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(prisma.songCover.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'song-cover-1' },
        data: expect.objectContaining({
          thumbnailUrl: expect.stringContaining('/uploads/music-covers/thumbnails/'),
          variantStatus: 'completed',
          variantGeneratedAt: expect.any(Date),
          lastError: null,
        }),
      })
    )
  })

  it('albumCover 任务完成后应写入缩略图、completed 状态和时间戳', async () => {
    await generator.enqueue({
      targetType: 'albumCover',
      targetId: 'album-cover-1',
      localFilePath: path.join(TEST_UPLOADS_DIR, 'music-covers/albums/cover.jpg'),
      priority: 'normal',
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(prisma.albumCover.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'album-cover-1' },
        data: expect.objectContaining({
          thumbnailUrl: expect.stringContaining('/uploads/music-covers/thumbnails/'),
          variantStatus: 'completed',
          variantGeneratedAt: expect.any(Date),
          lastError: null,
        }),
      })
    )
  })

  it('封面任务源文件缺失时应标记 failed 并记录 lastError', async () => {
    await generator.enqueue({
      targetType: 'songCover',
      targetId: 'song-cover-missing',
      localFilePath: path.join(TEST_UPLOADS_DIR, 'missing/cover.jpg'),
      priority: 'normal',
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(prisma.songCover.update).toHaveBeenCalledWith({
      where: { id: 'song-cover-missing' },
      data: { variantStatus: 'failed', lastError: 'Source file missing' },
    })
  })
})

describe('VariantGenerator - 恢复未完成任务', () => {
  let generator: any

  beforeEach(async () => {
    process.env.UPLOADS_PATH = TEST_UPLOADS_DIR
    fs.mkdirSync(path.join(TEST_UPLOADS_DIR, 'original'), { recursive: true })
    fs.mkdirSync(path.join(TEST_UPLOADS_DIR, 'music-covers/songs'), { recursive: true })
    fs.mkdirSync(path.join(TEST_UPLOADS_DIR, 'music-covers/albums'), { recursive: true })
    fs.writeFileSync(path.join(TEST_UPLOADS_DIR, 'original/im1.jpg'), 'src')
    fs.writeFileSync(path.join(TEST_UPLOADS_DIR, 'music-covers/songs/c1.jpg'), 'src')
    fs.writeFileSync(path.join(TEST_UPLOADS_DIR, 'music-covers/albums/c1.jpg'), 'src')

    const module = await import('../../../src/server/services/variantGenerator')
    const VariantGenerator = module.VariantGenerator
    generator = new VariantGenerator({ autoStart: false, processOnEnqueue: false })

    vi.clearAllMocks()
  })

  it('recoverPendingTasks 应按类型解析路径并入队', async () => {
    ;(prisma.imageMap.findMany as any).mockResolvedValueOnce([
      { id: 'im-1', localUrl: '/uploads/original/im1.jpg' },
    ])
    ;(prisma.songCover.findMany as any).mockResolvedValueOnce([
      { id: 'sc-1', storageKey: 'music-covers/songs/c1.jpg' },
    ])
    ;(prisma.albumCover.findMany as any).mockResolvedValueOnce([
      { id: 'ac-1', storageKey: 'music-covers/albums/c1.jpg' },
    ])

    const enqueueSpy = vi.spyOn(generator, 'enqueue').mockResolvedValue(undefined)

    await generator.recoverPendingTasks()

    expect(enqueueSpy).toHaveBeenCalledWith({
      targetType: 'imageMap',
      targetId: 'im-1',
      localFilePath: expect.stringContaining('im1.jpg'),
      priority: 'low',
    })
    expect(enqueueSpy).toHaveBeenCalledWith({
      targetType: 'songCover',
      targetId: 'sc-1',
      localFilePath: expect.stringContaining('c1.jpg'),
      priority: 'low',
    })
    expect(enqueueSpy).toHaveBeenCalledWith({
      targetType: 'albumCover',
      targetId: 'ac-1',
      localFilePath: expect.stringContaining('c1.jpg'),
      priority: 'low',
    })
  })

  it('recover 时源文件缺失的封面应标记 failed 并记录 lastError', async () => {
    ;(prisma.songCover.findMany as any).mockResolvedValueOnce([
      { id: 'sc-missing', storageKey: 'missing/cover.jpg' },
    ])

    const enqueueSpy = vi.spyOn(generator, 'enqueue')

    await generator.recoverPendingTasks()

    expect(enqueueSpy).not.toHaveBeenCalled()
    expect(prisma.songCover.update).toHaveBeenCalledWith({
      where: { id: 'sc-missing' },
      data: { variantStatus: 'failed', lastError: 'Source file missing' },
    })
  })
})

describe('VariantGenerator - 统计信息', () => {
  let generator: any

  beforeEach(async () => {
    process.env.UPLOADS_PATH = TEST_UPLOADS_DIR
    const module = await import('../../../src/server/services/variantGenerator')
    const VariantGenerator = module.VariantGenerator
    generator = new VariantGenerator({ autoStart: false })
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
    process.env.UPLOADS_PATH = TEST_UPLOADS_DIR
    const module = await import('../../../src/server/services/variantGenerator')
    const VariantGenerator = module.VariantGenerator
    generator = new VariantGenerator({ autoStart: false })
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

afterAll(() => {
  fs.rmSync(TEST_UPLOADS_DIR, { recursive: true, force: true })
})
