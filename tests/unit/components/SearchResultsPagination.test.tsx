// @vitest-environment jsdom
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { SearchResults } from '../../../src/components/search/SearchResults'
import type { SearchState } from '../../../src/hooks/useSearchPage'
import type { GalleryItem, PostItem, WikiItem } from '../../../src/types/entities'

const UrlProbe = () => {
  const [searchParams] = useSearchParams()
  return <span data-testid="search-wiki-page">{searchParams.get('searchWikiPage') || ''}</span>
}

const makeWiki = (index: number) =>
  ({
    id: `wiki-${index}`,
    slug: `wiki-${index}`,
    title: `百科 ${index}`,
    category: '人物',
    content: `内容 ${index}`,
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as unknown as WikiItem

const makePost = () =>
  ({
    id: 'post-1',
    slug: 'post-1',
    title: '帖子结果',
    section: '讨论',
    content: '帖子内容',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as unknown as PostItem

const emptyResults = {
  wiki: [],
  posts: [],
  galleries: [] as GalleryItem[],
  music: [],
  albums: [],
  lyrics: [],
}

const makeState = (overrides: Partial<SearchState> = {}): SearchState => ({
  query: '春日',
  includeDetail: false,
  results: emptyResults,
  loading: false,
  error: null,
  activeTab: 'all',
  filters: {
    selectedTags: [],
    dateRange: { start: '', end: '' },
    contentType: 'all',
    semanticImageSearch: false,
  },
  suggestions: [],
  mixedResults: [],
  isMixedSearch: false,
  aiSearching: false,
  hotKeywords: [],
  showFilters: false,
  ...overrides,
})

describe('搜索结果分类分页', () => {
  it('独立分页并保留其他类别结果', async () => {
    const user = userEvent.setup()
    const wiki = Array.from({ length: 21 }, (_, index) => makeWiki(index + 1))

    render(
      <MemoryRouter initialEntries={['/search?q=春日']}>
        <SearchResults
          state={makeState({ results: { ...emptyResults, wiki, posts: [makePost()] } })}
          viewMode="list"
          tabItems={[
            { id: 'all', label: '全部', count: 22 },
            { id: 'wiki', label: '百科', count: 21 },
            { id: 'posts', label: '帖子', count: 1 },
          ]}
          onTabChange={vi.fn()}
        />
        <UrlProbe />
      </MemoryRouter>
    )

    expect(screen.getByText('百科 1')).toBeInTheDocument()
    expect(screen.getByText('百科 20')).toBeInTheDocument()
    expect(screen.queryByText('百科 21')).not.toBeInTheDocument()
    expect(screen.getByText('帖子结果')).toBeInTheDocument()
    expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '第 2 页' }))

    expect(screen.queryByText('百科 1')).not.toBeInTheDocument()
    expect(screen.getByText('百科 21')).toBeInTheDocument()
    expect(screen.getByText('帖子结果')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('search-wiki-page')).toHaveTextContent('2'))
  })
})
