// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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

describe('搜索结果错误状态', () => {
  it('搜索失败显示错误和重试入口，不伪装成成功空结果', () => {
    const onRetry = vi.fn()

    render(
      <MemoryRouter>
        <SearchResults
          state={makeState({ error: '搜索服务暂时不可用' })}
          viewMode="list"
          tabItems={[{ id: 'all', label: '全部', count: 0 }]}
          onTabChange={vi.fn()}
          onRetry={onRetry}
        />
      </MemoryRouter>
    )

    expect(screen.getByRole('alert')).toHaveTextContent('搜索服务暂时不可用')
    expect(screen.queryByText('未找到符合筛选条件的结果')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))

    expect(onRetry).toHaveBeenCalledOnce()
  })
})
