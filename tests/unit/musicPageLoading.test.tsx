// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiGet } from '../../src/lib/apiClient'
import Music from '../../src/pages/Music'

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
}))
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../src/context/UserPreferencesContext', () => ({
  useUserPreferences: () => ({
    preferences: { listLoadMode: 'pagination', showMobileSongSequence: false },
    getScopedViewMode: () => 'list',
    setScopedViewMode: vi.fn(),
  }),
}))
vi.mock('../../src/context/MusicContext', () => ({
  useMusic: () => ({
    currentSong: null,
    setCurrentSong: vi.fn(),
    setIsPlaying: vi.fn(),
    setPlaylist: vi.fn(),
    playSongAtIndex: vi.fn(),
  }),
}))
vi.mock('../../src/components/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../../src/lib/i18n', () => ({
  useI18n: () => ({ t: (key: string) => (key === 'music.noMusic' ? '暂无音乐' : key) }),
}))

const mockedApiGet = vi.mocked(apiGet)

const renderPage = (entry = '/music') =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Music />
    </MemoryRouter>
  )

describe('音乐列表统一加载状态', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('歌曲请求未完成时显示音乐骨架，空结果后显示空态', async () => {
    let resolveRequest!: (value: { songs: []; total: number }) => void
    const request = new Promise<{ songs: []; total: number }>((resolve) => {
      resolveRequest = resolve
    })
    mockedApiGet.mockImplementation((path: string) => {
      if (path === '/api/music') return request as never
      if (path === '/api/music/tags') return Promise.resolve({ tags: [] }) as never
      if (path === '/api/albums') return Promise.resolve({ albums: [], total: 0 }) as never
      return Promise.reject(new Error(`unexpected path: ${path}`)) as never
    })

    renderPage()

    expect(await screen.findByRole('status', { name: '加载中' })).toBeInTheDocument()
    resolveRequest({ songs: [], total: 0 })
    expect(await screen.findByText('暂无音乐')).toBeInTheDocument()
  })

  it('歌曲首次失败显示错误，重试后显示空态', async () => {
    let attempts = 0
    mockedApiGet.mockImplementation((path: string) => {
      if (path === '/api/music/tags') return Promise.resolve({ tags: [] }) as never
      if (path === '/api/albums') return Promise.resolve({ albums: [], total: 0 }) as never
      if (path === '/api/music') {
        attempts += 1
        return attempts === 1
          ? (Promise.reject(new Error('music unavailable')) as never)
          : (Promise.resolve({ songs: [], total: 0 }) as never)
      }
      return Promise.reject(new Error(`unexpected path: ${path}`)) as never
    })

    renderPage()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await screen.findByText('暂无音乐')
    expect(attempts).toBe(2)
  })
})
