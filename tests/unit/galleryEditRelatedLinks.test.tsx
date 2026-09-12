// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import GalleryEdit from '../../src/pages/GalleryEdit'
import { apiGet, apiPatch } from '../../src/lib/apiClient'
import type { GalleryItem } from '../../src/types/entities'

const toastShow = vi.hoisted(() => vi.fn())

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  invalidateApiCacheByPrefix: vi.fn(),
}))
vi.mock('../../src/hooks/useTagSuggestions', () => ({ useTagSuggestions: () => [] }))
vi.mock('../../src/components/Toast', () => ({ useToast: () => ({ show: toastShow }) }))
vi.mock('../../src/components/Dialog', () => ({ useDialog: () => ({ confirm: vi.fn() }) }))
vi.mock('../../src/components/LocationTagInput', () => ({ LocationTagInput: () => null }))
vi.mock('../../src/components/MarkdownEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="图集描述" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))
vi.mock('../../src/components/SmartImage', () => ({
  SmartImage: ({ src, alt }: { src?: string | null; alt?: string }) => (
    <img src={src || undefined} alt={alt} />
  ),
}))
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'user-1', role: 'user' },
    isAdmin: false,
    isBanned: false,
    loading: false,
  }),
}))

const galleryFixture = {
  id: 'gallery-1',
  slug: '1024',
  title: '春日图集',
  description: '',
  authorUid: 'user-1',
  authorName: '作者',
  tags: [],
  relatedLinks: [{ label: '配套游记', url: '/events/259' }],
  eventDate: null,
  locationCode: null,
  locationName: null,
  locationDetail: null,
  copyright: null,
  status: 'draft',
  published: false,
  publishedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  images: [
    {
      id: 'image-1',
      assetId: 'asset-1',
      url: '/uploads/image-1.jpg',
      thumbnailUrl: '/uploads/image-1-thumb.webp',
      thumbnailStatus: 'completed',
      name: 'image-1.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
    },
  ],
} as unknown as GalleryItem

const labelInputs = () => screen.getAllByLabelText('相关链接名称')
const urlInputs = () => screen.getAllByLabelText('相关链接地址')

describe('GalleryEdit 相关链接', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiGet).mockImplementation((path: string) => {
      if (path === '/api/config/gallery-access') {
        return Promise.resolve({ adminOnly: false }) as never
      }
      if (path === '/api/galleries/gallery-1') {
        return Promise.resolve({ gallery: galleryFixture }) as never
      }
      return Promise.resolve({}) as never
    })
    vi.mocked(apiPatch).mockResolvedValue({ gallery: galleryFixture } as never)
  })

  const renderPage = async () => {
    render(
      <MemoryRouter initialEntries={['/gallery/gallery-1/edit']}>
        <Routes>
          <Route path="/gallery/:galleryId/edit" element={<GalleryEdit />} />
        </Routes>
      </MemoryRouter>
    )
    await screen.findByDisplayValue('春日图集')
  }

  it('回填已有链接，新增空白行并在保存时丢弃', async () => {
    await renderPage()
    expect(labelInputs()[0]).toHaveValue('配套游记')
    expect(urlInputs()[0]).toHaveValue('/events/259')

    fireEvent.click(screen.getByLabelText('添加相关链接'))
    fireEvent.click(screen.getByLabelText('添加相关链接'))
    expect(labelInputs()).toHaveLength(3)

    fireEvent.change(labelInputs()[1], { target: { value: '  新图集  ' } })
    fireEvent.change(urlInputs()[1], { target: { value: ' /gallery/2048 ' } })

    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))

    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1))
    const body = vi.mocked(apiPatch).mock.calls[0][1] as { relatedLinks: unknown }
    expect(body.relatedLinks).toEqual([
      { label: '配套游记', url: '/events/259' },
      { label: '新图集', url: '/gallery/2048' },
    ])
  })

  it('拦截站外协议地址，不发出保存请求', async () => {
    await renderPage()

    fireEvent.click(screen.getByLabelText('添加相关链接'))
    fireEvent.change(labelInputs()[1], { target: { value: '奖励' } })
    fireEvent.change(urlInputs()[1], { target: { value: 'javascript:alert(1)' } })

    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))

    await waitFor(() => expect(toastShow).toHaveBeenCalled())
    expect(vi.mocked(toastShow).mock.calls.at(-1)?.[0]).toMatch(/相关链接地址必须是/)
    expect(apiPatch).not.toHaveBeenCalled()
  })
})
