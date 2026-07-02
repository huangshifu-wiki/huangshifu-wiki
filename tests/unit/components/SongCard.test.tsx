// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { SongCard } from '../../../src/components/Music/SongCard'

// Mock IntersectionObserver (jsdom 环境不支持)
const MockIntersectionObserver = class IntersectionObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

beforeAll(() => {
  global.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver
})

afterAll(() => {
  delete (global as any).IntersectionObserver
})

afterEach(() => {
  cleanup()
})

vi.mock('../../../src/components/SmartImage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/components/SmartImage')>()
  return {
    ...actual,
    default: function MockSmartImage({ alt }: { alt?: string }) {
      return <div data-testid="smart-image" aria-label={alt} />
    },
  }
})

vi.mock('../../../src/lib/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'music.play': '播放',
        'music.favorite': '收藏',
        'music.select': '选择',
        'music.selected': '已选',
        'music.openOriginalLink': '打开原链接',
        'music.copyInternalLink': '复制内链',
        'music.viewPosts': '查看帖子',
        'music.deleteSong': '删除',
      }
      return map[key] || key
    },
  }),
}))

const mockSong = {
  docId: 'song-001',
  title: '测试歌曲名',
  artists: ['测试歌手'],
  album: '测试专辑',
  cover: '',
  audioUrl: '',
  sources: [
    {
      id: 'source-001',
      resourceType: 'song' as const,
      platform: 'netease' as const,
      sourceId: '12345',
      isPrimary: true,
    },
  ],
  favoritedByMe: false,
}

const defaultProps = {
  song: mockSong,
  isCurrentSong: false,
  isFavoriting: false,
  onPlay: vi.fn(),
  onToggleFavorite: vi.fn(),
}

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('SongCard', () => {
  it('renders song title', () => {
    renderWithRouter(<SongCard {...defaultProps} />)
    expect(screen.getByText('测试歌曲名')).toBeInTheDocument()
  })

  it('renders artist and album in subtitle', () => {
    const { container } = renderWithRouter(<SongCard {...defaultProps} />)
    // 歌手和专辑在同一<p>标签内，使用 container 查询验证文本存在
    const html = container.innerHTML
    expect(html).toContain('测试歌手')
    expect(html).toContain('测试专辑')
    expect(container.querySelectorAll('.bg-border.rounded-full')).toHaveLength(1)
  })

  it('hides album and its separator when display album is disabled', () => {
    const { container } = renderWithRouter(
      <SongCard
        {...defaultProps}
        song={{
          ...mockSong,
          displayAlbum: {
            mode: 'none',
            albumDocId: null,
            title: '',
          },
        }}
      />
    )

    expect(screen.getByText('测试歌手')).toBeInTheDocument()
    expect(screen.queryByText('测试专辑')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.bg-border.rounded-full')).toHaveLength(0)
  })

  it('keeps release date separated when album is hidden', () => {
    const { container } = renderWithRouter(
      <SongCard
        {...defaultProps}
        song={{
          ...mockSong,
          releaseDate: '2024-01-02',
          displayAlbum: {
            mode: 'none',
            albumDocId: null,
            title: '',
          },
        }}
      />
    )

    expect(screen.getByText('测试歌手')).toBeInTheDocument()
    expect(screen.getByText('发行日期：2024-01-02')).toBeInTheDocument()
    expect(screen.queryByText('测试专辑')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.bg-border.rounded-full')).toHaveLength(1)
  })

  it('has button role with correct aria-label', () => {
    const { container } = renderWithRouter(<SongCard {...defaultProps} />)
    const button = container.querySelector('[role="button"]')
    expect(button).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-label', '测试歌曲名 - 测试歌手')
  })

  it('renders sequence number in list layout', () => {
    renderWithRouter(<SongCard {...defaultProps} sequenceNumber={51} />)

    expect(screen.getByText('51')).toBeInTheDocument()
  })

  it('shows cover play button with correct aria-label', () => {
    renderWithRouter(<SongCard {...defaultProps} />)
    const playButtons = screen.getAllByLabelText(/播放/)
    expect(playButtons.length).toBeGreaterThanOrEqual(1)
    expect(playButtons[0]).toHaveAttribute('aria-label', '播放 测试歌曲名')
  })

  it('calls onPlay when cover play button clicked', async () => {
    const user = userEvent.setup()
    renderWithRouter(<SongCard {...defaultProps} />)
    const playButtons = screen.getAllByLabelText(/播放/)
    await user.click(playButtons[0])
    expect(defaultProps.onPlay).toHaveBeenCalledWith(mockSong)
  })

  it('keeps only favorite as the card action button', () => {
    renderWithRouter(<SongCard {...defaultProps} />)

    expect(screen.getAllByLabelText(/收藏/).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByLabelText(/打开原链接/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/复制内链/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/查看帖子/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/删除/)).not.toBeInTheDocument()
  })

  it('highlights current song with themed background class', () => {
    const { container } = renderWithRouter(<SongCard {...defaultProps} isCurrentSong={true} />)
    const row = container.firstElementChild
    expect(row?.className).toContain('bg-brand-gold/10')
  })

  it('renders grid card layout when viewMode is not list', () => {
    const { container } = renderWithRouter(<SongCard {...defaultProps} viewMode="medium" />)
    const card = container.firstElementChild

    expect(card?.className).toContain('rounded')
    expect(container.querySelector('.aspect-square')).toBeInTheDocument()
  })

  it('does not render sequence number in grid layout', () => {
    renderWithRouter(<SongCard {...defaultProps} sequenceNumber={51} viewMode="medium" />)

    expect(screen.queryByText('51')).not.toBeInTheDocument()
  })

  it('keeps compact grid cards from rendering album metadata', () => {
    renderWithRouter(<SongCard {...defaultProps} viewMode="small" />)

    expect(screen.queryByText('测试专辑')).not.toBeInTheDocument()
    expect(screen.getByText('测试歌手')).toBeInTheDocument()
  })

  it('does not render an empty album row in grid layout', () => {
    renderWithRouter(
      <SongCard
        {...defaultProps}
        viewMode="medium"
        song={{
          ...mockSong,
          album: '',
          displayAlbum: {
            mode: 'manual',
            albumDocId: null,
            title: '',
          },
        }}
      />
    )

    expect(screen.queryByText('测试专辑')).not.toBeInTheDocument()
    expect(screen.getByText('测试歌手')).toBeInTheDocument()
  })
})
