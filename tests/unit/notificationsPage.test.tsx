// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Notifications from '../../src/pages/Notifications'

const mockApiGet = vi.hoisted(() => vi.fn())
const mockApiPost = vi.hoisted(() => vi.fn())

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
  apiPost: mockApiPost,
}))

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

    render(
      <MemoryRouter initialEntries={['/notifications?filter=mention']}>
        <Notifications />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith(
        '/api/notifications',
        expect.objectContaining({ type: 'mention', page: 1, limit: 20 })
      )
    })
    expect(screen.getByText(/Alice 提到了你/)).toBeInTheDocument()
    expect(screen.getAllByText('提及').length).toBeGreaterThan(0)
  })
})
