// @vitest-environment jsdom
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import AdminVariantManager from '../../src/pages/Admin/AdminVariantManager'

const mockApiGet = vi.hoisted(() => vi.fn())
const mockApiPost = vi.hoisted(() => vi.fn())
const mockConfirmDialog = vi.hoisted(() => vi.fn())

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
  apiPost: mockApiPost,
}))

vi.mock('../../src/components/Dialog', () => ({
  useDialog: () => ({
    confirm: mockConfirmDialog,
  }),
}))

function mockStatsRequests() {
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/api/admin/variants/stats') {
      return Promise.resolve({
        success: true,
        data: {
          queueLength: 0,
          processingCount: 0,
          completedToday: 0,
          failedToday: 0,
          averageProcessingTime: 0,
          timeoutCount: 0,
        },
      })
    }

    if (path === '/api/admin/cleanup/stats') {
      return Promise.resolve({
        success: true,
        data: {
          totalImages: 0,
          completedVariants: 0,
          failedVariants: 0,
          pendingOrProcessing: 0,
          estimatedOrphanedDirectories: 0,
        },
      })
    }

    if (path === '/api/admin/music-cover-thumbnails/stats') {
      return Promise.resolve({
        success: true,
        data: {
          song: { total: 5, missing: 2 },
          album: { total: 3, missing: 1 },
          total: { total: 8, missing: 3 },
        },
      })
    }

    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
}

function expectMetric(label: string, value: string) {
  const metric = screen.getByText(label).closest('div')
  expect(metric).not.toBeNull()
  expect(within(metric as HTMLElement).getByText(value)).toBeInTheDocument()
}

describe('AdminVariantManager music cover thumbnails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfirmDialog.mockResolvedValue(true)
    mockStatsRequests()
  })

  it('显示音乐封面缩略图统计', async () => {
    render(<AdminVariantManager />)

    expect(await screen.findByText('音乐封面缩略图')).toBeInTheDocument()
    expectMetric('歌曲缺失', '2')
    expectMetric('专辑缺失', '1')
    expectMetric('总缺失', '3')
    expectMetric('总缺失', '共 8')
  })

  it('点击补齐后按批次调用接口并更新进度', async () => {
    const user = userEvent.setup()
    mockApiPost
      .mockResolvedValueOnce({
        success: true,
        data: {
          type: 'all',
          batchSize: 50,
          processed: 2,
          succeeded: 2,
          failed: 0,
          remaining: 1,
          errors: [],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          type: 'all',
          batchSize: 50,
          processed: 1,
          succeeded: 1,
          failed: 0,
          remaining: 0,
          errors: [],
        },
      })

    render(<AdminVariantManager />)

    await user.click(await screen.findByRole('button', { name: '补齐缩略图' }))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledTimes(2)
    })
    expect(mockApiPost).toHaveBeenNthCalledWith(1, '/api/admin/music-cover-thumbnails/backfill', {
      type: 'all',
      batchSize: 50,
    })
    expect(mockApiPost).toHaveBeenNthCalledWith(2, '/api/admin/music-cover-thumbnails/backfill', {
      type: 'all',
      batchSize: 50,
    })
    expect(await screen.findByText('补齐完成')).toBeInTheDocument()
    expectMetric('已处理', '3')
    expectMetric('成功', '3')
    expectMetric('失败', '0')
    expectMetric('剩余', '0')
  })

  it('补齐时单个坏封面失败后仍继续处理后续批次', async () => {
    const user = userEvent.setup()
    mockApiPost
      .mockResolvedValueOnce({
        success: true,
        data: {
          type: 'all',
          batchSize: 50,
          processed: 2,
          succeeded: 1,
          failed: 1,
          remaining: 1,
          errors: [
            {
              type: 'song',
              coverId: 'bad-cover',
              resourceId: 'song-bad',
              message: 'source missing',
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          type: 'all',
          batchSize: 50,
          processed: 1,
          succeeded: 1,
          failed: 0,
          remaining: 0,
          errors: [],
        },
      })

    render(<AdminVariantManager />)

    await user.click(await screen.findByRole('button', { name: '补齐缩略图' }))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledTimes(2)
    })
    expect(await screen.findByText('补齐完成')).toBeInTheDocument()
    expectMetric('已处理', '3')
    expectMetric('成功', '2')
    expectMetric('失败', '1')
    expect(screen.getByText(/source missing/)).toBeInTheDocument()
  })
})
