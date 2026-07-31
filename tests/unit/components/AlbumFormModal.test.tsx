// @vitest-environment jsdom
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AlbumFormModal } from '../../../src/components/AlbumFormModal'
import { ToastProvider } from '../../../src/components/Toast'
import { apiPost } from '../../../src/lib/apiClient'

vi.mock('../../../src/lib/apiClient', () => ({
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  invalidateMusicApiCaches: vi.fn(),
}))

const mockedApiPost = vi.mocked(apiPost)

const renderModal = (overrides: Partial<React.ComponentProps<typeof AlbumFormModal>> = {}) =>
  render(
    <ToastProvider>
      <AlbumFormModal
        open
        mode="create"
        album={null}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        {...overrides}
      />
    </ToastProvider>
  )

describe('AlbumFormModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedApiPost.mockResolvedValue({})
  })

  it('标题或艺术家为空时不发创建请求', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('button', { name: '创建' }))
    expect(mockedApiPost).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('专辑标题 *'), '手动专辑')
    await user.click(screen.getByRole('button', { name: '创建' }))
    expect(mockedApiPost).not.toHaveBeenCalled()
  })

  it('成功提交发送四字段并触发成功回调', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    renderModal({ onClose, onSuccess })

    await user.type(screen.getByLabelText('专辑标题 *'), '  手动测试专辑  ')
    await user.type(screen.getByLabelText('艺术家 *'), '  黄诗扶  ')
    await user.type(screen.getByLabelText('专辑简介'), '  简介  ')
    await user.type(screen.getByLabelText('发行日期'), '2026-07-30')
    await user.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(mockedApiPost).toHaveBeenCalledOnce())
    expect(mockedApiPost).toHaveBeenCalledWith('/api/albums', {
      title: '手动测试专辑',
      artist: '黄诗扶',
      description: '简介',
      releaseDate: '2026-07-30',
      sources: [],
    })
    expect(onSuccess).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })
})
