// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import AdminUsers from '../../../src/pages/Admin/AdminUsers'

const mockApiGet = vi.hoisted(() => vi.fn())
const mockApiPut = vi.hoisted(() => vi.fn())
const mockApiDelete = vi.hoisted(() => vi.fn())
const mockInvalidateApiCacheByPrefix = vi.hoisted(() => vi.fn())
const mockShow = vi.hoisted(() => vi.fn())
const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('../../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
  apiPut: mockApiPut,
  apiDelete: mockApiDelete,
  invalidateApiCacheByPrefix: mockInvalidateApiCacheByPrefix,
}))

vi.mock('../../../src/components/Toast', () => ({
  useToast: () => ({
    show: mockShow,
  }),
}))

vi.mock('../../../src/context/AuthContext', () => ({
  useAuth: mockUseAuth,
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
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({
      user: { uid: 'admin-1' },
      profile: { role: 'admin' },
    })
    mockApiGet.mockResolvedValue({
      data: [
        {
          uid: 'user-1',
          displayName: '普通用户',
          email: 'user@example.com',
          photoURL: null,
          role: 'user',
          status: 'active',
        },
        {
          uid: 'admin-2',
          displayName: '管理员',
          email: 'admin2@example.com',
          photoURL: null,
          role: 'admin',
          status: 'active',
        },
        {
          uid: 'super-admin-1',
          displayName: '超级管理员',
          email: 'super@example.com',
          photoURL: null,
          role: 'super_admin',
          status: 'active',
        },
      ],
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('allows resetting a regular user password from the modal', async () => {
    render(<AdminUsers />)

    await waitFor(() => {
      expect(screen.getByText('user@example.com')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTitle('重置密码'))

    expect(screen.getByRole('dialog', { name: '重置用户密码' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('新密码'), {
      target: { value: 'NewPassword123!' },
    })
    fireEvent.click(screen.getByText('确认重置'))

    await waitFor(() => {
      expect(mockApiPut).toHaveBeenCalledWith('/api/users/user-1/reset-password', {
        newPassword: 'NewPassword123!',
      })
    })
    expect(mockShow).toHaveBeenCalledWith('已重置 普通用户 的密码', { variant: 'success' })
  })

  it('hides reset password action for admin targets when current user is not super admin', async () => {
    render(<AdminUsers />)

    await waitFor(() => {
      expect(screen.getByText('admin2@example.com')).toBeInTheDocument()
    })

    expect(screen.getAllByTitle('重置密码')).toHaveLength(1)
    expect(screen.queryByText('为 管理员 设置新的登录密码')).not.toBeInTheDocument()
  })

  it('hides ban and delete actions for admin targets when current user is not super admin', async () => {
    render(<AdminUsers />)

    await waitFor(() => {
      expect(screen.getByText('admin2@example.com')).toBeInTheDocument()
    })

    expect(screen.getAllByTitle('封禁')).toHaveLength(1)
    expect(screen.getAllByTitle('删除')).toHaveLength(1)
  })

  it('allows super admin to manage admin targets except themselves', async () => {
    mockUseAuth.mockReturnValue({
      user: { uid: 'super-admin-1' },
      profile: { role: 'super_admin' },
    })

    render(<AdminUsers />)

    await waitFor(() => {
      expect(screen.getByText('super@example.com')).toBeInTheDocument()
    })

    expect(screen.getAllByTitle('重置密码')).toHaveLength(2)
    expect(screen.getAllByTitle('封禁')).toHaveLength(2)
    expect(screen.getAllByTitle('删除')).toHaveLength(2)
  })
})
