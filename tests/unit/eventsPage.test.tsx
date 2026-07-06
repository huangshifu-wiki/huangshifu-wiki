// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Events from '../../src/pages/Events'
import type { EventItem } from '../../src/types/entities'

const mockApiGet = vi.hoisted(() => vi.fn())
const mockSetScopedViewMode = vi.hoisted(() => vi.fn())
const mockEventViewMode = vi.hoisted(() => vi.fn(() => 'medium'))

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
}))

vi.mock('../../src/context/UserPreferencesContext', () => ({
  useUserPreferences: () => ({
    getScopedViewMode: mockEventViewMode,
    setScopedViewMode: mockSetScopedViewMode,
  }),
}))

vi.mock('../../src/components/SmartImage', () => ({
  SmartImage: ({
    src,
    alt,
    className,
  }: {
    src?: string | null
    alt?: string
    className?: string
  }) => <img src={src || ''} alt={alt || ''} className={className} />,
}))

const mockEvent: EventItem = {
  id: 'event-1',
  slug: '1001',
  title: '春日游记',
  location: '苏州',
  content: '',
  timeSlots: [{ type: 'date', start: '2024-04-01' }],
  ticketPrices: [],
  saleTimes: [],
  lineup: [],
  tags: ['现场'],
  externalLinks: [],
  relatedLinks: [],
  sortStart: '2024-04-01',
  sortEnd: '2024-04-01',
  coverAssetId: null,
  coverUrl: '/uploads/event.jpg',
  coverName: null,
  coverThumbnailUrl: null,
  coverThumbnailStatus: null,
  createdByUid: 'user-1',
  createdByName: '作者',
  updatedByUid: null,
  updatedByName: null,
  posters: [],
  createdAt: '2024-04-01T00:00:00.000Z',
  updatedAt: '2024-04-01T00:00:00.000Z',
}

const renderEvents = () =>
  render(
    <MemoryRouter initialEntries={['/events']}>
      <Events />
    </MemoryRouter>
  )

describe('Events page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEventViewMode.mockReturnValue('medium')
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/api/events/tags') {
        return Promise.resolve({ tags: ['现场'] })
      }

      return Promise.resolve({
        events: [mockEvent],
        total: 1,
        totalPages: 1,
      })
    })
  })

  it('only offers large and list view modes, and falls back old medium preference to list', async () => {
    const { container } = renderEvents()

    expect(await screen.findByText('春日游记')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '舒适' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '列表' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '标准' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '紧凑' })).not.toBeInTheDocument()

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith(
        '/api/events',
        expect.objectContaining({ sortOrder: 'desc' })
      )
    })

    const gridContainer = container.querySelector('.grid.grid-cols-1')
    expect(gridContainer).toBeInTheDocument()
  })
})
