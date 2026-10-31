// @vitest-environment jsdom
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { deferred } from '../setup/deferred'
import { DialogProvider } from '../../src/components/Dialog'
import { ToastProvider } from '../../src/components/Toast'
import { apiGet } from '../../src/lib/apiClient'
import AdminListPage from '../../src/pages/Admin/AdminListPage'
import { AdminReviews } from '../../src/pages/Admin/AdminReviews'
import { fetchReviewQueuePage } from '../../src/pages/Admin/reviewQueue'
import type * as ReviewQueueModule from '../../src/pages/Admin/reviewQueue'

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
vi.mock('../../src/pages/Admin/reviewQueue', async (importOriginal) => ({
  ...(await importOriginal<typeof ReviewQueueModule>()),
  fetchReviewQueuePage: vi.fn(),
}))

function Probe() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <output data-testid="location">{location.search}</output>
      <button onClick={() => navigate(-1)}>后退</button>
    </>
  )
}

beforeEach(() => vi.resetAllMocks())

it('审核类型切换从第一页开始，后退恢复原类型的第二页', async () => {
  const { promise, resolve } = deferred<{ items: []; total: number }>()
  let originalCalls = 0
  vi.mocked(fetchReviewQueuePage).mockImplementation((filter) => {
    if (filter !== 'all') return Promise.resolve({ items: [], total: 1 })
    originalCalls++
    return originalCalls === 1 ? Promise.resolve({ items: [], total: 40 }) : promise
  })
  render(
    <MemoryRouter initialEntries={['/admin/reviews?page=2']}>
      <Probe />
      <AdminReviews />
    </MemoryRouter>
  )
  fireEvent.click(await screen.findByRole('button', { name: '全部待审' }))
  expect(screen.getByTestId('location')).toHaveTextContent('page=2')
  fireEvent.click(screen.getByRole('button', { name: '百科待审' }))
  await waitFor(() => expect(fetchReviewQueuePage).toHaveBeenCalledWith('wiki', 1, 20))
  expect(screen.getByTestId('location')).not.toHaveTextContent('page=2')
  fireEvent.click(screen.getByRole('button', { name: '后退' }))
  await waitFor(() => expect(originalCalls).toBe(2))
  expect(screen.getByTestId('location')).toHaveTextContent('page=2')
  expect(fetchReviewQueuePage).toHaveBeenLastCalledWith('all', 2, 20)
  await act(async () => resolve({ items: [], total: 40 }))
  expect(screen.getByTestId('location')).toHaveTextContent('page=2')
})

it('后台列表切换已删除范围后退恢复第二页', async () => {
  const { promise, resolve } = deferred<{ data: []; total: number }>()
  let originalCalls = 0
  vi.mocked(apiGet).mockImplementation((path, params) => {
    if (path !== '/api/admin/events') throw new Error(`unexpected ${path}`)
    if (params?.includeDeleted) return Promise.resolve({ data: [], total: 1 }) as never
    originalCalls++
    return (originalCalls === 1 ? Promise.resolve({ data: [], total: 100 }) : promise) as never
  })
  render(
    <MemoryRouter initialEntries={['/admin/events?page=2']}>
      <ToastProvider>
        <DialogProvider>
          <Probe />
          <AdminListPage type="events" />
        </DialogProvider>
      </ToastProvider>
    </MemoryRouter>
  )
  fireEvent.click(await screen.findByRole('button', { name: '显示已删除' }))
  await waitFor(() =>
    expect(
      vi.mocked(apiGet).mock.calls.some(([, params]) => params?.includeDeleted && params.page === 1)
    ).toBe(true)
  )
  expect(screen.getByTestId('location')).not.toHaveTextContent('page=2')
  fireEvent.click(screen.getByRole('button', { name: '后退' }))
  await waitFor(() => expect(originalCalls).toBe(2))
  expect(screen.getByTestId('location')).toHaveTextContent('page=2')
  expect(vi.mocked(apiGet).mock.calls.at(-1)?.[1]?.page).toBe(2)
  await act(async () => resolve({ data: [], total: 100 }))
  expect(screen.getByTestId('location')).toHaveTextContent('page=2')
})
