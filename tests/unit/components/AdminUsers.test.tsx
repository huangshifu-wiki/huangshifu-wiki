// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import AdminUsers from '../../../src/pages/Admin/AdminUsers'
import { PASSWORD_MAX_LENGTH } from '../../../src/lib/passwordRules'

const mockApiGet = vi.hoisted(() => vi.fn())
const mockApiPut = vi.hoisted(() => vi.fn())
const mockApiPatch = vi.hoisted(() => vi.fn())
const mockApiDelete = vi.hoisted(() => vi.fn())
const mockInvalidateApiCacheByPrefix = vi.hoisted(() => vi.fn())
const mockShow = vi.hoisted(() => vi.fn())
const mockUseAuth = vi.hoisted(() => vi.fn())
const mockConfirmDialog = vi.hoisted(() => vi.fn())
const mockPromptDialog = vi.hoisted(() => vi.fn())

const DEFAULT_ADMIN_USERS = [
  {
    uid: 'user-1',
    displayName: '普通用户',
    email: 'user@example.com',
    photoURL: null,
    role: 'user',
    status: 'active',
    emailVerified: true,
    signature: '旧签名',
    bio: '旧简介',
  },
  {
    uid: 'admin-2',
    displayName: '管理员',
    email: 'admin2@example.com',
    photoURL: null,
    role: 'admin',
    status: 'active',
    emailVerified: false,
    signature: '',
    bio: '',
  },
  {
    uid: 'super-admin-1',
    displayName: '超级管理员',
    email: 'super@example.com',
    photoURL: null,
    role: 'super_admin',
    status: 'active',
    emailVerified: true,
    signature: '',
    bio: '',
  },
]

const SUPER_ADMIN_USERS = [
  {
    uid: 'super-admin-1',
    displayName: '当前超级管理员',
    email: 'me@example.com',
    photoURL: null,
    role: 'super_admin',
    status: 'active',
    emailVerified: true,
    signature: '',
    bio: '',
  },
  {
    uid: 'super-admin-2',
    displayName: '其他超级管理员',
    email: 'other-super@example.com',
    photoURL: null,
    role: 'super_admin',
    status: 'active',
    emailVerified: true,
    signature: '',
    bio: '',
  },
]

vi.mock('../../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
  apiPut: mockApiPut,
  apiPatch: mockApiPatch,
  apiDelete: mockApiDelete,
  invalidateApiCacheByPrefix: mockInvalidateApiCacheByPrefix,
}))

vi.mock('../../../src/components/Toast', () => ({
  useToast: () => ({
    show: mockShow,
  }),
}))

vi.mock('../../../src/components/Dialog', () => ({
  useDialog: () => ({
    confirm: mockConfirmDialog,
    prompt: mockPromptDialog,
  }),
}))

vi.mock('../../../src/context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

vi.mock('../../../src/context/UserPreferencesContext', () => ({
  useUserPreferences: () => ({
    preferences: {
      showCharacterCount: true,
    },
  }),
}))

vi.mock('../../../src/components/SmartImage', () => ({
  SmartImage: ({ src, alt, className }: { src?: string; alt?: string; className?: string }) => (
    <img src={src} alt={alt || ''} className={className} />
  ),
}))

vi.mock('../../../src/components/Modal', () => ({
  FormModal: ({
    open,
    onClose,
    title,
    subtitle,
    children,
    onSubmit,
    submitText = '提交',
    cancelText = '取消',
    loading = false,
  }: {
    open: boolean
    onClose: () => void
    title: string
    subtitle?: string
    children: React.ReactNode
    onSubmit?: (e: React.FormEvent) => void
    submitText?: string
    cancelText?: string
    loading?: boolean
  }) => {
    if (!open) return null

    return (
      <div role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
        <form onSubmit={onSubmit}>
          {children}
          <button type="button" onClick={onClose} disabled={loading}>
            {cancelText}
          </button>
          <button type="submit" disabled={loading}>
            {submitText}
          </button>
        </form>
      </div>
    )
  },
}))

describe('AdminUsers', () => {
  const setSuperAdminAuth = (uid = 'super-admin-1') => {
    mockUseAuth.mockReturnValue({
      user: { uid },
      profile: { role: 'super_admin' },
    })
  }

  const mockPromptSubmitPassword = (password = 'CurrentPassword123!') => {
    mockPromptDialog.mockImplementation(async (options) => {
      await options.onConfirm(password)
      return password
    })
  }

  const mockAdminUsers = (users = DEFAULT_ADMIN_USERS, allowSuperAdminRoleChanges = false) => {
    mockApiGet.mockImplementation(async (path) => {
      if (path === '/api/config/admin-permissions') {
        return { allowSuperAdminRoleChanges }
      }
      return { data: users }
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockConfirmDialog.mockResolvedValue(true)
    mockPromptDialog.mockResolvedValue('')
    mockUseAuth.mockReturnValue({
      user: { uid: 'admin-1' },
      profile: { role: 'admin' },
    })
    mockAdminUsers()
    mockApiPatch.mockResolvedValue({
      user: {
        uid: 'user-1',
        displayName: '新昵称',
        email: 'new@example.com',
        photoURL: null,
        role: 'user',
        status: 'active',
        emailVerified: true,
        signature: '新签名',
        bio: '新简介',
      },
    })
    mockApiPut.mockResolvedValue({
      user: {
        uid: 'user-1',
        displayName: '普通用户',
        email: 'user@example.com',
        photoURL: null,
        role: 'super_admin',
        status: 'active',
        emailVerified: true,
        signature: '旧签名',
        bio: '旧简介',
      },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('allows editing a regular user profile and password from the modal', async () => {
    render(<AdminUsers />)

    await waitFor(() => {
      expect(screen.getByText('user@example.com')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('编辑'))

    expect(screen.getByRole('dialog', { name: '编辑用户' })).toBeInTheDocument()
    expect(screen.getByLabelText(/昵称/)).toHaveValue('普通用户')
    expect(screen.getByLabelText('邮箱')).toHaveValue('user@example.com')
    expect(screen.getByRole('switch', { name: '邮箱验证状态' })).toHaveAttribute(
      'aria-checked',
      'true'
    )

    fireEvent.change(screen.getByLabelText(/昵称/), {
      target: { value: '新昵称' },
    })
    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'new@example.com' },
    })
    expect(screen.getByRole('switch', { name: '邮箱验证状态' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    fireEvent.click(screen.getByRole('switch', { name: '邮箱验证状态' }))
    expect(screen.getByRole('switch', { name: '邮箱验证状态' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    fireEvent.change(screen.getByLabelText(/签名/), {
      target: { value: '新签名' },
    })
    fireEvent.change(screen.getByLabelText(/个人简介/), {
      target: { value: '新简介' },
    })
    expect(screen.getByLabelText(/^新密码/)).toHaveAttribute(
      'maxlength',
      String(PASSWORD_MAX_LENGTH)
    )
    fireEvent.change(screen.getByLabelText(/^新密码/), {
      target: { value: 'NewPassword123!' },
    })
    expect(screen.getByText(`15 / ${PASSWORD_MAX_LENGTH} 字符`)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('确认新密码'), {
      target: { value: 'NewPassword123!' },
    })
    fireEvent.click(screen.getByText('保存修改'))

    await waitFor(() => {
      expect(mockApiPatch).toHaveBeenCalledWith('/api/users/user-1', {
        displayName: '新昵称',
        email: 'new@example.com',
        emailVerified: true,
        signature: '新签名',
        bio: '新简介',
        newPassword: 'NewPassword123!',
      })
    })
    expect(mockShow).toHaveBeenCalledWith('已更新 新昵称 的资料', { variant: 'success' })
  })

  it('does not submit a password when the password fields are blank', async () => {
    render(<AdminUsers />)

    await waitFor(() => {
      expect(screen.getByText('user@example.com')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('编辑'))
    fireEvent.click(screen.getByText('保存修改'))

    await waitFor(() => {
      expect(mockApiPatch).toHaveBeenCalledWith('/api/users/user-1', {
        displayName: '普通用户',
        email: 'user@example.com',
        emailVerified: true,
        signature: '旧签名',
        bio: '旧简介',
      })
    })
  })

  it('hides edit action for admin targets when current user is not super admin', async () => {
    render(<AdminUsers />)

    await waitFor(() => {
      expect(screen.getByText('admin2@example.com')).toBeInTheDocument()
    })

    expect(screen.getAllByText('编辑')).toHaveLength(1)
    expect(screen.queryByText('为 管理员 设置新的登录密码')).not.toBeInTheDocument()
  })

  it('hides ban and delete actions for admin targets when current user is not super admin', async () => {
    render(<AdminUsers />)

    await waitFor(() => {
      expect(screen.getByText('admin2@example.com')).toBeInTheDocument()
    })

    expect(screen.getAllByText('封禁')).toHaveLength(1)
    expect(screen.getAllByText('删除')).toHaveLength(1)
  })

  it('allows super admin to manage admin targets except themselves', async () => {
    setSuperAdminAuth()

    render(<AdminUsers />)

    await waitFor(() => {
      expect(screen.getByText('super@example.com')).toBeInTheDocument()
    })

    expect(screen.getAllByText('编辑')).toHaveLength(2)
    expect(screen.getAllByText('封禁')).toHaveLength(2)
    expect(screen.getAllByText('删除')).toHaveLength(2)
  })

  it('shows super admin role actions in the other options menu', async () => {
    setSuperAdminAuth()
    mockAdminUsers(DEFAULT_ADMIN_USERS, true)

    render(<AdminUsers />)

    await waitFor(() => {
      expect(screen.getByText('user@example.com')).toBeInTheDocument()
    })

    const regularUserMenuButton = screen.getByLabelText('普通用户 的其他选项')
    const adminMenuButton = screen.getByLabelText('管理员 的其他选项')

    fireEvent.click(regularUserMenuButton)
    expect(regularUserMenuButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitem', { name: '设为超级管理员' })).toBeInTheDocument()

    fireEvent.click(adminMenuButton)
    expect(regularUserMenuButton).toHaveAttribute('aria-expanded', 'false')
    expect(adminMenuButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitem', { name: '设为超级管理员' })).toBeInTheDocument()

    fireEvent.pointerDown(document.body)
    expect(adminMenuButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menuitem', { name: '设为超级管理员' })).not.toBeInTheDocument()

    expect(screen.queryByLabelText('超级管理员 的其他选项')).not.toBeInTheDocument()
  })

  it('submits the current password when setting a user as super admin', async () => {
    setSuperAdminAuth()
    mockAdminUsers(DEFAULT_ADMIN_USERS, true)
    mockPromptSubmitPassword()

    render(<AdminUsers />)

    await waitFor(() => {
      expect(screen.getByText('user@example.com')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByLabelText('普通用户 的其他选项'))
    fireEvent.click(screen.getByRole('menuitem', { name: '设为超级管理员' }))

    await waitFor(() => {
      expect(mockPromptDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '设为超级管理员',
          inputType: 'password',
        })
      )
      expect(mockApiPut).toHaveBeenCalledWith('/api/users/user-1/role', {
        role: 'super_admin',
        currentPassword: 'CurrentPassword123!',
      })
    })
  })

  it('hides super admin role actions when permission config is false', async () => {
    setSuperAdminAuth()
    mockAdminUsers([...DEFAULT_ADMIN_USERS, SUPER_ADMIN_USERS[1]])

    render(<AdminUsers />)

    await waitFor(() => {
      expect(screen.getByText('user@example.com')).toBeInTheDocument()
    })

    expect(screen.queryByLabelText('普通用户 的其他选项')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('管理员 的其他选项')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('其他超级管理员 的其他选项')).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '设为超级管理员' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '降为管理员' })).not.toBeInTheDocument()
  })

  it('submits the current password when demoting another super admin to admin', async () => {
    setSuperAdminAuth()
    mockAdminUsers(SUPER_ADMIN_USERS, true)
    mockApiPut.mockResolvedValueOnce({
      user: {
        uid: 'super-admin-2',
        displayName: '其他超级管理员',
        email: 'other-super@example.com',
        photoURL: null,
        role: 'admin',
        status: 'active',
        emailVerified: true,
        signature: '',
        bio: '',
      },
    })
    mockPromptSubmitPassword()

    render(<AdminUsers />)

    await waitFor(() => {
      expect(screen.getByText('other-super@example.com')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByLabelText('其他超级管理员 的其他选项'))
    fireEvent.click(screen.getByRole('menuitem', { name: '降为管理员' }))

    await waitFor(() => {
      expect(mockApiPut).toHaveBeenCalledWith('/api/users/super-admin-2/role', {
        role: 'admin',
        currentPassword: 'CurrentPassword123!',
      })
    })
  })

  it('shows server errors when demoting another super admin is rejected', async () => {
    setSuperAdminAuth()
    mockAdminUsers(SUPER_ADMIN_USERS, true)
    mockApiPut.mockRejectedValueOnce(new Error('当前配置不允许变更超级管理员身份'))
    mockPromptSubmitPassword()

    render(<AdminUsers />)

    await waitFor(() => {
      expect(screen.getByText('other-super@example.com')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByLabelText('其他超级管理员 的其他选项'))
    fireEvent.click(screen.getByRole('menuitem', { name: '降为管理员' }))

    await waitFor(() => {
      expect(mockShow).toHaveBeenCalledWith('当前配置不允许变更超级管理员身份', {
        variant: 'error',
      })
    })
  })
})
