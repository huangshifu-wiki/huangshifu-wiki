// @vitest-environment jsdom
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deferred } from '../setup/deferred'
import { apiGet } from '../../src/lib/apiClient'
import WikiList from '../../src/pages/wiki/WikiList'
import Events from '../../src/pages/Events'
import Forum from '../../src/pages/Forum'

vi.mock('../../src/lib/apiClient', () => ({ apiGet: vi.fn() }))
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ user: null, isBanned: false }),
}))
vi.mock('../../src/context/UserPreferencesContext', () => ({
  useUserPreferences: () => ({
    preferences: { listLoadMode: 'pagination' },
    getScopedViewMode: () => 'list',
    setScopedViewMode: vi.fn(),
  }),
}))
vi.mock('../../src/hooks/useWikiCategories', () => ({
  useWikiCategories: () => ({
    categories: [{ id: 'music', name: 'music' }],
    getCategoryLabel: (value: string) => value,
  }),
}))
vi.mock('../../src/hooks/useTagSuggestions', () => ({
  useTagSuggestions: () => ({ suggestions: [] }),
}))
vi.mock('../../src/components/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../../src/components/Dialog', () => ({ useDialog: () => ({ confirm: vi.fn() }) }))
vi.mock('../../src/lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

function Navigation() {
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <>
      <output data-testid="location">
        {location.pathname}
        {location.search}
      </output>
      <button onClick={() => navigate(-1)}>后退</button>
    </>
  )
}

const cases = [
  {
    name: '百科',
    Page: WikiList,
    initial: '/wiki?page=2',
    target: '/wiki?category=music',
    api: '/api/wiki',
    key: 'category',
    filtered: 'music',
    large: { pages: [], total: 100 },
    small: { pages: [], total: 1 },
  },
  {
    name: '活动',
    Page: Events,
    initial: '/events?page=2',
    target: '/events?tag=live',
    api: '/api/events',
    key: 'tag',
    filtered: 'live',
    large: { events: [], totalPages: 2 },
    small: { events: [], totalPages: 1 },
  },
  {
    name: '论坛',
    Page: Forum,
    initial: '/forum?page=2',
    target: '/forum?section=music',
    api: '/api/posts',
    key: 'section',
    filtered: 'music',
    large: { posts: [], totalPages: 2 },
    small: { posts: [], totalPages: 1 },
  },
]

describe('公开列表分页历史', () => {
  beforeEach(() => vi.resetAllMocks())
  it.each(cases)(
    '$name 返回时等待当前范围的总数',
    async ({ Page, initial, api, key, filtered, large, small }) => {
      const { promise, resolve } = deferred<unknown>()
      let originalCalls = 0
      vi.mocked(apiGet).mockImplementation((path, params) => {
        if (path === '/api/events/tags') return Promise.resolve({ tags: ['live'] }) as never
        if (path === '/api/sections')
          return Promise.resolve({ sections: [{ id: 'music', name: 'music' }] }) as never
        if (path !== api) throw new Error(`unexpected ${path}`)
        if (params?.[key] === filtered) return Promise.resolve(small) as never
        originalCalls++
        return (originalCalls === 1 ? Promise.resolve(large) : promise) as never
      })
      render(
        <MemoryRouter initialEntries={[initial]}>
          <Navigation />
          <Routes>
            <Route path={`${initial.split('?')[0]}/*`} element={<Page />} />
          </Routes>
        </MemoryRouter>
      )
      await waitFor(() => expect(originalCalls).toBe(1))
      fireEvent.click(await screen.findByRole('link', { name: filtered }))
      await waitFor(() =>
        expect(
          vi
            .mocked(apiGet)
            .mock.calls.some(([p, params]) => p === api && params?.[key] === filtered)
        ).toBe(true)
      )
      await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('page=2'))
      fireEvent.click(screen.getByText('后退'))
      await waitFor(() => expect(originalCalls).toBe(2))
      expect(screen.getByTestId('location')).toHaveTextContent('page=2')
      expect(
        vi
          .mocked(apiGet)
          .mock.calls.filter(([p]) => p === api)
          .at(-1)?.[1]?.page
      ).toBe(2)
      await act(async () => resolve(large))
      expect(screen.getByTestId('location')).toHaveTextContent('page=2')
    }
  )
  it('活动请求失败时保留深链接页码', async () => {
    vi.mocked(apiGet).mockImplementation((path) =>
      path === '/api/events/tags'
        ? (Promise.resolve({ tags: [] }) as never)
        : (Promise.reject(new Error('请求失败')) as never)
    )
    render(
      <MemoryRouter initialEntries={['/events?page=4']}>
        <Navigation />
        <Events />
      </MemoryRouter>
    )
    await screen.findByRole('alert')
    expect(screen.getByTestId('location')).toHaveTextContent('page=4')
  })
  it.each(cases)('$name 当前范围总数返回后修正越界页', async ({ Page, initial, api, large }) => {
    const { promise, resolve } = deferred<unknown>()
    vi.mocked(apiGet).mockImplementation((path) => {
      if (path === '/api/events/tags') return Promise.resolve({ tags: [] }) as never
      if (path === '/api/sections') return Promise.resolve({ sections: [] }) as never
      if (path === api) return promise as never
      throw new Error(`unexpected ${path}`)
    })
    render(
      <MemoryRouter initialEntries={[initial.replace('page=2', 'page=99')]}>
        <Navigation />
        <Routes>
          <Route path={`${initial.split('?')[0]}/*`} element={<Page />} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByTestId('location')).toHaveTextContent('page=99')
    await act(async () => resolve(large))
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('page=99'))
  })
})
