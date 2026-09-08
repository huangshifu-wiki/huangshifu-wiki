/**
 * sharpSafe 单元测试：sharp 全局运行参数（并发/缓存）与输入像素上限推导
 */

import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../../src/server/prisma', () => ({
  prisma: {
    siteConfig: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}))

const DEFAULT_MAX_PIXELS = 25_000_000

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

async function loadSharpSafe() {
  return import('../../../src/server/utils/sharpSafe')
}

async function loadRuntimeConfigService() {
  return import('../../../src/server/services/runtimeConfig.service')
}

describe('resolveSharpInputPixelLimit', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('硬闸小于配置推导值时取硬闸', async () => {
    const { resolveSharpInputPixelLimit } = await loadSharpSafe()
    expect(resolveSharpInputPixelLimit(1_000_000, 512)).toBe(1_000_000)
  })

  it('配置推导值（MB×1024×1024/4）更小时取配置推导值', async () => {
    const { resolveSharpInputPixelLimit } = await loadSharpSafe()
    expect(resolveSharpInputPixelLimit(25_000_000, 16)).toBe(4_194_304)
  })

  it('结果向下取整', async () => {
    const { resolveSharpInputPixelLimit } = await loadSharpSafe()
    expect(resolveSharpInputPixelLimit(999_999.9, 512)).toBe(999_999)
  })
})

describe('getSharpInputPixelLimit', () => {
  afterEach(() => {
    setEnv('SHARP_MAX_INPUT_PIXELS', undefined)
    setEnv('SHARP_CONCURRENCY', undefined)
    vi.resetModules()
  })

  it('默认使用 25MP 硬闸（默认配置 512MB 推导值更大）', async () => {
    const { getSharpInputPixelLimit } = await loadSharpSafe()
    expect(getSharpInputPixelLimit()).toBe(DEFAULT_MAX_PIXELS)
  })

  it('SHARP_MAX_INPUT_PIXELS env 可收紧硬闸', async () => {
    setEnv('SHARP_MAX_INPUT_PIXELS', '1000000')
    const { getSharpInputPixelLimit } = await loadSharpSafe()
    expect(getSharpInputPixelLimit()).toBe(1_000_000)
  })

  it('运行时配置 variantSharpMemoryLimitMb 更小时生效', async () => {
    const { runtimeConfigService } = await loadRuntimeConfigService()
    await runtimeConfigService.updateConfig({ variantSharpMemoryLimitMb: 16 })
    const { getSharpInputPixelLimit } = await loadSharpSafe()
    expect(getSharpInputPixelLimit()).toBe(4_194_304)
  })
})

describe('sharp 运行参数', () => {
  afterEach(() => {
    setEnv('SHARP_CONCURRENCY', undefined)
    setEnv('SHARP_MAX_INPUT_PIXELS', undefined)
    vi.resetModules()
  })

  it('默认 libvips 并发为 1', async () => {
    const sharp = (await import('sharp')).default
    await loadSharpSafe()
    expect(sharp.concurrency()).toBe(1)
  })

  it('SHARP_CONCURRENCY env 可调回更高并发', async () => {
    setEnv('SHARP_CONCURRENCY', '3')
    const sharp = (await import('sharp')).default
    await loadSharpSafe()
    expect(sharp.concurrency()).toBe(3)
  })
})
