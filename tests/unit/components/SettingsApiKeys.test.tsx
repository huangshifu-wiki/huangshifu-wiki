// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DialogProvider } from '../../../src/components/Dialog'
import { ToastProvider } from '../../../src/components/Toast'
import Settings from '../../../src/pages/Settings'
import { apiDelete, apiGet, apiPost, apiRequest } from '../../../src/lib/apiClient'
import type { CreatePersonalApiKeyResponse, PersonalApiKey } from '../../../src/types/api'
import type { User } from '../../../src/lib/auth'
import type { UserProfile } from '../../../src/types/entities'

const authState = vi.hoisted(() => ({
  user: null as unknown,
  profile: null as unknown,
  isBanned: false,
  refreshAuth: vi.fn(),
}))

const preferencesState = vi.hoisted(() => ({
  preferences: { listLoadMode: 'pagination' as const },
  updatePreferences: vi.fn(),
}))

vi.mock('../../../src/context/AuthContext', () => ({
  useAuth: () => authState,
}))

vi.mock('../../../src/context/UserPreferencesContext', () => ({
  useUserPreferences: () => preferencesState,
}))

vi.mock('../../../src/lib/apiClient', () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiRequest: vi.fn(),
}))

const mockApiDelete = vi.mocked(apiDelete)
const mockApiGet = vi.mocked(apiGet)
const mockApiPost = vi.mocked(apiPost)
const mockApiRequest = vi.mocked(apiRequest)

const userA: User = {
  uid: 'user-a',
  publicId: 'public-a',
  email: 'a@example.com',
  displayName: 'User A',
  photoURL: null,
  role: 'user',
  status: 'active',
  banReason: null,
  bannedAt: null,
  level: 1,
  signature: '',
  bio: '',
  emailVerified: true,
  isAnonymous: false,
  tenantId: null,
  providerData: [],
}

const userB: User = {
  ...userA,
  uid: 'user-b',
  publicId: 'public-b',
  email: 'b@example.com',
  displayName: 'User B',
}

const profileFor = (user: User): UserProfile => ({
  uid: user.uid,
  publicId: user.publicId,
  displayName: user.displayName,
  photoURL: '',
  email: user.email,
  role: user.role,
  status: user.status,
  banReason: user.banReason,
  bannedAt: user.bannedAt,
  level: user.level,
  signature: user.signature,
  bio: user.bio,
})

const existingKey: PersonalApiKey = {
  id: 'key-1',
  name: 'Nightly deploy',
  prefix: 'hsf_api_123456',
  createdAt: '2026-09-01T00:00:00.000Z',
  expiresAt: null,
  revokedAt: null,
  lastUsedAt: null,
}

const generatedToken = `hsf_api_${'A'.repeat(43)}`
const createdKey: PersonalApiKey = {
  ...existingKey,
  id: 'key-created',
  name: 'deploy script',
  prefix: generatedToken.slice(0, 16),
}
const createResponse: CreatePersonalApiKeyResponse = {
  key: createdKey,
  token: generatedToken,
}

function renderSettings() {
  return render(
    <ToastProvider>
      <DialogProvider>
        <MemoryRouter initialEntries={['/settings/api-keys']}>
          <Routes>
            <Route path="/settings/:section" element={<Settings />} />
          </Routes>
        </MemoryRouter>
      </DialogProvider>
    </ToastProvider>
  )
}

function setAuthenticatedUser(user: User) {
  authState.user = user
  authState.profile = profileFor(user)
  authState.isBanned = user.status === 'banned'
}

describe('Settings API key management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setAuthenticatedUser(userA)
    preferencesState.preferences = { listLoadMode: 'pagination' }
    preferencesState.updatePreferences.mockResolvedValue(undefined)
    authState.refreshAuth.mockResolvedValue(undefined)
    mockApiGet.mockResolvedValue({ enabled: false } as never)
    mockApiRequest.mockResolvedValue({ keys: [] } as never)
    mockApiPost.mockResolvedValue(createResponse as never)
    mockApiDelete.mockResolvedValue({ success: true } as never)
  })

  it('keeps API key management in its own settings tab, separate from account credentials', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('尚未创建 API 密钥。')
    expect(screen.getByRole('link', { name: 'API 密钥' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('button', { name: '修改邮箱' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: '账户' }))
    expect(await screen.findByRole('button', { name: '修改邮箱' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '密钥名称' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '账户' })).toHaveAttribute('aria-current', 'page')

    await user.click(screen.getByRole('link', { name: 'API 密钥' }))
    expect(await screen.findByRole('textbox', { name: '密钥名称' })).toBeInTheDocument()
  })

  it('creates a key, copies its one-time secret, and clears it after acknowledgement or leaving the page', async () => {
    const user = userEvent.setup()
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error('clipboard denied'))
      .mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    renderSettings()
    await screen.findByText('尚未创建 API 密钥。')
    await user.type(screen.getByLabelText('密钥名称'), 'deploy script')
    await user.click(screen.getByRole('button', { name: '创建密钥' }))

    await user.click(screen.getByRole('button', { name: '复制密钥' }))
    expect(await screen.findByText('复制失败，请手动选择并复制密钥')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '复制密钥' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(generatedToken))
    expect(await screen.findByText('API 密钥已复制')).toBeInTheDocument()
    const keyInput = await screen.findByRole('textbox', { name: '新 API 密钥' })
    expect(keyInput).toHaveValue(generatedToken)
    expect(screen.getByRole('button', { name: '创建密钥' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '我已保存' }))
    expect(screen.queryByRole('textbox', { name: '新 API 密钥' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建密钥' })).toBeEnabled()

    await user.type(screen.getByLabelText('密钥名称'), 'deploy script')
    mockApiPost.mockResolvedValueOnce(createResponse as never)
    await user.click(screen.getByRole('button', { name: '创建密钥' }))
    expect(await screen.findByRole('textbox', { name: '新 API 密钥' })).toHaveValue(generatedToken)

    await user.click(screen.getByRole('link', { name: '公开资料' }))
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: '新 API 密钥' })).not.toBeInTheDocument()
    })
    await user.click(screen.getByRole('link', { name: 'API 密钥' }))
    await screen.findByText('尚未创建 API 密钥。')
    expect(screen.queryByRole('textbox', { name: '新 API 密钥' })).not.toBeInTheDocument()
  })

  it('keeps a key active when revocation is cancelled or fails, then reflects a successful revocation', async () => {
    const user = userEvent.setup()
    const revokedKey = { ...existingKey, revokedAt: '2026-09-20T00:00:00.000Z' }
    mockApiRequest
      .mockResolvedValueOnce({ keys: [existingKey] } as never)
      .mockResolvedValueOnce({ keys: [revokedKey] } as never)
    mockApiDelete
      .mockRejectedValueOnce(new Error('server error'))
      .mockResolvedValueOnce({ success: true } as never)

    renderSettings()
    await screen.findByText('Nightly deploy')
    expect(screen.getByText('有效')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '撤销' }))
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(mockApiDelete).not.toHaveBeenCalled()
    expect(screen.getByText('有效')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '撤销' }))
    await user.click(screen.getByRole('button', { name: '撤销密钥' }))
    await waitFor(() => expect(mockApiDelete).toHaveBeenCalledTimes(1))
    expect(screen.getByText('有效')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '撤销' }))
    await user.click(screen.getByRole('button', { name: '撤销密钥' }))
    expect(await screen.findByText('已撤销')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
  })

  it('keeps existing keys available to banned users but disables creation', async () => {
    const user = userEvent.setup()
    setAuthenticatedUser({ ...userA, status: 'banned' })
    mockApiRequest.mockResolvedValueOnce({ keys: [existingKey] } as never)

    renderSettings()
    await screen.findByText('Nightly deploy')

    expect(screen.getByRole('button', { name: '创建密钥' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled()
    expect(
      screen.getByText('账号封禁期间不能创建密钥，仍可查看或撤销已有密钥。')
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('preserves an unacknowledged one-time key while retrying a failed list request', async () => {
    const user = userEvent.setup()
    mockApiRequest
      .mockRejectedValueOnce(new Error('list unavailable'))
      .mockResolvedValueOnce({ keys: [] } as never)

    renderSettings()
    expect(await screen.findByText('list unavailable')).toBeInTheDocument()
    await user.type(screen.getByLabelText('密钥名称'), 'deploy script')
    await user.click(screen.getByRole('button', { name: '创建密钥' }))
    expect(await screen.findByRole('textbox', { name: '新 API 密钥' })).toHaveValue(generatedToken)
    expect(screen.getByRole('textbox', { name: '密钥名称' })).toHaveValue('')
    await user.click(screen.getByRole('button', { name: '重新加载' }))
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('textbox', { name: '新 API 密钥' })).toHaveValue(generatedToken)
    expect(screen.getByText('deploy script')).toBeInTheDocument()
  })

  it('does not reveal a late create response after the authenticated user changes', async () => {
    const user = userEvent.setup()
    let resolveCreate: (response: CreatePersonalApiKeyResponse) => void = () => undefined
    mockApiPost.mockReturnValueOnce(
      new Promise<CreatePersonalApiKeyResponse>((resolve) => {
        resolveCreate = resolve
      }) as never
    )

    const view = renderSettings()
    await screen.findByText('尚未创建 API 密钥。')
    await user.type(screen.getByLabelText('密钥名称'), 'old account key')
    await user.click(screen.getByRole('button', { name: '创建密钥' }))
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(1))

    setAuthenticatedUser(userB)
    view.rerender(
      <ToastProvider>
        <DialogProvider>
          <MemoryRouter initialEntries={['/settings/api-keys']}>
            <Routes>
              <Route path="/settings/:section" element={<Settings />} />
            </Routes>
          </MemoryRouter>
        </DialogProvider>
      </ToastProvider>
    )
    await screen.findByText('尚未创建 API 密钥。')

    await act(async () => {
      resolveCreate(createResponse)
    })
    expect(screen.queryByRole('textbox', { name: '新 API 密钥' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '密钥名称' })).toHaveValue('')
  })
})
