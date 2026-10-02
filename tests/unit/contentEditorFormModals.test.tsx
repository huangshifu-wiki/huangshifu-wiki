// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ContentEditorRoutes } from '../../src/pages/ContentEditorRoutes'
import { DialogProvider } from '../../src/components/Dialog'
import { ToastProvider } from '../../src/components/Toast'
import {
  apiGet,
  apiPost,
  apiPut,
  apiRequest,
  invalidateApiCacheByPrefix,
} from '../../src/lib/apiClient'
class TestResizeObserver implements ResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}

  observe(_target: Element, _options?: ResizeObserverOptions) {}

  unobserve(_target: Element) {}

  disconnect() {}
}

globalThis.ResizeObserver = TestResizeObserver

const wikiCategories = vi.hoisted(() => [{ id: 'general', name: '通用' }])

vi.mock('../../src/lib/apiClient', () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiRequest: vi.fn(),
  apiUpload: vi.fn(),
  invalidateApiCache: vi.fn(),
  invalidateApiCacheByPrefix: vi.fn(),
}))
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'user-1', role: 'user' },
    isAdmin: false,
    isBanned: false,
    loading: false,
    ensureInitialized: () => Promise.resolve(),
  }),
}))
vi.mock('../../src/components/RouteGuard', () => ({
  RouteGuard: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('../../src/hooks/useWikiCategories', () => ({
  useWikiCategories: () => ({ categories: wikiCategories, canEditCategory: () => true }),
}))
vi.mock('../../src/hooks/useTagSuggestions', () => ({ useTagSuggestions: () => [] }))
vi.mock('../../src/lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('../../src/components/LocationTagInput', () => ({ LocationTagInput: () => null }))
vi.mock('../../src/components/MarkdownEditor', () => ({
  default: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string
    onChange: (value: string) => void
    ariaLabel?: string
  }) => (
    <textarea
      aria-label={ariaLabel || '盘票描述'}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

const LocationProbe = () => {
  const location = useLocation()
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  )
}

const renderEditor = (
  initialEntries: NonNullable<React.ComponentProps<typeof MemoryRouter>['initialEntries']>
) =>
  render(
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialEntries.length - 1}>
      <ToastProvider>
        <DialogProvider>
          <ContentEditorRoutes />
          <LocationProbe />
        </DialogProvider>
      </ToastProvider>
    </MemoryRouter>
  )

const ticketListing = {
  id: 'ticket-1',
  slug: 'draft-1',
  type: 'offer',
  eventId: null,
  customEventName: '巡演',
  eventName: '巡演',
  eventSlug: null,
  eventLocation: null,
  quantity: 1,
  ticketTier: '一层',
  seat: '',
  authorUid: 'user-1',
  authorPublicId: null,
  authorName: '测试用户',
  status: 'draft',
  reviewNote: null,
  reviewedAt: null,
  isDeleted: false,
  deletedAt: null,
  deletedBy: null,
  deletionReason: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  description: '',
  contact: '微信：ticket-contact',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(apiGet).mockResolvedValue({} as never)
  vi.mocked(apiRequest).mockResolvedValue({ listing: ticketListing } as never)
})

describe('百科与盘票编辑弹窗', () => {
  it('保存百科草稿后关闭编辑器并导航到新条目', async () => {
    const background = {
      pathname: '/wiki',
      search: '?category=general',
      hash: '',
      state: null,
      key: 'wiki-list',
    }
    vi.mocked(apiPost).mockResolvedValue({
      page: { slug: 'new-page', status: 'draft' },
    } as never)
    renderEditor([background, { pathname: '/wiki/new', state: { editorBackground: background } }])

    const modal = await screen.findByRole('dialog', { name: 'wiki.createWiki' })
    fireEvent.change(within(modal).getByLabelText(/^标题/), { target: { value: '新条目' } })
    fireEvent.change(within(modal).getByLabelText(/^内容 \(Markdown\)/), {
      target: { value: '百科正文' },
    })
    fireEvent.click(within(modal).getByRole('button', { name: 'wiki.saveDraft' }))

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/api/wiki',
        expect.objectContaining({ title: '新条目', content: '百科正文', status: 'draft' })
      )
      expect(screen.getByTestId('location')).toHaveTextContent('/wiki/new-page')
    })
    expect(invalidateApiCacheByPrefix).toHaveBeenCalledWith('/api/wiki')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('百科编辑加载失败保留弹窗并可重试，失败时不显示可提交表单', async () => {
    vi.mocked(apiGet)
      .mockRejectedValueOnce(new Error('wiki unavailable'))
      .mockResolvedValueOnce({
        page: {
          slug: 'existing-page',
          title: '已保存条目',
          category: 'general',
          content: '已保存正文',
          tags: [],
          relations: [],
        },
      } as never)
    renderEditor(['/wiki/existing-page/edit'])

    const modal = await screen.findByRole('dialog', { name: 'wiki.editWiki' })
    await within(modal).findByRole('alert')
    expect(within(modal).queryByLabelText(/^标题/)).not.toBeInTheDocument()
    expect(apiPut).not.toHaveBeenCalled()

    fireEvent.click(within(modal).getByRole('button', { name: '重新加载' }))
    expect(await within(modal).findByDisplayValue('已保存条目')).toBeInTheDocument()
    expect(apiGet).toHaveBeenCalledTimes(2)
    expect(apiPut).not.toHaveBeenCalled()
  })

  it('新建盘票草稿转到编辑弹窗，后续保存使用 PUT 且干净关闭返回来源', async () => {
    const background = {
      pathname: '/tickets',
      search: '?page=2',
      hash: '',
      state: null,
      key: 'ticket-list',
    }
    vi.mocked(apiPost).mockResolvedValue({
      listing: { ...ticketListing, id: 'ticket-1', slug: 'draft-1', status: 'draft' },
    } as never)
    vi.mocked(apiPut).mockResolvedValue({ listing: ticketListing } as never)
    renderEditor([
      background,
      { pathname: '/tickets/new', state: { editorBackground: background } },
    ])

    let modal = await screen.findByRole('dialog', { name: '发布盘票' }, { timeout: 10000 })
    fireEvent.change(within(modal).getByRole('combobox'), { target: { value: 'custom' } })
    fireEvent.change(within(modal).getByLabelText(/^自定义活动名称/), {
      target: { value: '巡演' },
    })
    fireEvent.change(within(modal).getByLabelText(/^票档/), { target: { value: '一层' } })
    fireEvent.change(within(modal).getByLabelText(/^联系方式/), {
      target: { value: '微信：ticket-contact' },
    })
    fireEvent.click(within(modal).getByRole('button', { name: '保存草稿' }))

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/api/ticket-listings',
        expect.objectContaining({ status: 'draft', customEventName: '巡演' })
      )
      expect(screen.getByTestId('location')).toHaveTextContent('/tickets/draft-1/edit')
    })
    modal = await screen.findByRole('dialog', { name: '编辑盘票' }, { timeout: 10000 })
    expect(await within(modal).findByLabelText(/^自定义活动名称/)).toHaveValue('巡演')
    expect(apiRequest).toHaveBeenCalledWith(
      '/api/ticket-listings/draft-1',
      expect.objectContaining({ method: 'GET' })
    )

    fireEvent.change(within(modal).getByLabelText(/^联系方式/), {
      target: { value: '微信：新联系方式' },
    })
    fireEvent.click(within(modal).getByRole('button', { name: '保存草稿' }))
    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith(
        '/api/ticket-listings/ticket-1',
        expect.objectContaining({ status: 'draft', contact: '微信：新联系方式' })
      )
    })
    expect(apiPost).toHaveBeenCalledTimes(1)

    fireEvent.click(
      within(screen.getByRole('dialog', { name: '编辑盘票' })).getByRole('button', {
        name: '取消',
      })
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('location')).toHaveTextContent('/tickets?page=2')
  })
})
