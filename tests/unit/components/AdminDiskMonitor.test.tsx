// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DialogProvider } from '../../../src/components/Dialog'
import AdminDiskMonitor from '../../../src/pages/Admin/AdminDiskMonitor'

const mockApiGet = vi.hoisted(() => vi.fn())
const mockApiPost = vi.hoisted(() => vi.fn())
const mockApiPut = vi.hoisted(() => vi.fn())

vi.mock('../../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
  apiPost: mockApiPost,
  apiPut: mockApiPut,
}))

const initialStatus = {
  totalSpaceGB: 100,
  freeSpaceGB: 40,
  usedSpaceGB: 60,
  usagePercent: 60,
  status: 'healthy' as const,
  lastChecked: '2026-06-28T10:00:00.000Z',
  uploadsDir: { fileCount: 2, totalSizeMB: 10 },
  originalDir: { fileCount: 1, totalSizeMB: 5 },
  variantsDir: { fileCount: 3, totalSizeMB: 6 },
}

const refreshedStatus = {
  ...initialStatus,
  freeSpaceGB: 35,
  usedSpaceGB: 65,
  usagePercent: 65,
  lastChecked: '2026-06-28T10:01:00.000Z',
}

const config = {
  warningThresholdGB: 50,
  criticalThresholdGB: 20,
  checkIntervalMs: 300000,
  uploadsMinFreeMB: 500,
}

function renderDiskMonitor() {
  return render(
    <DialogProvider>
      <AdminDiskMonitor />
    </DialogProvider>
  )
}

describe('AdminDiskMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/api/admin/disk/status') {
        return Promise.resolve({ success: true, data: initialStatus })
      }
      if (path === '/api/admin/disk/config') {
        return Promise.resolve({ success: true, data: config })
      }
      return Promise.reject(new Error(`Unexpected GET ${path}`))
    })
    mockApiPost.mockResolvedValue({ success: true, data: refreshedStatus })
    mockApiPut.mockResolvedValue({ success: true, data: config })
  })

  afterEach(() => {
    cleanup()
  })

  it('loads disk status and config without GET cache', async () => {
    renderDiskMonitor()

    await waitFor(() => {
      expect(screen.getByText('40.0')).toBeInTheDocument()
    })

    expect(mockApiGet).toHaveBeenCalledWith('/api/admin/disk/status', undefined, {
      staleTime: 0,
      swr: false,
    })
    expect(mockApiGet).toHaveBeenCalledWith('/api/admin/disk/config', undefined, {
      staleTime: 0,
      swr: false,
    })
  })

  it('keeps successful disk status updates visible when config loading fails', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/api/admin/disk/status') {
        return Promise.resolve({ success: true, data: initialStatus })
      }
      if (path === '/api/admin/disk/config') {
        return Promise.reject(new Error('配置加载失败'))
      }
      return Promise.reject(new Error(`Unexpected GET ${path}`))
    })

    renderDiskMonitor()

    await waitFor(() => {
      expect(screen.getByText('40.0')).toBeInTheDocument()
      expect(screen.getByText('配置加载失败')).toBeInTheDocument()
    })
  })

  it('preserves the initial load error while a silent retry is pending', async () => {
    let intervalCallback: (() => void) | undefined
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation((handler, timeout) => {
      if (timeout === 30000) {
        intervalCallback = handler as () => void
      }
      return 1 as unknown as ReturnType<typeof setInterval>
    })
    const clearIntervalSpy = vi
      .spyOn(globalThis, 'clearInterval')
      .mockImplementation(() => undefined)
    let statusRequestCount = 0
    let configRequestCount = 0
    let resolveRetryStatus:
      | ((value: { success: boolean; data: typeof initialStatus }) => void)
      | undefined
    let resolveRetryConfig: ((value: { success: boolean; data: typeof config }) => void) | undefined
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/api/admin/disk/status') {
        statusRequestCount += 1
        if (statusRequestCount === 1) {
          return Promise.reject(new Error('状态加载失败'))
        }
        return new Promise((resolve) => {
          resolveRetryStatus = resolve
        })
      }
      if (path === '/api/admin/disk/config') {
        configRequestCount += 1
        if (configRequestCount === 1) {
          return Promise.resolve({ success: true, data: config })
        }
        return new Promise((resolve) => {
          resolveRetryConfig = resolve
        })
      }
      return Promise.reject(new Error(`Unexpected GET ${path}`))
    })

    const { unmount } = renderDiskMonitor()

    await screen.findByText('状态加载失败')
    expect(intervalCallback).toBeDefined()

    act(() => {
      intervalCallback!()
    })

    expect(screen.getByText('状态加载失败')).toBeInTheDocument()

    await act(async () => {
      resolveRetryStatus!({ success: true, data: initialStatus })
      resolveRetryConfig!({ success: true, data: config })
      await Promise.resolve()
    })

    expect(screen.queryByText('状态加载失败')).not.toBeInTheDocument()
    expect(screen.getByText('40.0')).toBeInTheDocument()

    unmount()
    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
  })

  it('manual refresh triggers a disk check instead of reusing the status GET', async () => {
    renderDiskMonitor()

    await waitFor(() => {
      expect(screen.getByText('40.0')).toBeInTheDocument()
    })
    mockApiGet.mockClear()

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/admin/disk/check')
      expect(mockApiGet.mock.calls.map(([path]) => path)).not.toContain('/api/admin/disk/status')
      expect(mockApiGet).toHaveBeenCalledWith('/api/admin/disk/config', undefined, {
        staleTime: 0,
        swr: false,
      })
    })

    await waitFor(() => {
      expect(screen.getByText('35.0')).toBeInTheDocument()
    })
  })

  it('keeps manual disk check results visible when config refresh rejects', async () => {
    renderDiskMonitor()

    await waitFor(() => {
      expect(screen.getByText('40.0')).toBeInTheDocument()
    })
    mockApiGet.mockClear()
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/api/admin/disk/config') {
        return Promise.reject(new Error('配置刷新失败'))
      }
      return Promise.reject(new Error(`Unexpected GET ${path}`))
    })

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/admin/disk/check')
      expect(screen.getByText('35.0')).toBeInTheDocument()
      expect(screen.getByText('配置刷新失败')).toBeInTheDocument()
    })
    expect(mockApiGet.mock.calls.map(([path]) => path)).not.toContain('/api/admin/disk/status')
  })

  it('disables the refresh button while the manual disk check is running', async () => {
    let resolveRefresh: (value: { success: boolean; data: typeof refreshedStatus }) => void
    mockApiPost.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefresh = resolve
      })
    )

    renderDiskMonitor()

    await waitFor(() => {
      expect(screen.getByText('40.0')).toBeInTheDocument()
    })

    const refreshButton = screen.getByRole('button', { name: '刷新' })
    fireEvent.click(refreshButton)

    await waitFor(() => {
      expect(refreshButton).toBeDisabled()
    })
    expect(refreshButton.querySelector('svg')).toHaveClass('animate-spin')

    resolveRefresh!({ success: true, data: refreshedStatus })

    await waitFor(() => {
      expect(refreshButton).not.toBeDisabled()
    })
  })
})
