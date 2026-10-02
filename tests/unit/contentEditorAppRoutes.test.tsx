// @vitest-environment jsdom
import React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../../src/App'
import { DialogProvider } from '../../src/components/Dialog'
import { ToastProvider } from '../../src/components/Toast'
import { resetBackLinkOriginForTests } from '../../src/components/SmartBackLink'
import { apiGet, apiRequest } from '../../src/lib/apiClient'

// Mock factories load lazy route modules dynamically to preserve App's real React.lazy route boundary.
const appState = vi.hoisted(() => ({ detailMounts: 0, isAdmin: false }))

globalThis.ResizeObserver = class implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('../../src/lib/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/apiClient')>()),
  apiGet: vi.fn(),
  apiRequest: vi.fn(),
}))
vi.mock('../../src/hooks/useWikiCategories', () => ({
  useWikiCategories: () => ({
    categories: [{ id: 'general', name: '通用' }],
    canEditCategory: () => true,
  }),
}))
vi.mock('../../src/hooks/useTagSuggestions', () => ({ useTagSuggestions: () => [] }))
vi.mock('../../src/lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('../../src/components/LocationTagInput', () => ({ LocationTagInput: () => null }))
vi.mock('../../src/components/SmartImage', () => ({ SmartImage: () => null }))
vi.mock('../../src/components/MarkdownEditor', () => ({
  default: () => <textarea aria-label="正文" />,
}))

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

const contentRow = {
  id: 'internal-content-id',
  slug: '1001',
  title: '正常内容',
  category: 'general',
  section: 'general',
  content: '已保存正文',
  tags: [],
  relations: [],
  authorUid: 'other-user',
  status: 'draft',
  type: 'offer',
  customEventName: '巡演',
  eventName: '巡演',
  quantity: 1,
  ticketTier: '一层',
  seat: '',
  description: '',
  contact: '微信：ticket-contact',
  isDeleted: false,
  deletedAt: null,
}

beforeAll(async () => {
  await import('../../src/pages/Admin/AdminRoutes')
})

beforeEach(() => {
  resetBackLinkOriginForTests()
  appState.detailMounts = 0
  appState.isAdmin = false
  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    if (path.startsWith('/api/admin/')) {
      return {
        data: [
          contentRow,
          { ...contentRow, id: 'deleted-id', slug: '1002', title: '已删除内容', isDeleted: true },
          { ...contentRow, id: 'missing-slug-id', slug: undefined, title: '缺少标识的内容' },
        ],
        total: 41,
      } as never
    }
    if (path.startsWith('/api/wiki/')) return { page: contentRow } as never
    if (path.startsWith('/api/posts/')) return { post: contentRow } as never
    if (path === '/api/sections') return { sections: [{ id: 'general', name: '通用' }] } as never
    return {} as never
  })
  vi.mocked(apiRequest).mockResolvedValue({ listing: contentRow } as never)
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
    ['/admin/events', '活动管理'],
    ['/admin/wiki', '百科管理'],
  ])('管理员直接访问 %s 时渲染对应后台页面', async (path, title) => {
    appState.isAdmin = true
    window.history.replaceState({}, '', path)
    renderApp()

    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each([
    ['wiki', '百科管理', '新增百科', '/wiki', 'wiki.createWiki', 'wiki.editWiki'],
    ['posts', '帖子管理', '新增帖子', '/forum', 'forum.createPost', 'forum.editPost'],
    ['galleries', '图集管理', '新增图集', '/gallery', '图集编辑弹窗', '图集编辑弹窗'],
    ['ticket-listings', '盘票管理', '新增盘票', '/tickets', '发布盘票', '编辑盘票'],
  ])(
    '%s 可直接新建和编辑，取消保留后台分页与筛选',
    async (tab, heading, createLabel, editorPath, createTitle, editTitle) => {
      const user = userEvent.setup()
      appState.isAdmin = true
      const origin = `/admin/${tab}?page=2&pageSize=20#results`
      window.history.replaceState({}, '', origin)
      renderApp()

      const background = await screen.findByRole('heading', { name: heading })
      expect(screen.getAllByRole('link', { name: '编辑' })).toHaveLength(1)
      await user.click(screen.getByRole('link', { name: createLabel }))
      let modal = await screen.findByRole('dialog', { name: createTitle })
      expect(window.location.pathname).toBe(`${editorPath}/new`)
      expect(background).toBeInTheDocument()
      await user.click(within(modal).getByRole('button', { name: '取消' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
        origin
      )

      await user.click(screen.getByRole('link', { name: '编辑' }))
      modal = await screen.findByRole('dialog', { name: editTitle })
      expect(window.location.pathname).toBe(`${editorPath}/1001/edit`)
      expect(background).toBeInTheDocument()
      await user.click(within(modal).getByRole('button', { name: '取消' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
        origin
      )
    }
  )

  it('直接访问活动新建时阻止非管理员编辑后台内容', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/admin/events/new')
    renderApp()

    expect(await screen.findByRole('dialog', { name: '访问受限' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '取消' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(window.location.pathname).toBe('/admin/events')
    expect(screen.queryByRole('heading', { name: '活动管理' })).not.toBeInTheDocument()
    expect(screen.getByText('当前账号没有权限访问此页面。')).toBeInTheDocument()
  })

  it('管理员保存活动后关闭编辑弹窗并回到后台', async () => {
    const user = userEvent.setup()
    appState.isAdmin = true
    window.history.replaceState({}, '', '/admin/events/new')
    renderApp()

    expect(await screen.findByRole('dialog', { name: '新增活动' })).toBeInTheDocument()
    expect(document.body.textContent).toContain('活动管理')
    await user.click(screen.getByRole('button', { name: '模拟保存' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(window.location.pathname).toBe('/admin/events')
    expect(screen.getByRole('heading', { name: '活动管理' })).toBeInTheDocument()
  })
})
