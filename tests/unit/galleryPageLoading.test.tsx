// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiGet } from '../../src/lib/apiClient'
import Gallery from '../../src/pages/Gallery'
import type { GalleryItem } from '../../src/types/entities'

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
  invalidateApiCacheByPrefix: vi.fn(),
}))

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ user: null, isAdmin: false, isBanned: false }),
}))

vi.mock('../../src/context/UserPreferencesContext', () => ({
  useUserPreferences: () => ({
    preferences: {
      listLoadMode: 'pagination',
    },
    getScopedViewMode: () => 'list',
    setScopedViewMode: vi.fn(),
  }),
}))

const mockedApiGet = vi.mocked(apiGet)

type GalleryResponse = {
  galleries: GalleryItem[]
  total: number
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const gallery = {
  id: 'gallery-1',
  title: '春日图集',
  description: '春日记录',
  authorUid: 'user-1',
  authorName: '作者',
  tags: [],
  eventDate: null,
  locationCode: null,
  locationName: null,
  locationDetail: null,
  copyright: null,
  status: 'published',
  published: true,
  publishedAt: '2025-01-01T00:00:00.000Z',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  images: [],
} as GalleryItem

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/gallery']}>
      <Gallery />
    </MemoryRouter>
  )

const configureApi = (galleryRequest: Promise<GalleryResponse>) => {
  mockedApiGet.mockImplementation((path: string) => {
    if (path === '/api/galleries') return galleryRequest as never
    if (path === '/api/config/gallery-access') {
      return Promise.resolve({ adminOnly: false }) as never
    }
    return Promise.reject(new Error(`unexpected apiGet path: ${path}`)) as never
  })
}

describe('画廊列表加载状态', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('请求未完成时显示画廊骨架，不显示成功空态；空数组返回后才显示空态', async () => {
    const request = deferred<GalleryResponse>()
    configureApi(request.promise)

    renderPage()

    expect(await screen.findByRole('status', { name: '加载中' })).toBeInTheDocument()
    expect(screen.queryByText('暂无图集，快来上传吧！')).not.toBeInTheDocument()

    request.resolve({ galleries: [], total: 0 })

    expect(await screen.findByText('暂无图集，快来上传吧！')).toBeInTheDocument()
  })

  it('成功返回图集后显示内容', async () => {
    const request = deferred<GalleryResponse>()
    configureApi(request.promise)

    renderPage()
    request.resolve({ galleries: [gallery], total: 1 })

    expect(await screen.findByText('春日图集')).toBeInTheDocument()
    expect(screen.queryByText('暂无图集，快来上传吧！')).not.toBeInTheDocument()
  })

  it('请求失败显示错误和重试按钮，而不是成功空态', async () => {
    let attempts = 0
    mockedApiGet.mockImplementation((path: string) => {
      if (path === '/api/config/gallery-access') {
        return Promise.resolve({ adminOnly: false }) as never
      }
      if (path === '/api/galleries') {
        attempts += 1
        return attempts === 1
          ? (Promise.reject(new Error('gallery unavailable')) as never)
          : (Promise.resolve({ galleries: [gallery], total: 1 }) as never)
      }
      return Promise.reject(new Error(`unexpected apiGet path: ${path}`)) as never
    })

    renderPage()

    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent('加载失败')
    expect(screen.queryByText('暂无图集，快来上传吧！')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))

    await waitFor(() => expect(screen.getByText('春日图集')).toBeInTheDocument())
    expect(attempts).toBe(2)
  })
})
