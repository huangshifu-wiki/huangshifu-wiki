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

const Harness = () => {
  const { state, performSearch } = useSearchPage()
  const [searchParams, setSearchParams] = useSearchParams()

  return (
    <div>
      <span data-testid="page">{searchParams.get('searchWikiPage') || ''}</span>
      <span data-testid="query">{state.query}</span>
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
    mocks.search.mockResolvedValue(emptySearchResponse)
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
})
