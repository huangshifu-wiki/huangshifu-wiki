// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AdminEventEdit from '../../src/pages/Admin/AdminEventEdit'
import { apiGet, apiPost, apiPut } from '../../src/lib/apiClient'
import { uploadImageWithStrategy } from '../../src/services/imageService'
import type { UploadImageResult } from '../../src/services/imageService'
import type { EventItem } from '../../src/types/entities'

const toastShow = vi.hoisted(() => vi.fn())

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  invalidateApiCacheByPrefix: vi.fn(),
}))
vi.mock('../../src/services/imageService', () => ({ uploadImageWithStrategy: vi.fn() }))
vi.mock('../../src/hooks/useTagSuggestions', () => ({ useTagSuggestions: () => [] }))
vi.mock('../../src/components/Toast', () => ({ useToast: () => ({ show: toastShow }) }))
vi.mock('../../src/components/Dialog', () => ({ useDialog: () => ({ confirm: vi.fn() }) }))
vi.mock('../../src/components/MarkdownEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="正文" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))
vi.mock('../../src/components/SmartImage', () => ({
  SmartImage: ({ src, alt }: { src?: string | null; alt?: string }) => (
    <img src={src || undefined} alt={alt} />
  ),
}))

const eventFixture: EventItem = {
  id: 'evt-1',
  slug: 'evt-1',
  title: '测试活动',
  location: '',
  content: '',
  timeSlots: [],
  timeStatus: 'pending',
  ticketPrices: [],
  saleTimes: [],
  lineup: [],
  tags: [],
  externalLinks: [],
  relatedLinks: [],
  sortStart: null,
  sortEnd: null,
  coverAssetId: null,
  coverUrl: null,
  coverName: null,
  createdByUid: 'user-1',
  createdByName: null,
  updatedByUid: null,
  updatedByName: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  posters: [],
}

const uploadResult: UploadImageResult = {
  assetId: 'asset-1',
  imageMapId: 'map-1',
  url: '/uploads/asset-1.png',
  storageType: 'local',
  md5: 'md5-1',
  reused: false,
  status: 'uploaded',
}

const makeFile = (name: string) => new File(['x'], name, { type: 'image/png' })

const filesTransfer = (...names: string[]) => ({
  types: ['Files'],
  files: names.map(makeFile),
})

const textTransfer = { types: ['text/plain'] }

const renderPage = async () => {
  const view = render(
    <MemoryRouter initialEntries={['/admin/events']}>
      <Routes>
        <Route
          path="/admin/events"
          element={<AdminEventEdit eventId="evt-1" onClose={vi.fn()} onSaved={vi.fn()} />}
        />
      </Routes>
    </MemoryRouter>
  )
  await screen.findByPlaceholderText('活动标题')
  return view
}

const coverZone = () => document.querySelector('[data-file-drop-zone="cover"]') as HTMLElement

describe('活动编辑页拖拽上传', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    let objectUrlSeed = 0
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => `blob:preview-${(objectUrlSeed += 1)}`),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    })
    vi.mocked(apiGet).mockResolvedValue({ item: eventFixture } as never)
    vi.mocked(uploadImageWithStrategy).mockResolvedValue(uploadResult)
  })

  it('单张图片拖到封面区域按封面上传', async () => {
    await renderPage()
    const dataTransfer = filesTransfer('cover.png')

    fireEvent.drop(coverZone(), { dataTransfer })

    await waitFor(() => expect(uploadImageWithStrategy).toHaveBeenCalledTimes(1))
    expect(vi.mocked(uploadImageWithStrategy).mock.calls[0][0].name).toBe('cover.png')
    expect(toastShow).toHaveBeenCalledWith('封面已上传')
    expect(screen.getByText('暂无海报')).toBeInTheDocument()
  })

  it('多张图片拖到封面区域只提示，不上传', async () => {
    await renderPage()

    fireEvent.drop(coverZone(), { dataTransfer: filesTransfer('a.png', 'b.png') })

    expect(uploadImageWithStrategy).not.toHaveBeenCalled()
    expect(toastShow).toHaveBeenCalledWith(
      '封面区域一次只能拖入一张图片，多张请拖到其他区域上传为海报',
      { variant: 'error' }
    )
    expect(screen.queryAllByLabelText('删除海报')).toHaveLength(0)
  })

  it('拖到封面区域之外按海报批量上传', async () => {
    await renderPage()

    fireEvent.drop(screen.getByPlaceholderText('活动标题'), {
      dataTransfer: filesTransfer('a.png', 'b.png'),
    })

    await waitFor(() => expect(screen.queryAllByLabelText('删除海报')).toHaveLength(2))
    await waitFor(() => expect(uploadImageWithStrategy).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('暂无海报')).not.toBeInTheDocument()
  })

  it('封面区就地提示，其他区域全屏提示', async () => {
    await renderPage()
    const dataTransfer = filesTransfer('a.png')
    const cover = coverZone()

    fireEvent.dragEnter(cover, { dataTransfer })
    fireEvent.dragOver(cover, { dataTransfer })
    expect(within(cover).getByText('松开鼠标上传为封面')).toBeInTheDocument()
    expect(screen.queryByText('松开鼠标上传为海报')).not.toBeInTheDocument()

    fireEvent.dragLeave(cover, { dataTransfer })
    const title = screen.getByPlaceholderText('活动标题')
    fireEvent.dragEnter(title, { dataTransfer })
    fireEvent.dragOver(title, { dataTransfer })
    expect(screen.getByText('松开鼠标上传为海报')).toBeInTheDocument()
    expect(within(cover).queryByText('松开鼠标上传为封面')).not.toBeInTheDocument()
  })

  it('海报排序拖拽不会触发上传提示', async () => {
    await renderPage()

    fireEvent.dragEnter(screen.getByPlaceholderText('活动标题'), { dataTransfer: textTransfer })
    fireEvent.dragOver(screen.getByPlaceholderText('活动标题'), { dataTransfer: textTransfer })

    expect(screen.queryByText(/松开鼠标/)).not.toBeInTheDocument()
    expect(uploadImageWithStrategy).not.toHaveBeenCalled()
  })
})

describe('活动编辑页时间状态', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiGet).mockResolvedValue({ item: eventFixture } as never)
    vi.mocked(apiPut).mockResolvedValue({} as never)
  })

  it('可以把待定活动切换为推迟并保存状态', async () => {
    await renderPage()

    fireEvent.change(screen.getByLabelText('时间状态'), { target: { value: 'postponed' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1))
    const payload = vi.mocked(apiPut).mock.calls[0][1] as {
      timeSlots: unknown[]
      timeStatus: string | null
    }
    expect(payload.timeSlots).toEqual([])
    expect(payload.timeStatus).toBe('postponed')
  })

  it('填写真实时间时清除时间状态', async () => {
    await renderPage()

    fireEvent.change(screen.getByLabelText('时间状态'), { target: { value: '' } })
    const timeInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement
    fireEvent.change(timeInput, { target: { value: '2026-10-01T19:30' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1))
    const payload = vi.mocked(apiPut).mock.calls[0][1] as {
      timeSlots: unknown[]
      timeStatus: string | null
    }
    expect(payload.timeSlots).toEqual([{ type: 'datetime', start: '2026-10-01T19:30' }])
    expect(payload.timeStatus).toBeNull()
  })
})

describe('新增活动路由', () => {
  it('保持完整页面创建并在保存后返回活动管理', async () => {
    vi.clearAllMocks()
    vi.mocked(apiPost).mockResolvedValue({ event: eventFixture } as never)
    render(
      <MemoryRouter initialEntries={['/admin/events/new']}>
        <Routes>
          <Route path="/admin/events/new" element={<AdminEventEdit />} />
          <Route path="/admin/events" element={<p>活动管理列表</p>} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByRole('heading', { name: '新增活动' })).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('活动标题'), {
      target: { value: '新活动' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        '/api/events',
        expect.objectContaining({ title: '新活动' })
      )
    )
    expect(await screen.findByText('活动管理列表')).toBeInTheDocument()
  })
})
