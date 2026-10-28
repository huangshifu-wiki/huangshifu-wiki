// @vitest-environment jsdom
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { deferred } from '../setup/deferred'
import { apiGet } from '../../src/lib/apiClient'
import UserProfile from '../../src/pages/UserProfile'
import Settings from '../../src/pages/Settings'

const show = vi.hoisted(() => vi.fn())
const profile = {
  publicId: '1',
  displayName: '测试用户',
  photoURL: null,
  signature: '',
  bio: '',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  isSelf: true,
  canViewFavorites: false,
  canViewHistory: false,
  role: 'user',
}
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'owner', publicId: '1' },
    profile: { role: 'user' },
    refreshAuth: vi.fn(),
    isBanned: false,
  }),
}))
vi.mock('../../src/context/UserPreferencesContext', () => ({
  useUserPreferences: () => ({ preferences: {}, updatePreferences: vi.fn() }),
}))
vi.mock('../../src/components/Toast', () => ({ useToast: () => ({ show }) }))
vi.mock('../../src/components/Dialog', () => ({ useDialog: () => ({ confirm: vi.fn() }) }))
vi.mock('../../src/components/MarkdownRenderer', () => ({ default: () => null }))
vi.mock('../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  apiRequest: vi.fn(),
}))

function Probe() {
  const location = useLocation()
  const navigate = useNavigate()
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

beforeEach(() => vi.resetAllMocks())

it.each([
  {
    name: '用户资料',
    initial: '/users/1/posts?page=2',
    route: '/users/:userId/:tab?',
    pageParam: 'page',
    Page: UserProfile,
  },
  {
    name: '设置内容',
    initial: '/settings/content?contentPage=2',
    route: '/settings/:section',
    pageParam: 'contentPage',
    Page: Settings,
  },
])('$name 切换图集后后退恢复第二页', async ({ initial, route, pageParam, Page }) => {
  const { promise, resolve } = deferred<{ posts: []; total: number }>()
  let postCalls = 0
  vi.mocked(apiGet).mockImplementation((path) => {
    if (path === '/api/config/turnstile')
      return Promise.resolve({ enabled: false, siteKey: '' }) as never
    if (path.endsWith('/profile')) return Promise.resolve({ user: profile }) as never
    if (path.endsWith('/galleries')) return Promise.resolve({ galleries: [], total: 1 }) as never
    if (path.endsWith('/posts')) {
      postCalls++
      return (postCalls === 1 ? Promise.resolve({ posts: [], total: 100 }) : promise) as never
    }
    throw new Error(`unexpected ${path}`)
  })
  render(
    <MemoryRouter initialEntries={[initial]}>
      <Probe />
      <Routes>
        <Route path={route} element={<Page />} />
      </Routes>
    </MemoryRouter>
  )
  await waitFor(() => expect(postCalls).toBe(1))
  fireEvent.click(await screen.findByRole('link', { name: '图集' }))
  await waitFor(() =>
    expect(
      vi
        .mocked(apiGet)
        .mock.calls.some(([path, params]) => path.endsWith('/galleries') && params?.page === 1)
    ).toBe(true)
  )
  expect(screen.getByTestId('location')).not.toHaveTextContent(`${pageParam}=2`)
  fireEvent.click(screen.getByRole('button', { name: '后退' }))
  await waitFor(() => expect(postCalls).toBe(2))
  expect(screen.getByTestId('location')).toHaveTextContent(`${pageParam}=2`)
  expect(
    vi
      .mocked(apiGet)
      .mock.calls.filter(([path]) => path.endsWith('/posts'))
      .at(-1)?.[1]?.page
  ).toBe(2)
  await act(async () => resolve({ posts: [], total: 100 }))
  expect(screen.getByTestId('location')).toHaveTextContent(`${pageParam}=2`)
})
