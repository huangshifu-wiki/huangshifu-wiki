// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
}))

vi.mock('../../src/hooks/useSearch', () => ({
  useMixedSearch: () => ({ searchByImage: vi.fn() }),
  useTraditionalSearch: () => ({
    search: mocks.search,
    getSuggestions: vi.fn(),
    getHotKeywords: vi.fn().mockResolvedValue([]),
  }),
}))

vi.mock('../../src/hooks/useSearchHistory', () => ({
  useSearchHistory: () => ({
    history: [],
    addToHistory: vi.fn(),
    removeFromHistory: vi.fn(),
    clearHistory: vi.fn(),
  }),
}))

import { useSearchPage } from '../../src/hooks/useSearchPage'
import { SearchResults } from '../../src/components/search/SearchResults'

const page = <T,>(): {
  items: T[]
  total: number
  page: number
  limit: number
  totalPages: number
  hasMore: boolean
} => ({
  items: [],
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 1,
  hasMore: false,
})

const emptySearchResponse = {
  wiki: page(),
  posts: page(),
  galleries: page(),
  music: page(),
  albums: page(),
  lyrics: page(),
  searchMeta: {
    mode: 'keyword',
    query: '搜索',
    degraded: false,
    keywordResultCount: 0,
    vectorResultCount: 0,
    textVectorResultCount: 0,
  },
}
const SearchResultsHarness = () => {
  const { state, tabItems, searchCategoryPage } = useSearchPage()
  return (
    <SearchResults
      state={state}
      viewMode="list"
      tabItems={tabItems}
      onTabChange={() => {}}
      onCategoryPageChange={searchCategoryPage}
    />
  )
}

const Harness = () => {
  const { state, performSearch, searchCategoryPage } = useSearchPage()
  const [searchParams, setSearchParams] = useSearchParams()

  return (
    <div>
      <span data-testid="page">{searchParams.get('searchWikiPage') || ''}</span>
      <span data-testid="query">{state.query}</span>
      <span data-testid="wiki-items">
        {state.results.wiki.items.map((item) => String(item)).join(',')}
      </span>
      <span data-testid="posts-items">
        {state.results.posts.items.map((item) => String(item)).join(',')}
      </span>
      <span data-testid="wiki-error">{state.pageErrorByCategory.wiki || ''}</span>
      <button type="button" onClick={() => void performSearch('新词')}>
        新搜索
      </button>
      <button
        type="button"
        onClick={() => {
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev)
            next.set('searchWikiPage', '2')
            return next
          })
        }}
      >
        设置页码
      </button>
      <button
        type="button"
        onClick={() => {
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev)
            next.set('searchWikiPage', '2')
            next.set('searchPostsPage', '2')
            return next
          })
        }}
      >
        设置多个页码
      </button>
      <button
        type="button"
        onClick={() => {
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev)
            next.set('searchWikiPage', '2')
            return next
          })
          void searchCategoryPage('wiki', 2)
        }}
      >
        直接翻页
      </button>
      <button
        type="button"
        onClick={() =>
          void performSearch(state.query, undefined, undefined, { preservePagination: true })
        }
      >
        保留页码重试
      </button>
    </div>
  )
}

describe('搜索分页 URL 生命周期', () => {
  beforeEach(() => {
    mocks.search.mockReset()
    mocks.search.mockImplementation((_query, _filters, options) => {
      if (options?.requestType === 'wiki') {
        return Promise.resolve({
          ...emptySearchResponse,
          wiki: { ...page(), items: [{}], total: 21, page: 2, totalPages: 2, hasMore: false },
        })
      }
      return Promise.resolve(emptySearchResponse)
    })
  })

  it('新搜索清除旧页码，保留页码重试不清除', async () => {
    render(
      <MemoryRouter initialEntries={['/search?q=旧词&searchWikiPage=2']}>
        <Harness />
      </MemoryRouter>
    )

    await waitFor(() => expect(screen.getByTestId('page')).toHaveTextContent('2'))

    fireEvent.click(screen.getByRole('button', { name: '新搜索' }))
    await waitFor(() => expect(screen.getByTestId('page')).toHaveTextContent(''))

    fireEvent.click(screen.getByRole('button', { name: '设置页码' }))
    await waitFor(() => expect(screen.getByTestId('page')).toHaveTextContent('2'))

    fireEvent.click(screen.getByRole('button', { name: '保留页码重试' }))
    await waitFor(() => expect(screen.getByTestId('page')).toHaveTextContent('2'))
  })
  it('分页回调直连请求时 URL effect 不重复请求', async () => {
    render(
      <MemoryRouter initialEntries={['/search?q=春日']}>
        <Harness />
      </MemoryRouter>
    )
    await waitFor(() => expect(mocks.search).toHaveBeenCalledOnce())
    mocks.search.mockClear()

    fireEvent.click(screen.getByRole('button', { name: '直接翻页' }))
    await waitFor(() => expect(screen.getByTestId('page')).toHaveTextContent('2'))
    expect(mocks.search).toHaveBeenCalledOnce()
    expect(mocks.search.mock.calls[0][2]).toMatchObject({ requestType: 'wiki' })
  })
  it('单个类别翻页只请求目标类别并保留其他结果', async () => {
    const initialResponse = {
      ...emptySearchResponse,
      wiki: { ...page(), items: ['wiki-1'], total: 21, page: 1, totalPages: 2, hasMore: true },
      posts: { ...page(), items: ['post-1'], total: 1, page: 1, totalPages: 1, hasMore: false },
    }
    const wikiPageResponse = {
      ...initialResponse,
      wiki: { ...page(), items: ['wiki-2'], total: 21, page: 2, totalPages: 2, hasMore: false },
    }
    mocks.search.mockImplementation((_query, _filters, options) =>
      Promise.resolve(options?.requestType === 'wiki' ? wikiPageResponse : initialResponse)
    )

    render(
      <MemoryRouter initialEntries={['/search?q=春日']}>
        <Harness />
      </MemoryRouter>
    )

    await waitFor(() => expect(screen.getByTestId('wiki-items')).toHaveTextContent('wiki-1'))
    mocks.search.mockClear()

    fireEvent.click(screen.getByRole('button', { name: '设置页码' }))
    await waitFor(() => expect(screen.getByTestId('wiki-items')).toHaveTextContent('wiki-2'))

    expect(mocks.search).toHaveBeenCalledOnce()
    const [, , options] = mocks.search.mock.calls[0]
    expect(options).toMatchObject({ requestType: 'wiki', pageParams: { wikiPage: 2 } })
    expect(options.pageParams).not.toHaveProperty('postsPage')
    expect(options.pageParams).not.toHaveProperty('musicPage')
    expect(screen.getByTestId('posts-items')).toHaveTextContent('post-1')
  })

  it('类别翻页失败时恢复页码并保留错误范围', async () => {
    const response = {
      ...emptySearchResponse,
      wiki: { ...page(), items: ['wiki-1'], total: 21, page: 1, totalPages: 2, hasMore: true },
      posts: { ...page(), items: ['post-1'], total: 1, page: 1, totalPages: 1, hasMore: false },
    }
    let fail = false
    mocks.search.mockImplementation((_query, _filters, options) => {
      if (options?.requestType === 'wiki' && fail) return Promise.reject(new Error('百科分页失败'))
      return Promise.resolve(response)
    })

    render(
      <MemoryRouter initialEntries={['/search?q=春日']}>
        <Harness />
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByTestId('posts-items')).toHaveTextContent('post-1'))

    fail = true
    fireEvent.click(screen.getByRole('button', { name: '设置页码' }))
    await waitFor(() => expect(screen.getByTestId('wiki-error')).toHaveTextContent('百科分页失败'))
    expect(screen.getByTestId('page')).toHaveTextContent('')
    expect(screen.getByTestId('posts-items')).toHaveTextContent('post-1')

    fail = false
    fireEvent.click(screen.getByRole('button', { name: '设置页码' }))
    await waitFor(() => expect(screen.getByTestId('wiki-error')).toHaveTextContent(''))
  })

  it('多个类别页码同时变化时回退到一次聚合请求', async () => {
    mocks.search.mockResolvedValue(emptySearchResponse)
    render(
      <MemoryRouter initialEntries={['/search?q=春日']}>
        <Harness />
      </MemoryRouter>
    )
    await waitFor(() => expect(mocks.search).toHaveBeenCalledOnce())
    mocks.search.mockClear()

    fireEvent.click(screen.getByRole('button', { name: '设置多个页码' }))
    await waitFor(() => expect(mocks.search).toHaveBeenCalledOnce())

    const [, , options] = mocks.search.mock.calls[0]
    expect(options).toMatchObject({
      requestType: 'all',
      pageParams: { wikiPage: 2, postsPage: 2 },
    })
  })

  it('搜索响应到达后实际结果区块可见', async () => {
    mocks.search.mockResolvedValue({
      ...emptySearchResponse,
      wiki: {
        ...page(),
        items: [
          {
            id: 'wiki-1',
            slug: 'wiki-1',
            title: '实际百科结果',
            category: '人物',
            content: '内容',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        total: 0,
      },
    })

    render(
      <MemoryRouter initialEntries={['/search?q=春日']}>
        <React.StrictMode>
          <SearchResultsHarness />
        </React.StrictMode>
      </MemoryRouter>
    )

    await waitFor(() => expect(screen.getByText('实际百科结果')).toBeInTheDocument())
  })
  it('类别分页响应到达后替换目标结果', async () => {
    const firstItem = {
      id: 'wiki-1',
      slug: 'wiki-1',
      title: '第一页结果',
      category: '人物',
      content: '内容',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const secondItem = { ...firstItem, id: 'wiki-2', slug: 'wiki-2', title: '第二页结果' }
    const firstResponse = {
      ...emptySearchResponse,
      wiki: { ...page(), items: [firstItem], total: 21, totalPages: 2, hasMore: true },
    }
    const secondResponse = {
      ...firstResponse,
      wiki: { ...page(), items: [secondItem], total: 21, page: 2, totalPages: 2, hasMore: false },
    }
    mocks.search.mockImplementation((_query, _filters, options) =>
      Promise.resolve(options?.requestType === 'wiki' ? secondResponse : firstResponse)
    )

    render(
      <MemoryRouter initialEntries={['/search?q=春日']}>
        <SearchResultsHarness />
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByText('第一页结果')).toBeInTheDocument())
    mocks.search.mockClear()

    fireEvent.click(screen.getByRole('button', { name: '第 2 页' }))
    await waitFor(() => expect(screen.getByText('第二页结果')).toBeInTheDocument())
    expect(mocks.search).toHaveBeenCalledOnce()
  })
})
