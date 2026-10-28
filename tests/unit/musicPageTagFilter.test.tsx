// @vitest-environment jsdom
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useNavigate, useSearchParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deferred } from '../setup/deferred'

import { ToastProvider } from '../../src/components/Toast'
import { AuthProvider } from '../../src/context/AuthContext'
import { MusicProvider } from '../../src/context/MusicContext'
import { apiGet } from '../../src/lib/apiClient'
import Music from '../../src/pages/Music'

const loadMode = vi.hoisted(() => ({ value: 'pagination' as 'pagination' | 'incremental' }))
vi.mock('../../src/context/UserPreferencesContext', () => ({
  UserPreferencesProvider: ({ children }: { children: React.ReactNode }) => children,
  useUserPreferences: () => ({
    preferences: { listLoadMode: loadMode.value, showMobileSongSequence: false },
    getScopedViewMode: () => 'list',
    setScopedViewMode: vi.fn(),
  }),
}))
vi.mock('../../src/components/SmartImage', () => ({ SmartImage: () => null }))

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
}))

vi.mock('../../src/lib/auth', () => ({
  auth: {},
  onAuthStateChanged: vi.fn(),
  refreshAuthState: vi.fn(),
}))

const UrlProbe = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  return (
    <>
      <button onClick={() => navigate(-1)}>后退</button>
      <span data-testid="music-page">{searchParams.get('musicPage') || ''}</span>
      <span data-testid="url">{searchParams.get('tag') || ''}</span>
      <span data-testid="album-url">{searchParams.get('albumTag') || ''}</span>
      <span data-testid="album-page">{searchParams.get('albumPage') || ''}</span>
    </>
  )
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
    loadMode.value = 'pagination'
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === '/api/music/tags') return { tags: ['古风', '现场'] }
      if (path === '/api/albums/tags') return { tags: ['专辑古风', '专辑现场'] }
      if (path === '/api/albums')
        return { albums: [], total: 0, page: 1, limit: 24, hasMore: false }
      if (path === '/api/music') return { songs: [], total: 0, page: 1, limit: 50, hasMore: false }
      return Promise.reject(new Error(`unexpected apiGet: ${path}`))
    })
  })

  it.each([
    { tab: 'music', path: '/api/music', pageKey: 'musicPage', tag: '古风', total: 100 },
    { tab: 'albums', path: '/api/albums', pageKey: 'albumPage', tag: '专辑古风', total: 48 },
  ])(
    '$tab 筛选后后退保持第 2 页，直到原范围结果返回',
    async ({ tab, path, pageKey, tag, total }) => {
      const { promise: delayed, resolve: resolveReturn } = deferred<unknown>()
      let unfilteredRequests = 0
      vi.mocked(apiGet).mockImplementation((requestPath: string, params) => {
        if (requestPath === '/api/music/tags') return Promise.resolve({ tags: ['古风'] }) as never
        if (requestPath === '/api/albums/tags')
          return Promise.resolve({ tags: ['专辑古风'] }) as never
        if (requestPath === path) {
          const key = tab === 'music' ? 'songs' : 'albums'
          if (params?.tag) return Promise.resolve({ [key]: [], total: 1 }) as never
          unfilteredRequests++
          if (unfilteredRequests > 1) return delayed as never
          return Promise.resolve({ [key]: [], total }) as never
        }
        return Promise.resolve(
          requestPath === '/api/music' ? { songs: [], total: 0 } : { albums: [], total: 0 }
        ) as never
      })
      renderPage(`/music?tab=${tab}&${pageKey}=2`)
      await screen.findByRole('button', { name: tag })
      await waitFor(() => expect(unfilteredRequests).toBe(1))
      fireEvent.click(screen.getByRole('button', { name: tag }))
      await waitFor(() =>
        expect(screen.getByTestId(tab === 'music' ? 'url' : 'album-url')).toHaveTextContent(tag)
      )
      await waitFor(() =>
        expect(
          vi.mocked(apiGet).mock.calls.some(([p, params]) => p === path && params?.tag === tag)
        ).toBe(true)
      )
      fireEvent.click(screen.getByRole('button', { name: '后退' }))
      await waitFor(() => expect(unfilteredRequests).toBe(2))
      const pageProbe = screen.getByTestId(tab === 'music' ? 'music-page' : 'album-page')
      expect(pageProbe).toHaveTextContent('2')
      expect(
        vi
          .mocked(apiGet)
          .mock.calls.filter(([p]) => p === path)
          .at(-1)?.[1]?.page
      ).toBe(2)
      await act(async () =>
        resolveReturn({
          [tab === 'music' ? 'songs' : 'albums']:
            tab === 'albums'
              ? [{ docId: 'album-2', title: '第二页专辑', artist: '歌手', cover: '' }]
              : [],
          total,
        })
      )
      if (tab === 'albums') expect(await screen.findByText('第二页专辑')).toBeInTheDocument()
      expect(pageProbe).toHaveTextContent('2')
    }
  )

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

  it('专辑标签独立筛选并重置专辑页', async () => {
    renderPage('/music?tab=albums&tag=古风&albumPage=2')
    fireEvent.click(await screen.findByRole('button', { name: '专辑古风' }))
    expect(screen.getByTestId('url')).toHaveTextContent('古风')
    expect(screen.getByTestId('album-url')).toHaveTextContent('专辑古风')
    expect(screen.getByTestId('album-page')).toHaveTextContent('')
    await waitFor(() =>
      expect(
        vi
          .mocked(apiGet)
          .mock.calls.some(
            ([path, params]) =>
              path === '/api/albums' && params?.tag === '专辑古风' && params.page === 1
          )
      ).toBe(true)
    )
  })

  it('没有标签建议时仍可清除专辑筛选', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === '/api/albums/tags') return { tags: [] }
      if (path === '/api/music/tags') return { tags: [] }
      if (path === '/api/music') return { songs: [], total: 0 }
      if (path === '/api/albums') return { albums: [], total: 0 }
      throw new Error(`unexpected apiGet: ${path}`)
    })
    renderPage('/music?tab=albums&albumTag=已删除标签')
    fireEvent.click(await screen.findByRole('button', { name: '全部' }))
    expect(screen.getByTestId('album-url')).toBeEmptyDOMElement()
  })

  it('增量模式切换专辑标签时替换旧结果', async () => {
    loadMode.value = 'incremental'
    vi.mocked(apiGet).mockImplementation(async (path: string, params) => {
      if (path === '/api/music/tags') return { tags: ['古风'] }
      if (path === '/api/albums/tags') return { tags: ['专辑古风', '专辑现场'] }
      if (path === '/api/music') return { songs: [], total: 0 }
      if (path === '/api/albums') {
        const title = params?.tag === '专辑现场' ? '现场专辑' : '古风专辑'
        return { albums: [{ docId: title, title, artist: '歌手', cover: '' }], total: 1 }
      }
      throw new Error(`unexpected apiGet: ${path}`)
    })
    renderPage('/music?tab=albums&albumTag=专辑古风')
    expect(await screen.findByText('古风专辑')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '专辑现场' }))
    expect(await screen.findByText('现场专辑')).toBeInTheDocument()
    expect(screen.queryByText('古风专辑')).not.toBeInTheDocument()
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
