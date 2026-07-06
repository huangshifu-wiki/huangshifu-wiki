// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { VIEW_MODE_CONFIG } from '../../src/lib/viewModes'
import GalleryList from '../../src/pages/Gallery'
import type { GalleryItem } from '../../src/types/entities'

class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const mockApiGet = vi.hoisted(() => vi.fn())
const mockInvalidateApiCacheByPrefix = vi.hoisted(() => vi.fn())
const mockShowToast = vi.hoisted(() => vi.fn())
const mockSmartImage = vi.hoisted(() => vi.fn())

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
  apiDelete: vi.fn(),
  apiPost: vi.fn(),
  apiUpload: vi.fn(),
  invalidateApiCacheByPrefix: mockInvalidateApiCacheByPrefix,
}))

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    isAdmin: false,
    isBanned: false,
  }),
}))

vi.mock('../../src/context/UserPreferencesContext', () => ({
  useUserPreferences: () => ({
    preferences: {
      listLoadMode: 'pagination',
    },
    getScopedViewMode: (scope: string) => (scope === 'gallery' ? 'medium' : 'list'),
    setScopedViewMode: vi.fn(),
  }),
}))

vi.mock('../../src/components/Toast', () => ({
  useToast: () => ({
    show: mockShowToast,
  }),
}))

vi.mock('../../src/components/SmartImage', () => ({
  SmartImage: (props: { src?: string; alt?: string; className?: string }) => {
    mockSmartImage(props)
    return <img src={props.src || ''} alt={props.alt || ''} className={props.className} />
  },
}))

const mockGalleries: GalleryItem[] = [
  {
    id: 'gallery-1',
    title: '测试图集一',
    description: '第一条图集描述',
    authorUid: 'user-1',
    authorName: '作者一',
    tags: ['现场'],
    locationCode: null,
    locationName: null,
    locationDetail: null,
    copyright: null,
    published: true,
    publishedAt: new Date('2024-01-01').toISOString(),
    images: [
      {
        id: 'img-1',
        assetId: null,
        url: '/uploads/test-1.jpg',
        thumbnailUrl: '/uploads/variants/img-1/1080h.webp',
        thumbnailStatus: 'completed',
        name: 'test-1.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
      },
    ],
    createdAt: new Date('2024-01-01').toISOString(),
    updatedAt: new Date('2024-01-02').toISOString(),
  },
  {
    id: 'gallery-2',
    title: '测试图集二',
    description: '第二条图集描述',
    authorUid: 'user-2',
    authorName: '作者二',
    tags: ['写真'],
    locationCode: null,
    locationName: null,
    locationDetail: null,
    copyright: null,
    published: false,
    publishedAt: null,
    images: [
      {
        id: 'img-2',
        assetId: null,
        url: '/uploads/test-2.jpg',
        thumbnailUrl: '/uploads/variants/img-2/1080h.webp',
        thumbnailStatus: 'completed',
        name: 'test-2.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
      },
    ],
    createdAt: new Date('2024-02-01').toISOString(),
    updatedAt: new Date('2024-02-02').toISOString(),
  },
]

const renderWithRouter = (initialEntry = '/gallery') =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <GalleryList />
    </MemoryRouter>
  )

describe('GalleryList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
    mockApiGet.mockResolvedValue({
      galleries: mockGalleries,
      total: mockGalleries.length,
      page: 1,
      limit: 24,
      hasMore: false,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders gallery cards in a normal grid layout without the legacy virtual scroll container', async () => {
    const { container } = renderWithRouter()
    const { gridCols, gap } = VIEW_MODE_CONFIG.medium

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith(
        '/api/galleries',
        expect.objectContaining({
          page: 1,
          limit: 24,
        }),
        undefined,
        undefined
      )
    })

    expect(await screen.findByText('测试图集一')).toBeInTheDocument()
    expect(screen.getByText('测试图集二')).toBeInTheDocument()

    const gridContainer = Array.from(container.querySelectorAll<HTMLDivElement>('div')).find(
      (element) => {
        const className = typeof element.className === 'string' ? element.className : ''
        const expectedClasses = ['grid', ...gridCols.split(' '), gap]

        return expectedClasses.every((expectedClass) => className.includes(expectedClass))
      }
    )

    expect(gridContainer).toBeTruthy()
    expect(within(gridContainer as HTMLElement).getByText('测试图集一')).toBeInTheDocument()
    expect(within(gridContainer as HTMLElement).getByText('测试图集二')).toBeInTheDocument()

    const legacyVirtualScrollContainer = Array.from(
      container.querySelectorAll<HTMLDivElement>('div')
    ).find((element) => {
      const className = typeof element.className === 'string' ? element.className : ''
      const hasLegacyClasses = className.includes('overflow-y-auto')
      const hasLegacyInlineStyles =
        element.style.overflowY === 'auto' && element.style.maxHeight !== ''

      return hasLegacyClasses || hasLegacyInlineStyles
    })

    expect(legacyVirtualScrollContainer).toBeUndefined()
  })

  it('uses routed page and page size params on first load', async () => {
    renderWithRouter('/gallery?page=2&pageSize=48')

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith(
        '/api/galleries',
        expect.objectContaining({
          page: 2,
          limit: 48,
        }),
        undefined,
        undefined
      )
    })
  })

  it('waits for pending thumbnails without using the original image as the cover', async () => {
    vi.useFakeTimers()

    const pendingGallery: GalleryItem = {
      ...mockGalleries[0],
      id: 'gallery-pending',
      title: '等待缩略图图集',
      images: [
        {
          id: 'img-pending',
          assetId: null,
          url: '',
          originalUrl: '/uploads/original-pending.jpg',
          thumbnailUrl: null,
          thumbnailStatus: 'processing',
          name: 'original-pending.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 2048,
        },
      ],
    }
    const completedGallery: GalleryItem = {
      ...pendingGallery,
      images: [
        {
          ...pendingGallery.images[0],
          thumbnailUrl: '/uploads/variants/img-pending/1080h.webp',
          thumbnailStatus: 'completed',
        },
      ],
    }

    let galleryFetchCount = 0
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/api/config/gallery-access') {
        return Promise.resolve({ adminOnly: false })
      }

      galleryFetchCount += 1
      return Promise.resolve({
        galleries: galleryFetchCount === 1 ? [pendingGallery] : [completedGallery],
        total: 1,
        page: 1,
        limit: 24,
        hasMore: false,
      })
    })

    renderWithRouter()

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText('等待缩略图图集')).toBeInTheDocument()
    expect(screen.getByText('生成中...')).toBeInTheDocument()
    expect(screen.queryByText('无图片')).not.toBeInTheDocument()
    expect(mockSmartImage).not.toHaveBeenCalledWith(
      expect.objectContaining({ src: '/uploads/original-pending.jpg' })
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockSmartImage).toHaveBeenCalledWith(
      expect.objectContaining({ src: '/uploads/variants/img-pending/1080h.webp' })
    )
    expect(mockInvalidateApiCacheByPrefix).toHaveBeenCalledWith('/api/galleries')
    expect(screen.queryByText('生成中...')).not.toBeInTheDocument()
  })

  it('keeps current galleries when thumbnail polling fails', async () => {
    vi.useFakeTimers()

    const pendingGallery: GalleryItem = {
      ...mockGalleries[0],
      id: 'gallery-pending-error',
      title: '轮询失败保留图集',
      images: [
        {
          id: 'img-pending-error',
          assetId: null,
          url: '',
          originalUrl: '/uploads/original-error.jpg',
          thumbnailUrl: null,
          thumbnailStatus: 'processing',
          name: 'original-error.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 2048,
        },
      ],
    }

    let galleryFetchCount = 0
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/api/config/gallery-access') {
        return Promise.resolve({ adminOnly: false })
      }

      galleryFetchCount += 1
      if (galleryFetchCount === 1) {
        return Promise.resolve({
          galleries: [pendingGallery],
          total: 1,
          page: 1,
          limit: 24,
          hasMore: false,
        })
      }

      return Promise.reject(new Error('temporary gallery fetch failure'))
    })

    renderWithRouter()

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText('轮询失败保留图集')).toBeInTheDocument()
    expect(screen.getByText('生成中...')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText('轮询失败保留图集')).toBeInTheDocument()
    expect(screen.getByText('生成中...')).toBeInTheDocument()
    expect(mockInvalidateApiCacheByPrefix).not.toHaveBeenCalled()
  })
})
