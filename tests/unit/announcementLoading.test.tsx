import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnnouncementBar } from '../../src/components/AnnouncementBar'
import { apiGet, clearApiCache } from '../../src/lib/apiClient'
import { createLocalApi, type LocalApi } from '../setup/localApi'

let api: LocalApi
const announcement = {
  id: 'notice-1',
  content: '公告测试内容',
  link: '/announcements',
  updatedAt: '2026-10-28T00:00:00Z',
}
beforeEach(async () => {
  clearApiCache()
  localStorage.clear()
  api = await createLocalApi()
  vi.stubGlobal('fetch', api.fetch)
  api.json('/api/announcements/latest', { announcement })
})
afterEach(async () => {
  cleanup()
  await api.close()
  vi.unstubAllGlobals()
  clearApiCache()
})

describe('公告按需渲染', () => {
  it('可见公告显示内容、链接，关闭后退出', async () => {
    render(<AnnouncementBar />)
    await waitFor(() => expect(screen.getByText(announcement.content)).toBeVisible())
    expect(screen.getByRole('link', { name: /立即查看/ })).toHaveAttribute('href', '/announcements')
    await userEvent.click(screen.getByRole('button', { name: '关闭公告' }))
    await waitFor(() => expect(screen.queryByText(announcement.content)).not.toBeInTheDocument())
    expect(document.documentElement.style.getPropertyValue('--announcement-bar-offset')).toBe('')
  })

  it('记住不再显示，并在重新挂载时保持关闭', async () => {
    const view = render(<AnnouncementBar />)
    await screen.findByText(announcement.content)
    await userEvent.click(screen.getByRole('button', { name: '不再显示此公告' }))
    await waitFor(() => expect(screen.queryByText(announcement.content)).not.toBeInTheDocument())
    view.unmount()
    clearApiCache()
    render(<AnnouncementBar />)
    await act(async () => {
      await apiGet('/api/announcements/latest')
    })
    expect(screen.queryByText(announcement.content)).not.toBeInTheDocument()
  })

  it('已关闭公告更新后可再次显示', async () => {
    const view = render(<AnnouncementBar />)
    await screen.findByText(announcement.content)
    await userEvent.click(screen.getByRole('button', { name: '不再显示此公告' }))
    view.unmount()
    clearApiCache()
    api.json('/api/announcements/latest', {
      announcement: { ...announcement, content: '更新公告内容', updatedAt: '2026-10-28T01:00:00Z' },
    })
    render(<AnnouncementBar />)
    await waitFor(() => expect(screen.getByText('更新公告内容')).toBeVisible())
  })
})
