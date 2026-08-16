// @vitest-environment jsdom
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  invalidateMusicApiCaches,
} from '../../../src/lib/apiClient'
import AlbumTrackEditor from '../../../src/components/AlbumTrackEditor'
import { DialogProvider } from '../../../src/components/Dialog'
import { ToastProvider } from '../../../src/components/Toast'
import type { AdminDataItem } from '../../../src/types/entities'

vi.mock('../../../src/lib/apiClient', () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  invalidateMusicApiCaches: vi.fn(),
}))

const mockedApiDelete = vi.mocked(apiDelete)
const mockedApiGet = vi.mocked(apiGet)
const mockedApiPatch = vi.mocked(apiPatch)
const mockedApiPost = vi.mocked(apiPost)
const mockedInvalidateMusicApiCaches = vi.mocked(invalidateMusicApiCaches)

const album = {
  docId: 'album-1',
  slug: '1001',
  title: '测试专辑',
} as unknown as AdminDataItem

const detail = {
  album: {
    docId: 'album-1',
    tracks: [
      {
        docId: 'song-1',
        title: '第一首',
        artists: ['歌手甲'],
        trackOrder: 0,
        discNumber: 1,
      },
      {
        docId: 'song-2',
        title: '第二首',
        artists: ['歌手乙'],
        trackOrder: 1,
        discNumber: 1,
      },
      {
        docId: 'song-3',
        title: '附碟歌曲',
        artists: ['歌手丙'],
        trackOrder: 0,
        discNumber: 2,
      },
    ],
    discs: [
      { disc: 1, name: '主碟', songs: [] },
      { disc: 2, name: '附碟', songs: [] },
    ],
  },
}

const renderEditor = (overrides: Partial<React.ComponentProps<typeof AlbumTrackEditor>> = {}) => {
  const onClose = overrides.onClose || vi.fn()
  const onChanged = overrides.onChanged || vi.fn()
  render(
    <DialogProvider>
      <ToastProvider>
        <AlbumTrackEditor
          open
          album={album}
          onClose={onClose}
          onChanged={onChanged}
          {...overrides}
        />
      </ToastProvider>
    </DialogProvider>
  )
  return { onClose, onChanged }
}

const moveSecondTrackUp = async () => {
  await screen.findByText('第二首')
  await userEvent.click(screen.getByRole('button', { name: '将《第二首》上移' }))
}
describe('AlbumTrackEditor', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedApiGet.mockResolvedValue(detail as never)
    mockedApiPatch.mockResolvedValue({} as never)
    mockedApiPost.mockResolvedValue({} as never)
    mockedApiDelete.mockResolvedValue({} as never)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('调整轨序并保存时提交完整专辑快照并保留其它 Disc', async () => {
    const { onChanged } = renderEditor()

    await screen.findByText('第二首')
    expect(screen.getByRole('button', { name: /拖动《第一首》调整顺序/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: '将《第一首》上移' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '将《第二首》下移' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: '将《第二首》上移' }))

    expect(screen.getAllByRole('status').at(-1)).toHaveTextContent(
      '《第二首》已移至第 1 首，共 2 首'
    )
    expect(screen.getByRole('button', { name: '保存编排' })).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: '保存编排' }))

    await waitFor(() => expect(mockedApiPatch).toHaveBeenCalledOnce())
    expect(mockedApiPatch).toHaveBeenCalledWith('/api/albums/album-1/tracks/reorder', {
      tracks: [
        {
          disc: 1,
          name: '主碟',
          songs: [
            { songDocId: 'song-2', trackOrder: 0 },
            { songDocId: 'song-1', trackOrder: 1 },
          ],
        },
        {
          disc: 2,
          name: '附碟',
          songs: [{ songDocId: 'song-3', trackOrder: 0 }],
        },
      ],
    })
    expect(mockedInvalidateMusicApiCaches).toHaveBeenCalledOnce()
    expect(onChanged).toHaveBeenCalledOnce()
    await waitFor(() => expect(mockedApiGet).toHaveBeenCalledTimes(2))
  })

  it('详情加载失败时显示错误和重试入口', async () => {
    mockedApiGet.mockRejectedValueOnce(new Error('详情服务不可用'))
    renderEditor()

    expect(await screen.findByRole('alert')).toHaveTextContent('详情服务不可用')
    expect(screen.queryByText('暂无 Disc')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(await screen.findByText('附碟')).toBeInTheDocument()
  })

  it('搜索结果直接添加到当前 Disc 并提交追加轨序', async () => {
    const newSong = {
      docId: 'song-new',
      title: '新歌曲',
      artists: ['歌手丁'],
    }
    mockedApiGet
      .mockResolvedValueOnce(detail as never)
      .mockResolvedValueOnce({ data: [newSong] } as never)
    renderEditor()

    expect(await screen.findByText('第一首')).toBeInTheDocument()
    vi.useFakeTimers()
    fireEvent.change(screen.getByRole('combobox', { name: '添加歌曲' }), {
      target: { value: ' 新歌 ' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    fireEvent.click(screen.getByRole('option', { name: /新歌曲/ }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockedApiPost).toHaveBeenCalledOnce()
    expect(mockedApiPost).toHaveBeenCalledWith('/api/music/song-new/albums', {
      albumDocId: 'album-1',
      discNumber: 1,
      trackOrder: 2,
      isDisplay: false,
    })
    expect(screen.getByRole('combobox', { name: '添加歌曲' })).toHaveValue('')
  })

  it('保存失败时保留顺序草稿且不通知外层刷新', async () => {
    mockedApiPatch.mockRejectedValueOnce(new Error('服务暂不可用'))
    const { onChanged } = renderEditor()

    await moveSecondTrackUp()
    await userEvent.click(screen.getByRole('button', { name: '保存编排' }))

    expect(await screen.findByText('服务暂不可用')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存编排' })).toBeEnabled()
    expect(mockedInvalidateMusicApiCaches).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
    expect(mockedApiGet).toHaveBeenCalledOnce()
  })

  it('关闭未保存编排前要求确认', async () => {
    const { onClose } = renderEditor()

    await moveSecondTrackUp()
    await userEvent.click(screen.getByRole('button', { name: '关闭' }))

    expect(
      await screen.findByRole('alertdialog', { name: '放弃未保存的编排？' })
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '继续编辑' }))
    expect(onClose).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '关闭' }))
    await userEvent.click(await screen.findByRole('button', { name: '放弃并关闭' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('移出曲目前要求确认，确认后请求精确端点', async () => {
    renderEditor()

    await screen.findByText('第一首')
    await userEvent.click(screen.getByRole('button', { name: '移出《第一首》' }))
    await userEvent.click(await screen.findByRole('button', { name: '取消' }))
    expect(mockedApiDelete).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '移出《第一首》' }))
    await userEvent.click(await screen.findByRole('button', { name: '移出' }))
    await waitFor(() => expect(mockedApiDelete).toHaveBeenCalledOnce())
    expect(mockedApiDelete).toHaveBeenCalledWith('/api/music/song-1/albums/album-1')
  })
})
