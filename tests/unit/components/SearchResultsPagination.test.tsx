// @vitest-environment jsdom
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { SearchResults } from '../../../src/components/search/SearchResults'
import type { SearchState } from '../../../src/hooks/useSearchPage'
import type {
  AlbumItem,
  GalleryItem,
  LyricSearchItem,
  PostItem,
  SongItem,
  WikiItem,
} from '../../../src/types/entities'

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

const emptyPage = <T,>(): {
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

const emptyResults = {
  wiki: emptyPage<WikiItem>(),
  posts: emptyPage<PostItem>(),
  galleries: emptyPage<GalleryItem>(),
  music: emptyPage<SongItem>(),
  albums: emptyPage<AlbumItem>(),
  lyrics: emptyPage<LyricSearchItem>(),
}

const makeState = (overrides: Partial<SearchState> = {}): SearchState => ({
  query: '春日',
  includeDetail: false,
  results: emptyResults,
  loading: false,
  loadingCategoryPages: new Set(),
  error: null,
  pageErrorByCategory: {},
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
    const onCategoryPageChange = vi.fn()
    const wiki = Array.from({ length: 21 }, (_, index) => makeWiki(index + 1))

    render(
      <MemoryRouter initialEntries={['/search?q=春日']}>
        <SearchResults
          state={makeState({
            results: {
              ...emptyResults,
              wiki: { ...emptyPage(), items: wiki.slice(0, 20), total: 21, totalPages: 2 },
              posts: { ...emptyPage(), items: [makePost()], total: 1 },
            },
          })}
          viewMode="list"
          tabItems={[
            { id: 'all', label: '全部', count: 22 },
            { id: 'wiki', label: '百科', count: 21 },
            { id: 'posts', label: '帖子', count: 1 },
          ]}
          onTabChange={vi.fn()}
          onCategoryPageChange={onCategoryPageChange}
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
    await waitFor(() => expect(screen.getByTestId('search-wiki-page')).toHaveTextContent('2'))
    expect(onCategoryPageChange).toHaveBeenCalledWith('wiki', 2)
    expect(screen.queryByText('百科 21')).not.toBeInTheDocument()
  })

  it('类别加载或失败时不隐藏其他类别', () => {
    render(
      <MemoryRouter initialEntries={['/search?q=春日']}>
        <SearchResults
          state={makeState({
            loadingCategoryPages: new Set(['wiki']),
            results: {
              ...emptyResults,
              wiki: { ...emptyPage(), items: [makeWiki(1)], total: 21, totalPages: 2 },
              posts: { ...emptyPage(), items: [makePost()], total: 1 },
            },
          })}
          viewMode="list"
          tabItems={[{ id: 'all', label: '全部', count: 22 }]}
          onTabChange={vi.fn()}
        />
      </MemoryRouter>
    )

    expect(screen.getByRole('status', { name: '百科页面加载中' })).toBeInTheDocument()
    expect(screen.getByText('帖子结果')).toBeInTheDocument()
  })
})
