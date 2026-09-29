// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'

import { apiGet, apiPut } from '../../src/lib/apiClient'
import EventDetail from '../../src/pages/EventDetail'
import { useAuth } from '../../src/context/AuthContext'
import type { EventItem } from '../../src/types/entities'
import { DialogProvider } from '../../src/components/Dialog'
import { ToastProvider } from '../../src/components/Toast'

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
  invalidateApiCacheByPrefix: vi.fn(),
}))
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: vi.fn(),
}))
vi.mock('../../src/hooks/useTagSuggestions', () => ({ useTagSuggestions: () => [] }))

vi.mock('../../src/components/SmartBackLink', () => ({
  SmartBackLink: () => null,
}))

vi.mock('../../src/components/SmartImage', () => ({
  SmartImage: ({ fallback, className }: { fallback?: React.ReactNode; className?: string }) => (
    <div className={className}>{fallback}</div>
  ),
}))

vi.mock('../../src/components/CoverPlaceholder', () => ({
  CoverPlaceholder: ({ label }: { label?: string }) => <span>{label}</span>,
}))

vi.mock('../../src/components/Lightbox', () => ({
  Lightbox: () => null,
}))

vi.mock('../../src/components/MarkdownRenderer', () => ({
  default: () => null,
}))

const mockedApiGet = vi.mocked(apiGet)
const mockedUseAuth = vi.mocked(useAuth)

const renderDetail = () =>
  render(
    <MemoryRouter initialEntries={['/events/spring-2024']}>
      <ToastProvider>
        <DialogProvider>
          <Routes>
            <Route path="/events/:slug" element={<EventDetail />} />
          </Routes>
        </DialogProvider>
      </ToastProvider>
    </MemoryRouter>
  )

describe('EventDetail SEO 元数据', () => {
  const resetHead = () => {
    document.head.querySelectorAll('[data-hsf-seo]').forEach((el) => el.remove())
    document.title = ''
  }

  beforeEach(() => {
    resetHead()
    vi.clearAllMocks()
    mockedUseAuth.mockReturnValue({ isAdmin: false } as never)
  })

  it('数据尚未就绪时不崩溃，输出 noindex,follow', () => {
    mockedApiGet.mockImplementation(() => new Promise(() => {}))

    renderDetail()

    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex,follow'
    )
    expect(document.title).toBe('黄诗扶 Wiki')
    expect(document.querySelector('script[data-hsf-seo="jsonld"]')).toBeNull()
  })

  it('加载失败后输出 noindex,follow 与错误标题', async () => {
    mockedApiGet.mockRejectedValue(new Error('offline'))

    renderDetail()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    // SEO 由 useEffect 写入 head，与 alert 的 DOM 变更不在同一时点，需等待生效
    await waitFor(() => expect(document.title).toBe('活动不存在｜黄诗扶 Wiki'))
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex,follow'
    )
  })

  const eventFixture = {
    id: 'event-db-id',
    slug: 'event-public-slug',
    title: '测试活动',
    timeSlots: [],
    ticketPrices: [],
    tags: [],
    saleTimes: [],
    lineup: [],
    externalLinks: [],
    relatedLinks: [],
    posters: [],
    location: '',
    content: '',
    timeStatus: 'pending',
  } as unknown as EventItem

  it('管理员直接在详情页弹窗编辑活动，普通用户没有入口', async () => {
    const event = eventFixture
    mockedApiGet.mockImplementation(async (path: string) => {
      if (path === '/api/events/spring-2024') return { event } as never
      if (path === '/api/admin/events/event-db-id') return { item: event } as never
      throw new Error(`unexpected apiGet path: ${path}`)
    })
    mockedUseAuth.mockReturnValue({ isAdmin: true } as never)
    const view = renderDetail()
    const edit = await screen.findByRole('button', { name: '编辑' })
    await userEvent.setup().click(edit)
    expect(await screen.findByRole('dialog', { name: '编辑活动' })).toBeInTheDocument()
    expect(await screen.findByPlaceholderText('活动标题')).toHaveValue('测试活动')
    expect(screen.getByRole('heading', { name: '测试活动', hidden: true })).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('活动标题'), {
      target: { value: '尚未保存的活动' },
    })
    await userEvent.setup().click(
      within(screen.getByRole('dialog', { name: '编辑活动' })).getByRole('button', {
        name: '取消',
      })
    )
    expect(await screen.findByRole('alertdialog', { name: '放弃编辑？' })).toBeInTheDocument()
    await userEvent.setup().click(
      within(screen.getByRole('alertdialog', { name: '放弃编辑？' })).getByRole('button', {
        name: '取消',
      })
    )
    expect(screen.getByRole('dialog', { name: '编辑活动' })).toBeInTheDocument()
    await userEvent.setup().click(
      within(screen.getByRole('dialog', { name: '编辑活动' })).getByRole('button', {
        name: '取消',
      })
    )
    await userEvent.setup().click(await screen.findByRole('button', { name: '放弃修改' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑活动' })).toBeNull())
    expect(screen.getByRole('heading', { name: '测试活动' })).toBeInTheDocument()

    view.unmount()
    mockedUseAuth.mockReturnValue({ isAdmin: false } as never)
    renderDetail()
    expect(await screen.findByRole('heading', { name: '测试活动' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
  })

  it('弹窗保存后停留在活动详情并刷新可见内容', async () => {
    let title = '测试活动'
    mockedApiGet.mockImplementation(async (path: string) => {
      if (path === '/api/events/spring-2024') return { event: { ...eventFixture, title } } as never
      if (path === '/api/admin/events/event-db-id')
        return { item: { ...eventFixture, title } } as never
      throw new Error(`unexpected apiGet path: ${path}`)
    })
    vi.mocked(apiPut).mockImplementation(async (_path, payload) => {
      if (
        payload &&
        typeof payload === 'object' &&
        'title' in payload &&
        typeof payload.title === 'string'
      ) {
        title = payload.title
      }
      return { event: { ...eventFixture, title } } as never
    })
    mockedUseAuth.mockReturnValue({ isAdmin: true } as never)
    renderDetail()
    await userEvent.setup().click(await screen.findByRole('button', { name: '编辑' }))
    fireEvent.change(await screen.findByPlaceholderText('活动标题'), {
      target: { value: '更新后的活动' },
    })
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '编辑活动' })).not.toBeInTheDocument()
    )
    expect(await screen.findByRole('heading', { name: '更新后的活动' })).toBeInTheDocument()
    expect(vi.mocked(apiPut)).toHaveBeenCalledWith(
      '/api/events/event-db-id',
      expect.objectContaining({ title: '更新后的活动' })
    )
  })
})
