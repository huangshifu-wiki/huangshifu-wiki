// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DialogProvider } from '../../../src/components/Dialog'
import { ToastProvider } from '../../../src/components/Toast'
import { AdminMusicPage } from '../../../src/pages/Admin/AdminMusicPage'
import { apiGet } from '../../../src/lib/apiClient'

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
})
