// @vitest-environment jsdom
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Navbar } from '../../../src/components/Navbar'
import { AuthProvider } from '../../../src/context/AuthContext'
import { ToastProvider } from '../../../src/components/Toast'
import { clearApiCache } from '../../../src/lib/apiClient'
import { resetAuthStateForTests } from '../../../src/lib/auth'
import { createLocalApi, type LocalApi } from '../../setup/localApi'

let api: LocalApi
beforeEach(async () => {
  clearApiCache()
  resetAuthStateForTests()
  localStorage.clear()
  api = await createLocalApi()
  vi.stubGlobal('fetch', api.fetch)
  api.json('/api/auth/me', { user: null })
  api.json('/api/config/features', { registrationEnabled: true })
  api.json('/api/config/turnstile', { enabled: false, siteKey: '' })
})
afterEach(async () => {
  cleanup()
  await api.close()
  vi.unstubAllGlobals()
  clearApiCache()
  resetAuthStateForTests()
})

function renderNavbar() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <AuthProvider>
          <Navbar />
          <Routes>
            <Route path="/search" element={<div>搜索结果页</div>} />
            <Route path="*" element={null} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  )
}

describe('Navbar', () => {
  it('菜单在导航栏内展开，并保留导航及主题切换', async () => {
    const { container } = renderNavbar()
    const nav = screen.getByRole('navigation', { name: '主导航' })
    await userEvent.click(screen.getByRole('button', { name: '打开菜单' }))
    const menu = container.querySelector('#site-mobile-menu') as HTMLElement
    expect(menu.parentElement).toBe(nav)
    expect(nav).toHaveAttribute('data-menu-open', 'true')
    for (const label of ['音乐', '画廊', '游记', '百科', '论坛', '更多']) {
      expect(within(menu).getByRole('link', { name: label })).toBeVisible()
    }
    expect(within(menu).getByRole('group', { name: '颜色模式' })).toBeVisible()
  })

  it.each(['登录', '注册'])('首次打开%s表单，关闭后可重新打开', async (mode) => {
    const { container } = renderNavbar()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '打开菜单' }))
    const menu = container.querySelector('#site-mobile-menu') as HTMLElement
    await userEvent.click(await within(menu).findByRole('button', { name: mode }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(menu).toHaveAttribute('data-state', 'closed'))
    expect(await within(dialog).findByRole('heading', { name: new RegExp(mode) })).toBeVisible()
    expect(within(dialog).getByRole('textbox', { name: /邮箱/ })).toBeVisible()
    await userEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '打开菜单' }))
    await userEvent.click(
      within(container.querySelector('#site-mobile-menu') as HTMLElement).getByRole('button', {
        name: mode,
      })
    )
    expect(await screen.findByRole('dialog')).toBeVisible()
  })

  it.each([
    ['自定义头像', 'https://cdn/avatar.png', 'https://cdn/avatar.png'],
    ['默认头像', null, '/default-avatar.svg'],
  ])('已登录用户显示个人资料和%s，且可退出登录', async (_label, photoURL, expectedAvatar) => {
    api.json('/api/auth/me', {
      user: { uid: 'u1', publicId: 'u123', displayName: '测试用户', photoURL },
    })
    api.json('/api/notifications', { notifications: [], unreadCount: 0 })
    api.handlers.set('/api/auth/logout', (_req, res) => {
      api.json('/api/auth/me', { user: null })
      res.end(JSON.stringify({ success: true }))
    })
    const { container } = renderNavbar()
    await userEvent.click(screen.getByRole('button', { name: '打开菜单' }))
    const menu = within(container.querySelector('#site-mobile-menu') as HTMLElement)
    const profile = await menu.findByRole('link', { name: '测试用户的个人资料' })
    expect(profile).toHaveAttribute('href', '/users/u123')
    expect(profile.querySelector('img')).toHaveAttribute('src', expectedAvatar)
    await userEvent.click(menu.getByRole('button', { name: '退出登录' }))
    await userEvent.click(await screen.findByRole('button', { name: '打开菜单' }))
    expect(
      await within(container.querySelector('#site-mobile-menu') as HTMLElement).findByRole(
        'button',
        { name: '登录' }
      )
    ).toBeVisible()
  })

  it('菜单内提交搜索后进入搜索结果页', async () => {
    const { container } = renderNavbar()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '打开菜单' }))
    const menu = within(container.querySelector('#site-mobile-menu') as HTMLElement)
    await user.type(menu.getByRole('textbox'), '演唱会')
    await user.click(menu.getByRole('button', { name: '搜索' }))
    expect(await screen.findByText('搜索结果页')).toBeVisible()
  })
})
