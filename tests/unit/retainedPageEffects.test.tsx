import { useState } from 'react'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { Route, useNavigate, type NavigateFunction } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RouteRetentionProvider } from '../../src/context/RouteRetentionContext'
import { RetainedRoutes } from '../../src/components/RetainedRoutes'
import { RouteGuard } from '../../src/components/RouteGuard'
import { DialogProvider } from '../../src/components/Dialog'
import { NotificationPanel } from '../../src/components/Navbar/NotificationPanel'
import { RouteActivity } from '../../src/lib/routeActivity'
import { clearApiCache } from '../../src/lib/apiClient'
import { resetAuthStateForTests } from '../../src/lib/auth'
import Forum from '../../src/pages/Forum'
import GalleryDetail from '../../src/pages/GalleryDetail'
import { createLocalApi, type LocalApi } from '../setup/localApi'
import { renderTagFilterPage } from '../setup/tagFilterPage'

let api: LocalApi
let navigate: NavigateFunction
const scrollIntoView = Element.prototype.scrollIntoView
beforeEach(async () => {
  clearApiCache()
  resetAuthStateForTests()
  localStorage.clear()
  Element.prototype.scrollIntoView = () => {}
  api = await createLocalApi()
  vi.stubGlobal('fetch', api.fetch)
  api.json('/api/auth/me', { user: null })
  api.json('/api/users/me', { user: {} })
  api.json('/api/sections', { sections: [] })
  api.json('/api/config/gallery-access', { adminOnly: false })
})
afterEach(async () => {
  cleanup()
  vi.useRealTimers()
  Element.prototype.scrollIntoView = scrollIntoView
  await api.close()
  vi.unstubAllGlobals()
  clearApiCache()
  resetAuthStateForTests()
})

function Pages() {
  navigate = useNavigate()
  return (
    <DialogProvider>
      <RouteRetentionProvider scopeKey="review">
        <RetainedRoutes scope="public">
          <Route path="/forum/*" element={<Forum />} />
          <Route path="/gallery/:galleryId" element={<GalleryDetail />} />
          <Route path="/other" element={<p>其他页面</p>} />
        </RetainedRoutes>
        <RetainedRoutes scope="admin">
          <Route
            path="/admin/settings"
            element={
              <RouteGuard requireSuperAdmin>
                <input aria-label="受限字段" />
              </RouteGuard>
            }
          />
        </RetainedRoutes>
      </RouteRetentionProvider>
    </DialogProvider>
  )
}

it('普通管理员离开受限页面后，隐藏实例仍不得挂载设置表单', async () => {
  api.json('/api/auth/me', { user: { uid: 'admin', role: 'admin', status: 'active' } })
  renderTagFilterPage(<Pages />, '/admin/settings')
  await screen.findByText('访问受限')
  await act(() => navigate('/other'))
  expect(screen.queryByLabelText('受限字段')).not.toBeInTheDocument()
  await act(() => navigate(-1))
  expect(screen.getByText('访问受限')).toBeVisible()
})

it.each(['/forum/item', '/gallery/item'])('%s 返回时不残留评论定位高亮', async (path) => {
  const createdAt = '2026-01-01T00:00:00.000Z'
  const comment = {
    id: 'target',
    postId: 'item',
    galleryId: 'item',
    authorUid: 'author',
    authorName: '作者',
    content: '定位评论',
    parentId: null,
    replyToId: null,
    isDeleted: false,
    likesCount: 0,
    likedByMe: false,
    createdAt,
  }
  api.json('/api/posts/item', {
    post: {
      id: 'item',
      title: '帖子',
      content: '正文',
      section: 'all',
      status: 'published',
      authorUid: 'author',
      authorName: '作者',
      tags: [],
      createdAt,
      updatedAt: createdAt,
    },
    comments: [comment],
  })
  api.json('/api/galleries/item', {
    gallery: {
      id: 'item',
      slug: 'item',
      title: '图集',
      description: '正文',
      status: 'published',
      published: true,
      authorUid: 'author',
      authorName: '作者',
      tags: [],
      relatedLinks: [],
      images: [],
      createdAt,
      updatedAt: createdAt,
    },
  })
  api.json('/api/galleries/item/comments', { comments: [comment] })
  renderTagFilterPage(<Pages />, `${path}#comment-target`)
  await screen.findByText('定位评论')
  const target = document.querySelector('#comment-target')!
  const highlight = 'bg-[color-mix(in_srgb,var(--color-theme-accent)_14%,var(--book-panel-bg))]'
  await waitFor(() => expect(target).toHaveClass(highlight))
  await act(async () => {
    await new Promise(requestAnimationFrame)
  })
  await act(() => navigate('/other'))
  expect(target).not.toHaveClass(highlight)
  await act(() => navigate(-1))
  expect(document.querySelector('#comment-target')).toBe(target)
  expect(target).not.toHaveClass(highlight)
})

function Notifications() {
  const [active, setActive] = useState(true)
  const navigate = useNavigate()
  return (
    <>
      <button onClick={() => setActive(!active)}>切换外壳</button>
      <RouteActivity active={active}>
        <div hidden={!active}>
          <NotificationPanel onNavigate={navigate} />
        </div>
      </RouteActivity>
    </>
  )
}

it('通知轮询在隐藏时暂停，恢复后保留数据并等待下一个周期', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  api.json('/api/auth/me', { user: { uid: 'user', role: 'user', status: 'active' } })
  let unreadCount = 0
  api.handlers.set('/api/notifications', (_req, res) => {
    res.end(JSON.stringify({ notifications: [], unreadCount: ++unreadCount }))
  })
  renderTagFilterPage(<Notifications />, '/other')
  await screen.findByRole('button', { name: '通知，有1条未读' })
  clearApiCache()
  fireEvent.click(screen.getByText('切换外壳'))
  await act(() => vi.advanceTimersByTimeAsync(60000))
  fireEvent.click(screen.getByText('切换外壳'))
  expect(screen.getByRole('button', { name: '通知，有1条未读' })).toBeVisible()
  await act(() => vi.advanceTimersByTimeAsync(60000))
  await screen.findByRole('button', { name: '通知，有2条未读' })
  expect(api.requests.filter((path) => path === '/api/notifications')).toHaveLength(2)
})
