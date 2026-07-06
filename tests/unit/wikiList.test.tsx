// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { VIEW_MODE_CONFIG } from '../../src/lib/viewModes'
import WikiList from '../../src/pages/wiki/WikiList'
import { DEFAULT_PAGE_SIZE, type WikiItem } from '../../src/pages/wiki/types'

const mockApiGet = vi.hoisted(() => vi.fn())
const mockShowToast = vi.hoisted(() => vi.fn())
const mockListLoadMode = vi.hoisted(() => vi.fn(() => 'pagination'))

const mockCategories = [
  {
    id: 'biography',
    name: '人物介绍',
    description: '',
    order: 10,
    requiresAdminEdit: false,
  },
  {
    id: 'music',
    name: '音乐作品',
    description: '',
    order: 20,
    requiresAdminEdit: true,
  },
]

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
}))

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    isBanned: false,
  }),
}))

vi.mock('../../src/context/UserPreferencesContext', () => ({
  useUserPreferences: () => ({
    preferences: {
      listLoadMode: mockListLoadMode(),
    },
    getScopedViewMode: (scope: string) => (scope === 'wiki' ? 'medium' : 'list'),
    setScopedViewMode: vi.fn(),
  }),
}))

vi.mock('../../src/components/Toast', () => ({
  useToast: () => ({
    show: mockShowToast,
  }),
}))

const mockPages: WikiItem[] = [
  {
    id: 'wiki-1',
    slug: 'test-page-1',
    title: '测试页面一',
    category: 'biography',
    content: '第一条百科内容',
    status: 'published',
    isPinned: false,
    tags: [],
    likesCount: 3,
    favoritesCount: 0,
    createdAt: new Date('2024-01-01').toISOString(),
    updatedAt: new Date('2024-06-01').toISOString(),
    lastEditorUid: 'user-1',
    lastEditorName: 'Tester',
  },
  {
    id: 'wiki-2',
    slug: 'test-page-2',
    title: '测试页面二',
    category: 'music',
    content: '第二条百科内容',
    status: 'published',
    isPinned: true,
    tags: [],
    likesCount: 8,
    favoritesCount: 0,
    createdAt: new Date('2024-02-01').toISOString(),
    updatedAt: new Date('2024-06-15').toISOString(),
    lastEditorUid: 'user-2',
    lastEditorName: 'Tester 2',
  },
]

const renderWithRouter = (initialEntry = '/wiki') =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <WikiList />
    </MemoryRouter>
  )

describe('WikiList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListLoadMode.mockReturnValue('pagination')
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/api/wiki/categories') {
        return Promise.resolve({
          categories: mockCategories,
        })
      }
      return Promise.resolve({
        pages: mockPages,
        total: mockPages.length,
      })
    })
  })

  it('renders wiki cards in a normal grid layout without the legacy virtual scroll container', async () => {
    const { container } = renderWithRouter()
    const { gridCols, gap } = VIEW_MODE_CONFIG.medium

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith(
        '/api/wiki',
        expect.objectContaining({
          page: 1,
          pageSize: DEFAULT_PAGE_SIZE,
        }),
        undefined,
        undefined
      )
    })

    expect(await screen.findByText('测试页面一')).toBeInTheDocument()
    expect(screen.getByText('测试页面二')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /时间轴/ })).not.toBeInTheDocument()

    const articles = container.querySelectorAll<HTMLElement>('[role="article"]')
    expect(articles).toHaveLength(2)

    const gridContainer = Array.from(container.querySelectorAll<HTMLDivElement>('div')).find(
      (element) => {
        const className = typeof element.className === 'string' ? element.className : ''
        const expectedClasses = ['grid', ...gridCols.split(' '), gap]

        return expectedClasses.every((expectedClass) => className.includes(expectedClass))
      }
    )

    expect(gridContainer).toBeTruthy()
    expect(within(gridContainer as HTMLElement).getByText('测试页面一')).toBeInTheDocument()
    expect(within(gridContainer as HTMLElement).getByText('测试页面二')).toBeInTheDocument()

    const legacyVirtualScrollContainer = Array.from(
      container.querySelectorAll<HTMLDivElement>('div')
    ).find((element) => {
      const className = typeof element.className === 'string' ? element.className : ''
      const hasLegacyClasses =
        className.includes('overflow-y-auto') && className.includes('max-h-[calc(100vh-280px)]')
      const hasLegacyInlineStyles =
        element.style.overflowY === 'auto' && element.style.maxHeight === 'calc(100vh - 280px)'

      return hasLegacyClasses || hasLegacyInlineStyles
    })

    expect(legacyVirtualScrollContainer).toBeUndefined()
  })

  it('uses routed page and page size params on first load', async () => {
    renderWithRouter('/wiki?page=2&pageSize=50')

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith(
        '/api/wiki',
        expect.objectContaining({
          page: 2,
          pageSize: 50,
        }),
        undefined,
        undefined
      )
    })
  })

  it('appends the next page in incremental load mode', async () => {
    mockListLoadMode.mockReturnValue('incremental')
    mockApiGet.mockImplementation((path: string, params?: { page?: number }) => {
      if (path === '/api/wiki/categories') {
        return Promise.resolve({
          categories: mockCategories,
        })
      }
      return Promise.resolve({
        pages: [
          {
            ...mockPages[0],
            id: `wiki-${params?.page ?? 1}`,
            title: `第 ${params?.page ?? 1} 页百科`,
          },
        ],
        total: 2,
      })
    })

    renderWithRouter('/wiki?page=3&pageSize=50')

    expect(await screen.findByText('第 1 页百科')).toBeInTheDocument()
    expect(screen.queryByLabelText('分页导航')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '加载更多' }))

    expect(await screen.findByText('第 2 页百科')).toBeInTheDocument()
    expect(mockApiGet).toHaveBeenCalledWith(
      '/api/wiki',
      expect.objectContaining({
        page: 2,
        pageSize: DEFAULT_PAGE_SIZE,
      }),
      undefined,
      expect.any(AbortSignal)
    )
  })
})
