import { StrictMode } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DefaultHome } from '../../src/pages/home/DefaultHome'
import { MusicProvider } from '../../src/context/MusicContext'
import { clearApiCache } from '../../src/lib/apiClient'
import { createLocalApi, type LocalApi } from '../setup/localApi'
import { deferred } from '../setup/deferred'

let api: LocalApi

beforeEach(async () => {
  clearApiCache()
  api = await createLocalApi()
  vi.stubGlobal('fetch', api.fetch)
  api.json('/api/events', { events: [] })
  api.json('/api/music', { songs: [] })
  api.json('/api/albums', { albums: [] })
  api.json('/api/galleries', { galleries: [] })
})
afterEach(async () => {
  cleanup()
  await api.close()
  vi.unstubAllGlobals()
  clearApiCache()
})

function renderHome() {
  return render(
    <StrictMode>
      <MemoryRouter>
        <MusicProvider>
          <DefaultHome />
        </MusicProvider>
      </MemoryRouter>
    </StrictMode>
  )
}

describe('首页分区加载', () => {
  it.each([
    ['/api/galleries', '暂无已发布图集', '暂无曲目'],
    ['/api/music', '暂无曲目', '暂无已发布图集'],
  ])('%s 延迟时其他区域独立显示', async (path, pending, ready) => {
    const gate = deferred<void>()
    api.handlers.set(path, async (_req, res) => {
      await gate.promise
      res.end(JSON.stringify(path === '/api/music' ? { songs: [] } : { galleries: [] }))
    })
    renderHome()
    expect(await screen.findByText('暂无活动')).toBeVisible()
    expect(await screen.findByText(ready)).toBeVisible()
    expect(screen.queryByText(pending)).not.toBeInTheDocument()
    await act(async () => {
      gate.resolve()
      await gate.promise
    })
    expect(await screen.findByText(pending)).toBeVisible()
  })

  it('图集失败后只重试图集，其他未完成请求仍能提交', async () => {
    const gate = deferred<void>()
    api.handlers.set('/api/music', async (_req, res) => {
      await gate.promise
      res.end(JSON.stringify({ songs: [] }))
    })
    api.json('/api/galleries', { error: '暂不可用' }, 503)
    renderHome()
    expect(await screen.findByText('图集暂时无法加载。')).toBeVisible()
    expect(await screen.findByText('暂无活动')).toBeVisible()
    api.json('/api/galleries', { galleries: [] })
    await userEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(await screen.findByText('暂无已发布图集')).toBeVisible()
    await act(async () => {
      gate.resolve()
      await gate.promise
    })
    expect(await screen.findByText('暂无曲目')).toBeVisible()
    expect(screen.getByText('暂无专辑')).toBeVisible()
    expect(api.requests.filter((path) => path !== '/api/galleries').sort()).toEqual([
      '/api/albums',
      '/api/events',
      '/api/music',
    ])
  })

  it('卸载后的旧请求不覆盖重新挂载的页面', async () => {
    const gate = deferred<void>()
    api.handlers.set('/api/events', async (_req, res) => {
      await gate.promise
      res.end(
        JSON.stringify({ events: [{ id: 'old', slug: 'old', title: '旧活动', timeSlots: [] }] })
      )
    })
    const first = renderHome()
    await waitFor(() => expect(api.requests).toContain('/api/events'))
    first.unmount()
    clearApiCache()
    api.json('/api/events', {
      events: [{ id: 'new', slug: 'new', title: '新活动', timeSlots: [] }],
    })
    renderHome()
    expect(await screen.findByText('新活动')).toBeVisible()
    await act(async () => {
      gate.resolve()
      await gate.promise
    })
    expect(screen.getByText('新活动')).toBeVisible()
    expect(screen.queryByText('旧活动')).not.toBeInTheDocument()
  })
})
