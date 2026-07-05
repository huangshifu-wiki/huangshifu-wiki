// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AdminSettings from '../../src/pages/Admin/AdminSettings'
import { DEFAULT_RATE_LIMIT_CONFIG } from '../../src/lib/rateLimitConfig'

const {
  mockApiGet,
  mockApiRequest,
  mockApiPatch,
  mockApiPost,
  mockClearApiCache,
  mockGenerateApiCacheKey,
  mockShow,
} = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiRequest: vi.fn(),
  mockApiPatch: vi.fn(),
  mockApiPost: vi.fn(),
  mockClearApiCache: vi.fn(),
  mockGenerateApiCacheKey: vi.fn((method: string, path: string) => `${method}|${path}|`),
  mockShow: vi.fn(),
}))

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
  apiRequest: mockApiRequest,
  apiPatch: mockApiPatch,
  apiPost: mockApiPost,
  clearApiCache: mockClearApiCache,
  generateApiCacheKey: mockGenerateApiCacheKey,
}))

vi.mock('../../src/components/Toast', () => ({
  useToast: () => ({
    show: mockShow,
  }),
}))

function mockDefaultConfigLoads() {
  mockApiRequest.mockImplementation((path: string) => {
    if (path === '/api/config/email-verification/admin') {
      return Promise.reject(new Error('mail failed'))
    }
    if (path === '/api/config/registration/admin') {
      return Promise.resolve({ enabled: true })
    }
    return Promise.reject(new Error(`Unexpected GET ${path}`))
  })
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/api/admin/rate-limits/config') {
      return Promise.resolve({ success: true, data: DEFAULT_RATE_LIMIT_CONFIG })
    }
    return Promise.reject(new Error(`Unexpected GET ${path}`))
  })
}

describe('AdminSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDefaultConfigLoads()
  })

  afterEach(() => {
    cleanup()
  })

  it('does not render a savable form when mail service config fails to load', async () => {
    render(<AdminSettings />)

    expect(
      await screen.findByText('邮件服务配置加载失败，未加载成功前无法保存设置。')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    expect(await screen.findByRole('switch', { name: '开放账号注册' })).toBeInTheDocument()
    expect(mockApiPatch).not.toHaveBeenCalled()
  })

  it('saves registration config independently from mail service config', async () => {
    const user = userEvent.setup()
    mockApiPatch.mockResolvedValueOnce({
      success: true,
      config: { enabled: false },
    })

    render(<AdminSettings />)

    const switchButton = await screen.findByRole('switch', { name: '开放账号注册' })
    expect(switchButton).toHaveAttribute('aria-checked', 'true')

    await user.click(switchButton)
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(mockApiPatch).toHaveBeenCalledWith('/api/config/registration', {
      enabled: false,
    })
    expect(mockClearApiCache).toHaveBeenCalledWith('GET|/api/config/registration/admin|')
    expect(mockShow).toHaveBeenCalledWith('注册设置已保存')
  })

  it('saves rate limit config from site settings', async () => {
    const user = userEvent.setup()
    mockApiPatch.mockResolvedValueOnce({
      success: true,
      data: {
        ...DEFAULT_RATE_LIMIT_CONFIG,
        global: { ...DEFAULT_RATE_LIMIT_CONFIG.global, max: 180 },
      },
    })

    render(<AdminSettings />)

    const globalMaxInput = await screen.findByDisplayValue('200')
    fireEvent.change(globalMaxInput, { target: { value: '180' } })
    await user.click(screen.getByRole('button', { name: '保存请求限流' }))

    expect(mockApiPatch).toHaveBeenCalledWith('/api/admin/rate-limits/config', {
      ...DEFAULT_RATE_LIMIT_CONFIG,
      global: { ...DEFAULT_RATE_LIMIT_CONFIG.global, max: 180 },
    })
    expect(mockClearApiCache).toHaveBeenCalledWith('GET|/api/admin/rate-limits/config|')
    expect(mockShow).toHaveBeenCalledWith('请求限流配置已保存')
  })

  it('renders rate limit numeric fields as text inputs to avoid wheel increments', async () => {
    render(<AdminSettings />)

    const globalMaxInput = await screen.findByDisplayValue('200')

    expect(globalMaxInput).toHaveAttribute('type', 'text')
    expect(globalMaxInput).toHaveAttribute('inputmode', 'numeric')
  })
})
