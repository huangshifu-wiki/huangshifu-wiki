// @vitest-environment jsdom
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiGet } from '../../src/lib/apiClient'
import EventDetail from '../../src/pages/EventDetail'

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
}))

vi.mock('../../src/components/SmartBackLink', () => ({
  SmartBackLink: () => null,
}))

vi.mock('../../src/components/SmartImage', () => ({
  SmartImage: ({ fallback, className }: { fallback?: React.ReactNode; className?: string }) => (
    <div className={className}>{fallback}</div>
  ),
}))

vi.mock('../../src/components/CoverPlaceholder', () => ({
  CoverPlaceholder: ({ label }: { label?: string }) => <span>{label}</span>,
}))

vi.mock('../../src/components/Lightbox', () => ({
  Lightbox: () => null,
}))

vi.mock('../../src/components/MarkdownRenderer', () => ({
  default: () => null,
}))

const mockedApiGet = vi.mocked(apiGet)

const renderDetail = () =>
  render(
    <MemoryRouter initialEntries={['/events/spring-2024']}>
      <Routes>
        <Route path="/events/:slug" element={<EventDetail />} />
      </Routes>
    </MemoryRouter>
  )

describe('EventDetail SEO 元数据', () => {
  const resetHead = () => {
    document.head.querySelectorAll('[data-hsf-seo]').forEach((el) => el.remove())
    document.title = ''
  }

  beforeEach(() => {
    resetHead()
    vi.clearAllMocks()
  })

  it('数据尚未就绪时不崩溃，输出 noindex,follow', () => {
    mockedApiGet.mockImplementation(() => new Promise(() => {}))

    renderDetail()

    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex,follow'
    )
    expect(document.title).toBe('黄诗扶 Wiki')
    expect(document.querySelector('script[data-hsf-seo="jsonld"]')).toBeNull()
  })

  it('加载失败后输出 noindex,follow 与错误标题', async () => {
    mockedApiGet.mockRejectedValue(new Error('offline'))

    renderDetail()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    // SEO 由 useEffect 写入 head，与 alert 的 DOM 变更不在同一时点，需等待生效
    await waitFor(() => expect(document.title).toBe('活动不存在｜黄诗扶 Wiki'))
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex,follow'
    )
  })
})
