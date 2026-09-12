// @vitest-environment jsdom
import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
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

describe('Navbar', () => {
  it('打开汉堡菜单时将菜单挂在响应式导航容器内', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>
    )

    expect(container.querySelector('[data-state]')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '打开菜单' }))

    const mobileMenu = container.querySelector('[data-state]')

    expect(mobileMenu).toBeInTheDocument()
    expect(mobileMenu?.parentElement).toBe(screen.getByRole('navigation').firstElementChild)
  })
})
