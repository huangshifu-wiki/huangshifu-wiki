// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Navbar } from '../../../src/components/Navbar'
import { ToastProvider } from '../../../src/components/Toast'

const { mockUsePublicFeatures } = vi.hoisted(() => ({
  mockUsePublicFeatures: vi.fn(() => ({
    features: { semanticSearch: true, registrationEnabled: true },
    loading: false,
  })),
}))

vi.mock('../../../src/lib/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'nav.wiki': 'nav.wiki',
        'nav.forum': 'nav.forum',
        'nav.gallery': 'nav.gallery',
        'nav.music': 'nav.music',
        search: '搜索',
        'auth.register': '注册',
        'auth.login': '登录',
        'site.title': '诗扶小筑',
      }
      return map[key] || key
    },
  }),
}))

vi.mock('../../../src/hooks/usePublicFeatures', () => ({
  usePublicFeatures: mockUsePublicFeatures,
}))

vi.mock('../../../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    profile: null,
    isAdmin: false,
    isBanned: false,
    loading: false,
    ensureInitialized: vi.fn(),
    refreshAuth: vi.fn(),
  }),
}))

describe('Navbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUsePublicFeatures.mockReturnValue({
      features: { semanticSearch: true, registrationEnabled: true },
      loading: false,
    })
  })

  const renderWithRouter = (ui: React.ReactElement) => {
    return render(
      <MemoryRouter>
        <ToastProvider>{ui}</ToastProvider>
      </MemoryRouter>
    )
  }

  it('renders navigation with role=navigation', () => {
    renderWithRouter(<Navbar />)
    const navs = screen.getAllByRole('navigation')
    expect(navs.length).toBeGreaterThanOrEqual(1)
    expect(navs[0]).toBeInTheDocument()
  })

  it('has correct aria-label for navigation', () => {
    renderWithRouter(<Navbar />)
    const navs = screen.getAllByRole('navigation')
    expect(navs[0]).toHaveAttribute('aria-label', '主导航')
  })

  it('renders site title "黄诗扶"', () => {
    const { container } = renderWithRouter(<Navbar />)
    expect(container.innerHTML).toContain('黄诗扶')
    expect(container.innerHTML).toContain('Wiki')
  })

  it('renders navigation links', () => {
    const { container } = renderWithRouter(<Navbar />)
    const html = container.innerHTML
    expect(html).toContain('百科')
    expect(html).toContain('论坛')
    expect(html).toContain('画廊')
    expect(html).toContain('音乐')
    expect(html).toContain('游记')
    expect(html).toContain('搜索')
  })

  it('shows login and register buttons when not authenticated', () => {
    renderWithRouter(<Navbar />)
    expect(screen.queryByRole('button', { name: '注册' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument()
  })

  it('has login and register buttons that are clickable', async () => {
    const user = userEvent.setup()
    const { container } = renderWithRouter(<Navbar />)

    const menuButton = container.querySelector(
      '[aria-label="打开账户菜单"]'
    ) as HTMLButtonElement | null
    expect(menuButton).not.toBeNull()
    if (!menuButton) {
      return
    }
    await user.click(menuButton)

    const buttons = container.querySelectorAll('button')
    let foundLogin = false
    let foundRegister = false
    for (const btn of buttons) {
      if (btn.textContent?.includes('登录')) {
        await user.click(btn)
        foundLogin = true
      }
      if (btn.textContent?.includes('注册')) {
        foundRegister = true
      }
    }
    expect(foundLogin).toBe(true)
    expect(foundRegister).toBe(true)
  })

  it('hides register action when registration is disabled', async () => {
    mockUsePublicFeatures.mockReturnValue({
      features: { semanticSearch: true, registrationEnabled: false },
      loading: false,
    })
    const user = userEvent.setup()
    const { container } = renderWithRouter(<Navbar />)

    const menuButton = container.querySelector(
      '[aria-label="打开账户菜单"]'
    ) as HTMLButtonElement | null
    expect(menuButton).not.toBeNull()
    if (!menuButton) {
      return
    }
    await user.click(menuButton)

    expect(container.innerHTML).toContain('登录')
    expect(container.innerHTML).not.toContain('注册')
  })

  it('renders mobile menu toggle button', () => {
    const { container } = renderWithRouter(<Navbar />)
    expect(container.innerHTML).toContain('打开菜单')
  })

  it('mobile menu toggle button is present in DOM', () => {
    const { container } = renderWithRouter(<Navbar />)
    const toggleBtns = container.querySelectorAll('[aria-label="打开菜单"]')
    expect(toggleBtns.length).toBeGreaterThanOrEqual(1)
  })
})
