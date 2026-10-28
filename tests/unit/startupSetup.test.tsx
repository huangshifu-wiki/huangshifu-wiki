import { StrictMode } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { ToastProvider } from '../../src/components/Toast'
import { DialogProvider } from '../../src/components/Dialog'
import { clearApiCache } from '../../src/lib/apiClient'
import { resetAuthStateForTests } from '../../src/lib/auth'
import { getSetupStatus } from '../../src/lib/setup'
import { createLocalApi, type LocalApi } from '../setup/localApi'
import { deferred } from '../setup/deferred'

let api: LocalApi
beforeEach(async () => {
  clearApiCache()
  resetAuthStateForTests()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  api = await createLocalApi()
  vi.stubGlobal('fetch', api.fetch)
  api.json('/api/auth/me', { user: null })
  api.json('/api/setup/status', { initialized: true, requiresSetup: false })
  api.json('/api/announcements/latest', { announcement: null })
  api.json('/api/config/features', { registrationEnabled: true })
  api.json('/api/events', { events: [] })
  api.json('/api/music', { songs: [] })
  api.json('/api/albums', { albums: [] })
  api.json('/api/galleries', { galleries: [] })
})
afterEach(async () => {
  cleanup()
  await api.close()
  vi.unstubAllGlobals()
  clearApiCache()
  resetAuthStateForTests()
})

function renderApp() {
  return render(
    <StrictMode>
      <ToastProvider>
        <DialogProvider>
          <App />
        </DialogProvider>
      </ToastProvider>
    </StrictMode>
  )
}

describe('安装检查不阻塞普通页面', () => {
  it('安装状态未返回时已显示导航、标题和首页内容', async () => {
    const gate = deferred<void>()
    api.handlers.set('/api/setup/status', async (_req, res) => {
      await gate.promise
      res.end(JSON.stringify({ initialized: true, requiresSetup: false }))
    })
    renderApp()
    expect(await screen.findByRole('navigation', { name: '主导航' })).toBeVisible()
    expect(await screen.findByRole('heading', { name: '黄诗扶', level: 1 })).toBeVisible()
    expect(await screen.findByText('暂无活动')).toBeVisible()
    await act(async () => {
      gate.resolve()
      await gate.promise
    })
  })

  it.each([false, true])('认证完成后根据实际用户决定是否跳转，已登录：%s', async (signedIn) => {
    const gate = deferred<void>()
    api.json('/api/setup/status', { initialized: false, requiresSetup: true })
    api.handlers.set('/api/auth/me', async (_req, res) => {
      await gate.promise
      res.end(
        JSON.stringify({
          user: signedIn
            ? {
                uid: 'user-1',
                publicId: '100001',
                displayName: '测试用户',
                role: 'user',
                status: 'active',
              }
            : null,
        })
      )
    })
    api.json('/api/users/me', { user: {} })
    api.json('/api/notifications', { notifications: [], unreadCount: 0 })
    renderApp()
    expect(await screen.findByRole('heading', { name: '黄诗扶', level: 1 })).toBeVisible()
    expect(window.location.pathname).toBe('/')
    await waitFor(() => expect(api.requests).toContain('/api/auth/me'))
    await act(async () => {
      gate.resolve()
      await gate.promise
    })
    if (signedIn) {
      expect(await screen.findByText('测试用户')).toBeVisible()
      expect(window.location.pathname).toBe('/')
    } else {
      expect(await screen.findByRole('heading', { name: '初始化超级管理员' })).toBeVisible()
      expect(window.location.pathname).toBe('/setup')
    }
  })

  it('安装完成后忽略尚未返回的旧安装状态', async () => {
    const gate = deferred<void>()
    api.handlers.set('/api/setup/status', async (_req, res) => {
      await gate.promise
      res.end(JSON.stringify({ initialized: false, requiresSetup: true }))
    })
    renderApp()
    await waitFor(() => expect(api.requests).toContain('/api/setup/status'))
    expect(await screen.findByRole('button', { name: '打开账户菜单' })).toBeEnabled()
    const pendingStatus = getSetupStatus()
    await act(async () => {
      window.dispatchEvent(new Event('hsf:setup-complete'))
      gate.resolve()
      await pendingStatus
    })
    expect(await screen.findByText('暂无活动')).toBeVisible()
    expect(window.location.pathname).toBe('/')
  })

  it('安装状态接口失败不触发初始化跳转', async () => {
    api.json('/api/setup/status', { error: '暂不可用' }, 503)
    renderApp()
    expect(await screen.findByText('暂无活动')).toBeVisible()
    expect(window.location.pathname).toBe('/')
    expect(screen.queryByRole('heading', { name: '初始化超级管理员' })).not.toBeInTheDocument()
  })
})
