// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '../../../src/components/Toast'
import { AuthModal } from '../../../src/components/Navbar/AuthModal'
import { register, requestPasswordReset } from '../../../src/lib/auth'

vi.mock('../../../src/lib/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'auth.dialogLabel': '认证弹窗',
        'auth.accountLogin': '账号登录',
        'auth.accountRegister': '账号注册',
        'auth.wechatLogin': '微信登录',
        'auth.placeholderDisplayName': '昵称（可选，留空将自动生成）',
        'auth.placeholderWechatDisplayName': '微信昵称',
        'auth.placeholderWechatCode': '微信登录码',
        'auth.placeholderPhotoURL': '头像地址',
        'auth.placeholderEmail': '邮箱',
        'auth.placeholderPassword': '密码',
        'auth.placeholderRegisterPassword': '密码（至少 8 位）',
        'auth.labelDisplayName': '显示名称',
        'auth.labelWechatCode': '微信码',
        'auth.labelPhotoURL': '头像',
        'auth.labelEmail': '邮箱',
        'auth.labelPassword': '密码',
        'auth.noAccountGoRegister': '没有账号，去注册',
        'auth.hasAccountGoLogin': '已有账号，去登录',
        'auth.switchToAccount': '切换到账号登录',
        'auth.switchToWechat': '切换到微信登录',
        'auth.loggingIn': '登录中',
        'auth.registering': '注册中',
        'auth.sendingResetEmail': '发送中',
        'auth.login': '登录',
        'auth.register': '注册',
        'auth.passwordReset': '找回密码',
        'auth.sendResetEmail': '发送重置邮件',
        'auth.forgotPassword': '忘记密码？',
        'auth.backToLogin': '返回登录',
        'auth.mockCodeHint': 'mock code hint',
        'auth.loginFailed': '登录失败',
      }
      return map[key] || key
    },
  }),
}))

vi.mock('../../../src/lib/auth', () => ({
  login: vi.fn(),
  register: vi.fn(),
  loginWithWeChat: vi.fn(),
  requestPasswordReset: vi.fn(),
}))

const renderAuthModal = (
  open: boolean,
  initialMode: 'login' | 'register' | 'wechat' = 'login',
  allowRegister = true
) =>
  render(
    <ToastProvider>
      <AuthModal
        open={open}
        initialMode={initialMode}
        allowRegister={allowRegister}
        onClose={vi.fn()}
        onAuthSuccess={vi.fn()}
      />
    </ToastProvider>
  )

describe('AuthModal', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('resets to the requested mode when reopened', async () => {
    const user = userEvent.setup()
    const { rerender } = renderAuthModal(true, 'login')

    expect(screen.getByRole('heading', { name: '账号登录' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '没有账号，去注册' }))
    expect(screen.getByRole('heading', { name: '账号注册' })).toBeInTheDocument()

    rerender(
      <ToastProvider>
        <AuthModal open={false} initialMode="login" onClose={vi.fn()} onAuthSuccess={vi.fn()} />
      </ToastProvider>
    )

    rerender(
      <ToastProvider>
        <AuthModal open initialMode="register" onClose={vi.fn()} onAuthSuccess={vi.fn()} />
      </ToastProvider>
    )

    expect(screen.getByRole('heading', { name: '账号注册' })).toBeInTheDocument()
  })

  it('only applies the 8-character password constraint in register mode', async () => {
    const user = userEvent.setup()
    renderAuthModal(true, 'login')

    const loginPasswordInput = screen.getByLabelText('密码') as HTMLInputElement
    expect(loginPasswordInput).not.toHaveAttribute('minLength')
    expect(loginPasswordInput).toHaveAttribute('placeholder', '密码')

    await user.click(screen.getByRole('button', { name: '没有账号，去注册' }))

    const registerPasswordInput = screen.getByLabelText('密码') as HTMLInputElement
    expect(registerPasswordInput).toHaveAttribute('minLength', '8')
    expect(registerPasswordInput).toHaveAttribute('placeholder', '密码（至少 8 位）')
  })

  it('falls back to login and hides register switch when registration is disabled', () => {
    renderAuthModal(true, 'register', false)

    expect(screen.getByRole('heading', { name: '账号登录' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '没有账号，去注册' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('显示名称')).not.toBeInTheDocument()
  })

  it('submits register without synthesizing a display name', async () => {
    const user = userEvent.setup()
    const registerMock = vi.mocked(register)
    registerMock.mockResolvedValueOnce(undefined)

    renderAuthModal(true, 'register')

    expect(screen.getByLabelText('显示名称')).toHaveAttribute(
      'placeholder',
      '昵称（可选，留空将自动生成）'
    )

    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'averylonglocalpart@example.com' },
    })
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'ValidPassword123!' },
    })
    fireEvent.submit(screen.getByRole('button', { name: '注册' }).closest('form')!)

    await waitFor(() => {
      expect(registerMock).toHaveBeenCalledWith(
        'averylonglocalpart@example.com',
        'ValidPassword123!',
        ''
      )
    })
  })

  it('requests password reset from login mode', async () => {
    const user = userEvent.setup()
    const requestPasswordResetMock = vi.mocked(requestPasswordReset)
    requestPasswordResetMock.mockResolvedValueOnce({
      success: true,
      message: '如果该邮箱存在，我们会发送一封密码重置邮件',
    })

    renderAuthModal(true, 'login')

    await user.click(screen.getByRole('button', { name: '忘记密码？' }))
    expect(screen.getByRole('heading', { name: '找回密码' })).toBeInTheDocument()
    expect(screen.queryByLabelText('密码')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'reset@example.com' },
    })
    fireEvent.submit(screen.getByRole('button', { name: '发送重置邮件' }).closest('form')!)

    await waitFor(() => {
      expect(requestPasswordResetMock).toHaveBeenCalledWith('reset@example.com')
    })
    expect(await screen.findByRole('heading', { name: '账号登录' })).toBeInTheDocument()
  })
})
