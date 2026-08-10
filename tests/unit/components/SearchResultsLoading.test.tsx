// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SearchResults } from '../../../src/components/search/SearchResults'
import type { SearchState } from '../../../src/hooks/useSearchPage'

const emptyResults = {
  wiki: [],
  posts: [],
  galleries: [],
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
  textSemanticResults: [],
  ...overrides,
})

describe('搜索结果错误状态', () => {
  it('搜索失败显示错误和重试入口，不伪装成成功空结果', () => {
    const onRetry = vi.fn()

    render(
      <SearchResults
        state={makeState({ error: '搜索服务暂时不可用' })}
        viewMode="list"
        tabItems={[{ id: 'all', label: '全部', count: 0 }]}
        onTabChange={vi.fn()}
        onRetry={onRetry}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('搜索服务暂时不可用')
    expect(screen.queryByText('未找到符合筛选条件的结果')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))

    expect(onRetry).toHaveBeenCalledOnce()
  })
})
