// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SearchResults } from '../../src/components/search/SearchResults'
import { VIEW_MODE_CONFIG } from '../../src/lib/viewModes'
import type { SearchState } from '../../src/hooks/useSearchPage'

vi.mock('motion/react', () => ({
  motion: {
    section: ({ children, ...props }: React.ComponentProps<'section'>) => <section {...props}>{children}</section>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const baseState: SearchState = {
  query: '测试',
  results: {
    wiki: [],
    posts: [],
    galleries: [],
    music: [],
    albums: [],
  },
  loading: false,
  hasSearched: true,
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
  searchMeta: undefined,
  textSemanticResults: [],
}

const tabItems = [
  { id: 'all', label: '全部', count: 0 },
  { id: 'wiki', label: '百科', count: 0 },
  { id: 'posts', label: '帖子', count: 0 },
  { id: 'textSemantic', label: '语义', count: 0 },
]

const makeWiki = (index: number) => ({
  id: `wiki-${index}`,
  slug: `wiki-${index}`,
  title: `百科 ${index}`,
  category: 'biography',
  content: `这是第 ${index} 条百科内容`,
  tags: [],
  lastEditorUid: 'user-1',
  lastEditorName: 'Tester',
  createdAt: new Date('2024-01-01').toISOString(),
  updatedAt: new Date('2024-06-01').toISOString(),
})

const renderSearchResults = (state: SearchState) =>
  render(
    <MemoryRouter>
      <SearchResults
        state={state}
        viewMode="small"
        tabItems={tabItems}
        onTabChange={() => {}}
      />
    </MemoryRouter>
  )

describe('SearchResults', () => {
  it('renders large wiki result sets with the selected grid view instead of forcing list mode', async () => {
    const state: SearchState = {
      ...baseState,
      results: {
        ...baseState.results,
        wiki: Array.from({ length: 31 }, (_, index) => makeWiki(index + 1)),
      },
    }

    const { container } = renderSearchResults(state)
    const { gridCols, gap, cardHeight } = VIEW_MODE_CONFIG.small

    expect(await screen.findByText('百科 1')).toBeInTheDocument()

    const gridContainer = Array.from(container.querySelectorAll<HTMLDivElement>('div')).find((element) => {
      const className = typeof element.className === 'string' ? element.className : ''
      const expectedClasses = ['grid', ...gridCols.split(' '), gap]
      return expectedClasses.every((expectedClass) => className.includes(expectedClass))
    })

    expect(gridContainer).toBeTruthy()
    expect(within(gridContainer as HTMLElement).getByText('百科 1')).toBeInTheDocument()

    const firstCard = screen.getByText('百科 1').closest('a')
    expect(firstCard).toHaveClass(cardHeight)
    expect(firstCard?.className).not.toContain('w-full')

    const legacyVirtualScrollContainer = Array.from(container.querySelectorAll<HTMLDivElement>('div')).find((element) => {
      const className = typeof element.className === 'string' ? element.className : ''
      const hasLegacyClasses = className.includes('overflow-auto') && className.includes('max-h-[60vh]')
      const hasLegacyInlineStyles = element.style.overflow === 'auto' && element.style.maxHeight === '60vh'
      return hasLegacyClasses || hasLegacyInlineStyles
    })

    expect(legacyVirtualScrollContainer).toBeUndefined()
  })

  it('applies the selected view mode to post and text semantic results', async () => {
    const state: SearchState = {
      ...baseState,
      results: {
        ...baseState.results,
        posts: [
          {
            id: 'post-1',
            title: '帖子一',
            section: '讨论',
            content: '帖子内容预览',
            tags: [],
            authorUid: 'user-1',
            likesCount: 0,
            dislikesCount: 0,
            commentsCount: 0,
            createdAt: new Date('2024-01-01').toISOString(),
            updatedAt: new Date('2024-06-02').toISOString(),
          },
        ],
      },
      textSemanticResults: [
        {
          sourceType: 'post',
          sourceId: 'semantic-post-1',
          score: 0.87,
          chunkPreview: '这是一段语义命中的帖子摘要',
          entity: {
            id: 'semantic-post-1',
            title: '语义帖子一',
          },
        },
      ],
    }

    renderSearchResults(state)
    const { cardHeight } = VIEW_MODE_CONFIG.small

    expect(await screen.findByText('帖子一')).toBeInTheDocument()
    expect(screen.getByText('语义帖子一')).toBeInTheDocument()

    const postCard = screen.getByText('帖子一').closest('a')
    const semanticCard = screen.getByText('语义帖子一').closest('a')

    expect(postCard).toHaveClass(cardHeight)
    expect(postCard?.className).not.toContain('w-full')
    expect(semanticCard).toHaveClass(cardHeight)
    expect(semanticCard?.className).not.toContain('w-full')
  })
})
