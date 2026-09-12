// @vitest-environment jsdom
import React from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiGet } from '../../src/lib/apiClient'
import { DialogProvider } from '../../src/components/Dialog'
import { ToastProvider } from '../../src/components/Toast'
import GalleryDetail from '../../src/pages/GalleryDetail'
import type { GalleryItem } from '../../src/types/entities'

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}))

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ user: null, profile: null, isAdmin: false, isBanned: false }),
}))

vi.mock('../../src/components/SmartBackLink', () => ({
  SmartBackLink: () => null,
}))

vi.mock('../../src/components/SmartImage', () => ({
  SmartImage: ({ fallback, className }: { fallback?: React.ReactNode; className?: string }) => (
    <div className={className}>{fallback}</div>
  ),
}))

vi.mock('../../src/components/Lightbox', () => ({
  Lightbox: () => null,
}))

const mockedApiGet = vi.mocked(apiGet)

const gallery = {
  id: 'gallery-1',
  slug: 'spring-gallery',
  title: '春日图集',
  description: '# 出行记录\n\n**大雨** 也没挡住行程',
  authorUid: 'user-1',
  authorName: '作者',
  tags: [],
  relatedLinks: [],
  status: 'published',
  published: true,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  images: [],
} as GalleryItem

const renderDetail = () =>
  render(
    <MemoryRouter initialEntries={['/gallery/spring-gallery']}>
      <Routes>
        <Route
          path="/gallery/:galleryId"
          element={
            <DialogProvider>
              <ToastProvider>
                <GalleryDetail />
              </ToastProvider>
            </DialogProvider>
          }
        />
      </Routes>
    </MemoryRouter>
  )

const configureApi = (galleryResponse: GalleryItem) => {
  mockedApiGet.mockImplementation((path: string) => {
    if (path === '/api/galleries/spring-gallery') {
      return Promise.resolve({ gallery: galleryResponse }) as never
    }
    if (path === '/api/config/gallery-access') {
      return Promise.resolve({ adminOnly: false }) as never
    }
    if (path === '/api/galleries/gallery-1/comments') {
      return Promise.resolve({ comments: [] }) as never
    }
    return Promise.reject(new Error(`unexpected apiGet path: ${path}`)) as never
  })
}

describe('GalleryDetail 图集描述渲染', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    configureApi(gallery)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('描述按 Markdown 渲染为标题与加粗文本', async () => {
    renderDetail()

    expect(await screen.findByRole('heading', { level: 1, name: '出行记录' })).toBeInTheDocument()
    expect(screen.getByText('大雨').closest('strong')).not.toBeNull()
  })

  it('描述为空时显示占位文案，不渲染 Markdown 内容', async () => {
    configureApi({ ...gallery, description: '' })

    renderDetail()

    expect(await screen.findByText('暂无描述')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '出行记录' })).not.toBeInTheDocument()
  })
})

describe('GalleryDetail 相关链接', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('站内路径走同页跳转，站外地址新窗口打开', async () => {
    configureApi({
      ...gallery,
      relatedLinks: [
        { label: '配套游记', url: '/events/259' },
        { label: '站外报道', url: 'https://example.com/news' },
      ],
    })

    renderDetail()

    const internalLink = await screen.findByRole('link', { name: '配套游记' })
    expect(internalLink).toHaveAttribute('href', '/events/259')
    expect(internalLink).not.toHaveAttribute('target')

    const externalLink = screen.getByRole('link', { name: '站外报道' })
    expect(externalLink).toHaveAttribute('href', 'https://example.com/news')
    expect(externalLink).toHaveAttribute('target', '_blank')
    expect(externalLink).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('没有相关链接时不渲染相关链接面板', async () => {
    configureApi(gallery)

    renderDetail()

    expect(await screen.findByRole('heading', { level: 1, name: '出行记录' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '相关链接' })).not.toBeInTheDocument()
  })
})
