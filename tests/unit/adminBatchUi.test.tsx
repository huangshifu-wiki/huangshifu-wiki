// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CoverManager } from '../../src/components/CoverManager'
import AdminLocks from '../../src/pages/Admin/AdminLocks'

const mockApiGet = vi.hoisted(() => vi.fn())
const mockApiDelete = vi.hoisted(() => vi.fn())
const mockApiPatch = vi.hoisted(() => vi.fn())
const mockApiPost = vi.hoisted(() => vi.fn())
const mockInvalidateApiCacheByPrefix = vi.hoisted(() => vi.fn())
const mockShowToast = vi.hoisted(() => vi.fn())
const mockConfirmDialog = vi.hoisted(() => vi.fn())

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
  apiDelete: mockApiDelete,
  apiPatch: mockApiPatch,
  apiPost: mockApiPost,
  invalidateApiCacheByPrefix: mockInvalidateApiCacheByPrefix,
}))

vi.mock('../../src/components/Toast', () => ({
  useToast: () => ({
    show: mockShowToast,
  }),
}))

vi.mock('../../src/components/Dialog', () => ({
  useDialog: () => ({
    confirm: mockConfirmDialog,
  }),
}))

vi.mock('../../src/services/imageService', () => ({
  uploadImageWithStrategy: vi.fn(),
}))

describe('admin batch UI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfirmDialog.mockResolvedValue(true)
    mockApiDelete.mockResolvedValue({ success: true })
  })

  it('batch deletes covers from CoverManager', async () => {
    const user = userEvent.setup()
    const onCoverUpdated = vi.fn()
    mockApiGet
      .mockResolvedValueOnce({
        covers: [
          { id: 'cover-1', url: '/uploads/cover-1.jpg', isDefault: true, sortOrder: 0 },
          { id: 'cover-2', url: '/uploads/cover-2.jpg', isDefault: false, sortOrder: 1 },
        ],
      })
      .mockResolvedValueOnce({
        covers: [{ id: 'cover-2', url: '/uploads/cover-2.jpg', isDefault: true, sortOrder: 0 }],
      })

    render(
      <CoverManager
        resourceType="song"
        resourceId="song-1"
        currentCover="/uploads/cover-1.jpg"
        onCoverUpdated={onCoverUpdated}
      />
    )

    await user.click(screen.getByRole('button', { name: '封面管理' }))
    expect(await screen.findByText('已上传的封面 (2)')).toBeInTheDocument()

    await user.click(screen.getAllByLabelText('选择封面')[0])
    await user.click(screen.getByRole('button', { name: /删除 1/ }))

    await waitFor(() => {
      expect(mockApiDelete).toHaveBeenCalledWith('/api/music/song-1/covers', {
        coverIds: ['cover-1'],
      })
    })
    expect(mockInvalidateApiCacheByPrefix).toHaveBeenCalledWith('/api/music/song-1/covers')
    expect(onCoverUpdated).toHaveBeenCalledWith({
      url: '/uploads/cover-2.jpg',
      thumbnailUrl: null,
    })
  })

  it('batch releases edit locks from AdminLocks', async () => {
    const user = userEvent.setup()
    mockApiGet.mockResolvedValue({
      locks: [
        {
          id: 'lock-1',
          collection: 'wiki',
          recordId: 'page-1',
          userId: 'user-1',
          username: 'User One',
          createdAt: '2024-01-01T00:00:00.000Z',
          expiresAt: '2024-01-01T00:15:00.000Z',
        },
        {
          id: 'lock-2',
          collection: 'post',
          recordId: 'post-1',
          userId: 'user-2',
          username: 'User Two',
          createdAt: '2024-01-01T00:00:00.000Z',
          expiresAt: '2024-01-01T00:15:00.000Z',
        },
      ],
    })

    render(<AdminLocks />)

    expect(await screen.findByText('wiki / page-1')).toBeInTheDocument()
    await user.click(screen.getByLabelText('选择全部编辑锁'))
    await user.click(screen.getByRole('button', { name: /释放选中 2/ }))

    await waitFor(() => {
      expect(mockApiDelete).toHaveBeenCalledWith('/api/admin/locks', {
        lockIds: ['lock-1', 'lock-2'],
      })
    })
  })
})
