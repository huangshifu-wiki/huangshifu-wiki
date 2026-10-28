// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CoverManager } from '../../../src/components/CoverManager'
import { DialogProvider } from '../../../src/components/Dialog'
import { ToastProvider } from '../../../src/components/Toast'
import { apiGet } from '../../../src/lib/apiClient'
import { uploadImageWithStrategy } from '../../../src/services/imageService'

vi.mock('../../../src/lib/apiClient', () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  invalidateApiCacheByPrefix: vi.fn(),
  invalidateMusicApiCaches: vi.fn(),
}))

vi.mock('../../../src/services/imageService', () => ({
  uploadImageWithStrategy: vi.fn(),
}))

const mockedApiGet = vi.mocked(apiGet)
const mockedUpload = vi.mocked(uploadImageWithStrategy)

const renderManager = () =>
  render(
    <ToastProvider>
      <DialogProvider>
        <CoverManager
          open
          resourceType="album"
          resourceId="album-1"
          currentCover="/uploads/current.jpg"
          onClose={vi.fn()}
        />
      </DialogProvider>
    </ToastProvider>
  )

describe('CoverManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedUpload.mockResolvedValue({ assetId: 'asset-1' } as never)
  })

  it('封面列表加载失败时显示错误而不是假空态', async () => {
    mockedApiGet.mockRejectedValue(new Error('封面服务不可用'))
    renderManager()

    expect(await screen.findByRole('alert')).toHaveTextContent('封面服务不可用')
    expect(screen.queryByText('暂无额外封面')).not.toBeInTheDocument()
  })

  it('选择不支持的封面格式时不会发起上传', async () => {
    mockedApiGet.mockResolvedValue({ covers: [] } as never)
    const { container } = renderManager()
    const fileInput = container.querySelector('input[type="file"]')
    expect(fileInput).not.toBeNull()

    fireEvent.change(fileInput!, {
      target: {
        files: [new File(['svg'], 'cover.svg', { type: 'image/svg+xml' })],
      },
    })

    expect(mockedUpload).not.toHaveBeenCalled()
    expect(await screen.findByText('请选择 JPG、PNG、WEBP、GIF 或 BMP 图片')).toBeInTheDocument()
  })
})
