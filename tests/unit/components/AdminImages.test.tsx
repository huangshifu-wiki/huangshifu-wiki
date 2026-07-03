// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DialogProvider } from '../../../src/components/Dialog'
import AdminImages from '../../../src/pages/Admin/AdminImages'

const mockApiGet = vi.hoisted(() => vi.fn())
const mockApiPost = vi.hoisted(() => vi.fn())
const mockApiPatch = vi.hoisted(() => vi.fn())
const mockApiDelete = vi.hoisted(() => vi.fn())
const mockApiDownload = vi.hoisted(() => vi.fn())
const mockShow = vi.hoisted(() => vi.fn())

vi.mock('../../../src/lib/apiClient', () => ({
  apiDelete: mockApiDelete,
  apiDownload: mockApiDownload,
  apiGet: mockApiGet,
  apiPatch: mockApiPatch,
  apiPost: mockApiPost,
}))

vi.mock('../../../src/components/Toast', () => ({
  useToast: () => ({
    show: mockShow,
  }),
}))

vi.mock('../../../src/components/SmartImage', () => ({
  SmartImage: ({ alt }: { alt: string }) => <img alt={alt} />,
}))

vi.mock('../../../src/services/imageService', () => ({
  clearImagePreferenceCache: vi.fn(),
}))

const mediaHealthScanResponse = {
  success: true,
  data: {
    generatedAt: '2026-07-03T00:00:00.000Z',
    mode: 'strict',
    summary: {
      missingLocalFiles: 1,
      unusedMediaAssets: 1,
      unusedImageMaps: 0,
      cleanupCandidates: 1,
      blockedRecords: 0,
    },
    missingLocalFiles: [
      {
        recordType: 'mediaAsset',
        id: 'asset-1',
        storageKey: 'gallery/missing.jpg',
        publicUrl: '/uploads/gallery/missing.jpg',
        expectedPath: '/uploads/gallery/missing.jpg',
        label: 'missing.jpg',
        references: [],
        canCleanup: true,
        blockedReasons: [],
      },
    ],
    unusedMediaRecords: [],
  },
}

function renderPage() {
  return render(
    <DialogProvider>
      <AdminImages />
    </DialogProvider>
  )
}

describe('AdminImages media health panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/api/image-maps') return Promise.resolve({ items: [] })
      if (path === '/api/image-maps/stats') {
        return Promise.resolve({ total: 0, stats: { local: 0, s3: 0, external: 0 } })
      }
      if (path === '/api/config/image-preference') {
        return Promise.resolve({ strategy: 'local', fallback: true })
      }
      if (path === '/api/admin/media-health/scan') {
        return Promise.resolve(mediaHealthScanResponse)
      }
      return Promise.reject(new Error(`unexpected GET ${path}`))
    })
    mockApiPost.mockResolvedValue({
      success: true,
      data: { total: 1, cleaned: 1, skipped: 0, results: [] },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('scans media health and cleans selected records', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: '扫描' }))

    expect(await screen.findByText('missing.jpg')).toBeInTheDocument()
    expect(screen.getByText('缺失文件')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /软清理/ }))
    await user.click(await screen.findByRole('button', { name: '软清理' }))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/admin/media-health/cleanup', {
        mode: 'strict',
        targets: [{ recordType: 'mediaAsset', id: 'asset-1' }],
      })
    })
    expect(mockShow).toHaveBeenCalledWith('已清理 1 条，跳过 0 条', { variant: 'success' })
  })
})
