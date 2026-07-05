// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import UserProfile from '../../src/pages/UserProfile'

const { mockApiGet } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
}))
const { mockApiPatch } = vi.hoisted(() => ({
  mockApiPatch: vi.fn(),
}))
const { mockRefreshAuth } = vi.hoisted(() => ({
  mockRefreshAuth: vi.fn(),
}))
const { mockToastShow } = vi.hoisted(() => ({
  mockToastShow: vi.fn(),
}))

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
  apiPatch: mockApiPatch,
}))

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      uid: 'user-1',
      publicId: '1',
      displayName: '测试用户',
      photoURL: '',
      role: 'user',
    },
    refreshAuth: mockRefreshAuth,
  }),
}))

vi.mock('../../src/components/Toast', () => ({
  useToast: () => ({
    show: mockToastShow,
  }),
}))

describe('UserProfile', () => {
  beforeEach(() => {
    mockApiGet.mockReset()
    mockApiPatch.mockReset()
    mockApiPatch.mockResolvedValue({})
    mockRefreshAuth.mockReset()
    mockRefreshAuth.mockResolvedValue(undefined)
    mockToastShow.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  const renderProfile = (path = '/users/1') =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/users/:userId/:tab?" element={<UserProfile />} />
        </Routes>
      </MemoryRouter>
    )

  it('opens on the profile tab and hides comments tab', async () => {
    mockApiGet.mockImplementation(async (path: string) => {
      if (path === '/api/users/1/profile') {
        return {
          user: {
            publicId: '1',
            displayName: '测试用户',
            photoURL: '',
            signature: '',
            bio: '公开简介',
            createdAt: '2026-05-25T10:00:00.000Z',
            updatedAt: '2026-05-25T10:00:00.000Z',
            isSelf: true,
            canViewFavorites: true,
            canViewHistory: true,
            publicFavorites: false,
            publicHistory: false,
          },
        }
      }

      return { galleries: [], favorites: [], history: [] }
    })

    renderProfile()

    expect(await screen.findByText('公开简介')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /设置/ })).toHaveAttribute('href', '/settings/profile')
    expect(screen.queryByRole('link', { name: '评论' })).not.toBeInTheDocument()

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledTimes(1)
    })
  })

  it('renders public posts on the posts tab', async () => {
    mockApiGet.mockImplementation(async (path: string) => {
      if (path === '/api/users/1/profile') {
        return {
          user: {
            publicId: '1',
            displayName: '测试用户',
            photoURL: '',
            signature: '',
            bio: '',
            createdAt: '2026-05-25T10:00:00.000Z',
            updatedAt: '2026-05-25T10:00:00.000Z',
            isSelf: true,
            canViewFavorites: true,
            canViewHistory: true,
            publicFavorites: false,
            publicHistory: false,
          },
        }
      }

      if (path === '/api/users/1/posts') {
        return {
          posts: [
            {
              id: 'post-1',
              title: '公开帖子',
              section: '闲聊',
              content: '',
              authorUid: 'user-1',
              status: 'published',
              likesCount: 2,
              dislikesCount: 0,
              commentsCount: 1,
              createdAt: '2026-05-25T10:00:00.000Z',
              updatedAt: '2026-05-25T10:00:00.000Z',
            },
          ],
        }
      }

      return { galleries: [], favorites: [], history: [] }
    })

    renderProfile('/users/1/posts')

    expect(await screen.findByText('公开帖子')).toBeInTheDocument()

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/api/users/1/posts', {
        limit: 50,
        visibility: 'public',
      })
    })
  })

  it('allows the owner to edit the signature inline', async () => {
    mockApiGet.mockImplementation(async (path: string) => {
      if (path === '/api/users/1/profile') {
        return {
          user: {
            publicId: '1',
            displayName: '测试用户',
            photoURL: '',
            signature: '旧签名',
            bio: '',
            createdAt: '2026-05-25T10:00:00.000Z',
            updatedAt: '2026-05-25T10:00:00.000Z',
            isSelf: true,
            canViewFavorites: true,
            canViewHistory: true,
            publicFavorites: false,
            publicHistory: false,
          },
        }
      }

      return {}
    })

    renderProfile()

    fireEvent.click(await screen.findByRole('button', { name: '旧签名' }))
    const editor = screen.getByRole('textbox', { name: '编辑签名' })

    fireEvent.input(editor, { target: { innerText: '新签名' } })
    fireEvent.blur(editor)

    await waitFor(() => {
      expect(mockApiPatch).toHaveBeenCalledWith('/api/users/me', { signature: '新签名' })
    })
    expect(mockRefreshAuth).toHaveBeenCalled()
    expect(mockToastShow).toHaveBeenCalledWith('签名已保存')
    expect(await screen.findByRole('button', { name: '新签名' })).toBeInTheDocument()
  })

  it('does not show private tabs when the profile keeps them private', async () => {
    mockApiGet.mockImplementation(async (path: string) => {
      if (path === '/api/users/2/profile') {
        return {
          user: {
            publicId: '2',
            displayName: '其他用户',
            photoURL: '',
            signature: '',
            bio: '',
            createdAt: '2026-05-25T10:00:00.000Z',
            updatedAt: '2026-05-25T10:00:00.000Z',
            isSelf: false,
            canViewFavorites: false,
            canViewHistory: false,
            publicFavorites: false,
            publicHistory: false,
          },
        }
      }

      if (path === '/api/users/2/posts') {
        return { posts: [] }
      }

      return {}
    })

    renderProfile('/users/2')

    expect(await screen.findByText('其他用户')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '收藏' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '浏览历史' })).not.toBeInTheDocument()
  })
})
