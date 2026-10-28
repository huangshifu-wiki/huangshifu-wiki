// @vitest-environment jsdom
import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'

import { apiGet, apiPatch } from '../../src/lib/apiClient'
import MusicDetail from '../../src/pages/MusicDetail'
import { useAuth } from '../../src/context/AuthContext'
import { DialogProvider } from '../../src/components/Dialog'

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  invalidateMusicApiCaches: vi.fn(),
}))

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: null, isAdmin: false })),
}))
vi.mock('../../src/hooks/useTagSuggestions', () => ({ useTagSuggestions: () => [] }))

vi.mock('../../src/context/MusicContext', () => ({
  useMusic: () => ({
    currentSong: null,
    currentTime: 0,
  }),
}))

vi.mock('../../src/components/Toast', () => ({
  useToast: () => ({ show: vi.fn() }),
}))

vi.mock('../../src/hooks/useToggleInteraction', () => ({
  useToggleInteraction: () => ({
    toggleFavorite: vi.fn(),
  }),
}))

vi.mock('../../src/lib/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../src/components/SmartBackLink', () => ({
  SmartBackLink: () => null,
}))

vi.mock('../../src/components/SmartImage', () => ({
  SmartImage: ({ fallback, className }: { fallback?: React.ReactNode; className?: string }) => (
    <div className={className}>{fallback}</div>
  ),
}))

vi.mock('../../src/components/CoverPlaceholder', () => ({
  CoverPlaceholder: ({ label }: { label?: string }) => <span>{label}</span>,
}))

vi.mock('../../src/components/Lightbox', () => ({
  Lightbox: () => null,
}))

vi.mock('../../src/components/LyricsDisplay', () => ({
  LyricsDisplay: () => null,
}))

vi.mock('../../src/components/MarkdownRenderer', () => ({
  default: () => null,
}))

const createSong = (
  sources = [
    {
      id: 'source-primary',
      platform: 'netease' as const,
      sourceId: '123',
      isPrimary: true,
    },
    {
      id: 'source-other-1',
      platform: 'tencent' as const,
      isPrimary: false,
      sourceId: '456',
    },
  ]
) => ({
  docId: 'song-1',
  slug: undefined as string | undefined,
  title: '测试歌曲',
  artists: ['歌手'],
  album: '测试专辑',
  cover: '',
  audioUrl: '',
  tags: [],
  sources,
})

const mockedApiGet = vi.mocked(apiGet)
const mockedUseAuth = vi.mocked(useAuth)
afterEach(() => mockedUseAuth.mockReturnValue({ user: null, isAdmin: false } as never))

const renderDetail = (song = createSong()) => {
  mockedApiGet.mockImplementation(async (path: string) => {
    if (path === '/api/music/song-1') return { song } as never
    if (path === '/api/music/song-1/posts') return { posts: [] } as never
    throw new Error(`unexpected apiGet path: ${path}`)
  })

  return render(
    <MemoryRouter initialEntries={['/music/song-1']}>
      <DialogProvider>
        <Routes>
          <Route path="/music/:songId" element={<MusicDetail />} />
        </Routes>
      </DialogProvider>
    </MemoryRouter>
  )
}

describe('MusicDetail 来源展示', () => {
  it('歌曲来源指向官方平台链接', async () => {
    renderDetail()
    expect(await screen.findByRole('heading', { name: '歌曲信息' })).toBeInTheDocument()
    expect(screen.getByText('netease / 123')).toHaveAttribute(
      'href',
      'https://music.163.com/song?id=123'
    )
  })

  it('没有来源时不渲染主来源和其他来源行', async () => {
    renderDetail(createSong([]))

    expect(await screen.findByRole('heading', { name: '歌曲信息' })).toBeInTheDocument()
    expect(screen.queryByText('主来源')).not.toBeInTheDocument()
    expect(screen.queryByText('其他来源')).not.toBeInTheDocument()
  })
})

describe('MusicDetail 异步加载', () => {
  it('切换歌曲后忽略前一首迟到的详情响应', async () => {
    let resolveOld!: (value: unknown) => void
    const oldRequest = new Promise<unknown>((resolve) => {
      resolveOld = resolve
    })
    mockedApiGet.mockImplementation(async (path: string) => {
      if (path === '/api/music/1') return oldRequest as never
      if (path === '/api/music/2')
        return {
          song: { ...createSong([]), docId: 'song-2', title: '新歌曲' },
        } as never
      if (path === '/api/music/song-2/posts') return { posts: [] } as never
      throw new Error(`unexpected apiGet path: ${path}`)
    })

    render(
      <MemoryRouter initialEntries={['/music/1']}>
        <DialogProvider>
          <Link to="/music/2">下一首</Link>
          <Routes>
            <Route path="/music/:songId" element={<MusicDetail />} />
          </Routes>
        </DialogProvider>
      </MemoryRouter>
    )
    await userEvent.setup().click(screen.getByRole('link', { name: '下一首' }))
    expect(await screen.findByRole('heading', { name: '新歌曲' })).toBeInTheDocument()
    await act(async () => {
      resolveOld({ song: { ...createSong([]), title: '旧歌曲' } })
    })
    expect(screen.getByRole('heading', { name: '新歌曲' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '旧歌曲' })).not.toBeInTheDocument()
  })
})

describe('MusicDetail 管理员编辑入口', () => {
  it('管理员在歌曲详情直接打开预填的编辑弹窗，普通用户不可见', async () => {
    mockedUseAuth.mockReturnValue({ user: null, isAdmin: true } as never)
    const view = renderDetail({ ...createSong([]), slug: '123' })
    const edit = await screen.findByRole('button', { name: '编辑' })
    await userEvent.setup().click(edit)
    expect(await screen.findByRole('dialog', { name: '编辑歌曲' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('歌曲名称')).toHaveValue('测试歌曲')
    await userEvent.setup().click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑歌曲' })).toBeNull())
    expect(screen.getByRole('heading', { name: '测试歌曲' })).toBeInTheDocument()
    view.unmount()

    mockedUseAuth.mockReturnValue({ user: null, isAdmin: false } as never)
    renderDetail({ ...createSong([]), slug: '123' })
    expect(await screen.findByRole('heading', { name: '测试歌曲' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
  })

  it('歌曲没有公开 slug 时仍能以 docId 就地编辑', async () => {
    mockedUseAuth.mockReturnValue({ user: null, isAdmin: true } as never)
    renderDetail(createSong([]))
    await userEvent.setup().click(await screen.findByRole('button', { name: '编辑' }))
    expect(await screen.findByRole('dialog', { name: '编辑歌曲' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('歌曲名称')).toHaveValue('测试歌曲')
  })
  it('歌曲保存后关闭弹窗并刷新当前详情', async () => {
    mockedUseAuth.mockReturnValue({ user: null, isAdmin: true } as never)
    renderDetail(createSong([]))
    await screen.findByRole('heading', { name: '测试歌曲' })
    let title = '测试歌曲'
    mockedApiGet.mockImplementation(async (path: string) => {
      if (path === '/api/music/song-1') return { song: { ...createSong([]), title } } as never
      if (path === '/api/music/song-1/posts') return { posts: [] } as never
      throw new Error(`unexpected apiGet path: ${path}`)
    })
    vi.mocked(apiPatch).mockImplementation(async (_path, payload) => {
      if (
        payload &&
        typeof payload === 'object' &&
        'title' in payload &&
        typeof payload.title === 'string'
      ) {
        title = payload.title
      }
      return {} as never
    })
    await userEvent.setup().click(screen.getByRole('button', { name: '编辑' }))
    await userEvent.setup().clear(await screen.findByPlaceholderText('歌曲名称'))
    await userEvent.setup().type(screen.getByPlaceholderText('歌曲名称'), '更新后的歌曲')
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '编辑歌曲' })).not.toBeInTheDocument()
    )
    expect(await screen.findByRole('heading', { name: '更新后的歌曲' })).toBeInTheDocument()
    expect(vi.mocked(apiPatch)).toHaveBeenCalledWith(
      '/api/music/song-1',
      expect.objectContaining({ title: '更新后的歌曲' })
    )
  })
})

describe('MusicDetail SEO 元数据', () => {
  const resetHead = () => {
    document.head.querySelectorAll('[data-hsf-seo]').forEach((el) => el.remove())
    document.title = ''
  }

  const getMeta = (key: string) =>
    document.querySelector<HTMLMetaElement>(`meta[data-hsf-seo="${key}"]`)

  const getCanonical = () =>
    document.querySelector<HTMLLinkElement>('link[data-hsf-seo="canonical"]')

  beforeEach(() => {
    resetHead()
    vi.clearAllMocks()
  })

  it('成功加载后输出 index、canonical 与 MusicRecording JSON-LD', async () => {
    mockedApiGet.mockImplementation(async (path: string) => {
      if (path === '/api/music/song-1')
        return {
          song: {
            ...createSong([]),
            cover: '/uploads/cover.png',
            album: '测试专辑',
            description: '**歌曲简介** 正文',
            releaseDate: '2023-05-01',
            durationMs: 225000,
          },
        } as never
      if (path === '/api/music/song-1/posts') return { posts: [] } as never
      throw new Error(`unexpected apiGet path: ${path}`)
    })

    render(
      <MemoryRouter initialEntries={['/music/song-1']}>
        <Routes>
          <Route path="/music/:songId" element={<MusicDetail />} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByRole('heading', { name: '歌曲信息' })).toBeInTheDocument()

    // title 由 useSeo 的 useEffect 异步写入，需要等待 effect flush
    await waitFor(() => expect(document.title).toBe('测试歌曲｜黄诗扶 Wiki'))
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'index,follow'
    )
    expect(getCanonical()?.getAttribute('href')).toBe('http://localhost:3000/music/song-1')
    expect(getMeta('og:type')?.getAttribute('content')).toBe('music.song')
    expect(getMeta('og:image')?.getAttribute('content')).toBe(
      'http://localhost:3000/uploads/cover.png'
    )

    const jsonLd = JSON.parse(
      document.querySelector('script[data-hsf-seo="jsonld"]')?.textContent ?? 'null'
    )
    expect(jsonLd).toMatchObject({
      '@type': 'MusicRecording',
      name: '测试歌曲',
      byArtist: '歌手',
      inAlbum: { '@type': 'MusicAlbum', name: '测试专辑' },
      datePublished: '2023-05-01',
      image: 'http://localhost:3000/uploads/cover.png',
      duration: 'PT3M45S',
    })
  })

  it('加载失败后输出 noindex,follow', async () => {
    mockedApiGet.mockRejectedValue(new Error('offline'))

    render(
      <MemoryRouter initialEntries={['/music/song-1']}>
        <Routes>
          <Route path="/music/:songId" element={<MusicDetail />} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await waitFor(() => expect(document.title).toBe('歌曲不存在｜黄诗扶 Wiki'))
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex,follow'
    )
    expect(getCanonical()?.getAttribute('href')).toBe('http://localhost:3000/music/song-1')
    expect(document.querySelector('script[data-hsf-seo="jsonld"]')).toBeNull()
  })
})
