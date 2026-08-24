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
import type { SearchState } from '../../hooks/useSearchPage'
import type { WikiItem, PostItem, GalleryItem, AlbumItem } from '../../types/entities'
import { MixedSearchResultCard } from '../MixedSearchResultCard'
import { SearchResultCard } from './SearchResultCard'
import { LyricSearchResultCard } from './LyricSearchResultCard'
import { MusicSearchResults } from './MusicSearchResults'
import { useRoutedPagination } from '../../hooks/useRoutedPagination'
import {
  SEARCH_PAGE_PARAM_BY_CATEGORY,
  SEARCH_PAGE_SIZE,
  SEARCH_PAGINATION_DOCK_GROUP,
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
}
function useSearchResultsPagination(totalCount: number, pageParam: string, totalKnown: boolean) {
  return useRoutedPagination({
    totalCount,
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
    description: gallery.description || undefined,
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
}) => {
  const { loading, error, activeTab, isMixedSearch, mixedResults, results, filters } = state
  const searchPaginationDockGroup = `${SEARCH_PAGINATION_DOCK_GROUP}-${React.useId()}`
  const hasSearched = state.query.trim().length > 0

  const hasFilters =
    filters.selectedTags.length > 0 || filters.dateRange.start || filters.dateRange.end
  const fallbackTab = tabItems[0]?.id ?? (isMixedSearch ? 'semantic' : 'all')
  const effectiveTab = tabItems.some((tab) => tab.id === activeTab) ? activeTab : fallbackTab
  const filteredMixedResults = isMixedSearch
    ? mixedResults.filter(
        (result) => effectiveTab === 'semantic' || result.sourceType === effectiveTab
      )
    : []
  const mixedWikiResults = mixedResults
    .filter((result) => result.sourceType === 'wiki')
    .map((result) => result.data as WikiItem)
  const mixedPostResults = mixedResults
    .filter((result) => result.sourceType === 'post')
    .map((result) => result.data as PostItem)
  const mixedGalleryResults = mixedResults
    .filter((result) => result.sourceType === 'gallery')
    .map((result) => result.data as GalleryItem)
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

  const totalResults =
    results.wiki.length +
    results.posts.length +
    results.galleries.length +
    results.music.length +
    results.albums.length +
    results.lyrics.length
  const paginationTotalKnown = !loading
  const semanticPagination = useSearchResultsPagination(
    isMixedSearch ? mixedResults.length : 0,
    SEARCH_PAGE_PARAM_BY_CATEGORY.semantic,
    paginationTotalKnown
  )
  const wikiPagination = useSearchResultsPagination(
    isMixedSearch ? mixedWikiResults.length : results.wiki.length,
    SEARCH_PAGE_PARAM_BY_CATEGORY.wiki,
    paginationTotalKnown
  )
  const postsPagination = useSearchResultsPagination(
    isMixedSearch ? mixedPostResults.length : results.posts.length,
    SEARCH_PAGE_PARAM_BY_CATEGORY.posts,
    paginationTotalKnown
  )
  const galleriesPagination = useSearchResultsPagination(
    isMixedSearch ? mixedGalleryResults.length : results.galleries.length,
    SEARCH_PAGE_PARAM_BY_CATEGORY.galleries,
    paginationTotalKnown
  )
  const musicPagination = useSearchResultsPagination(
    isMixedSearch ? 0 : results.music.length,
    SEARCH_PAGE_PARAM_BY_CATEGORY.music,
    paginationTotalKnown
  )
  const lyricsPagination = useSearchResultsPagination(
    isMixedSearch ? 0 : results.lyrics.length,
    SEARCH_PAGE_PARAM_BY_CATEGORY.lyrics,
    paginationTotalKnown
  )
  const albumsPagination = useSearchResultsPagination(
    isMixedSearch ? 0 : results.albums.length,
    SEARCH_PAGE_PARAM_BY_CATEGORY.albums,
    paginationTotalKnown
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

  if (isMixedSearch && mixedResults.length === 0) {
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
          {isMixedSearch ? `${mixedResults.length} 个结果` : `${totalResults} 个结果`}
        </div>
      </div>

      {state.searchMeta?.degraded && (
        <div className="theme-status-warning-soft rounded-lg p-3 text-sm">
          语义搜索暂时不可用，已降级为关键词搜索
        </div>
      )}

      <div className="space-y-8">
        <AnimatePresence mode="wait">
          {isMixedSearch && mixedResults.length > 0 && mixedConfig && (
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
            />
          )}

          {!isMixedSearch && (
            <>
              {effectiveTab === 'all' || effectiveTab === 'wiki'
                ? results.wiki.length > 0 && (
                    <SearchResultSection
                      title="百科页面"
                      dockGroup={searchPaginationDockGroup}
                      icon={<Book size={14} className="text-brand-gold" />}
                      items={results.wiki}
                      pagination={wikiPagination}
                      resultGridClassName={resultGridClassName}
                      getItemKey={(page) => page.id}
                      renderItem={(page) => (
                        <SearchResultCard config={wikiToConfig(page)} viewMode={viewMode} />
                      )}
                    />
                  )
                : null}

              {effectiveTab === 'all' || effectiveTab === 'posts'
                ? results.posts.length > 0 && (
                    <SearchResultSection
                      title="社区帖子"
                      dockGroup={searchPaginationDockGroup}
                      icon={<MessageSquare size={14} className="text-brand-gold" />}
                      items={results.posts}
                      pagination={postsPagination}
                      resultGridClassName={resultGridClassName}
                      getItemKey={(post) => post.id}
                      renderItem={(post) => (
                        <SearchResultCard config={postToConfig(post)} viewMode={viewMode} />
                      )}
                    />
                  )
                : null}

              {effectiveTab === 'all' || effectiveTab === 'galleries'
                ? results.galleries.length > 0 && (
                    <SearchResultSection
                      title="画廊"
                      dockGroup={searchPaginationDockGroup}
                      icon={<ImageIcon size={14} className="text-brand-gold" />}
                      items={results.galleries}
                      pagination={galleriesPagination}
                      resultGridClassName={resultGridClassName}
                      getItemKey={(gallery) => gallery.id}
                      renderItem={(gallery) => (
                        <SearchResultCard config={galleryToConfig(gallery)} viewMode={viewMode} />
                      )}
                    />
                  )
                : null}

              {effectiveTab === 'all' || effectiveTab === 'music'
                ? results.music.length > 0 && (
                    <SearchResultSection
                      title="音乐曲目"
                      dockGroup={searchPaginationDockGroup}
                      icon={<Music size={14} className="text-brand-gold" />}
                      items={results.music}
                      pagination={musicPagination}
                      renderItems={(songs) => (
                        <MusicSearchResults songs={songs} viewMode={viewMode} />
                      )}
                      renderGrid={false}
                    />
                  )
                : null}

              {effectiveTab === 'all' || effectiveTab === 'lyrics'
                ? results.lyrics.length > 0 && (
                    <SearchResultSection
                      title="歌词匹配"
                      dockGroup={searchPaginationDockGroup}
                      icon={<FileText size={14} className="text-brand-gold" />}
                      items={results.lyrics}
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
                ? results.albums.length > 0 && (
                    <SearchResultSection
                      title="音乐专辑"
                      dockGroup={searchPaginationDockGroup}
                      icon={<Music size={14} className="text-brand-gold" />}
                      items={results.albums}
                      pagination={albumsPagination}
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
