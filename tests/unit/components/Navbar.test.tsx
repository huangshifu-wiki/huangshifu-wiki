// @vitest-environment jsdom
import { MemoryRouter } from 'react-router-dom'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Navbar } from '../../../src/components/Navbar'

vi.mock('../../../src/lib/auth', () => ({
  logoutRequest: vi.fn(),
}))

vi.mock('../../../src/components/HeaderUserControls', () => ({
  HeaderUserControls: () => null,
}))

vi.mock('../../../src/components/Navbar/NavbarSearchBox', () => ({
  NavbarSearchBox: () => null,
}))

vi.mock('../../../src/components/Navbar/AuthModal', () => ({
  AuthModal: () => null,
}))

vi.mock('../../../src/components/Toast', () => ({
  useToast: () => ({ show: vi.fn() }),
}))

vi.mock('../../../src/hooks/usePublicFeatures', () => ({
  usePublicFeatures: () => ({ features: { registrationEnabled: true } }),
}))

vi.mock('../../../src/context/AuthContext', () => ({
  useAuth: () => ({ user: null, profile: null, isAdmin: false, isBanned: false }),
}))

vi.mock('../../../src/hooks/usePendingReviewCount', () => ({
  usePendingReviewCount: () => 0,
}))

vi.mock('../../../src/components/ThemeToggle', () => ({
  ThemeToggle: () => null,
}))

describe('Navbar', () => {
  it('打开汉堡菜单时将菜单挂在响应式导航容器内', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>
    )

    await user.click(screen.getByRole('button', { name: '打开菜单' }))

    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: '音乐' })).toHaveLength(2)
    })

    const navigation = screen.getByRole('navigation')
    const mobileMenu = screen.getAllByRole('link', { name: '音乐' })[1].closest('[data-state]')

    expect(mobileMenu).toBeInTheDocument()
    expect(mobileMenu?.parentElement).toBe(navigation.firstElementChild)
  })
})
