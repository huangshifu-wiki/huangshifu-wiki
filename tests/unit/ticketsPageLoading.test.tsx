// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Tickets from '../../src/pages/Tickets'
import { apiGet } from '../../src/lib/apiClient'

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}))

const authState: {
  user: { uid: string; displayName: string } | null
  isBanned: boolean
  isAdmin: boolean
} = {
  user: { uid: 'user-1', displayName: '测试用户' },
  isBanned: false,
  isAdmin: false,
}

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => authState,
}))

vi.mock('../../src/components/Toast', () => ({
  useToast: () => ({ show: vi.fn() }),
}))

vi.mock('../../src/components/Dialog', () => ({
  useDialog: () => ({ confirm: vi.fn() }),
}))

const mockedApiGet = vi.mocked(apiGet)

function renderPage(initialEntry = '/tickets') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/tickets/*" element={<Tickets />} />
      </Routes>
    </MemoryRouter>
  )
}

const listing = {
  id: 'listing-1',
  slug: '900001',
  type: 'offer' as const,
  eventId: null,
  customEventName: '春日现场',
  eventName: '春日现场',
  eventSlug: null,
  eventLocation: null,
  quantity: 2,
  ticketTier: '看台',
  seat: 'A区',
  authorUid: 'user-1',
  authorPublicId: 'user-public-1',
  authorName: '测试用户',
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  authState.user = { uid: 'user-1', displayName: '测试用户' }
  authState.isBanned = false
  authState.isAdmin = false
  mockedApiGet.mockImplementation((path: string) => {
    if (path === '/api/ticket-listings/events') return Promise.resolve({ events: [] }) as never
    if (path === '/api/ticket-listings')
      return Promise.resolve({ listings: [], totalPages: 1 }) as never
    return Promise.reject(new Error(`unexpected path: ${path}`)) as never
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('盘票列表加载状态', () => {
  it('加载时不显示成功空态，成功空结果后显示空态', async () => {
    let resolveList!: (value: { listings: never[]; totalPages: number }) => void
    const listRequest = new Promise<{ listings: never[]; totalPages: number }>((resolve) => {
      resolveList = resolve
    })
    mockedApiGet.mockImplementation((path: string) => {
      if (path === '/api/ticket-listings/events') return Promise.resolve({ events: [] }) as never
      return listRequest as never
    })

    renderPage()
    expect(screen.queryByText('暂无符合条件的盘票信息')).not.toBeInTheDocument()
    resolveList({ listings: [], totalPages: 1 })
    expect(await screen.findByText('暂无符合条件的盘票信息')).toBeInTheDocument()
  })

  it('请求失败显示可重试错误，重试后加载列表', async () => {
    let attempts = 0
    mockedApiGet.mockImplementation((path: string) => {
      if (path === '/api/ticket-listings/events') return Promise.resolve({ events: [] }) as never
      attempts += 1
      return attempts === 1
        ? (Promise.reject(new Error('tickets unavailable')) as never)
        : (Promise.resolve({ listings: [listing], totalPages: 1 }) as never)
    })

    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('加载失败')
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(await screen.findByText('春日现场')).toBeInTheDocument()
    expect(attempts).toBe(2)
  })

  it('出票和收票筛选发送对应查询参数', async () => {
    renderPage()
    await screen.findByText('暂无符合条件的盘票信息')
    fireEvent.click(screen.getByRole('button', { name: '出票' }))
    await waitFor(() => {
      expect(mockedApiGet.mock.calls).toEqual(
        expect.arrayContaining([
          expect.arrayContaining([
            '/api/ticket-listings',
            expect.objectContaining({ type: 'offer' }),
          ]),
        ])
      )
    })
  })

  it('只向登录且未封禁用户显示发布按钮', async () => {
    renderPage()
    expect(await screen.findByRole('link', { name: /发布盘票/ })).toBeInTheDocument()

    authState.user = null
    authState.isBanned = false
    cleanup()
    renderPage()
    await screen.findByText('暂无符合条件的盘票信息')
    expect(screen.queryByRole('link', { name: /发布盘票/ })).not.toBeInTheDocument()

    authState.user = { uid: 'user-1', displayName: '测试用户' }
    authState.isBanned = true
    cleanup()
    renderPage()
    await screen.findByText('暂无符合条件的盘票信息')
    expect(screen.queryByRole('link', { name: /发布盘票/ })).not.toBeInTheDocument()
  })
})
