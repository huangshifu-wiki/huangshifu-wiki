// @vitest-environment jsdom
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../../src/App'
import { DialogProvider } from '../../src/components/Dialog'
import { ToastProvider } from '../../src/components/Toast'
import { resetBackLinkOriginForTests } from '../../src/components/SmartBackLink'

// Mock factories load lazy route modules dynamically to preserve App's real React.lazy route boundary.
const appState = vi.hoisted(() => ({ detailMounts: 0, isAdmin: false }))

vi.mock('../../src/context/AuthContext', async () => {
  const React = await import('react')
  return {
    AuthProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useAuth: () => ({
      user: { uid: 'editor-1', role: appState.isAdmin ? 'admin' : 'user' },
      isAdmin: appState.isAdmin,
      isBanned: false,
      loading: false,
      ensureInitialized: () => Promise.resolve(),
    }),
  }
})

vi.mock('../../src/context/MusicContext', async () => {
  const React = await import('react')
  return {
    MusicProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useMusic: () => ({ currentSong: null }),
  }
})

vi.mock('../../src/hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true }),
}))
vi.mock('../../src/lib/setup', () => ({
  getSetupStatus: () => Promise.resolve({ initialized: true, requiresSetup: false }),
}))
vi.mock('../../src/lib/miniProgram', () => ({
  clearMiniProgramLoginParams: vi.fn(),
  getMiniProgramLoginPayload: vi.fn(),
  isMiniProgramWebView: () => false,
}))
vi.mock('../../src/components/Navbar', () => ({ Navbar: () => null }))
vi.mock('../../src/components/AnnouncementBar', () => ({ AnnouncementBar: () => null }))
vi.mock('../../src/components/BottomNav', () => ({ BottomNav: () => null }))
vi.mock('../../src/components/GlobalMusicPlayer', () => ({ GlobalMusicPlayer: () => null }))
vi.mock('../../src/components/SiteFooter', () => ({ SiteFooterContent: () => null }))
vi.mock('../../src/components/ErrorBoundary', async () => {
  const React = await import('react')
  return {
    ErrorBoundary: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  }
})

vi.mock('../../src/pages/Gallery', async () => {
  const React = await import('react')
  const { Link: RouterLink, useLocation } = await import('react-router-dom')

  return {
    default: function GalleryListMock() {
      const location = useLocation()
      return React.createElement(
        'div',
        null,
        React.createElement('h1', null, '图集列表'),
        React.createElement(
          'output',
          { 'data-testid': 'background-location' },
          `${location.pathname}${location.search}`
        ),
        React.createElement(
          RouterLink,
          { to: '/gallery/new', state: { editorBackground: location } },
          '上传图集'
        )
      )
    },
  }
})

vi.mock('../../src/pages/GalleryDetail', async () => {
  const React = await import('react')
  const { Link: RouterLink, useLocation } = await import('react-router-dom')

  return {
    default: function GalleryDetailMock() {
      const location = useLocation()
      React.useEffect(() => {
        appState.detailMounts += 1
      }, [])
      return React.createElement(
        'div',
        null,
        React.createElement('h1', null, '图集详情'),
        React.createElement(
          RouterLink,
          { to: '/gallery/test-1/edit', state: { editorBackground: location } },
          '编辑图集'
        )
      )
    },
  }
})

vi.mock('../../src/pages/GalleryEdit', async () => {
  const React = await import('react')
  const { useLocation } = await import('react-router-dom')
  const { FormModal } = await import('../../src/components/Modal/FormModal')
  const { useContentEditorNavigation } = await import('../../src/hooks/useContentEditorNavigation')

  return {
    default: function GalleryEditorMock() {
      const location = useLocation()
      const { closeEditor, navigateAfterSave } = useContentEditorNavigation()
      const editorContent = React.createElement(
        React.Fragment,
        null,
        React.createElement('output', { 'data-testid': 'editor-path' }, location.pathname),
        React.createElement(
          'button',
          { type: 'button', onClick: () => navigateAfterSave('/gallery/test-1') },
          '模拟保存'
        )
      )
      return React.createElement(FormModal, {
        open: true,
        onClose: closeEditor,
        title: '图集编辑弹窗',
        children: editorContent,
      })
    },
  }
})
vi.mock('../../src/components/admin/AdminLayout', async () => {
  const { Outlet } = await import('react-router-dom')
  return { AdminLayout: Outlet }
})
vi.mock('../../src/pages/Admin/AdminDashboard', () => ({
  default: () => <h1>管理面板首页</h1>,
}))
vi.mock('../../src/pages/Admin/AdminListPage', () => ({
  default: ({ type }: { type: string }) => <h1>后台列表：{type}</h1>,
}))

vi.mock('../../src/pages/Admin/AdminEventEdit', async () => {
  const React = await import('react')
  const { FormModal } = await import('../../src/components/Modal/FormModal')
  const { useContentEditorNavigation } = await import('../../src/hooks/useContentEditorNavigation')

  return {
    default: function AdminEventEditorMock() {
      const { closeEditor, navigateAfterSave } = useContentEditorNavigation()
      const eventContent = React.createElement(
        'button',
        { type: 'button', onClick: () => navigateAfterSave('/admin/events') },
        '模拟保存'
      )
      return React.createElement(FormModal, {
        open: true,
        onClose: closeEditor,
        title: '新增活动',
        children: eventContent,
      })
    },
  }
})

const renderApp = () =>
  render(
    <ToastProvider>
      <DialogProvider>
        <App />
      </DialogProvider>
    </ToastProvider>
  )

beforeAll(async () => {
  await import('../../src/pages/Admin/AdminRoutes')
})

beforeEach(() => {
  resetBackLinkOriginForTests()
  appState.detailMounts = 0
  appState.isAdmin = false
})

describe('真实应用的内容编辑路由弹窗', () => {
  it('从列表打开后保留查询上下文，取消回到来源', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/gallery?page=2')
    renderApp()

    await screen.findByRole('heading', { name: '图集列表' })
    expect(screen.getByTestId('background-location')).toHaveTextContent('/gallery?page=2')
    await user.click(screen.getByRole('link', { name: '上传图集' }))

    expect(await screen.findByRole('dialog', { name: '图集编辑弹窗' })).toBeInTheDocument()
    expect(document.querySelector('[data-testid="background-location"]')).toHaveTextContent(
      '/gallery?page=2'
    )
    expect(screen.getByTestId('editor-path')).toHaveTextContent('/gallery/new')

    await user.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(window.location.pathname).toBe('/gallery')
    expect(window.location.search).toBe('?page=2')
    expect(await screen.findByRole('heading', { name: '图集列表' })).toBeInTheDocument()
  })

  it('直接进入编辑 URL 时显示列表背景，关闭替换到列表', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/gallery/new')
    renderApp()

    expect(await screen.findByRole('dialog', { name: '图集编辑弹窗' })).toBeInTheDocument()
    expect(document.querySelector('[data-testid="background-location"]')).toHaveTextContent(
      '/gallery'
    )
    await user.click(screen.getByRole('button', { name: '取消' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(window.location.pathname).toBe('/gallery')
    expect(await screen.findByRole('heading', { name: '图集列表' })).toBeInTheDocument()
  })

  it('保存详情编辑后重载同一路由背景', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/gallery/test-1')
    renderApp()

    await screen.findByRole('heading', { name: '图集详情' })
    expect(appState.detailMounts).toBe(1)
    await user.click(screen.getByRole('link', { name: '编辑图集' }))
    expect(await screen.findByRole('dialog', { name: '图集编辑弹窗' })).toBeInTheDocument()
    expect(appState.detailMounts).toBe(1)

    await user.click(screen.getByRole('button', { name: '模拟保存' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(window.location.pathname).toBe('/gallery/test-1')
    await waitFor(() => expect(appState.detailMounts).toBe(2))
  })

  it.each([
    ['/admin', '管理面板首页'],
    ['/admin/events', '后台列表：events'],
    ['/admin/wiki', '后台列表：wiki'],
  ])('管理员直接访问 %s 时渲染对应后台页面', async (path, title) => {
    appState.isAdmin = true
    window.history.replaceState({}, '', path)
    renderApp()

    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('直接访问活动新建时阻止非管理员编辑后台内容', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/admin/events/new')
    renderApp()

    expect(await screen.findByRole('dialog', { name: '访问受限' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '取消' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(window.location.pathname).toBe('/admin/events')
    expect(screen.queryByRole('heading', { name: '后台列表：events' })).not.toBeInTheDocument()
    expect(screen.getByText('当前账号没有权限访问此页面。')).toBeInTheDocument()
  })

  it('管理员保存活动后关闭编辑弹窗并回到后台', async () => {
    const user = userEvent.setup()
    appState.isAdmin = true
    window.history.replaceState({}, '', '/admin/events/new')
    renderApp()

    expect(await screen.findByRole('dialog', { name: '新增活动' })).toBeInTheDocument()
    expect(document.body.textContent).toContain('后台列表：events')
    await user.click(screen.getByRole('button', { name: '模拟保存' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(window.location.pathname).toBe('/admin/events')
    expect(screen.getByRole('heading', { name: '后台列表：events' })).toBeInTheDocument()
  })
})
