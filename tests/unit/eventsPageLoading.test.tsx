// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiGet } from '../../src/lib/apiClient'
import Events from '../../src/pages/Events'
import type { EventItem } from '../../src/types/entities'

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
}))

vi.mock('../../src/context/UserPreferencesContext', () => ({
  useUserPreferences: () => ({
    getScopedViewMode: () => 'list',
    setScopedViewMode: vi.fn(),
  }),
}))

const mockedApiGet = vi.mocked(apiGet)

type EventResponse = {
  events: EventItem[]
  totalPages: number
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const event = {
  id: 'event-1',
  slug: 'spring-live',
  title: '春日现场',
  location: '上海',
  content: '',
  timeSlots: [{ type: 'date', start: '2025-04-01' }],
  ticketPrices: [],
  saleTimes: [],
  lineup: [],
  tags: [],
  externalLinks: [],
  relatedLinks: [],
  sortStart: '2025-04-01T00:00:00.000Z',
  sortEnd: null,
  coverAssetId: null,
  coverUrl: null,
  coverName: null,
  createdByUid: 'user-1',
  createdByName: '作者',
  updatedByUid: null,
  updatedByName: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  posters: [],
} as EventItem

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/events']}>
      <Events />
    </MemoryRouter>
  )

const configureApi = (eventRequest: Promise<EventResponse>) => {
  mockedApiGet.mockImplementation((path: string) => {
    if (path === '/api/events') return eventRequest as never
    if (path === '/api/events/tags') return Promise.resolve({ tags: [] }) as never
    return Promise.reject(new Error(`unexpected apiGet path: ${path}`)) as never
  })
}

describe('游记列表加载状态', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('请求未完成时显示游记骨架，不显示成功空态；空结果返回后才显示空态', async () => {
    const request = deferred<EventResponse>()
    configureApi(request.promise)

    renderPage()

    expect(await screen.findByRole('status', { name: '加载中' })).toBeInTheDocument()
    expect(screen.queryByText('暂无活动')).not.toBeInTheDocument()

    request.resolve({ events: [], totalPages: 1 })

    expect(await screen.findByText('暂无活动')).toBeInTheDocument()
  })

  it('请求失败显示错误和重试按钮，而不是成功空态', async () => {
    let attempts = 0
    mockedApiGet.mockImplementation((path: string) => {
      if (path === '/api/events/tags') return Promise.resolve({ tags: [] }) as never
      if (path === '/api/events') {
        attempts += 1
        return attempts === 1
          ? (Promise.reject(new Error('events unavailable')) as never)
          : (Promise.resolve({ events: [event], totalPages: 1 }) as never)
      }
      return Promise.reject(new Error(`unexpected apiGet path: ${path}`)) as never
    })

    renderPage()

    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent('加载失败')
    expect(screen.queryByText('暂无活动')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))

    await screen.findByText('春日现场')
    expect(attempts).toBe(2)
  })

  it('分页请求在途时保留已有活动并显示局部刷新状态', async () => {
    const pageTwoRequest = deferred<EventResponse>()
    let pageOne = true
    mockedApiGet.mockImplementation(
      (path: string, query?: Record<string, string | number | boolean | undefined | null>) => {
        if (path === '/api/events/tags') return Promise.resolve({ tags: [] }) as never
        if (path !== '/api/events') {
          return Promise.reject(new Error(`unexpected apiGet path: ${path}`)) as never
        }
        if (pageOne) {
          pageOne = false
          return Promise.resolve({ events: [event], totalPages: 2 }) as never
        }
        expect(query?.page).toBe(2)
        return pageTwoRequest.promise as never
      }
    )
    renderPage()
    expect(await screen.findByText('春日现场')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '第 2 页' }))

    expect(await screen.findByRole('status', { name: '游记刷新中' })).toBeInTheDocument()
    expect(screen.getByText('春日现场')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: '加载中' })).not.toBeInTheDocument()

    pageTwoRequest.resolve({ events: [], totalPages: 2 })
    expect(await screen.findByText('暂无活动')).toBeInTheDocument()
  })
})
