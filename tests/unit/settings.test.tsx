// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Settings from '../../src/pages/Settings'
import {
  PROFILE_DISPLAY_NAME_MAX_LENGTH,
  PROFILE_SIGNATURE_MAX_LENGTH,
  WIKI_MAX_CONTENT_SIZE,
} from '../../src/lib/contentLimits'
import { PASSWORD_MAX_LENGTH } from '../../src/lib/passwordRules'

const {
  mockApiPatch,
  mockApiPut,
  mockRefreshAuth,
  mockSetTheme,
  mockUpdatePreferences,
  mockShow,
} = vi.hoisted(() => ({
  mockApiPatch: vi.fn(),
  mockApiPut: vi.fn(),
  mockRefreshAuth: vi.fn(),
  mockSetTheme: vi.fn(),
  mockUpdatePreferences: vi.fn(),
  mockShow: vi.fn(),
}))

vi.mock('../../src/lib/apiClient', () => ({
  apiPatch: mockApiPatch,
  apiPut: mockApiPut,
}))

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      uid: 'user-1',
      email: 'old@example.com',
      displayName: '测试用户',
      photoURL: '',
      role: 'user',
    },
    profile: {
      displayName: '测试用户',
      signature: '旧签名',
      bio: '旧简介',
      photoURL: '',
      level: 1,
      role: 'user',
      status: 'active',
    },
    refreshAuth: mockRefreshAuth,
  }),
}))

vi.mock('../../src/context/UserPreferencesContext', () => ({
  useUserPreferences: () => ({
    preferences: {
      theme: 'system',
      showCharacterCount: false,
    },
    updatePreferences: mockUpdatePreferences,
    setTheme: mockSetTheme,
    resolvedTheme: 'default',
    loading: false,
  }),
}))

vi.mock('../../src/components/Toast', () => ({
  useToast: () => ({
    show: mockShow,
  }),
}))

vi.mock('../../src/components/AvatarCropModal', () => ({
  AvatarCropModal: () => null,
}))

describe('Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiPatch.mockResolvedValue({})
    mockApiPut.mockResolvedValue({})
    mockRefreshAuth.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
  })

  const renderSettings = (initialPath = '/settings/profile') => {
    return render(
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/settings/:section?" element={<Settings />} />
        </Routes>
      </MemoryRouter>
    )
  }

  it('saves public profile updates', async () => {
    const user = userEvent.setup()
    renderSettings('/settings/profile')

    const displayNameInput = await screen.findByLabelText('昵称')
    expect(displayNameInput).toHaveAttribute('maxlength', String(PROFILE_DISPLAY_NAME_MAX_LENGTH))
    expect(screen.queryByText(`4 / ${PROFILE_DISPLAY_NAME_MAX_LENGTH} 字符`)).not.toBeInTheDocument()
    await user.clear(displayNameInput)
    await user.type(displayNameInput, '新昵称')

    const bioInput = screen.getByLabelText('个人简介（支持 Markdown）')
    expect(bioInput).toHaveAttribute('maxlength', String(WIKI_MAX_CONTENT_SIZE))
    expect(screen.queryByText(`3 / ${WIKI_MAX_CONTENT_SIZE} 字符`)).not.toBeInTheDocument()
    await user.clear(bioInput)
    await user.type(bioInput, '新简介')

    const signatureInput = screen.getByLabelText('签名')
    expect(signatureInput).toHaveAttribute('maxlength', String(PROFILE_SIGNATURE_MAX_LENGTH))
    expect(screen.queryByText(`3 / ${PROFILE_SIGNATURE_MAX_LENGTH} 字符`)).not.toBeInTheDocument()
    await user.clear(signatureInput)
    await user.type(signatureInput, '新签名')

    expect(screen.queryByText(`3 / ${PROFILE_DISPLAY_NAME_MAX_LENGTH} 字符`)).not.toBeInTheDocument()
    expect(screen.queryByText(`3 / ${WIKI_MAX_CONTENT_SIZE} 字符`)).not.toBeInTheDocument()
    expect(screen.queryByText(`3 / ${PROFILE_SIGNATURE_MAX_LENGTH} 字符`)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /保存公开资料/ }))

    await waitFor(() => {
      expect(mockApiPatch).toHaveBeenCalledWith('/api/users/me', {
        displayName: '新昵称',
        signature: '新签名',
        bio: '新简介',
        photoURL: '',
      })
    })
    expect(mockRefreshAuth).toHaveBeenCalled()
    expect(mockShow).toHaveBeenCalledWith('公开资料已保存')
  })

  it('submits email and password changes', async () => {
    renderSettings('/settings/account')

    expect(screen.getByText('old@example.com')).toBeInTheDocument()
    expect(screen.queryByLabelText('新邮箱')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /修改邮箱/ }))

    fireEvent.change(await screen.findByLabelText('新邮箱'), {
      target: { value: 'new@example.com' },
    })
    fireEvent.change(screen.getAllByLabelText('当前密码')[0], {
      target: { value: 'CurrentPassword123!' },
    })
    fireEvent.click(screen.getByRole('button', { name: /保存邮箱/ }))

    await waitFor(() => {
      expect(mockApiPut).toHaveBeenCalledWith('/api/users/email', {
        newEmail: 'new@example.com',
        currentPassword: 'CurrentPassword123!',
      })
    })

    expect(screen.queryByLabelText('新密码')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /修改密码/ }))
    expect(screen.queryAllByText(`0 / ${PASSWORD_MAX_LENGTH} 字符`)).toHaveLength(0)

    fireEvent.change(screen.getByLabelText('当前密码'), {
      target: { value: 'CurrentPassword123!' },
    })
    fireEvent.change(screen.getByLabelText('新密码'), {
      target: { value: 'UpdatedPassword123!' },
    })
    fireEvent.change(screen.getByLabelText('确认新密码'), {
      target: { value: 'UpdatedPassword123!' },
    })
    expect(screen.queryAllByText(`19 / ${PASSWORD_MAX_LENGTH} 字符`)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /保存密码/ }))

    await waitFor(() => {
      expect(mockApiPut).toHaveBeenCalledWith('/api/users/password', {
        currentPassword: 'CurrentPassword123!',
        newPassword: 'UpdatedPassword123!',
      })
    })
  })

  it('shows a chinese validation message when current password is empty', async () => {
    const user = userEvent.setup()
    renderSettings('/settings/account')

    await user.click(screen.getByRole('button', { name: /修改邮箱/ }))
    await user.click(screen.getByRole('button', { name: /保存邮箱/ }))
    expect(mockShow).toHaveBeenCalledWith('当前密码不能为空', { variant: 'error' })

    await user.click(screen.getByRole('button', { name: /修改密码/ }))
    await user.click(screen.getByRole('button', { name: /保存密码/ }))
    expect(mockShow).toHaveBeenCalledWith('当前密码不能为空', { variant: 'error' })
  })

  it('shows a chinese validation message when new email is empty', async () => {
    const user = userEvent.setup()
    renderSettings('/settings/account')

    await user.click(screen.getByRole('button', { name: /修改邮箱/ }))
    fireEvent.change(await screen.findByLabelText('当前密码'), {
      target: { value: 'CurrentPassword123!' },
    })
    await user.click(screen.getByRole('button', { name: /保存邮箱/ }))

    expect(mockShow).toHaveBeenCalledWith('新邮箱不能为空', { variant: 'error' })
  })

  it('shows theme controls in appearance section', async () => {
    renderSettings('/settings/appearance')

    expect(screen.getByRole('button', { name: '浅色模式' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '深色模式' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '跟随系统（当前浅色）' })).toBeInTheDocument()
  })

  it('can enable character count display from appearance section', async () => {
    renderSettings('/settings/appearance')

    const toggle = screen.getByRole('switch', { name: '展示字数限制' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    await userEvent.click(toggle)

    expect(mockUpdatePreferences).toHaveBeenCalledWith({ showCharacterCount: true })
  })

  it('renders section navigation as routes', () => {
    renderSettings('/settings/profile')

    expect(screen.getByRole('link', { name: '公开资料' })).toHaveAttribute('href', '/settings/profile')
    expect(screen.getByRole('link', { name: '账户' })).toHaveAttribute('href', '/settings/account')
    expect(screen.getByRole('link', { name: '外观' })).toHaveAttribute('href', '/settings/appearance')
  })
})
