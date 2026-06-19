// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AdminSettings from '../../src/pages/Admin/AdminSettings'

const { mockApiRequest, mockApiPatch, mockClearApiCache, mockGenerateApiCacheKey, mockShow } =
  vi.hoisted(() => ({
    mockApiRequest: vi.fn(),
    mockApiPatch: vi.fn(),
    mockClearApiCache: vi.fn(),
    mockGenerateApiCacheKey: vi.fn((method: string, path: string) => `${method}|${path}|`),
    mockShow: vi.fn(),
  }))

vi.mock('../../src/lib/apiClient', () => ({
  apiRequest: mockApiRequest,
  apiPatch: mockApiPatch,
  clearApiCache: mockClearApiCache,
  generateApiCacheKey: mockGenerateApiCacheKey,
}))

vi.mock('../../src/components/Toast', () => ({
  useToast: () => ({
    show: mockShow,
  }),
}))

describe('AdminSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('does not render a savable form when email verification config fails to load', async () => {
    mockApiRequest.mockRejectedValue(new Error('network failed'))

    render(<AdminSettings />)

    expect(
      await screen.findByText('邮箱验证配置加载失败，未加载成功前无法保存设置。')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument()
    expect(mockApiPatch).not.toHaveBeenCalled()
  })
})
