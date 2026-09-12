// @vitest-environment jsdom
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { logoutRequest } from '../../../src/lib/auth'
import { Navbar } from '../../../src/components/Navbar'

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('../../../src/lib/auth', () => ({
  logoutRequest: vi.fn(),
}))

vi.mock('../../../src/context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

vi.mock('../../../src/context/UserPreferencesContext', () => ({
  useUserPreferences: () => ({
    preferences: { theme: 'system' },
    setTheme: vi.fn(),
    resolvedTheme: 'default',
  }),
}))

vi.mock('../../../src/components/HeaderUserControls', () => ({
  HeaderUserControls: () => null,
}))

vi.mock('../../../src/components/Navbar/NavbarSearchBox', () => ({
  NavbarSearchBox: () => null,
}))

vi.mock('../../../src/components/Navbar/AuthModal', () => ({
  AuthModal: ({ open }: { open: boolean }) => (open ? <div>登录弹窗</div> : null),
}))

vi.mock('../../../src/components/Toast', () => ({
  useToast: () => ({ show: vi.fn() }),
}))

vi.mock('../../../src/hooks/usePublicFeatures', () => ({
  usePublicFeatures: () => ({ features: { registrationEnabled: true } }),
}))

const renderNavbar = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Navbar />
      <Routes>
        <Route path="/search" element={<div>搜索结果页</div>} />
        <Route path="*" element={<div>其他页面</div>} />
      </Routes>
    </MemoryRouter>
  )

const openMobileMenu = async (container: HTMLElement) => {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '打开菜单' }))
  const menu = container.querySelector('#site-mobile-menu')
  expect(menu).toBeInTheDocument()
  return { user, menu: menu as HTMLElement }
}

describe('Navbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ user: null, profile: null, loading: false })
  })

  it('打开汉堡菜单时菜单在导航栏盒内展开，整条导航切换为磨砂面板', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>
    )

    const nav = screen.getByRole('navigation')
    expect(container.querySelector('[data-state]')).not.toBeInTheDocument()
    expect(nav).toHaveAttribute('data-menu-open', 'false')

    await user.click(screen.getByRole('button', { name: '打开菜单' }))

    const mobileMenu = container.querySelector('[data-state]')

    expect(mobileMenu).toBeInTheDocument()
    expect(mobileMenu?.parentElement).toBe(nav)
    expect(nav).toHaveAttribute('data-menu-open', 'true')
  })

  it('菜单内展示全部主导航链接与主题切换', async () => {
    const { container } = renderNavbar()
    const { menu } = await openMobileMenu(container)

    for (const label of ['音乐', '画廊', '游记', '百科', '论坛', '更多']) {
      expect(within(menu).getByRole('link', { name: label })).toBeInTheDocument()
    }
    expect(within(menu).getByRole('group', { name: '颜色模式' })).toBeInTheDocument()
  })

  it('游客可见登录与注册入口，点击登录后关闭菜单并打开登录弹窗', async () => {
    const { container } = renderNavbar()
    const { user, menu } = await openMobileMenu(container)

    expect(within(menu).getByRole('button', { name: '登录' })).toBeInTheDocument()
    expect(within(menu).getByRole('button', { name: '注册' })).toBeInTheDocument()

    await user.click(within(menu).getByRole('button', { name: '登录' }))

    expect(screen.getByText('登录弹窗')).toBeInTheDocument()
    await waitFor(() => expect(menu).toHaveAttribute('data-state', 'closed'))
  })

  it('已登录用户可见个人资料链接，退出登录调用登出请求', async () => {
    mockUseAuth.mockReturnValue({
      user: { publicId: 'u123' },
      profile: { displayName: '测试用户' },
      loading: false,
    })
    const { container } = renderNavbar()
    const { user, menu } = await openMobileMenu(container)

    expect(within(menu).getByRole('link', { name: '个人资料' })).toHaveAttribute(
      'href',
      '/users/u123'
    )

    await user.click(within(menu).getByRole('button', { name: '退出登录' }))

    await waitFor(() => expect(vi.mocked(logoutRequest)).toHaveBeenCalled())
  })

  it('菜单内提交搜索后跳转到搜索页', async () => {
    const { container } = renderNavbar()
    const { user, menu } = await openMobileMenu(container)

    await user.type(within(menu).getByRole('textbox'), '演唱会')
    await user.click(within(menu).getByRole('button', { name: '搜索' }))

    await waitFor(() => expect(screen.getByText('搜索结果页')).toBeInTheDocument())
  })
})
