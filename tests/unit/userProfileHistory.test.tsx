import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UserProfile from '../../src/pages/UserProfile'
import { clearCache } from '../../src/utils/requestDedup'

const auth = vi.hoisted(() => ({ user: { uid: 'owner', publicId: '1' } }))
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ user: auth.user, refreshAuth: vi.fn() }),
}))
vi.mock('../../src/components/Toast', () => ({
  useToast: () => ({ show: vi.fn() }),
}))
vi.mock('../../src/components/MarkdownRenderer', () => ({ default: () => null }))

const profile = {
  publicId: '1',
  displayName: '历史测试用户',
  photoURL: null,
  signature: '',
  bio: '',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  isSelf: true,
  canViewFavorites: false,
  canViewHistory: true,
  publicFavorites: false,
  publicHistory: false,
}
const item = {
  id: 'history-1',
  targetType: 'music',
  targetId: 'song-1',
  createdAt: '2025-01-01T00:00:00.000Z',
  target: { docId: 'song-1', slug: '101', title: '刚浏览的歌曲', artists: [] },
}

function HistoryHarness() {
  return (
    <MemoryRouter initialEntries={['/users/1/history']}>
      <Link to="/away">离开历史</Link>
      <Link to="/users/1/history">返回历史</Link>
      <Routes>
        <Route path="/users/:userId/:tab?" element={<UserProfile />} />
        <Route path="/away" element={<p>其他页面</p>} />
      </Routes>
    </MemoryRouter>
  )
}

const fetchMock = vi.fn<typeof fetch>()
let rows: (typeof item)[]
let historyFailure: boolean
let historyLoader: (() => Promise<Response>) | undefined
let allowHistory: boolean

beforeEach(() => {
  clearCache()
  auth.user = { uid: 'owner', publicId: '1' }
  rows = []
  historyFailure = false
  historyLoader = undefined
  allowHistory = true
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const path = String(input)
    if (path.endsWith('/profile')) {
      return Response.json({ user: { ...profile, canViewHistory: allowHistory } })
    }
    if (path.includes('/history?')) {
      if (historyLoader) return historyLoader()
      if (historyFailure) return Response.json({ error: '历史服务暂不可用' }, { status: 500 })
      return Response.json({ history: rows, total: rows.length })
    }
    throw new Error(`未预期的请求：${path}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  clearCache()
  vi.unstubAllGlobals()
})

describe('个人浏览历史的即时刷新', () => {
  it('离开空历史后浏览内容，在缓存有效期内返回即可显示新记录', async () => {
    const user = userEvent.setup()
    render(<HistoryHarness />)
    expect(await screen.findByText('暂无可见浏览历史')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: '离开历史' }))
    rows = [item]
    await user.click(screen.getByRole('link', { name: '返回历史' }))
    expect(await screen.findByRole('link', { name: /刚浏览的歌曲/ })).toHaveAttribute(
      'href',
      '/music/101'
    )
    expect(screen.queryByText('暂无可见浏览历史')).not.toBeInTheDocument()
  })

  it('离开后迟到的旧请求不能覆盖返回页面的新记录', async () => {
    const user = userEvent.setup()
    let resolveOld!: (response: Response) => void
    const oldResponse = new Promise<Response>((resolve) => {
      resolveOld = resolve
    })
    historyLoader = () => oldResponse
    render(<HistoryHarness />)
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([path]) => String(path).includes('/history?'))).toBe(true)
    )
    await user.click(screen.getByRole('link', { name: '离开历史' }))
    historyLoader = undefined
    rows = [item]
    await user.click(screen.getByRole('link', { name: '返回历史' }))
    expect(await screen.findByRole('link', { name: /刚浏览的歌曲/ })).toBeInTheDocument()
    await act(async () => {
      resolveOld(Response.json({ history: [], total: 0 }))
      await oldResponse
    })
    expect(screen.getByRole('link', { name: /刚浏览的歌曲/ })).toBeInTheDocument()
    expect(screen.queryByText('暂无可见浏览历史')).not.toBeInTheDocument()
  })

  it('新请求失败时显示错误，重试成功后显示最新记录', async () => {
    const user = userEvent.setup()
    render(<HistoryHarness />)
    expect(await screen.findByText('暂无可见浏览历史')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: '离开历史' }))
    historyFailure = true
    await user.click(screen.getByRole('link', { name: '返回历史' }))
    expect(await screen.findByText('历史服务暂不可用')).toBeInTheDocument()
    historyFailure = false
    rows = [item]
    await user.click(screen.getByRole('button', { name: '重新加载' }))
    expect(await screen.findByRole('link', { name: /刚浏览的歌曲/ })).toBeInTheDocument()
    expect(screen.queryByText('历史服务暂不可用')).not.toBeInTheDocument()
  })

  it('身份变化后重新取得权限，不显示上一身份的私有历史', async () => {
    rows = [item]
    const view = render(<HistoryHarness />)
    expect(await screen.findByRole('link', { name: /刚浏览的歌曲/ })).toBeInTheDocument()
    auth.user = { uid: 'visitor', publicId: '2' }
    allowHistory = false
    view.rerender(<HistoryHarness />)
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /刚浏览的歌曲/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: '浏览历史' })).not.toBeInTheDocument()
    })
    expect(await screen.findByText('这位粉丝很神秘，还没有写下任何简介...')).toBeInTheDocument()
  })
})
