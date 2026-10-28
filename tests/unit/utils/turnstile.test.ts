import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetSecrets = vi.hoisted(() => vi.fn())
const mockGetConfig = vi.hoisted(() => vi.fn())
const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../../../src/server/services/secretsConfig.service', () => ({
  secretsConfigService: { getSecrets: mockGetSecrets },
}))

vi.mock('../../../src/server/services/runtimeConfig.service', () => ({
  runtimeConfigService: { getConfig: mockGetConfig },
}))

vi.mock('../../../src/server/utils/logger', () => ({
  logger: mockLogger,
}))

import {
  getTurnstilePublicConfig,
  isTurnstileEnabled,
  verifyTurnstileToken,
} from '../../../src/server/utils/turnstile'

describe('Turnstile 启用判定', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSecrets.mockReturnValue({ turnstileSiteKey: '', turnstileSecretKey: '' })
    mockGetConfig.mockReturnValue({ turnstileEnabled: false })
  })

  it('开关关闭或任一密钥缺失时不启用', () => {
    expect(isTurnstileEnabled()).toBe(false)

    mockGetConfig.mockReturnValue({ turnstileEnabled: true })
    expect(isTurnstileEnabled()).toBe(false)

    mockGetSecrets.mockReturnValue({ turnstileSiteKey: 'site-key', turnstileSecretKey: '' })
    expect(isTurnstileEnabled()).toBe(false)

    mockGetSecrets.mockReturnValue({ turnstileSiteKey: '', turnstileSecretKey: 'secret-key' })
    expect(isTurnstileEnabled()).toBe(false)
  })

  it('三者齐备时启用并对外返回 trim 后的 siteKey', () => {
    mockGetConfig.mockReturnValue({ turnstileEnabled: true })
    mockGetSecrets.mockReturnValue({
      turnstileSiteKey: ' site-key ',
      turnstileSecretKey: ' secret-key ',
    })

    expect(isTurnstileEnabled()).toBe(true)
    expect(getTurnstilePublicConfig()).toEqual({ enabled: true, siteKey: 'site-key' })
  })

  it('未启用时公开配置不暴露 siteKey', () => {
    mockGetSecrets.mockReturnValue({ turnstileSiteKey: 'site-key', turnstileSecretKey: 's' })
    expect(getTurnstilePublicConfig()).toEqual({ enabled: false, siteKey: '' })
  })
})

describe('verifyTurnstileToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSecrets.mockReturnValue({ turnstileSiteKey: 'site-key', turnstileSecretKey: 'secret' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('success:true 返回 ok 并携带 secret/response/remoteip', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(verifyTurnstileToken('token-1', '1.2.3.4')).resolves.toBe('ok')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    const body = init.body
    if (!(body instanceof URLSearchParams)) {
      throw new Error('expected URLSearchParams body')
    }
    expect(body.get('secret')).toBe('secret')
    expect(body.get('response')).toBe('token-1')
    expect(body.get('remoteip')).toBe('1.2.3.4')
  })

  it('success:false 返回 rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
    )

    await expect(verifyTurnstileToken('token-2')).resolves.toBe('rejected')
  })

  it('网络错误返回 unavailable 且记录告警', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    await expect(verifyTurnstileToken('token-3')).resolves.toBe('unavailable')
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('非 2xx 返回 unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad gateway', { status: 502 })))

    await expect(verifyTurnstileToken('token-4')).resolves.toBe('unavailable')
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('未配置 secret 时直接返回 unavailable 且不发起请求', async () => {
    mockGetSecrets.mockReturnValue({ turnstileSiteKey: 'site-key', turnstileSecretKey: '' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(verifyTurnstileToken('token-5')).resolves.toBe('unavailable')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
