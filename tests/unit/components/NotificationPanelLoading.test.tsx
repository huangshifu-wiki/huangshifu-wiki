// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NotificationPanel } from '../../../src/components/Navbar/NotificationPanel'
import { apiGet } from '../../../src/lib/apiClient'

const mockUser = vi.hoisted(() => ({ uid: 'user-1' }))

vi.mock('../../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}))

vi.mock('../../../src/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}))

const mockedApiGet = vi.mocked(apiGet)

type NotificationResponse = {
  notifications: []
  unreadCount: number
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const renderPanel = () => render(<NotificationPanel onNavigate={vi.fn()} />)

const openPanel = () => {
  fireEvent.click(screen.getByRole('button', { name: '通知' }))
}

describe('通知面板加载状态', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('通知请求未完成时显示局部加载状态，不显示成功空态；空结果返回后才显示空态', async () => {
    const request = deferred<NotificationResponse>()
    mockedApiGet.mockImplementation((path: string) => {
      if (path === '/api/notifications') return request.promise as never
      return Promise.reject(new Error(`unexpected apiGet path: ${path}`)) as never
    })

    renderPanel()
    openPanel()

    expect(await screen.findByText('通知加载中')).toBeInTheDocument()
    expect(screen.queryByText('暂无通知')).not.toBeInTheDocument()

    request.resolve({ notifications: [], unreadCount: 0 })

    expect(await screen.findByText('暂无通知')).toBeInTheDocument()
  })

  it('通知请求失败显示错误和重试入口，不伪装成成功空态', async () => {
    let attempts = 0
    mockedApiGet.mockImplementation((path: string) => {
      if (path === '/api/notifications') {
        attempts += 1
        return attempts === 1
          ? (Promise.reject(new Error('notifications unavailable')) as never)
          : (Promise.resolve({ notifications: [], unreadCount: 0 }) as never)
      }
      return Promise.reject(new Error(`unexpected apiGet path: ${path}`)) as never
    })

    renderPanel()
    openPanel()

    expect(await screen.findByRole('alert')).toHaveTextContent('通知暂时无法加载。')
    expect(screen.queryByText('暂无通知')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))

    expect(await screen.findByText('暂无通知')).toBeInTheDocument()
    expect(attempts).toBe(2)
  })
})
