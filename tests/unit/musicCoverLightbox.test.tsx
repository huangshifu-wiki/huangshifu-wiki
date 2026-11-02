import { act, render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import MusicDetail from '../../src/pages/MusicDetail'
import AlbumDetail from '../../src/pages/AlbumDetail'
import { MusicProvider } from '../../src/context/MusicContext'
import { ToastProvider } from '../../src/components/ui'
import { clearApiCache, generateApiCacheKey } from '../../src/lib/apiClient'
import { dedupedRequest } from '../../src/utils/requestDedup'

// jsdom 不提供可见性观察器；图片地址断言不依赖布局。
beforeAll(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})
afterAll(() => vi.unstubAllGlobals())

function incoming(path: string) {
  let resolve!: (value: unknown) => void
  const response = new Promise((done) => {
    resolve = done
  })
  const promise = dedupedRequest(() => response, generateApiCacheKey('GET', path), { swr: false })
  return { resolve, promise }
}

describe('音乐封面查看', () => {
  it.each([
    ['song', 'b', ['a', 'b', 'c', 'a'], ['a', 'b', 'c'], 1],
    ['album', 'b', ['a', 'b', 'c', 'a'], ['a', 'b', 'c'], 1],
    ['song', 'x', ['a', 'b'], ['x', 'a', 'b'], 0],
    ['album', 'x', undefined, ['x'], 0],
    ['song', '', [], [], 0],
  ] as const)('%s 当前封面 %s', async (kind, cover, ids, expected, initial) => {
    clearApiCache()
    const state = window.history.state
    const url = window.location.href
    const title = '测试封面'
    const docId = `${kind}-doc`
    const slug = kind === 'song' ? '101' : '201'
    const path = kind === 'song' ? `/music/${slug}` : `/album/${slug}`
    const detail = incoming(kind === 'song' ? `/api/music/${slug}` : `/api/albums/${slug}`)
    const posts = kind === 'song' ? incoming(`/api/music/${docId}/posts`) : null
    const resource = {
      docId,
      slug,
      title,
      cover,
      coverThumbnail: cover ? `${cover}-thumb` : '',
      covers: ids?.map((id, sortOrder) => ({
        id: `${id}-${sortOrder}`,
        url: id,
        thumbnailUrl: `${id}-thumb`,
        isDefault: false,
        sortOrder,
      })),
      artists: [],
      artist: '歌手',
      album: '',
      audioUrl: '',
      tracks: [],
    }
    const view = render(
      <MusicProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/music/:songId" element={<MusicDetail />} />
              <Route path="/album/:albumId" element={<AlbumDetail />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </MusicProvider>
    )
    try {
      await act(async () => {
        detail.resolve(kind === 'song' ? { song: resource } : { album: resource })
        await detail.promise
      })
      await screen.findByRole('heading', { name: title })
      if (posts)
        await act(async () => {
          posts.resolve({ posts: [] })
          await posts.promise
        })
      const trigger = screen.getByRole('button', { name: `查看 ${title} 封面原图` })
      if (kind === 'song' && expected.length > 1) {
        expect(within(trigger).getByRole('img', { name: '多张封面' })).toBeInTheDocument()
      } else {
        expect(within(trigger).queryByRole('img', { name: '多张封面' })).toBeNull()
      }
      if (!expected.length) {
        expect(trigger).toBeDisabled()
        expect(screen.queryByRole('dialog')).toBeNull()
        return
      }
      const user = userEvent.setup()
      await user.click(trigger)
      const check = (index: number) => {
        const dialog = screen.getByRole('dialog', {
          name: `图片查看器 ${index + 1} / ${expected.length}`,
        })
        expect(dialog.querySelector('img')).toHaveAttribute('src', expected[index])
        expect(within(dialog).getByRole('link', { name: '下载原图' })).toHaveAttribute(
          'href',
          expected[index]
        )
        return dialog
      }
      let dialog = check(initial)
      if (expected.length > 1) {
        for (let step = 1; step <= expected.length; step++) {
          await user.click(within(dialog).getByRole('button', { name: '下一张' }))
          dialog = check((initial + step) % expected.length)
        }
        fireEvent.keyDown(document, { key: 'ArrowLeft' })
        dialog = check((initial - 1 + expected.length) % expected.length)
      } else {
        expect(within(dialog).queryByRole('button', { name: '下一张' })).toBeNull()
      }
      await user.click(within(dialog).getByRole('button', { name: '关闭' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      await user.click(trigger)
      check(initial)
    } finally {
      view.unmount()
      posts?.resolve({ posts: [] })
      await posts?.promise
      clearApiCache()
      window.history.replaceState(state, '', url)
    }
  })
})
