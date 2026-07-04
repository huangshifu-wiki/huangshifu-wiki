// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import Notifications from '../../src/pages/Notifications'

const mockApiGet = vi.hoisted(() => vi.fn())
const mockApiPost = vi.hoisted(() => vi.fn())

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
  apiPost: mockApiPost,
}))

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname + location.search}</span>
}

const renderNotifications = (initialEntry = '/notifications') =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Notifications />
      <LocationProbe />
    </MemoryRouter>
  )

describe('Notifications page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiPost.mockResolvedValue({ success: true })
  })

  it('supports mention notification filters and labels', async () => {
    mockApiGet.mockResolvedValue({
      notifications: [
        {
          id: 'notif-1',
          type: 'mention',
          payload: {
            actorName: 'Alice',
            targetType: 'post',
            postId: 'post-1',
            commentId: 'comment-1',
            preview: 'hello mention',
          },
          isRead: false,
          createdAt: '2026-06-27T00:00:00.000Z',
        },
      ],
      total: 1,
      unreadCount: 1,
      page: 1,
      limit: 20,
    })

    renderNotifications('/notifications?filter=mention')

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith(
        '/api/notifications',
        expect.objectContaining({ type: 'mention', page: 1, limit: 20 })
      )
    })
    expect(screen.getByText(/Alice 提到了你/)).toBeInTheDocument()
    expect(screen.getAllByText('提及').length).toBeGreaterThan(0)
  })

  it('uses routed page and cleans default filter values', async () => {
    mockApiGet.mockResolvedValue({
      notifications: [
        {
          id: 'notif-1',
          type: 'reply',
          payload: { actorName: 'Alice', targetType: 'post', postId: 'post-1' },
          isRead: true,
          createdAt: '2026-06-27T00:00:00.000Z',
        },
      ],
      total: 60,
      unreadCount: 0,
      page: 2,
      limit: 20,
    })

    renderNotifications('/notifications?filter=all&page=2')

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith(
        '/api/notifications',
        expect.objectContaining({ page: 2, limit: 20 })
      )
    })
    expect(screen.getByTestId('location')).toHaveTextContent('/notifications?page=2')
  })

  it('writes the next page to the route when pagination changes', async () => {
    const user = userEvent.setup()
    mockApiGet.mockResolvedValue({
      notifications: [
        {
          id: 'notif-1',
          type: 'reply',
          payload: { actorName: 'Alice', targetType: 'post', postId: 'post-1' },
          isRead: true,
          createdAt: '2026-06-27T00:00:00.000Z',
        },
      ],
      total: 60,
      unreadCount: 0,
      page: 1,
      limit: 20,
    })

    renderNotifications()

    await screen.findByLabelText('下一页')
    await user.click(screen.getByLabelText('下一页'))

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/notifications?page=2')
    })
  })

  it('normalizes out-of-range page after loading an empty result set', async () => {
    mockApiGet.mockResolvedValue({
      notifications: [],
      total: 0,
      unreadCount: 0,
      page: 99,
      limit: 20,
    })

    renderNotifications('/notifications?page=99')

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith(
        '/api/notifications',
        expect.objectContaining({ page: 99, limit: 20 })
      )
    })
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/notifications')
    })
  })
})
