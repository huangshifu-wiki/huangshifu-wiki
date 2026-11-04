import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { ToastProvider } from '../../src/components/Toast'
import { DialogProvider } from '../../src/components/Dialog'
import { clearApiCache } from '../../src/lib/apiClient'
import { resetAuthStateForTests } from '../../src/lib/auth'
import { createLocalApi, type LocalApi } from '../setup/localApi'

let api: LocalApi
beforeEach(async () => {
  clearApiCache()
  resetAuthStateForTests()
  localStorage.clear()
  window.history.replaceState(null, '', '/notifications')
  api = await createLocalApi()
  vi.stubGlobal('fetch', api.fetch)
  api.json('/api/auth/me', {
    user: { uid: 'u1', publicId: 'u123', displayName: '测试用户', role: 'user', status: 'active' },
  })
  api.json('/api/users/me', { user: {} })
  api.json('/api/setup/status', { initialized: true, requiresSetup: false })
  api.json('/api/announcements/latest', { announcement: null })
  api.json('/api/config/features', { registrationEnabled: true })
  api.json('/api/config/turnstile', { enabled: false, siteKey: '' })
})
afterEach(async () => {
  cleanup()
  await api.close()
  vi.unstubAllGlobals()
  clearApiCache()
  resetAuthStateForTests()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})
function mount() {
  render(
    <ToastProvider>
      <DialogProvider>
        <App />
      </DialogProvider>
    </ToastProvider>
  )
}
function notifications() {
  const records = [
    {
      id: 'n1',
      type: 'reply',
      payload: { actorName: '测试歌迷', postId: 'p1', preview: '一起听歌' },
      isRead: false,
      createdAt: '2026-11-04T00:00:00.000Z',
    },
  ]
  api.handlers.set('/api/notifications', (_req, res) =>
    res.end(
      JSON.stringify({
        notifications: records,
        total: records.length,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasMore: false,
        unreadCount: records.filter((n) => !n.isRead).length,
      })
    )
  )
  api.handlers.set('/api/notifications/n1/read', (_req, res) => {
    records[0].isRead = true
    res.end(JSON.stringify({ success: true }))
  })
  return records
}
it('手机通知入口按账户顺序排列并进入独立页面，已读操作更新状态', async () => {
  window.history.replaceState(null, '', '/more')
  const records = notifications()
  mount()
  await userEvent.click(await screen.findByRole('button', { name: '打开菜单' }))
  const menu = within(document.querySelector('#site-mobile-menu') as HTMLElement)
  const link = await menu.findByRole('link', { name: '通知' })
  const profile = menu.getByRole('link', { name: '测试用户的个人资料' })
  const logout = menu.getByRole('button', { name: '退出登录' })
  expect(profile.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(link.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  await userEvent.click(link)
  const main = within(screen.getByRole('main'))
  expect(await main.findByRole('heading', { name: '通知中心' })).toBeVisible()
  expect(window.location.pathname).toBe('/notifications')
  expect(await main.findByText('测试歌迷 回复了你的帖子：一起听歌')).toBeVisible()
  await userEvent.click(main.getByRole('button', { name: /^标记已读$/ }))
  await waitFor(() => expect(main.getByText(/未读 0 条/)).toBeVisible())
  expect(records[0].isRead).toBe(true)
  expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
    'content',
    'noindex,nofollow'
  )
})
it('游客直接访问通知页跳转登录并保留回跳地址', async () => {
  api.json('/api/auth/me', { user: null })
  mount()
  await waitFor(() =>
    expect(window.location.pathname + window.location.search).toBe(
      '/login?redirect=%2Fnotifications'
    )
  )
  expect(screen.queryByRole('heading', { name: '通知中心' })).not.toBeInTheDocument()
})
it.each(['空列表', '失败重试'])('通知页处理%s', async (state) => {
  if (state === '空列表')
    api.json('/api/notifications', {
      notifications: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 1,
      hasMore: false,
      unreadCount: 0,
    })
  else api.json('/api/notifications', { error: '通知暂不可用' }, 503)
  mount()
  const main = within(screen.getByRole('main'))
  if (state === '空列表') expect(await main.findByText('当前筛选下暂无通知')).toBeVisible()
  else {
    expect(await main.findByRole('alert')).toHaveTextContent('通知暂不可用')
    notifications()
    await userEvent.click(main.getByRole('button', { name: '重新加载' }))
    expect(await main.findByText('测试歌迷 回复了你的帖子：一起听歌')).toBeVisible()
  }
})

it.each(['有通知', '空通知', '加载失败'])('桌面面板在%s时可进入完整通知中心', async (state) => {
  window.history.replaceState(null, '', '/more')
  if (state === '有通知') notifications()
  else if (state === '空通知')
    api.json('/api/notifications', {
      notifications: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 1,
      hasMore: false,
      unreadCount: 0,
    })
  else api.json('/api/notifications', { error: '通知暂不可用' }, 503)
  mount()
  const bell = await screen.findByRole('button', { name: /^通知/ })
  await userEvent.click(bell)
  if (state === '有通知') await screen.findByText('测试歌迷 回复了你的帖子：一起听歌')
  else if (state === '空通知') await screen.findByText('暂无通知')
  else expect(await screen.findByRole('alert')).toHaveTextContent('通知暂不可用')
  const link = screen.getByRole('link', { name: '查看全部通知' })
  expect(link).toHaveAttribute('href', '/notifications')
  await userEvent.click(link)
  const main = within(screen.getByRole('main'))
  expect(await main.findByRole('heading', { name: '通知中心' })).toBeVisible()
  expect(window.location.pathname).toBe('/notifications')
  expect(bell).toHaveAttribute('aria-expanded', 'false')
  if (state === '有通知')
    expect(await main.findByText('测试歌迷 回复了你的帖子：一起听歌')).toBeVisible()
  else if (state === '空通知') expect(await main.findByText('当前筛选下暂无通知')).toBeVisible()
  else expect(await main.findByRole('alert')).toHaveTextContent('通知暂不可用')
})
