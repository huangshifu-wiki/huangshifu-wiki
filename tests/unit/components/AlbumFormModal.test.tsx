// @vitest-environment jsdom
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AlbumFormModal } from '../../../src/components/AlbumFormModal'
import { ToastProvider } from '../../../src/components/Toast'
import { DialogProvider } from '../../../src/components/Dialog'
import type { AdminDataItem } from '../../../src/types/entities'
import { apiPatch, apiPost } from '../../../src/lib/apiClient'

vi.mock('../../../src/lib/apiClient', () => ({
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  invalidateMusicApiCaches: vi.fn(),
}))

const mockedApiPost = vi.mocked(apiPost)
const mockedApiPatch = vi.mocked(apiPatch)

const renderModal = (overrides: Partial<React.ComponentProps<typeof AlbumFormModal>> = {}) =>
  render(
    <ToastProvider>
      <DialogProvider>
        <AlbumFormModal
          open
          mode="create"
          album={null}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          {...overrides}
        />
      </DialogProvider>
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

  it('重复来源时弹窗提醒，确认后才触发成功回调', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    mockedApiPost.mockResolvedValue({
      duplicates: [
        {
          platform: 'netease',
          sourceId: '123456',
          album: { docId: 'album-x', title: '已有专辑' },
        },
      ],
    })
    renderModal({ onClose, onSuccess })

    await user.type(screen.getByLabelText('专辑标题 *'), '共享来源专辑')
    await user.type(screen.getByLabelText('艺术家 *'), '黄诗扶')
    await user.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(screen.getByRole('alertdialog')).toHaveTextContent('平台ID重复提醒'))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('已被专辑「已有专辑」使用')
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '知道了' }))
    expect(onSuccess).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('编辑模式更新时同样处理重复提醒', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    mockedApiPatch.mockResolvedValue({
      duplicates: [
        {
          platform: 'tencent',
          sourceId: '8888',
          album: { docId: 'album-y', title: '另一专辑' },
        },
      ],
    })
    renderModal({
      mode: 'edit',
      album: {
        docId: 'album-1',
        title: '旧专辑',
        artist: '黄诗扶',
        sources: [],
      } as unknown as AdminDataItem,
      onClose,
      onSuccess,
    })

    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(screen.getByRole('alertdialog')).toHaveTextContent('平台ID重复提醒'))
    expect(onSuccess).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '知道了' }))
    expect(onSuccess).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Esc 关闭提醒弹窗时保存流程继续并给出成功反馈', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    mockedApiPost.mockResolvedValue({
      duplicates: [
        {
          platform: 'netease',
          sourceId: '123456',
          album: { docId: 'album-x', title: '已有专辑' },
        },
      ],
    })
    renderModal({ onClose, onSuccess })

    await user.type(screen.getByLabelText('专辑标题 *'), '共享来源专辑')
    await user.type(screen.getByLabelText('艺术家 *'), '黄诗扶')
    await user.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(screen.getByRole('alertdialog')).toHaveTextContent('平台ID重复提醒'))
    await user.keyboard('{Escape}')

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.getByText('专辑已创建')).toBeInTheDocument()
  })
})
