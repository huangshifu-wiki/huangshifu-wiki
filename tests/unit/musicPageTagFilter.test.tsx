// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '../../src/components/Toast'
import { AuthProvider } from '../../src/context/AuthContext'
import { MusicProvider } from '../../src/context/MusicContext'
import { apiGet } from '../../src/lib/apiClient'
import Music from '../../src/pages/Music'

vi.mock('../../src/lib/apiClient', () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
}))

vi.mock('../../src/lib/auth', () => ({
  auth: {},
  onAuthStateChanged: vi.fn(),
  refreshAuthState: vi.fn(),
}))

const UrlProbe = () => {
  const [searchParams] = useSearchParams()
  return <span data-testid="url">{searchParams.get('tag') || ''}</span>
}

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/music']}>
      <AuthProvider>
        <MusicProvider>
          <ToastProvider>
            <Music />
            <UrlProbe />
          </ToastProvider>
        </MusicProvider>
      </AuthProvider>
    </MemoryRouter>
  )

describe('音乐列表页标签按钮', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === '/api/music/tags') return { tags: ['古风', '现场'] }
      if (path === '/api/music') return { songs: [], total: 0, page: 1, limit: 50, hasMore: false }
      return Promise.reject(new Error(`unexpected apiGet: ${path}`))
    })
  })

  it('点击标签后 URL 保留 tag 参数并携带 tag 重新请求列表', async () => {
    renderPage()
    const tagButton = await screen.findByRole('button', { name: '古风' })
    fireEvent.click(tagButton)

    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('古风'))
    await waitFor(() =>
      expect(vi.mocked(apiGet)).toHaveBeenCalledWith(
        '/api/music',
        expect.objectContaining({ tag: '古风' })
      )
    )
  })
})
