// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiGet, apiPatch } from '../../../src/lib/apiClient'
import AlbumTrackEditor from '../../../src/components/AlbumTrackEditor'
import { ToastProvider } from '../../../src/components/Toast'
import type { AdminDataItem } from '../../../src/types/entities'

vi.mock('../../../src/lib/apiClient', () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  invalidateMusicApiCaches: vi.fn(),
}))

const mockedApiGet = vi.mocked(apiGet)
const mockedApiPatch = vi.mocked(apiPatch)

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
        title: '主碟歌曲',
        artists: ['歌手'],
        trackOrder: 0,
        discNumber: 1,
      },
      {
        docId: 'song-2',
        title: '附碟歌曲',
        artists: ['歌手'],
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

const renderEditor = () =>
  render(
    <ToastProvider>
      <AlbumTrackEditor open album={album} onClose={vi.fn()} onChanged={vi.fn()} />
    </ToastProvider>
  )

describe('AlbumTrackEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedApiPatch.mockResolvedValue({} as never)
  })

  it('保存单个 Disc 时提交完整专辑曲目并保留其它 Disc', async () => {
    mockedApiGet.mockResolvedValue(detail as never)
    renderEditor()
    expect(await screen.findByText('附碟歌曲')).toBeInTheDocument()
    expect(screen.getAllByText('歌手')).toHaveLength(2)
    expect(await screen.findByText('附碟')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '保存轨序' })[0])

    await waitFor(() => expect(mockedApiPatch).toHaveBeenCalledOnce())
    const [, body] = mockedApiPatch.mock.calls[0]
    expect(body).toEqual({
      tracks: [
        {
          disc: 1,
          name: '主碟',
          songs: [{ songDocId: 'song-1', trackOrder: 0 }],
        },
        {
          disc: 2,
          name: '附碟',
          songs: [{ songDocId: 'song-2', trackOrder: 0 }],
        },
      ],
    })
  })

  it('详情加载失败时显示错误和重试入口', async () => {
    mockedApiGet.mockRejectedValueOnce(new Error('详情服务不可用'))
    renderEditor()

    expect(await screen.findByRole('alert')).toHaveTextContent('详情服务不可用')
    expect(screen.queryByText('暂无 Disc，请先创建 Disc')).not.toBeInTheDocument()

    mockedApiGet.mockResolvedValueOnce(detail as never)
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(await screen.findByText('附碟')).toBeInTheDocument()
  })
})
