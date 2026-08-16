// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiGet } from '../../src/lib/apiClient'
import WikiList from '../../src/pages/wiki/WikiList'

vi.mock('../../src/lib/apiClient', () => ({ apiGet: vi.fn() }))
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
vi.mock('../../src/hooks/useWikiCategories', () => ({
  useWikiCategories: () => ({ categories: [], getCategoryLabel: (value: string) => value }),
}))

const mockedApiGet = vi.mocked(apiGet)

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/wiki']}>
      <WikiList />
    </MemoryRouter>
  )

describe('百科列表统一加载状态', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('请求未完成时显示百科骨架，空结果后显示空态', async () => {
    let resolveRequest!: (value: { pages: []; total: number }) => void
    const request = new Promise<{ pages: []; total: number }>((resolve) => {
      resolveRequest = resolve
    })
    mockedApiGet.mockReturnValue(request as never)

    renderPage()

    expect(await screen.findByRole('status', { name: '加载中' })).toBeInTheDocument()
    expect(screen.queryByText('暂无相关百科页面')).not.toBeInTheDocument()

    resolveRequest({ pages: [], total: 0 })

    expect(await screen.findByText('暂无相关百科页面')).toBeInTheDocument()
  })

  it('首次失败显示错误，重试后显示内容', async () => {
    let attempts = 0
    mockedApiGet.mockImplementation(() => {
      attempts += 1
      return attempts === 1
        ? (Promise.reject(new Error('wiki unavailable')) as never)
        : (Promise.resolve({
            pages: [{ id: 'page-1', title: '百科页面', category: 'general' }],
            total: 1,
          }) as never)
    })

    renderPage()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await screen.findByText('百科页面')
    expect(attempts).toBe(2)
  })
})
