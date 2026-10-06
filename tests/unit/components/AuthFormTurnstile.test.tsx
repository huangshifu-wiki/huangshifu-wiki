// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '../../../src/components/Toast'
import { AuthForm } from '../../../src/components/AuthForm'
import { register } from '../../../src/lib/auth'
import type { TurnstileApi, TurnstileRenderOptions } from '../../../src/lib/turnstile'

vi.mock('../../../src/hooks/useTurnstileConfig', () => ({
  useTurnstileConfig: () => ({ enabled: true, siteKey: 'test-site-key' }),
}))

vi.mock('../../../src/lib/auth', () => ({
  login: vi.fn(),
  register: vi.fn(),
  loginWithWeChat: vi.fn(),
  requestPasswordReset: vi.fn(),
}))

vi.mock('../../../src/lib/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const mockedRegister = vi.mocked(register)

// 模拟 Cloudflare 脚本已就绪：loadTurnstile 直接返回 window.turnstile
function stubTurnstile(options: { emitToken?: string } = {}) {
  const renderMock = vi.fn((_container: HTMLElement, renderOptions: TurnstileRenderOptions) => {
    if (options.emitToken) {
      renderOptions.callback?.(options.emitToken)
    }
    return 'widget-1'
  })
  const api: TurnstileApi = {
    render: (container, renderOptions) => renderMock(container, renderOptions),
    reset: vi.fn(),
    remove: vi.fn(),
  }
  window.turnstile = api
  return { api, renderMock }
}

const renderAuthForm = () =>
  render(
    <ToastProvider>
      <AuthForm initialMode="register" onAuthSuccess={vi.fn()} />
    </ToastProvider>
  )

async function fillRegisterForm() {
  const user = userEvent.setup()
  await user.type(screen.getByPlaceholderText('auth.placeholderEmail'), 'tester@example.com')
  await user.type(screen.getByPlaceholderText('auth.placeholderRegisterPassword'), 'password123')
}

describe('AuthForm Turnstile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedRegister.mockResolvedValue({
      success: true,
      requiresEmailVerification: false,
      verificationEmailSent: false,
    })
  })

  afterEach(() => {
    cleanup()
    delete window.turnstile
  })

  it('未取得 token 时阻止提交并提示', async () => {
    const { renderMock } = stubTurnstile()
    renderAuthForm()
    await fillRegisterForm()
    await waitFor(() => expect(renderMock).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: 'auth.register' }))

    expect(await screen.findByText('请先完成人机验证')).toBeTruthy()
    expect(mockedRegister).not.toHaveBeenCalled()
  })

  it('取得 token 后提交并透传给 register', async () => {
    const { renderMock } = stubTurnstile({ emitToken: 'test-token' })
    renderAuthForm()
    await fillRegisterForm()
    await waitFor(() => expect(renderMock).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: 'auth.register' }))

    await waitFor(() => {
      expect(mockedRegister).toHaveBeenCalledWith(
        'tester@example.com',
        'password123',
        '',
        'test-token'
      )
    })
  })
})
