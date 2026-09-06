// @vitest-environment jsdom
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiGet } from '../../src/lib/apiClient'
import MusicDetail from '../../src/pages/MusicDetail'

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
}))

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}))

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

const longSourceId = 'S'.repeat(100)
const otherSourceId = 'T'.repeat(96)
const longArtist = 'Artist'.repeat(24)
const longAlbum = 'Album'.repeat(24)
const longTag = 'tag'.repeat(32)

const createSong = (
  sources = [
    {
      id: 'source-primary',
      platform: 'netease' as const,
      sourceId: longSourceId,
      isPrimary: true,
    },
    {
      id: 'source-other-1',
      platform: 'tencent' as const,
      isPrimary: false,
      sourceId: otherSourceId,
    },
  ]
) => ({
  docId: 'song-1',
  title: '测试歌曲',
  artists: [longArtist],
  album: longAlbum,
  cover: '',
  tags: [longTag],
  sources,
})

const mockedApiGet = vi.mocked(apiGet)

const renderDetail = (song = createSong()) => {
  mockedApiGet.mockImplementation(async (path: string) => {
    if (path === '/api/music/song-1') return { song } as never
    if (path === '/api/music/song-1/posts') return { posts: [] } as never
    throw new Error(`unexpected apiGet path: ${path}`)
  })

  return render(
    <MemoryRouter initialEntries={['/music/song-1']}>
      <Routes>
        <Route path="/music/:songId" element={<MusicDetail />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('MusicDetail 来源面板布局契约', () => {
  it('限制长来源和歌曲信息值的 flex 宽度，同时保留官方来源链接', async () => {
    renderDetail()

    expect(await screen.findByRole('heading', { name: '歌曲信息' })).toBeInTheDocument()

    const primaryLink = screen.getByText(`netease / ${longSourceId}`)
    expect(primaryLink).toHaveClass('flex-1', 'min-w-0', 'max-w-full', 'text-wrap-anywhere')
    expect(primaryLink).toHaveAttribute('href', `https://music.163.com/song?id=${longSourceId}`)

    const otherSource = screen.getByText(`tencent / ${otherSourceId}`)
    expect(otherSource).toHaveClass('flex-1', 'min-w-0', 'max-w-full', 'text-wrap-anywhere')

    const songInfoHeading = screen.getByRole('heading', { name: '歌曲信息' })
    const aside = songInfoHeading.closest('aside')
    expect(aside).toHaveClass('mobile-detail-aside')
    expect(aside?.querySelector('.flex.min-w-0.max-w-full.flex-1.flex-col')).toBeTruthy()

    expect(screen.getByText(longTag)).toHaveClass('min-w-0', 'max-w-full', 'text-wrap-anywhere')
  })

  it('没有来源时不渲染主来源和其他来源行', async () => {
    renderDetail(createSong([]))

    expect(await screen.findByRole('heading', { name: '歌曲信息' })).toBeInTheDocument()
    expect(screen.queryByText('主来源')).not.toBeInTheDocument()
    expect(screen.queryByText('其他来源')).not.toBeInTheDocument()
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
      byArtist: longArtist,
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
