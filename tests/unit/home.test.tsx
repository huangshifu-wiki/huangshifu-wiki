// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { DefaultHome } from '../../src/pages/home/DefaultHome'
import type { AlbumItem, EventItem, GalleryItem, SongItem } from '../../src/types/entities'

const mockApiGet = vi.hoisted(() => vi.fn())
const mockPlayAlbumTracks = vi.hoisted(() => vi.fn())
const mockSmartImage = vi.hoisted(() => vi.fn())
const mockMusicState = vi.hoisted(() => ({
  currentSong: null as { docId?: string } | null,
  isPlaying: false,
}))

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
}))

vi.mock('../../src/context/MusicContext', () => ({
  useMusic: () => ({
    currentSong: mockMusicState.currentSong,
    isPlaying: mockMusicState.isPlaying,
    playAlbumTracks: mockPlayAlbumTracks,
  }),
}))

vi.mock('../../src/components/SmartImage', () => ({
  SmartImage: (props: { src?: string | null; alt?: string; className?: string }) => {
    mockSmartImage(props)
    return <img src={props.src || ''} alt={props.alt || ''} className={props.className} />
  },
}))

const mockGalleries: GalleryItem[] = [
  {
    id: 'gallery-1',
    title: '现场图集',
    description: '第一组现场影像',
    authorUid: 'user-1',
    authorName: '作者一',
    tags: ['现场'],
    locationCode: null,
    locationName: null,
    locationDetail: null,
    copyright: null,
    published: true,
    publishedAt: '2024-01-01T00:00:00.000Z',
    images: [
      {
        id: 'image-1',
        assetId: null,
        url: '/uploads/gallery-1.jpg',
        thumbnailUrl: '/uploads/gallery-1-thumb.webp',
        thumbnailStatus: 'completed',
        name: 'gallery-1.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
      },
    ],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'gallery-2',
    title: '舞台图集',
    description: '第二组现场影像',
    authorUid: 'user-2',
    authorName: '作者二',
    tags: ['舞台'],
    locationCode: null,
    locationName: null,
    locationDetail: null,
    copyright: null,
    published: true,
    publishedAt: '2024-01-02T00:00:00.000Z',
    images: [
      {
        id: 'image-2',
        assetId: null,
        url: '/uploads/gallery-2.jpg',
        thumbnailUrl: '/uploads/gallery-2-thumb.webp',
        thumbnailStatus: 'completed',
        name: 'gallery-2.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
      },
    ],
    createdAt: '2024-01-02T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  },
]

const mockSongs: SongItem[] = [
  {
    docId: 'song-1',
    title: '吹梦到西洲',
    artists: ['黄诗扶'],
    album: '人间不值得',
    cover: '/uploads/song-1.jpg',
    audioUrl: '',
    createdAt: '2024-02-01T00:00:00.000Z',
  },
  {
    docId: 'song-2',
    title: '九万字',
    artists: ['黄诗扶'],
    album: '九万字',
    cover: '/uploads/song-2.jpg',
    audioUrl: '',
    createdAt: '2024-02-02T00:00:00.000Z',
  },
]

const mockAlbums: AlbumItem[] = [
  {
    docId: 'album-1',
    title: '精选专辑',
    artist: '黄诗扶',
    cover: '/uploads/album-1.jpg',
    trackCount: 12,
  },
]

const mockEvents: EventItem[] = [
  {
    id: 'event-1',
    slug: 'event-1',
    title: '苏州园林采风',
    location: '苏州',
    content: '',
    timeSlots: [{ type: 'date', start: '2024-03-01' }],
    ticketPrices: [],
    saleTimes: [],
    lineup: [],
    tags: [],
    externalLinks: [],
    relatedLinks: [],
    sortStart: '2024-03-01',
    sortEnd: null,
    coverAssetId: null,
    coverUrl: '/uploads/event-1.jpg',
    coverName: 'event-1.jpg',
    createdByUid: 'user-1',
    createdByName: '作者一',
    updatedByUid: null,
    updatedByName: null,
    createdAt: '2024-03-01T00:00:00.000Z',
    updatedAt: '2024-03-01T00:00:00.000Z',
    posters: [],
  },
]

function mockSuccessfulHomeRequests() {
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/api/events') {
      return Promise.resolve({
        events: mockEvents,
        total: mockEvents.length,
        page: 1,
        limit: 4,
        totalPages: 1,
        hasMore: false,
      })
    }

    if (path === '/api/galleries') {
      return Promise.resolve({
        galleries: mockGalleries,
        total: mockGalleries.length,
        page: 1,
        limit: 5,
        hasMore: false,
      })
    }

    if (path === '/api/music') {
      return Promise.resolve({
        songs: mockSongs,
        total: mockSongs.length,
        page: 1,
        limit: 3,
        hasMore: false,
      })
    }

    if (path === '/api/albums') {
      return Promise.resolve({
        albums: mockAlbums,
        total: mockAlbums.length,
        page: 1,
        limit: 1,
        hasMore: false,
      })
    }

    return Promise.reject(new Error(`unexpected path: ${path}`))
  })
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <DefaultHome />
    </MemoryRouter>
  )
}

describe('DefaultHome', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMusicState.currentSong = null
    mockMusicState.isPlaying = false
    mockSuccessfulHomeRequests()
  })

  afterEach(() => {
    cleanup()
  })

  it('requests latest events, galleries, songs, and albums with home-sized limits', async () => {
    renderHome()

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledTimes(4)
    })

    expect(mockApiGet).toHaveBeenCalledWith('/api/events', {
      page: 1,
      limit: 4,
      sortOrder: 'desc',
    })
    expect(mockApiGet).toHaveBeenCalledWith('/api/galleries', { page: 1, limit: 5 })
    expect(mockApiGet).toHaveBeenCalledWith('/api/music', {
      page: 1,
      limit: 3,
      includeInstrumentals: false,
    })
    expect(mockApiGet).toHaveBeenCalledWith('/api/albums', { page: 1, limit: 1 })
  })

  it('renders live gallery, music, and album content without the old static stats', async () => {
    renderHome()

    expect(await screen.findByText('苏州园林采风')).toBeInTheDocument()
    expect(await screen.findByText('现场图集')).toBeInTheDocument()
    expect(screen.getByText('舞台图集')).toBeInTheDocument()
    expect(screen.getByText('吹梦到西洲')).toBeInTheDocument()
    expect(screen.getAllByText('九万字').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('精选专辑')).toBeInTheDocument()
    expect(screen.getByRole('contentinfo', { name: '首页底部' })).toHaveTextContent('黄诗扶 Wiki')
    expect(screen.getByText('全部活动').querySelector('span')).toHaveTextContent('→')
    expect(screen.queryByText('进入百科')).not.toBeInTheDocument()
    expect(screen.queryByText('1,240+')).not.toBeInTheDocument()
    expect(screen.queryByText('收录曲目')).not.toBeInTheDocument()
    expect(screen.queryByText(/毕业于英国布里斯托大学/)).not.toBeInTheDocument()
  })

  it('makes asynchronously loaded gallery reveal items visible without IntersectionObserver', async () => {
    renderHome()

    const gallery = await screen.findByText('现场图集')
    const galleryItem = gallery.closest('.home-gallery-item')
    expect(galleryItem).toHaveClass('is-visible')
  })

  it('plays the selected song through the global music context', async () => {
    const user = userEvent.setup()
    renderHome()

    const playSecondSong = await screen.findByRole('button', { name: '播放 九万字' })
    await user.click(playSecondSong)

    expect(mockPlayAlbumTracks).toHaveBeenCalledWith('home-latest', '首页新近曲目', mockSongs, 1)
  })

  it('keeps other sections visible when one section fails', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/api/events') {
        return Promise.resolve({
          events: mockEvents,
          total: mockEvents.length,
          page: 1,
          limit: 4,
          totalPages: 1,
          hasMore: false,
        })
      }

      if (path === '/api/galleries') {
        return Promise.reject(new Error('gallery failed'))
      }

      if (path === '/api/music') {
        return Promise.resolve({
          songs: mockSongs,
          total: mockSongs.length,
          page: 1,
          limit: 3,
          hasMore: false,
        })
      }

      if (path === '/api/albums') {
        return Promise.resolve({
          albums: mockAlbums,
          total: mockAlbums.length,
          page: 1,
          limit: 1,
          hasMore: false,
        })
      }

      return Promise.reject(new Error(`unexpected path: ${path}`))
    })

    renderHome()

    expect(await screen.findByText('图集暂时无法加载')).toBeInTheDocument()
    expect(screen.getByText('吹梦到西洲')).toBeInTheDocument()
    expect(screen.getByText('精选专辑')).toBeInTheDocument()
  })
})
