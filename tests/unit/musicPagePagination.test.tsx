// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Music from '../../src/pages/Music'

const mockApiGet = vi.hoisted(() => vi.fn())
const mockSetPlaylist = vi.hoisted(() => vi.fn())

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
  apiDelete: vi.fn(),
  apiPost: vi.fn(),
}))

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}))

vi.mock('../../src/context/UserPreferencesContext', () => ({
  useUserPreferences: () => ({
    preferences: {
      listLoadMode: 'pagination',
    },
    getScopedViewMode: (scope: string) => (scope === 'music' ? 'list' : 'medium'),
    setScopedViewMode: vi.fn(),
  }),
}))

vi.mock('../../src/context/MusicContext', () => ({
  useMusic: () => ({
    currentSong: null,
    setCurrentSong: vi.fn(),
    setIsPlaying: vi.fn(),
    setPlaylist: mockSetPlaylist,
    playSongAtIndex: vi.fn(),
  }),
}))

vi.mock('../../src/components/PageSkeleton', () => ({
  PageSkeleton: () => <div>loading</div>,
}))

vi.mock('../../src/components/Music/SongCard', () => ({
  SongCard: ({ song, sequenceNumber }: { song: { title: string }; sequenceNumber?: number }) => (
    <div>
      <span data-testid="song-sequence">{sequenceNumber}</span>
      <span>{song.title}</span>
    </div>
  ),
}))

vi.mock('../../src/components/Music/AlbumCard', () => ({
  AlbumCard: ({ album }: { album: { title: string } }) => <div>{album.title}</div>,
}))

vi.mock('../../src/components/ViewModeSelector', () => ({
  ViewModeSelector: () => <div />,
}))

vi.mock('../../src/components/Toast', () => ({
  useToast: () => ({ show: vi.fn() }),
}))

vi.mock('../../src/lib/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'music.title': '音乐',
        'music.tabMusic': '音乐',
        'music.tabAlbums': '专辑',
        'music.unit.song': '首',
        'music.unit.album': '张',
        'music.showAccompaniments': '显示伴奏',
        'music.noMusic': '暂无音乐',
        'music.noAlbums': '暂无专辑',
        'music.sortOrder.asc': '升序',
        'music.sortOrder.desc': '降序',
      }
      return map[key] || key
    },
  }),
}))

const pageOneSong = {
  docId: 'song-1',
  title: '第一页歌曲',
  artists: ['黄诗扶'],
  album: '',
  cover: '',
  audioUrl: '',
  playable: false,
}

const renderMusic = (initialEntry = '/music') =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Music />
    </MemoryRouter>
  )

describe('Music page pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.scrollTo = vi.fn()
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/albums') {
        return Promise.resolve({
          albums: [],
          total: 123,
          page: 1,
          limit: 24,
          hasMore: true,
        })
      }
      return Promise.resolve({
        songs: [pageOneSong],
        total: 213,
        page: 1,
        limit: 50,
        hasMore: true,
      })
    })
  })

  it('uses API totals for counts instead of current page lengths', async () => {
    renderMusic()

    await screen.findByText('第一页歌曲')

    expect(screen.getByText('213 首')).toBeInTheDocument()
    expect(screen.getByText('213')).toBeInTheDocument()
    expect(screen.getByText('123')).toBeInTheDocument()
    expect(mockApiGet).toHaveBeenCalledWith('/api/music', {
      limit: 50,
      page: 1,
      includeInstrumentals: false,
      sortBy: 'releaseDate',
      sortOrder: 'desc',
    })
  })

  it('keeps the content column shrinkable so the stats sidebar stays in the grid', async () => {
    renderMusic()

    await screen.findByText('第一页歌曲')

    const layout = screen.getByText('统计').closest('.mobile-detail-grid')
    expect(layout).toHaveClass('mobile-detail-grid')
    expect(layout?.firstElementChild).toHaveClass('min-w-0')
  })

  it('requests the next server page when pagination changes', async () => {
    const user = userEvent.setup()
    renderMusic()

    await screen.findByText('第一页歌曲')
    await user.click(screen.getAllByLabelText('下一页')[0])

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/api/music', {
        limit: 50,
        page: 2,
        includeInstrumentals: false,
        sortBy: 'releaseDate',
        sortOrder: 'desc',
      })
    })
  })

  it('uses routed music pagination params on first load', async () => {
    renderMusic('/music?musicPage=3&musicPageSize=25')

    await screen.findByText('第一页歌曲')

    expect(mockApiGet).toHaveBeenCalledWith('/api/music', {
      limit: 25,
      page: 3,
      includeInstrumentals: false,
      sortBy: 'releaseDate',
      sortOrder: 'desc',
    })
  })

  it('uses routed album tab and album page params on first load', async () => {
    mockApiGet.mockImplementation((url: string, params?: { page?: number }) => {
      if (url === '/api/albums') {
        return Promise.resolve({
          albums: [
            { docId: `album-${params?.page ?? 1}`, title: `第 ${params?.page ?? 1} 页专辑` },
          ],
          total: 123,
          page: params?.page ?? 1,
          limit: 24,
          hasMore: true,
        })
      }
      return Promise.resolve({
        songs: [pageOneSong],
        total: 213,
        page: 1,
        limit: 50,
        hasMore: true,
      })
    })

    renderMusic('/music?tab=albums&albumPage=2')

    await screen.findByText('第 2 页专辑')

    expect(mockApiGet).toHaveBeenCalledWith('/api/albums', {
      limit: 24,
      page: 2,
    })
  })

  it('passes global sequence numbers across server pages', async () => {
    const user = userEvent.setup()
    mockApiGet.mockImplementation((url: string, params?: { page?: number }) => {
      if (url === '/api/albums') {
        return Promise.resolve({
          albums: [],
          total: 123,
          page: 1,
          limit: 24,
          hasMore: true,
        })
      }

      return Promise.resolve({
        songs: [
          {
            ...pageOneSong,
            docId: `song-${params?.page ?? 1}`,
            title: `第 ${params?.page ?? 1} 页歌曲`,
          },
        ],
        total: 213,
        page: params?.page ?? 1,
        limit: 50,
        hasMore: true,
      })
    })

    renderMusic()

    await screen.findByText('第 1 页歌曲')
    expect(screen.getByTestId('song-sequence')).toHaveTextContent('1')

    await user.click(screen.getAllByLabelText('下一页')[0])

    await screen.findByText('第 2 页歌曲')
    expect(screen.getByTestId('song-sequence')).toHaveTextContent('51')
  })
})
