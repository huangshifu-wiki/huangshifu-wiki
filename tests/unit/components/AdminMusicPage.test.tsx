// @vitest-environment jsdom
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { DialogProvider } from '../../../src/components/Dialog'
import { ToastProvider } from '../../../src/components/Toast'
import { AdminMusicPage } from '../../../src/pages/Admin/AdminMusicPage'
import { apiGet, apiPatch } from '../../../src/lib/apiClient'

vi.mock('../../../src/lib/apiClient', () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  invalidateMusicApiCaches: vi.fn(),
}))

vi.mock('../../../src/components/SmartImage', () => {
  const MockSmartImage = ({
    src,
    alt,
    className,
    fallback,
  }: {
    src?: string | null
    alt?: string
    className?: string
    fallback?: React.ReactNode
  }) => {
    const [hasError, setHasError] = React.useState(!src)

    if (hasError) {
      return <div className={className}>{fallback}</div>
    }

    return (
      <img
        src={src}
        alt={alt}
        className={className}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        onError={() => setHasError(true)}
      />
    )
  }

  return { SmartImage: MockSmartImage }
})

const mockedApiGet = vi.mocked(apiGet)

const renderPage = (entry = '/admin/music') =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <DialogProvider>
        <ToastProvider>
          <AdminMusicPage />
        </ToastProvider>
      </DialogProvider>
    </MemoryRouter>
  )

const expectSquareCovers = async (count: number) => {
  const covers = await waitFor(() => {
    const elements = screen.getAllByTestId('music-list-cover')
    expect(elements).toHaveLength(count)
    return elements
  })

  for (const cover of covers) {
    expect(cover).toHaveClass('relative', 'aspect-square', 'h-12', 'w-12', 'shrink-0')
  }

  return covers
}

describe('AdminMusicPage list covers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps song covers square for portrait, landscape, and empty sources', async () => {
    mockedApiGet.mockResolvedValue({
      data: [
        {
          docId: 'song-landscape',
          title: '横向歌曲',
          artists: ['测试歌手'],
          album: '',
          cover: 'https://example.com/landscape.jpg',
          coverThumbnail: 'https://example.com/landscape-thumb.jpg',
        },
        {
          docId: 'song-empty',
          title: '无封面歌曲',
          artists: ['测试歌手'],
          album: '',
          cover: '',
          coverThumbnail: '',
        },
      ],
      total: 2,
    } as never)
    renderPage()

    const covers = await expectSquareCovers(2)
    const image = await screen.findByAltText('横向歌曲 封面')
    expect(image).toHaveStyle({ width: '100%', height: '100%', objectFit: 'cover' })
    expect(covers[1]).toHaveTextContent('无封面')

    fireEvent.error(image)
    await waitFor(() =>
      expect(screen.getAllByTestId('music-list-cover')[0]).toHaveTextContent('无封面')
    )
    expect(screen.getByText('横向歌曲')).toBeInTheDocument()
  })
  it('keeps album covers square and preserves the empty-cover placeholder', async () => {
    mockedApiGet.mockResolvedValue({
      data: [
        {
          docId: 'album-portrait',
          title: '纵向专辑',
          artist: '测试歌手',
          cover: 'https://example.com/portrait.jpg',
          coverThumbnail: '',
          trackCount: 1,
          discCount: 1,
        },
        {
          docId: 'album-empty',
          title: '无封面专辑',
          artist: '测试歌手',
          cover: '',
          coverThumbnail: '',
          trackCount: 0,
          discCount: 0,
        },
      ],
      total: 2,
    } as never)

    renderPage('/admin/music?musicTab=albums')

    const covers = await expectSquareCovers(2)
    expect(await screen.findByAltText('纵向专辑 封面')).toHaveStyle({
      width: '100%',
      height: '100%',
      objectFit: 'cover',
    })
    expect(covers[1]).toHaveTextContent('无封面')
  })

  it('loads both song and album tab counts on mount', async () => {
    mockedApiGet.mockImplementation(async (path: string) => {
      if (path === '/api/admin/music')
        return {
          data: [{ docId: 's1', title: '歌曲一', artists: ['歌手'] }],
          total: 12,
        } as never
      if (path === '/api/admin/albums') return { data: [], total: 7 } as never
      throw new Error(`unexpected apiGet path: ${path}`)
    })
    renderPage()
    expect(await screen.findByText('歌曲 (12)')).toBeInTheDocument()
    expect(await screen.findByText('专辑 (7)')).toBeInTheDocument()
  })

  it('keeps songPage from the URL after data loads', async () => {
    mockedApiGet.mockResolvedValue({
      data: [
        {
          docId: 's1',
          title: '歌曲一',
          artists: ['歌手'],
          album: '',
          cover: '',
          coverThumbnail: '',
        },
      ],
      total: 250,
    } as never)
    renderPage('/admin/music?songPage=2')

    await waitFor(() => {
      const musicCalls = mockedApiGet.mock.calls.filter(([path]) => path === '/api/admin/music')
      expect(musicCalls.length).toBeGreaterThan(0)
      expect(musicCalls[musicCalls.length - 1][1]).toMatchObject({ page: 2 })
    })
    expect(await screen.findByText('第 2 / 5 页')).toBeInTheDocument()
  })

  it('编辑保存后静默刷新：旧行在途可见、数据原地更新', async () => {
    let musicCallCount = 0
    let releaseRefresh: (value: unknown) => void
    const refreshGate = new Promise((resolve) => {
      releaseRefresh = resolve
    })
    mockedApiGet.mockImplementation(async (path: string) => {
      if (path === '/api/admin/music') {
        musicCallCount += 1
        if (musicCallCount === 1) {
          return {
            data: [{ docId: 's1', title: '歌曲一', artists: ['歌手'] }],
            total: 1,
          } as never
        }
        return refreshGate as never
      }
      if (path === '/api/admin/albums') {
        return { data: [], total: 0 } as never
      }
      throw new Error(`unexpected apiGet path: ${path}`)
    })
    vi.mocked(apiPatch).mockResolvedValue({} as never)
    renderPage()

    expect(await screen.findByText('歌曲一')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const titleInput = await screen.findByPlaceholderText('歌曲名称')
    fireEvent.change(titleInput, { target: { value: '歌曲一（已更新）' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    // 静默刷新在途：旧行仍在文档中（未被骨架屏替换），新数据未出现
    await waitFor(() => expect(musicCallCount).toBe(2))
    expect(screen.getByText('歌曲一')).toBeInTheDocument()
    expect(screen.queryByText('歌曲一（已更新）')).not.toBeInTheDocument()

    act(() => {
      releaseRefresh!({
        data: [{ docId: 's1', title: '歌曲一（已更新）', artists: ['歌手'] }],
        total: 1,
      })
    })
    expect(await screen.findByText('歌曲一（已更新）')).toBeInTheDocument()
  })

  it('静默刷新失败时保留现有列表并提示', async () => {
    let musicCallCount = 0
    mockedApiGet.mockImplementation(async (path: string) => {
      if (path === '/api/admin/music') {
        musicCallCount += 1
        if (musicCallCount === 1) {
          return {
            data: [{ docId: 's1', title: '歌曲一', artists: ['歌手'] }],
            total: 1,
          } as never
        }
        throw new Error('获取歌曲列表失败')
      }
      if (path === '/api/admin/albums') {
        return { data: [], total: 0 } as never
      }
      throw new Error(`unexpected apiGet path: ${path}`)
    })
    vi.mocked(apiPatch).mockResolvedValue({} as never)
    renderPage()

    expect(await screen.findByText('歌曲一')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const titleInput = await screen.findByPlaceholderText('歌曲名称')
    fireEvent.change(titleInput, { target: { value: '歌曲一（已更新）' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(musicCallCount).toBe(2))
    expect(await screen.findByText('获取歌曲列表失败')).toBeInTheDocument()
    expect(screen.getByText('歌曲一')).toBeInTheDocument()
    expect(screen.queryByText('歌曲一（已更新）')).not.toBeInTheDocument()
  })
  it('取消歌曲勾选后清除选择状态', async () => {
    mockedApiGet.mockImplementation(async (path: string) => {
      if (path === '/api/admin/music') {
        return {
          data: [{ docId: 'song-1', title: '歌曲一', artists: ['歌手'] }],
          total: 1,
        } as never
      }
      if (path === '/api/admin/albums') return { data: [], total: 0 } as never
      throw new Error(`unexpected apiGet path: ${path}`)
    })
    const user = userEvent.setup()
    renderPage()

    const checkbox = await screen.findByRole('checkbox', { name: '选择 歌曲一' })
    const batchButton = screen.getByRole('button', { name: '批量设置展示' })
    expect(batchButton).toBeDisabled()

    await user.click(checkbox)
    expect(batchButton).not.toBeDisabled()
    await user.click(checkbox)
    expect(batchButton).toBeDisabled()
  })

  it('修改非关键词筛选时不会提交未点击搜索的关键词', async () => {
    const albumCalls: Array<Record<string, unknown> | undefined> = []
    mockedApiGet.mockImplementation(async (path: string, query?: Record<string, unknown>) => {
      if (path === '/api/admin/albums') {
        albumCalls.push(query)
        return { data: [], total: 0 } as never
      }
      if (path === '/api/admin/music') return { data: [], total: 0 } as never
      throw new Error(`unexpected apiGet path: ${path}`)
    })
    const user = userEvent.setup()
    renderPage('/admin/music?musicTab=albums')

    const queryInput = await screen.findByPlaceholderText('搜索专辑、艺人或简介')
    await user.type(queryInput, '未提交关键词')
    await user.selectOptions(screen.getByLabelText('平台'), 'netease')

    await waitFor(() => expect(albumCalls.length).toBeGreaterThan(1))
    const latestQuery = albumCalls[albumCalls.length - 1]
    expect(latestQuery).toMatchObject({ platform: 'netease' })
    expect(latestQuery?.q).toBeUndefined()
  })
})
