// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '../../src/components/Toast'
import { AuthProvider } from '../../src/context/AuthContext'
import { MusicProvider } from '../../src/context/MusicContext'
import { apiGet } from '../../src/lib/apiClient'
import Music from '../../src/pages/Music'

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
}))

vi.mock('../../src/lib/auth', () => ({
  auth: {},
  onAuthStateChanged: vi.fn(),
  refreshAuthState: vi.fn(),
}))

const UrlProbe = () => {
  const [searchParams] = useSearchParams()
  return <span data-testid="url">{searchParams.get('tag') || ''}</span>
}

const renderPage = (entry = '/music') =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider>
        <MusicProvider>
          <ToastProvider>
            <Music />
            <UrlProbe />
          </ToastProvider>
        </MusicProvider>
      </AuthProvider>
    </MemoryRouter>
  )

describe('音乐列表页标签按钮', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === '/api/music/tags') return { tags: ['古风', '现场'] }
      if (path === '/api/music') return { songs: [], total: 0, page: 1, limit: 50, hasMore: false }
      return Promise.reject(new Error(`unexpected apiGet: ${path}`))
    })
  })

  it('点击标签后 URL 保留 tag 参数并携带 tag 重新请求列表', async () => {
    renderPage()
    const tagButton = await screen.findByRole('button', { name: '古风' })
    fireEvent.click(tagButton)

    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('古风'))
    await waitFor(() => {
      expect(
        vi
          .mocked(apiGet)
          .mock.calls.some(([path, params]) => path === '/api/music' && params?.tag === '古风')
      ).toBe(true)
    })
  })

  it('专辑请求未完成时显示整页音乐骨架；空结果返回后才显示空态', async () => {
    let resolveAlbums!: (value: { albums: []; total: number }) => void
    const albumRequest = new Promise<{ albums: []; total: number }>((resolve) => {
      resolveAlbums = resolve
    })
    vi.mocked(apiGet).mockImplementation((path: string) => {
      if (path === '/api/music/tags') return Promise.resolve({ tags: [] }) as never
      if (path === '/api/music') return Promise.resolve({ songs: [], total: 0 }) as never
      if (path === '/api/albums') return albumRequest as never
      return Promise.reject(new Error(`unexpected apiGet: ${path}`)) as never
    })

    renderPage('/music?tab=albums')

    expect(await screen.findByRole('status', { name: '加载中' })).toBeInTheDocument()
    expect(screen.queryByText('暂无专辑，快去创建吧')).not.toBeInTheDocument()

    resolveAlbums({ albums: [], total: 0 })

    expect(await screen.findByText('暂无专辑，快去创建吧')).toBeInTheDocument()
  })

  it('专辑请求失败显示错误和重试入口，不伪装成成功空态', async () => {
    let attempts = 0
    vi.mocked(apiGet).mockImplementation((path: string) => {
      if (path === '/api/music/tags') return Promise.resolve({ tags: [] }) as never
      if (path === '/api/music') return Promise.resolve({ songs: [], total: 0 }) as never
      if (path === '/api/albums') {
        attempts += 1
        return attempts === 1
          ? (Promise.reject(new Error('albums unavailable')) as never)
          : (Promise.resolve({ albums: [], total: 0 }) as never)
      }
      return Promise.reject(new Error(`unexpected apiGet: ${path}`)) as never
    })

    renderPage('/music?tab=albums')

    expect(await screen.findByRole('alert')).toHaveTextContent('加载失败')
    expect(screen.queryByText('暂无专辑，快去创建吧')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))

    expect(await screen.findByText('暂无专辑，快去创建吧')).toBeInTheDocument()
    expect(attempts).toBe(2)
  })
})
