// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AdminEventEdit from '../../src/pages/Admin/AdminEventEdit'

const mockApiGet = vi.hoisted(() => vi.fn())
const mockApiPost = vi.hoisted(() => vi.fn())
const mockApiPut = vi.hoisted(() => vi.fn())
const mockInvalidateApiCacheByPrefix = vi.hoisted(() => vi.fn())
const mockShowToast = vi.hoisted(() => vi.fn())
const mockUploadImageWithStrategy = vi.hoisted(() => vi.fn())

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
  apiPost: mockApiPost,
  apiPut: mockApiPut,
  invalidateApiCacheByPrefix: mockInvalidateApiCacheByPrefix,
}))

vi.mock('../../src/components/Toast', () => ({
  useToast: () => ({
    show: mockShowToast,
  }),
}))

vi.mock('../../src/components/SmartImage', () => ({
  SmartImage: (props: { alt?: string; className?: string; src?: string }) => (
    <img alt={props.alt || ''} className={props.className} src={props.src || ''} />
  ),
}))

vi.mock('../../src/components/MarkdownEditor', () => ({
  default: (props: { value: string; onChange: (value: string) => void }) => (
    <textarea
      aria-label="活动内容"
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}))

vi.mock('../../src/services/imageService', () => ({
  uploadImageWithStrategy: mockUploadImageWithStrategy,
}))

const objectUrls: string[] = []

const renderCreatePage = () =>
  render(
    <MemoryRouter initialEntries={['/admin/events/new']}>
      <Routes>
        <Route path="/admin/events" element={<div>活动列表</div>} />
        <Route path="/admin/events/new" element={<AdminEventEdit />} />
        <Route path="/admin/events/:eventId/edit" element={<AdminEventEdit />} />
      </Routes>
    </MemoryRouter>
  )

const renderEditPage = () =>
  render(
    <MemoryRouter initialEntries={['/admin/events/event-1/edit']}>
      <Routes>
        <Route path="/admin/events" element={<div>活动列表</div>} />
        <Route path="/admin/events/:eventId/edit" element={<AdminEventEdit />} />
      </Routes>
    </MemoryRouter>
  )

const makeImageFile = (name: string) => new File(['image'], name, { type: 'image/jpeg' })

describe('AdminEventEdit 上传体验', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    objectUrls.length = 0
    global.URL.createObjectURL = vi.fn(() => {
      const url = `blob:preview-${objectUrls.length + 1}`
      objectUrls.push(url)
      return url
    })
    global.URL.revokeObjectURL = vi.fn()
    mockApiPost.mockResolvedValue({
      event: {
        id: 'event-1',
      },
    })
    mockApiPut.mockResolvedValue({
      event: {
        id: 'event-1',
      },
    })
    mockApiGet.mockResolvedValue({
      item: {
        id: 'event-1',
        slug: 'test-event',
        title: '旧活动',
        location: '',
        content: '',
        timeSlots: [],
        ticketPrices: [],
        saleTimes: [],
        lineup: [],
        tags: ['旧标签'],
        externalLinks: [],
        relatedLinks: [],
        sortStart: null,
        sortEnd: null,
        coverAssetId: null,
        coverUrl: null,
        coverName: null,
        createdByUid: 'admin',
        createdByName: null,
        updatedByUid: null,
        updatedByName: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        posters: [],
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('上传封面时不阻止继续选择海报，并展示本地预览和进度', async () => {
    const user = userEvent.setup()
    let resolveCoverUpload: (value: unknown) => void = () => undefined
    mockUploadImageWithStrategy.mockImplementation((file: File, options) => {
      options?.onProgress?.(45)
      if (file.name === 'cover.jpg') {
        return new Promise((resolve) => {
          resolveCoverUpload = resolve
        })
      }
      return Promise.resolve({
        assetId: 'poster-asset-1',
        url: '/uploads/poster.jpg',
        storageType: 'local',
      })
    })

    renderCreatePage()

    await user.type(screen.getByPlaceholderText('活动标题'), '测试活动')
    const fileInputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]')
    await user.upload(fileInputs[0], makeImageFile('cover.jpg'))

    expect(screen.getByAltText('封面')).toHaveAttribute('src', 'blob:preview-1')
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()

    await user.upload(fileInputs[1], makeImageFile('poster.jpg'))

    expect(screen.getByAltText('poster.jpg')).toBeInTheDocument()
    expect(mockUploadImageWithStrategy).toHaveBeenCalledTimes(2)

    resolveCoverUpload({
      assetId: 'cover-asset-1',
      url: '/uploads/cover.jpg',
      storageType: 'local',
    })

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('封面已上传')
    })
  })

  it('等待上传完成后保存封面和海报 assetId', async () => {
    const user = userEvent.setup()
    mockUploadImageWithStrategy.mockImplementation((file: File, options) => {
      options?.onProgress?.(100)
      return Promise.resolve({
        assetId: file.name === 'cover.jpg' ? 'cover-asset-1' : 'poster-asset-1',
        url: file.name === 'cover.jpg' ? '/uploads/cover.jpg' : '/uploads/poster.jpg',
        storageType: 'local',
      })
    })

    renderCreatePage()

    await user.type(screen.getByPlaceholderText('活动标题'), '测试活动')
    const fileInputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]')
    await user.upload(fileInputs[0], makeImageFile('cover.jpg'))
    await user.upload(fileInputs[1], makeImageFile('poster.jpg'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存' })).not.toBeDisabled()
    })
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/events', {
        title: '测试活动',
        location: '',
        content: '',
        timeSlots: [],
        ticketPrices: [],
        saleTimes: [],
        lineup: [],
        tags: [],
        externalLinks: [],
        relatedLinks: [],
        coverAssetId: 'cover-asset-1',
        posters: [{ assetId: 'poster-asset-1' }],
      })
    })
    expect(await screen.findByText('活动列表')).toBeInTheDocument()
  })

  it('编辑已有活动保存成功后返回活动列表', async () => {
    const user = userEvent.setup()

    renderEditPage()

    const titleInput = await screen.findByPlaceholderText('活动标题')
    await user.clear(titleInput)
    await user.type(titleInput, '更新活动')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(mockApiPut).toHaveBeenCalledWith('/api/events/event-1', {
        title: '更新活动',
        location: '',
        content: '',
        timeSlots: [],
        ticketPrices: [],
        saleTimes: [],
        lineup: [],
        tags: ['旧标签'],
        externalLinks: [],
        relatedLinks: [],
        coverAssetId: null,
        posters: [],
      })
    })
    expect(await screen.findByText('活动列表')).toBeInTheDocument()
  })

  it('海报上传失败时阻止保存，直到删除失败项', async () => {
    const user = userEvent.setup()
    mockUploadImageWithStrategy.mockRejectedValue(new Error('网络断开'))

    renderCreatePage()

    await user.type(screen.getByPlaceholderText('活动标题'), '测试活动')
    const fileInputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]')
    await user.upload(fileInputs[1], makeImageFile('poster.jpg'))

    expect(await screen.findByText('网络断开')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(mockApiPost).not.toHaveBeenCalled()
    expect(mockShowToast).toHaveBeenCalledWith('请先删除或重新上传失败的图片', {
      variant: 'error',
    })

    await user.click(screen.getByRole('button', { name: '删除海报' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        '/api/events',
        expect.objectContaining({ posters: [] })
      )
    })
  })

  it('删除上传中的海报后即使请求完成也不写回资源', async () => {
    const user = userEvent.setup()
    let resolvePosterUpload: (value: unknown) => void = () => undefined
    mockUploadImageWithStrategy.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePosterUpload = resolve
        })
    )

    renderCreatePage()

    await user.type(screen.getByPlaceholderText('活动标题'), '测试活动')
    const fileInputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]')
    await user.upload(fileInputs[1], makeImageFile('poster.jpg'))
    await user.click(screen.getByRole('button', { name: '删除海报' }))

    await act(async () => {
      resolvePosterUpload({
        assetId: 'poster-asset-1',
        url: '/uploads/poster.jpg',
        storageType: 'local',
      })
      await Promise.resolve()
    })

    expect(mockShowToast).not.toHaveBeenCalledWith('已上传 1 张海报')

    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        '/api/events',
        expect.objectContaining({ posters: [] })
      )
    })
  })
})
