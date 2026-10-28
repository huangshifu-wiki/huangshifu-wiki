import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rateLimitMock = vi.fn((options) => options)
const ipKeyGeneratorMock = vi.fn((ip: string) => ip)
const shutdownMock = vi.fn()
const memoryStoreInstances: Array<{ shutdown: ReturnType<typeof vi.fn> }> = []

class MemoryStoreMock {
  shutdown = shutdownMock

  constructor() {
    memoryStoreInstances.push(this)
  }
}

vi.mock('express-rate-limit', () => ({
  default: rateLimitMock,
  MemoryStore: MemoryStoreMock,
  ipKeyGenerator: ipKeyGeneratorMock,
}))

describe('rateLimiter', () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalDevDisableRateLimit = process.env.DEV_DISABLE_RATE_LIMIT
  const originalVitest = process.env.VITEST
  const originalVitestWorkerId = process.env.VITEST_WORKER_ID

  beforeEach(() => {
    vi.resetModules()
    rateLimitMock.mockClear()
    ipKeyGeneratorMock.mockClear()
    shutdownMock.mockClear()
    memoryStoreInstances.length = 0
    process.env.NODE_ENV = 'development'
    delete process.env.DEV_DISABLE_RATE_LIMIT
    delete process.env.VITEST
    delete process.env.VITEST_WORKER_ID
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    process.env.NODE_ENV = originalNodeEnv
    if (originalDevDisableRateLimit === undefined) {
      delete process.env.DEV_DISABLE_RATE_LIMIT
    } else {
      process.env.DEV_DISABLE_RATE_LIMIT = originalDevDisableRateLimit
    }

    if (originalVitest === undefined) {
      delete process.env.VITEST
    } else {
      process.env.VITEST = originalVitest
    }

    if (originalVitestWorkerId === undefined) {
      delete process.env.VITEST_WORKER_ID
    } else {
      process.env.VITEST_WORKER_ID = originalVitestWorkerId
    }
  })

  it('keeps rate limiting enabled by default outside test runtime', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VITEST', undefined)
    vi.stubEnv('VITEST_WORKER_ID', undefined)

    const { globalLimiter, isRateLimitDisabledInDevelopment } =
      await import('../../src/server/middleware/rateLimiter')

    expect(globalLimiter).toBeDefined()
    expect(isRateLimitDisabledInDevelopment()).toBe(false)

    const [{ skip }] = rateLimitMock.mock.calls.at(-1)!
    expect(skip({}, {})).toBe(false)
  })

  it('allows disabling rate limiting explicitly in development', async () => {
    process.env.DEV_DISABLE_RATE_LIMIT = 'true'

    const { globalLimiter, isRateLimitDisabledInDevelopment } =
      await import('../../src/server/middleware/rateLimiter')

    expect(globalLimiter).toBeDefined()
    expect(isRateLimitDisabledInDevelopment()).toBe(true)

    const [{ skip }] = rateLimitMock.mock.calls.at(-1)!
    expect(skip({}, {})).toBe(true)
  })

  it('honors env values loaded after module import', async () => {
    const { globalLimiter, isRateLimitDisabledInDevelopment } =
      await import('../../src/server/middleware/rateLimiter')

    process.env.DEV_DISABLE_RATE_LIMIT = 'true'

    expect(globalLimiter).toBeDefined()
    expect(isRateLimitDisabledInDevelopment()).toBe(true)

    const [{ skip }] = rateLimitMock.mock.calls.at(-1)!
    expect(skip({}, {})).toBe(true)
  })

  it('does not disable rate limiting in production even when the flag is set', async () => {
    process.env.NODE_ENV = 'production'
    process.env.DEV_DISABLE_RATE_LIMIT = 'true'

    const { globalLimiter, isRateLimitDisabledInDevelopment } =
      await import('../../src/server/middleware/rateLimiter')

    expect(globalLimiter).toBeDefined()
    expect(isRateLimitDisabledInDevelopment()).toBe(false)

    const [{ skip }] = rateLimitMock.mock.calls.at(-1)!
    expect(skip({}, {})).toBe(false)
  })

  it('disables rate limiting automatically in test environment', async () => {
    process.env.VITEST = 'true'
    process.env.VITEST_WORKER_ID = '1'
    delete process.env.DEV_DISABLE_RATE_LIMIT

    const { globalLimiter, isRateLimitDisabledInDevelopment } =
      await import('../../src/server/middleware/rateLimiter')

    expect(globalLimiter).toBeDefined()
    expect(isRateLimitDisabledInDevelopment()).toBe(true)

    const [{ skip }] = rateLimitMock.mock.calls.at(-1)!
    expect(skip({}, {})).toBe(true)
  })

  it('skips business rate limiters for admin users only', async () => {
    const { searchLimiter } = await import('../../src/server/middleware/rateLimiter')

    expect(searchLimiter).toBeDefined()

    const [{ skip }] = rateLimitMock.mock.calls.at(-1)!
    expect(skip({ authUser: { role: 'admin' } }, {})).toBe(true)
    expect(skip({ authUser: { role: 'super_admin' } }, {})).toBe(true)
    expect(skip({ authUser: { role: 'user' } }, {})).toBe(false)
  })

  it('does not skip global or auth rate limiters for admin users', async () => {
    await import('../../src/server/middleware/rateLimiter')

    const limiterOptions = rateLimitMock.mock.calls.map(([options]) => options)
    const authOptions = limiterOptions.find(
      (options) => options.message?.error === '请求过于频繁，请15分钟后再试'
    )
    const globalOptions = limiterOptions.find(
      (options) => options.message?.error === '请求过于频繁，请稍后再试'
    )

    expect(authOptions?.skip({ authUser: { role: 'admin' } }, {})).toBe(false)
    expect(globalOptions?.skip({ authUser: { role: 'admin' } }, {})).toBe(false)
  })

  it('uses separate limiter instances for password reset request and confirmation', async () => {
    const { passwordResetConfirmLimiter, passwordResetRequestLimiter } =
      await import('../../src/server/middleware/rateLimiter')

    expect(passwordResetRequestLimiter).toBeDefined()
    expect(passwordResetConfirmLimiter).toBeDefined()
    expect(passwordResetRequestLimiter).not.toBe(passwordResetConfirmLimiter)

    const requestLimiterOptions = rateLimitMock.mock.calls
      .map(([options]) => options)
      .find((options) => options.message?.error === '密码找回请求过于频繁，请15分钟后再试')
    const confirmLimiterOptions = rateLimitMock.mock.calls
      .map(([options]) => options)
      .find((options) => options.message?.error === '密码重置确认过于频繁，请15分钟后再试')

    expect(requestLimiterOptions).toBeDefined()
    expect(confirmLimiterOptions).toBeDefined()
    expect(requestLimiterOptions).not.toBe(confirmLimiterOptions)
  })

  it('shuts down replaced memory stores when config changes', async () => {
    const { applyRateLimitConfig } = await import('../../src/server/middleware/rateLimiter')
    const { DEFAULT_RATE_LIMIT_CONFIG } = await import('../../src/lib/rateLimitConfig')

    expect(memoryStoreInstances).toHaveLength(11)

    applyRateLimitConfig({
      ...DEFAULT_RATE_LIMIT_CONFIG,
      global: {
        ...DEFAULT_RATE_LIMIT_CONFIG.global,
        max: DEFAULT_RATE_LIMIT_CONFIG.global.max + 1,
      },
    })

    expect(memoryStoreInstances).toHaveLength(12)
    expect(shutdownMock).toHaveBeenCalledTimes(1)
  })

  it('rebuilds limiters when enabled changes so counters reset on re-enable', async () => {
    const { applyRateLimitConfig } = await import('../../src/server/middleware/rateLimiter')
    const { DEFAULT_RATE_LIMIT_CONFIG } = await import('../../src/lib/rateLimitConfig')

    applyRateLimitConfig({
      ...DEFAULT_RATE_LIMIT_CONFIG,
      global: {
        ...DEFAULT_RATE_LIMIT_CONFIG.global,
        enabled: false,
      },
    })
    applyRateLimitConfig(DEFAULT_RATE_LIMIT_CONFIG)

    expect(memoryStoreInstances).toHaveLength(13)
    expect(shutdownMock).toHaveBeenCalledTimes(2)
  })
})
