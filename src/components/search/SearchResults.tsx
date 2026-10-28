import React from 'react'
import { clsx } from 'clsx'
import { AnimatePresence } from 'motion/react'
import {
  Book,
  MessageSquare,
  Image as ImageIcon,
  Music,
  Sparkles,
  Search as SearchIcon,
  Tag,
  FileText,
} from '@/src/components/icons'
import { VIEW_MODE_CONFIG } from '../../lib/viewModes'
import type { ViewMode } from '../../types/userPreferences'
import { formatDate } from '../../lib/dateUtils'
import { summarizeSeoText } from '../../lib/seo'
import type { SearchState } from '../../hooks/useSearchPage'
import type { WikiItem, PostItem, GalleryItem, AlbumItem } from '../../types/entities'
import { MixedSearchResultCard } from '../MixedSearchResultCard'
import { SearchResultCard } from './SearchResultCard'
import { LyricSearchResultCard } from './LyricSearchResultCard'
import { MusicSearchResults } from './MusicSearchResults'
import { useRoutedPagination } from '../../hooks/useRoutedPagination'
import {
  getSearchResultCount,
  SEARCH_PAGE_PARAM_BY_CATEGORY,
  SEARCH_PAGE_SIZE,
  SEARCH_PAGINATION_DOCK_GROUP,
  type SearchPaginationCategory,
} from '../../lib/searchPagination'
import { SearchResultSection } from './SearchResultSection'
import { getFirstGalleryImage, shouldWaitForGalleryThumbnail } from '../../lib/galleryThumbnails'
import { Button, LoadErrorState, Skeleton } from '@/src/components/ui'

interface SearchResultsProps {
  state: SearchState
  viewMode: ViewMode
  tabItems: Array<{ id: string; label: string; count: number }>
  onTabChange: (tab: string) => void
  onRetry?: () => void
  onCategoryPageChange?: (category: SearchPaginationCategory, page: number) => void
  onMixedPageChange?: (source: 'semantic' | 'wiki' | 'post' | 'gallery', page: number) => void
}
function useSearchResultsPagination(
  totalCount: number,
  pageParam: string,
  totalKnown: boolean,
  serverTotalPages?: number
) {
  return useRoutedPagination({
    totalCount,
    serverTotalPages,
    totalKnown,
    defaultPageSize: SEARCH_PAGE_SIZE,
    pageParam,
    pageSizeParam: null,
    showPageSizeSelector: false,
  })
}

function wikiToConfig(page: WikiItem): import('./SearchResultCard').SearchResultCardConfig {
  return {
    id: page.id,
    title: page.title,
    description: (page.content || '').replace(/[#*`]/g, '').substring(0, 80),
    link: `/wiki/${page.slug}`,
    tags: [page.category],
    meta: formatDate(page.updatedAt, 'yyyy-MM-dd'),
    type: 'wiki',
  }
}

function galleryToConfig(
  gallery: GalleryItem
): import('./SearchResultCard').SearchResultCardConfig {
  const image = getFirstGalleryImage(gallery)

  return {
    id: gallery.id,
    title: gallery.title,
    description: summarizeSeoText(gallery.description, '', 80) || undefined,
    link: `/gallery/${gallery.slug || gallery.id}`,
    image: image?.thumbnailUrl || undefined,
    imagePlaceholder: shouldWaitForGalleryThumbnail(gallery) ? '生成中...' : undefined,
    meta: `${Array.isArray(gallery.images) ? gallery.images.length : 0} 张图片`,
    type: 'gallery',
  }
}

function albumToConfig(album: AlbumItem): import('./SearchResultCard').SearchResultCardConfig {
  return {
    id: album.docId || album.title,
    title: album.title,
    subtitle: album.artist,
    link: `/album/${album.slug || album.docId}`,
    image: album.coverThumbnail || album.cover || undefined,
    meta: `${album.trackCount} 曲`,
    type: 'album',
  }
}

function postToConfig(post: PostItem): import('./SearchResultCard').SearchResultCardConfig {
  return {
    id: post.id,
    title: post.title,
    description: (post.content || '').replace(/[#*`]/g, '').substring(0, 80),
    link: `/forum/${post.slug || post.id}`,
    tags: [post.section],
    meta: formatDate(post.updatedAt, 'yyyy-MM-dd'),
    type: 'post',
  }
}

export const SearchResults: React.FC<SearchResultsProps> = ({
  state,
  viewMode,
  tabItems,
  onTabChange,
  onRetry,
  onCategoryPageChange,
  onMixedPageChange,
}) => {
  const { loading, error, activeTab, isMixedSearch, results, filters } = state
  const hasSearched = state.query.trim().length > 0
  const hasFilters =
    filters.selectedTags.length > 0 || filters.dateRange.start || filters.dateRange.end
  const fallbackTab = tabItems[0]?.id ?? (isMixedSearch ? 'semantic' : 'all')
  const effectiveTab = tabItems.some((tab) => tab.id === activeTab) ? activeTab : fallbackTab
  const imagePages = state.imageCategoryPages
  const mixedSemanticResults = imagePages?.semantic.items ?? []
  const filteredMixedResults = isMixedSearch
    ? effectiveTab === 'semantic'
      ? mixedSemanticResults
      : (imagePages?.[effectiveTab as 'wiki' | 'post' | 'gallery'].items ?? [])
    : []
  const mixedWikiResults = (imagePages?.wiki.items ?? []).map((result) => result.data as WikiItem)
  const mixedPostResults = (imagePages?.post.items ?? []).map((result) => result.data as PostItem)
  const mixedGalleryResults = (imagePages?.gallery.items ?? []).map(
    (result) => result.data as GalleryItem
  )
  const mixedTotal = imagePages?.semantic.total ?? 0
  const searchPaginationDockGroup = `${SEARCH_PAGINATION_DOCK_GROUP}-${React.useId()}`
  const resultGridClassName = clsx(
    viewMode === 'list'
      ? 'shared-ink-list'
      : clsx(
          'mobile-grid grid items-start',
          viewMode === 'large' && 'search-large-grid',
          VIEW_MODE_CONFIG[viewMode].gridCols,
          VIEW_MODE_CONFIG[viewMode].gap
        )
  )

  const resultCounts = {
    wiki: getSearchResultCount(results.wiki),
    posts: getSearchResultCount(results.posts),
    galleries: getSearchResultCount(results.galleries),
    music: getSearchResultCount(results.music),
    albums: getSearchResultCount(results.albums),
    lyrics: getSearchResultCount(results.lyrics),
  }
  const totalResults = Object.values(resultCounts).reduce((sum, count) => sum + count, 0)
  const paginationTotalKnown = !loading
  const semanticPagination = useSearchResultsPagination(
    isMixedSearch ? (imagePages?.semantic.total ?? 0) : 0,
    SEARCH_PAGE_PARAM_BY_CATEGORY.semantic,
    paginationTotalKnown,
    isMixedSearch ? imagePages?.semantic.totalPages : undefined
  )
  const wikiPagination = useSearchResultsPagination(
    isMixedSearch ? (imagePages?.wiki.total ?? 0) : resultCounts.wiki,
    SEARCH_PAGE_PARAM_BY_CATEGORY.wiki,
    paginationTotalKnown,
    isMixedSearch ? imagePages?.wiki.totalPages : results.wiki.totalPages
  )
  const postsPagination = useSearchResultsPagination(
    isMixedSearch ? (imagePages?.post.total ?? 0) : resultCounts.posts,
    SEARCH_PAGE_PARAM_BY_CATEGORY.posts,
    paginationTotalKnown,
    isMixedSearch ? imagePages?.post.totalPages : results.posts.totalPages
  )
  const galleriesPagination = useSearchResultsPagination(
    isMixedSearch ? (imagePages?.gallery.total ?? 0) : resultCounts.galleries,
    SEARCH_PAGE_PARAM_BY_CATEGORY.galleries,
    paginationTotalKnown,
    isMixedSearch ? imagePages?.gallery.totalPages : results.galleries.totalPages
  )
  const musicPagination = useSearchResultsPagination(
    resultCounts.music,
    SEARCH_PAGE_PARAM_BY_CATEGORY.music,
    paginationTotalKnown,
    results.music.totalPages
  )
  const lyricsPagination = useSearchResultsPagination(
    resultCounts.lyrics,
    SEARCH_PAGE_PARAM_BY_CATEGORY.lyrics,
    paginationTotalKnown,
    results.lyrics.totalPages
  )
  const albumsPagination = useSearchResultsPagination(
    resultCounts.albums,
    SEARCH_PAGE_PARAM_BY_CATEGORY.albums,
    paginationTotalKnown,
    results.albums.totalPages
  )

  if (loading) {
    return (
      <div className="space-y-3" role="status" aria-label="搜索结果加载中">
        {[1, 2, 3].map((i) => (
          <Skeleton
            key={i}
            className="book-skeleton h-24 rounded border border-[var(--book-ink-line)]"
          />
        ))}
      </div>
    )
  }

  if (error) {
    return <LoadErrorState description={error} onRetry={onRetry} />
  }

  if (!hasSearched && !hasFilters && !isMixedSearch) {
    return (
      <div className="border-y border-[var(--book-ink-line)] py-20 text-center">
        <Tag size={48} className="mx-auto mb-6 text-border" />
        <p className="text-[0.9375rem] tracking-[0.08em] text-text-muted">
          输入关键词、上传图片或使用高级筛选开始探索
        </p>
      </div>
    )
  }

  if (!isMixedSearch && totalResults === 0) {
    return (
      <div className="border-y border-[var(--book-ink-line)] py-20 text-center">
        <SearchIcon size={48} className="mx-auto mb-6 text-border" />
        <p className="text-[0.9375rem] tracking-[0.08em] text-text-muted">
          未找到符合筛选条件的结果
        </p>
      </div>
    )
  }

  if (isMixedSearch && mixedTotal === 0) {
    return (
      <div className="border-y border-[var(--book-ink-line)] py-20 text-center">
        <Sparkles size={48} className="mx-auto mb-6 text-border" />
        <p className="text-[0.9375rem] tracking-[0.08em] text-text-muted">未找到语义匹配的结果</p>
      </div>
    )
  }

  const mixedSectionConfig = {
    semantic: { title: '智能匹配', icon: <Sparkles size={14} className="text-brand-gold" /> },
    gallery: { title: '图库', icon: <ImageIcon size={14} className="text-brand-gold" /> },
    wiki: { title: '百科', icon: <Book size={14} className="text-brand-gold" /> },
    post: { title: '帖子', icon: <MessageSquare size={14} className="text-brand-gold" /> },
  } as const
  const mixedPagination =
    effectiveTab === 'semantic'
      ? semanticPagination
      : effectiveTab === 'gallery'
        ? galleriesPagination
        : effectiveTab === 'wiki'
          ? wikiPagination
          : postsPagination
  const mixedConfig = mixedSectionConfig[effectiveTab as keyof typeof mixedSectionConfig]

  return (
    <div className="space-y-8">
      <div className="mobile-filterbar">
        <div className="mobile-filter-tabs">
          {tabItems.map((tab) => (
            <Button
              type="button"
              variant="ghost"
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              aria-pressed={effectiveTab === tab.id}
              className={clsx(
                'relative min-h-0 cursor-pointer rounded-none border-0 px-0 pb-2 text-[1.0625rem] tracking-[0.06em]',
                effectiveTab === tab.id
                  ? 'font-semibold text-text-primary'
                  : 'text-text-muted hover:text-text-secondary'
              )}
            >
              {tab.label}
              <span className="ml-1.5 text-[0.8125rem] text-text-muted">{tab.count}</span>
              {effectiveTab === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-brand-gold" />
              )}
            </Button>
          ))}
        </div>
        <div className="mobile-filter-actions">
          {isMixedSearch ? `${mixedTotal} 个结果` : `${totalResults} 个结果`}
        </div>
      </div>

      {state.searchMeta?.degraded && (
        <div className="theme-status-warning-soft rounded-lg p-3 text-sm">
          语义搜索暂时不可用，已降级为关键词搜索
        </div>
      )}

      <div className="space-y-8">
        <AnimatePresence mode="wait">
          {isMixedSearch && mixedTotal > 0 && mixedConfig && (
            <SearchResultSection
              title={mixedConfig.title}
              dockGroup={searchPaginationDockGroup}
              icon={mixedConfig.icon}
              items={filteredMixedResults}
              pagination={mixedPagination}
              resultGridClassName={resultGridClassName}
              getItemKey={(result, index) => `${result.sourceType}-${result.sourceId}-${index}`}
              renderItem={(result) => (
                <MixedSearchResultCard result={result} viewMode={viewMode} showSimilarity={true} />
              )}
              onPageChange={
                onMixedPageChange
                  ? (page) =>
                      onMixedPageChange(
                        effectiveTab === 'semantic' ||
                          effectiveTab === 'wiki' ||
                          effectiveTab === 'post' ||
                          effectiveTab === 'gallery'
                          ? effectiveTab
                          : 'semantic',
                        page
                      )
                  : undefined
              }
            />
          )}
          {!isMixedSearch && (
            <>
              {effectiveTab === 'all' || effectiveTab === 'wiki'
                ? resultCounts.wiki > 0 && (
                    <SearchResultSection
                      title="百科页面"
                      dockGroup={searchPaginationDockGroup}
                      icon={<Book size={14} className="text-brand-gold" />}
                      items={results.wiki.items}
                      pagination={wikiPagination}
                      isLoading={state.loadingCategoryPages.has('wiki')}
                      error={state.pageErrorByCategory.wiki}
                      onPageChange={(page) => onCategoryPageChange?.('wiki', page)}
                      onRetry={() => onCategoryPageChange?.('wiki', wikiPagination.page)}
                      resultGridClassName={resultGridClassName}
                      getItemKey={(page) => page.id}
                      renderItem={(page) => (
                        <SearchResultCard config={wikiToConfig(page)} viewMode={viewMode} />
                      )}
                    />
                  )
                : null}

              {effectiveTab === 'all' || effectiveTab === 'posts'
                ? resultCounts.posts > 0 && (
                    <SearchResultSection
                      title="社区帖子"
                      dockGroup={searchPaginationDockGroup}
                      icon={<MessageSquare size={14} className="text-brand-gold" />}
                      items={results.posts.items}
                      pagination={postsPagination}
                      isLoading={state.loadingCategoryPages.has('posts')}
                      error={state.pageErrorByCategory.posts}
                      onPageChange={(page) => onCategoryPageChange?.('posts', page)}
                      onRetry={() => onCategoryPageChange?.('posts', postsPagination.page)}
                      resultGridClassName={resultGridClassName}
                      getItemKey={(post) => post.id}
                      renderItem={(post) => (
                        <SearchResultCard config={postToConfig(post)} viewMode={viewMode} />
                      )}
                    />
                  )
                : null}

              {effectiveTab === 'all' || effectiveTab === 'galleries'
                ? resultCounts.galleries > 0 && (
                    <SearchResultSection
                      title="画廊"
                      dockGroup={searchPaginationDockGroup}
                      icon={<ImageIcon size={14} className="text-brand-gold" />}
                      items={results.galleries.items}
                      pagination={galleriesPagination}
                      isLoading={state.loadingCategoryPages.has('galleries')}
                      error={state.pageErrorByCategory.galleries}
                      onPageChange={(page) => onCategoryPageChange?.('galleries', page)}
                      onRetry={() => onCategoryPageChange?.('galleries', galleriesPagination.page)}
                      resultGridClassName={resultGridClassName}
                      getItemKey={(gallery) => gallery.id}
                      renderItem={(gallery) => (
                        <SearchResultCard config={galleryToConfig(gallery)} viewMode={viewMode} />
                      )}
                    />
                  )
                : null}

              {effectiveTab === 'all' || effectiveTab === 'music'
                ? resultCounts.music > 0 && (
                    <SearchResultSection
                      title="音乐曲目"
                      dockGroup={searchPaginationDockGroup}
                      icon={<Music size={14} className="text-brand-gold" />}
                      items={results.music.items}
                      pagination={musicPagination}
                      isLoading={state.loadingCategoryPages.has('music')}
                      error={state.pageErrorByCategory.music}
                      onPageChange={(page) => onCategoryPageChange?.('music', page)}
                      onRetry={() => onCategoryPageChange?.('music', musicPagination.page)}
                      renderItems={(songs) => (
                        <MusicSearchResults songs={songs} viewMode={viewMode} />
                      )}
                      renderGrid={false}
                    />
                  )
                : null}

              {effectiveTab === 'all' || effectiveTab === 'lyrics'
                ? resultCounts.lyrics > 0 && (
                    <SearchResultSection
                      isLoading={state.loadingCategoryPages.has('lyrics')}
                      error={state.pageErrorByCategory.lyrics}
                      onPageChange={(page) => onCategoryPageChange?.('lyrics', page)}
                      onRetry={() => onCategoryPageChange?.('lyrics', lyricsPagination.page)}
                      title="歌词匹配"
                      dockGroup={searchPaginationDockGroup}
                      icon={<FileText size={14} className="text-brand-gold" />}
                      items={results.lyrics.items}
                      pagination={lyricsPagination}
                      resultGridClassName={resultGridClassName}
                      getItemKey={(item) => item.docId}
                      renderItem={(item) => (
                        <LyricSearchResultCard
                          item={item}
                          query={state.searchMeta?.query ?? state.query}
                          viewMode={viewMode}
                        />
                      )}
                    />
                  )
                : null}

              {effectiveTab === 'all' || effectiveTab === 'albums'
                ? resultCounts.albums > 0 && (
                    <SearchResultSection
                      title="音乐专辑"
                      dockGroup={searchPaginationDockGroup}
                      icon={<Music size={14} className="text-brand-gold" />}
                      items={results.albums.items}
                      pagination={albumsPagination}
                      isLoading={state.loadingCategoryPages.has('albums')}
                      error={state.pageErrorByCategory.albums}
                      onPageChange={(page) => onCategoryPageChange?.('albums', page)}
                      onRetry={() => onCategoryPageChange?.('albums', albumsPagination.page)}
                      resultGridClassName={resultGridClassName}
                      getItemKey={(album) => album.docId}
                      renderItem={(album) => (
                        <SearchResultCard config={albumToConfig(album)} viewMode={viewMode} />
                      )}
                    />
                  )
                : null}
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
