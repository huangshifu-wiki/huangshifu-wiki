// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiGet } from '../../src/lib/apiClient'
import Forum from '../../src/pages/Forum'

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
}))
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ user: null, isBanned: false }),
}))
vi.mock('../../src/context/UserPreferencesContext', () => ({
  useUserPreferences: () => ({
    preferences: { listLoadMode: 'pagination' },
    getScopedViewMode: () => 'list',
    setScopedViewMode: vi.fn(),
  }),
}))
vi.mock('../../src/lib/i18n', () => ({
  useI18n: () => ({ t: (key: string) => (key === 'forum.emptyPosts' ? '暂无帖子' : key) }),
}))
vi.mock('../../src/components/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../../src/components/Dialog', () => ({ useDialog: () => ({ confirm: vi.fn() }) }))
vi.mock('../../src/hooks/useTagSuggestions', () => ({
  useTagSuggestions: () => ({ suggestions: [] }),
}))

const mockedApiGet = vi.mocked(apiGet)

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/forum']}>
      <Routes>
        <Route path="/forum/*" element={<Forum />} />
      </Routes>
    </MemoryRouter>
  )

describe('论坛列表统一加载状态', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('请求未完成时显示论坛骨架，空结果后显示空态', async () => {
    let resolveRequest!: (value: { posts: []; totalPages: number }) => void
    const request = new Promise<{ posts: []; totalPages: number }>((resolve) => {
      resolveRequest = resolve
    })
    mockedApiGet.mockImplementation((path: string) => {
      if (path === '/api/posts') return request as never
      if (path === '/api/sections') return Promise.resolve({ sections: [] }) as never
      return Promise.reject(new Error(`unexpected path: ${path}`)) as never
    })

    renderPage()

    expect(await screen.findByRole('status', { name: '加载中' })).toBeInTheDocument()
    expect(screen.queryByText('暂无帖子')).not.toBeInTheDocument()

    resolveRequest({ posts: [], totalPages: 1 })

    expect(await screen.findByText('暂无帖子')).toBeInTheDocument()
  })

  it('首次失败显示错误，重试后显示内容', async () => {
    let attempts = 0
    mockedApiGet.mockImplementation((path: string) => {
      if (path === '/api/sections') return Promise.resolve({ sections: [] }) as never
      if (path === '/api/posts') {
        attempts += 1
        return attempts === 1
          ? (Promise.reject(new Error('forum unavailable')) as never)
          : (Promise.resolve({
              posts: [{ id: 'post-1', title: '论坛帖子', section: 'all' }],
              totalPages: 1,
            }) as never)
      }
      return Promise.reject(new Error(`unexpected path: ${path}`)) as never
    })

    renderPage()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await screen.findByText('论坛帖子')
    expect(attempts).toBe(2)
  })
})
