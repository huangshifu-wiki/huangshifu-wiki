// @vitest-environment jsdom
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'

import AlbumDetail from '../../src/pages/AlbumDetail'
import { apiGet, apiPatch } from '../../src/lib/apiClient'
import { useAuth } from '../../src/context/AuthContext'
import { DialogProvider } from '../../src/components/Dialog'

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  invalidateMusicApiCaches: vi.fn(),
}))
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: null, isAdmin: false })),
}))
vi.mock('../../src/context/MusicContext', () => ({
  useMusic: () => ({ currentSong: null, playAlbumTracks: vi.fn() }),
}))
vi.mock('../../src/components/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../../src/components/SmartBackLink', () => ({ SmartBackLink: () => null }))
vi.mock('../../src/components/SmartImage', () => ({ SmartImage: () => null }))
vi.mock('../../src/components/Lightbox', () => ({ Lightbox: () => null }))

const mockedUseAuth = vi.mocked(useAuth)
const mockedApiGet = vi.mocked(apiGet)

afterEach(() => mockedUseAuth.mockReturnValue({ user: null, isAdmin: false } as never))

const renderAlbum = (slug?: string) => {
  mockedApiGet.mockResolvedValue({
    album: { docId: 'album-db-id', slug, title: '测试专辑', artist: '歌手', cover: '', tracks: [] },
  })
  return render(
    <MemoryRouter initialEntries={['/album/456']}>
      <DialogProvider>
        <Routes>
          <Route path="/album/:albumId" element={<AlbumDetail />} />
        </Routes>
      </DialogProvider>
    </MemoryRouter>
  )
}

describe('AlbumDetail 管理员编辑入口', () => {
  it('管理员在专辑详情直接打开预填编辑弹窗，普通用户不可见', async () => {
    mockedUseAuth.mockReturnValue({ user: null, isAdmin: true } as never)
    const view = renderAlbum('456')
    await userEvent.setup().click(await screen.findByRole('button', { name: '编辑' }))
    expect(await screen.findByRole('dialog', { name: '编辑专辑' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('专辑名称')).toHaveValue('测试专辑')
    await userEvent.setup().click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑专辑' })).toBeNull())
    expect(screen.getByRole('heading', { name: '测试专辑' })).toBeInTheDocument()
    view.unmount()

    mockedUseAuth.mockReturnValue({ user: null, isAdmin: false } as never)
    renderAlbum('456')
    expect(await screen.findByRole('heading', { name: '测试专辑' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
  })

  it('没有公开 slug 仍可从详情就地编辑专辑', async () => {
    mockedUseAuth.mockReturnValue({ user: null, isAdmin: true } as never)
    renderAlbum()
    await userEvent.setup().click(await screen.findByRole('button', { name: '编辑' }))
    expect(await screen.findByRole('dialog', { name: '编辑专辑' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('专辑名称')).toHaveValue('测试专辑')
  })
  it('专辑弹窗保存后刷新当前详情而不跳转', async () => {
    mockedUseAuth.mockReturnValue({ user: null, isAdmin: true } as never)
    renderAlbum('456')
    await screen.findByRole('heading', { name: '测试专辑' })
    let title = '测试专辑'
    mockedApiGet.mockImplementation(async (path: string) => {
      if (path === '/api/albums/456')
        return {
          album: {
            docId: 'album-db-id',
            slug: '456',
            title,
            artist: '歌手',
            cover: '',
            tracks: [],
            sources: [],
          },
        } as never
      throw new Error(`unexpected apiGet path: ${path}`)
    })
    vi.mocked(apiPatch).mockImplementation(async (_path, payload) => {
      if (
        payload &&
        typeof payload === 'object' &&
        'title' in payload &&
        typeof payload.title === 'string'
      ) {
        title = payload.title
      }
      return {} as never
    })
    await userEvent.setup().click(screen.getByRole('button', { name: '编辑' }))
    await userEvent.setup().clear(await screen.findByPlaceholderText('专辑名称'))
    await userEvent.setup().type(screen.getByPlaceholderText('专辑名称'), '更新后的专辑')
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '编辑专辑' })).not.toBeInTheDocument()
    )
    expect(await screen.findByRole('heading', { name: '更新后的专辑' })).toBeInTheDocument()
    expect(vi.mocked(apiPatch)).toHaveBeenCalledWith(
      '/api/albums/album-db-id',
      expect.objectContaining({ title: '更新后的专辑' })
    )
  })
})
