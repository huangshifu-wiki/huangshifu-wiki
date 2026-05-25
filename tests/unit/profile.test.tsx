import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Profile from '../../src/pages/Profile'

const { mockApiGet, mockApiPatch, mockRefreshAuth, mockShow } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiPatch: vi.fn(),
  mockRefreshAuth: vi.fn(),
  mockShow: vi.fn(),
}))

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
  apiPatch: mockApiPatch,
}))

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      uid: 'user-1',
      displayName: '测试用户',
      photoURL: '',
      role: 'user',
    },
    profile: {
      displayName: '测试用户',
      bio: '',
      photoURL: '',
      level: 1,
      role: 'user',
      status: 'active',
    },
    refreshAuth: mockRefreshAuth,
  }),
}))

vi.mock('../../src/components/Toast', () => ({
  useToast: () => ({
    show: mockShow,
  }),
}))

vi.mock('../../src/components/AvatarCropModal', () => ({
  AvatarCropModal: () => null,
}))

describe('Profile posts status', () => {
  beforeEach(() => {
    mockApiGet.mockReset()
    mockApiPatch.mockReset()
    mockRefreshAuth.mockReset()
    mockShow.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders rejected posts with Chinese status text and error style', async () => {
    mockApiGet.mockImplementation(async (path: string) => {
      if (path === '/api/users/user-1/posts') {
        return {
          posts: [
            {
              id: 'post-1',
              title: '被驳回的帖子',
              section: '闲聊',
              status: 'rejected',
              likesCount: 0,
              commentsCount: 0,
              createdAt: '2026-05-25T10:00:00.000Z',
              updatedAt: '2026-05-25T10:00:00.000Z',
            },
          ],
          total: 1,
        }
      }

      return { favorites: [], comments: [], history: [], total: 0 }
    })

    const view = render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: '我的帖子' }))

    const statusBadge = await screen.findByText('已驳回')
    await screen.findByText('被驳回的帖子')

    await waitFor(() => {
      expect(statusBadge.className).toContain('theme-status-error')
    })
    expect(screen.queryByText('rejected')).not.toBeInTheDocument()

    view.unmount()
  })
})
