// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DialogProvider } from '../../src/components/Dialog'
import { ToastProvider } from '../../src/components/Toast'
import { apiGet, apiPut } from '../../src/lib/apiClient'
import AdminListPage from '../../src/pages/Admin/AdminListPage'
import type { EventItem } from '../../src/types/entities'

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  invalidateApiCacheByPrefix: vi.fn(),
}))
vi.mock('../../src/hooks/useTagSuggestions', () => ({ useTagSuggestions: () => [] }))
vi.mock('../../src/components/SmartImage', () => ({ SmartImage: () => null }))

const event: EventItem = {
  id: 'evt-1',
  slug: '123',
  title: '后台活动',
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
  createdByUid: 'admin-1',
  createdByName: '管理员',
  updatedByUid: null,
  updatedByName: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  posters: [],
}

const PathProbe = () => <output data-testid="current-path">{useLocation().pathname}</output>

beforeEach(() => vi.clearAllMocks())

describe('活动后台列表编辑弹窗', () => {
  it('取消不修改列表；保存后留在列表并显示最新标题', async () => {
    let title = event.title
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === '/api/admin/events') return { data: [{ ...event, title }], total: 1 } as never
      if (path === '/api/admin/events/evt-1') return { item: { ...event, title } } as never
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
      return { event: { ...event, title } } as never
    })

    render(
      <MemoryRouter initialEntries={['/admin/events']}>
        <ToastProvider>
          <DialogProvider>
            <PathProbe />
            <AdminListPage type="events" />
          </DialogProvider>
        </ToastProvider>
      </MemoryRouter>
    )

    const row = (await screen.findByRole('link', { name: '后台活动' })).closest('tr')!
    await userEvent.setup().click(within(row).getByRole('button', { name: '编辑' }))
    const modal = await screen.findByRole('dialog', { name: '编辑活动' })
    expect(await within(modal).findByPlaceholderText('活动标题')).toHaveValue('后台活动')
    expect(screen.getByTestId('current-path')).toHaveTextContent('/admin/events')
    await userEvent.setup().click(within(modal).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑活动' })).toBeNull())
    expect(apiPut).not.toHaveBeenCalled()

    await userEvent.setup().click(within(row).getByRole('button', { name: '编辑' }))
    const editModal = await screen.findByRole('dialog', { name: '编辑活动' })
    fireEvent.change(await within(editModal).findByPlaceholderText('活动标题'), {
      target: { value: '后台活动已更新' },
    })
    await userEvent.setup().click(within(editModal).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑活动' })).toBeNull())
    expect(await screen.findByRole('link', { name: '后台活动已更新' })).toBeInTheDocument()
    expect(screen.getByTestId('current-path')).toHaveTextContent('/admin/events')
    expect(apiPut).toHaveBeenCalledWith(
      '/api/events/evt-1',
      expect.objectContaining({ title: '后台活动已更新' })
    )
  })
})
