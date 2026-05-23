// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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
const mockSetViewMode = vi.hoisted(() => vi.fn())
const mockShowToast = vi.hoisted(() => vi.fn())

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
  apiDelete: vi.fn(),
  apiPost: vi.fn(),
  apiUpload: vi.fn(),
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
      viewMode: 'medium',
    },
    setViewMode: mockSetViewMode,
  }),
}))

vi.mock('../../src/components/Toast', () => ({
  useToast: () => ({
    show: mockShowToast,
  }),
}))

const mockGalleries: GalleryItem[] = [
  {
    id: 'gallery-1',
    title: '测试图集一',
    description: '第一条图集描述',
    tags: ['现场'],
    images: [{ id: 'img-1', url: '/uploads/test-1.jpg', name: 'test-1.jpg' }],
    authorUid: 'user-1',
    createdAt: new Date('2024-01-01').toISOString(),
    updatedAt: new Date('2024-01-02').toISOString(),
  },
  {
    id: 'gallery-2',
    title: '测试图集二',
    description: '第二条图集描述',
    tags: ['写真'],
    images: [{ id: 'img-2', url: '/uploads/test-2.jpg', name: 'test-2.jpg' }],
    authorUid: 'user-2',
    createdAt: new Date('2024-02-01').toISOString(),
    updatedAt: new Date('2024-02-02').toISOString(),
  },
]

const renderWithRouter = () =>
  render(
    <MemoryRouter initialEntries={['/gallery']}>
      <GalleryList />
    </MemoryRouter>
  )

describe('GalleryList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
    mockApiGet.mockResolvedValue({
      galleries: mockGalleries,
      total: mockGalleries.length,
    })
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
        })
      )
    })

    expect(await screen.findByText('测试图集一')).toBeInTheDocument()
    expect(screen.getByText('测试图集二')).toBeInTheDocument()

    const gridContainer = Array.from(container.querySelectorAll<HTMLDivElement>('div')).find((element) => {
      const className = typeof element.className === 'string' ? element.className : ''
      const expectedClasses = ['grid', ...gridCols.split(' '), gap]

      return expectedClasses.every((expectedClass) => className.includes(expectedClass))
    })

    expect(gridContainer).toBeTruthy()
    expect(within(gridContainer as HTMLElement).getByText('测试图集一')).toBeInTheDocument()
    expect(within(gridContainer as HTMLElement).getByText('测试图集二')).toBeInTheDocument()

    const legacyVirtualScrollContainer = Array.from(
      container.querySelectorAll<HTMLDivElement>('div')
    ).find((element) => {
      const className = typeof element.className === 'string' ? element.className : ''
      const hasLegacyClasses = className.includes('overflow-y-auto')
      const hasLegacyInlineStyles = element.style.overflowY === 'auto' && element.style.maxHeight !== ''

      return hasLegacyClasses || hasLegacyInlineStyles
    })

    expect(legacyVirtualScrollContainer).toBeUndefined()
  })
})
