import React from 'react'
import { clsx } from 'clsx'
import { motion, AnimatePresence } from 'motion/react'
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
import { formatMusicCredits } from '../../lib/musicCredits'
import type { ViewMode } from '../../types/userPreferences'
import { formatDate } from '../../lib/dateUtils'
import type { SearchState } from '../../hooks/useSearchPage'
import type { WikiItem, PostItem, GalleryItem, SongItem, AlbumItem } from '../../types/entities'
import type { TextSearchResult } from '../../types/api'
import { MixedSearchResultCard } from '../MixedSearchResultCard'
import { SearchResultCard } from './SearchResultCard'
import { getFirstGalleryImage, shouldWaitForGalleryThumbnail } from '../../lib/galleryThumbnails'

interface SearchResultsProps {
  state: SearchState
  viewMode: ViewMode
  tabItems: Array<{ id: string; label: string; count: number }>
  onTabChange: (tab: string) => void
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

function musicToConfig(track: SongItem): import('./SearchResultCard').SearchResultCardConfig {
  return {
    id: track.docId,
    title: track.title,
    subtitle: `${formatMusicCredits(track.artists, '未知歌手')} — ${track.album}`,
    link: `/music/${track.slug || track.docId}`,
    image: track.coverThumbnail || track.cover || undefined,
    type: 'music',
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

const TEXT_SEMANTIC_SOURCE_LABELS: Record<string, string> = {
  wiki: '百科',
  post: '帖子',
  music: '音乐',
  album: '专辑',
}

function getTextSemanticLink(result: TextSearchResult): string {
  switch (result.sourceType) {
    case 'wiki':
      return `/wiki/${result.entity.slug || result.sourceId}`
    case 'post':
      return `/forum/${result.entity.slug || result.sourceId}`
    case 'music':
      return `/music/${result.entity.slug || result.sourceId}`
    case 'album':
      return `/album/${result.entity.slug || result.sourceId}`
    default:
      return '#'
  }
}

function getTextSemanticTitle(result: TextSearchResult): string {
  switch (result.sourceType) {
    case 'wiki':
      return result.entity.title || result.sourceId
    case 'post':
      return result.entity.title || result.sourceId
    case 'music':
      return result.entity.title || formatMusicCredits(result.entity.artists, '') || result.sourceId
    case 'album':
      return result.entity.title || result.entity.artist || result.sourceId
    default:
      return ''
  }
}

function textSemanticToConfig(
  result: TextSearchResult
): import('./SearchResultCard').SearchResultCardConfig {
  return {
    id: `${result.sourceType}-${result.sourceId}`,
    title: getTextSemanticTitle(result),
    subtitle:
      result.sourceType === 'music' || result.sourceType === 'album'
        ? result.sourceType === 'music'
          ? formatMusicCredits(result.entity.artists, '未知歌手')
          : result.entity.artist
        : undefined,
    description: undefined,
    link: getTextSemanticLink(result),
    tags: [TEXT_SEMANTIC_SOURCE_LABELS[result.sourceType] || result.sourceType],
    meta: `相似度 ${(result.score * 100).toFixed(1)}%`,
    type: result.sourceType,
    chunkPreview: result.chunkPreview,
    matchSource: 'semantic',
  }
}

export const SearchResults: React.FC<SearchResultsProps> = ({
  state,
  viewMode,
  tabItems,
  onTabChange,
}) => {
  const {
    loading,
    hasSearched,
    activeTab,
    isMixedSearch,
    mixedResults,
    results,
    filters,
    textSemanticResults,
  } = state

  const hasFilters =
    filters.selectedTags.length > 0 || filters.dateRange.start || filters.dateRange.end
  const filteredMixedResults = isMixedSearch
    ? mixedResults.filter((result) => activeTab === 'semantic' || result.sourceType === activeTab)
    : []
  const resultGridClassName = clsx(
    'mobile-grid grid',
    VIEW_MODE_CONFIG[viewMode].gridCols,
    VIEW_MODE_CONFIG[viewMode].gap
  )

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 theme-panel rounded" />
        ))}
      </div>
    )
  }

  if (!hasSearched && !hasFilters) {
    return (
      <div className="theme-panel rounded p-10 text-center sm:p-20">
        <Tag size={48} className="mx-auto text-border mb-6" />
        <p className="text-text-muted italic">输入关键词、上传图片或使用高级筛选开始探索</p>
      </div>
    )
  }

  const totalResults =
    results.wiki.length +
    results.posts.length +
    results.galleries.length +
    results.music.length +
    results.albums.length +
    (textSemanticResults?.length ?? 0)

  if (!isMixedSearch && totalResults === 0 && (textSemanticResults?.length ?? 0) === 0) {
    return (
      <div className="theme-panel rounded p-10 text-center sm:p-20">
        <SearchIcon size={48} className="mx-auto text-border mb-6" />
        <p className="text-text-muted italic">未找到符合筛选条件的结果</p>
      </div>
    )
  }

  if (isMixedSearch && mixedResults.length === 0) {
    return (
      <div className="theme-panel rounded p-10 text-center sm:p-20">
        <Sparkles size={48} className="mx-auto text-border mb-6" />
        <p className="text-text-muted italic">未找到语义匹配的结果</p>
        <p className="text-text-muted/70 text-sm mt-2">尝试使用其他关键词或上传图片搜索</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Tab bar */}
      <div className="mobile-filterbar">
        <div className="mobile-filter-tabs">
          {tabItems.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={clsx(
                'text-[1.125rem] pb-2 relative tracking-[0.05em] transition-all cursor-pointer',
                activeTab === tab.id
                  ? "text-brand-gold font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[var(--color-theme-accent)] after:rounded-[1px]"
                  : 'text-text-muted hover:text-brand-gold'
              )}
            >
              {tab.label}
              <span className="text-[0.8125rem] text-text-muted ml-1.5">{tab.count}</span>
            </button>
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
          {isMixedSearch && mixedResults.length > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
            >
              <div className={resultGridClassName}>
                {filteredMixedResults.map((result, index) => (
                  <MixedSearchResultCard
                    key={`${result.sourceType}-${result.sourceId}-${index}`}
                    result={result}
                    viewMode={viewMode}
                    cardHeight={VIEW_MODE_CONFIG[viewMode].cardHeight}
                    showSimilarity={true}
                  />
                ))}
              </div>
            </motion.section>
          )}

          {!isMixedSearch && (
            <>
              {/* Text Semantic Results */}
              {(activeTab === 'all' || activeTab === 'textSemantic') &&
                textSemanticResults.length > 0 && (
                  <motion.section
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    className="space-y-4"
                  >
                    <h2 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase mb-4 flex items-center gap-2">
                      <FileText size={14} className="text-brand-gold" /> 语义匹配
                    </h2>
                    <div className={resultGridClassName}>
                      {textSemanticResults.map((result) => (
                        <SearchResultCard
                          key={`${result.sourceType}-${result.sourceId}`}
                          config={textSemanticToConfig(result)}
                          viewMode={viewMode}
                          cardHeight={VIEW_MODE_CONFIG[viewMode].cardHeight}
                        />
                      ))}
                    </div>
                  </motion.section>
                )}

              {/* Wiki Results */}
              {(activeTab === 'all' || activeTab === 'wiki') && results.wiki.length > 0 && (
                <motion.section
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  className="space-y-4"
                >
                  <h2 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase mb-4 flex items-center gap-2">
                    <Book size={14} className="text-brand-gold" /> 百科页面
                  </h2>
                  <div className={resultGridClassName}>
                    {results.wiki.map((page) => (
                      <SearchResultCard
                        key={page.id}
                        config={wikiToConfig(page)}
                        viewMode={viewMode}
                        cardHeight={VIEW_MODE_CONFIG[viewMode].cardHeight}
                      />
                    ))}
                  </div>
                </motion.section>
              )}

              {/* Posts Results */}
              {(activeTab === 'all' || activeTab === 'posts') && results.posts.length > 0 && (
                <motion.section
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  className="space-y-4"
                >
                  <h2 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase mb-4 flex items-center gap-2">
                    <MessageSquare size={14} className="text-brand-gold" /> 社区帖子
                  </h2>
                  <div className={resultGridClassName}>
                    {results.posts.map((post) => (
                      <SearchResultCard
                        key={post.id}
                        config={postToConfig(post)}
                        viewMode={viewMode}
                        cardHeight={VIEW_MODE_CONFIG[viewMode].cardHeight}
                      />
                    ))}
                  </div>
                </motion.section>
              )}

              {/* Galleries Results */}
              {(activeTab === 'all' || activeTab === 'galleries') &&
                results.galleries.length > 0 && (
                  <motion.section
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    className="space-y-4"
                  >
                    <h2 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase mb-4 flex items-center gap-2">
                      <ImageIcon size={14} className="text-brand-gold" /> 画廊
                    </h2>
                    <div className={resultGridClassName}>
                      {results.galleries.map((gallery) => (
                        <SearchResultCard
                          key={gallery.id}
                          config={galleryToConfig(gallery)}
                          viewMode={viewMode}
                          cardHeight={VIEW_MODE_CONFIG[viewMode].cardHeight}
                        />
                      ))}
                    </div>
                  </motion.section>
                )}

              {/* Music Results */}
              {(activeTab === 'all' || activeTab === 'music') && results.music.length > 0 && (
                <motion.section
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  className="space-y-4"
                >
                  <h2 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase mb-4 flex items-center gap-2">
                    <Music size={14} className="text-brand-gold" /> 音乐曲目
                  </h2>
                  <div className={resultGridClassName}>
                    {results.music.map((track) => (
                      <SearchResultCard
                        key={track.docId}
                        config={musicToConfig(track as SongItem)}
                        viewMode={viewMode}
                        cardHeight={VIEW_MODE_CONFIG[viewMode].cardHeight}
                      />
                    ))}
                  </div>
                </motion.section>
              )}

              {/* Albums Results */}
              {(activeTab === 'all' || activeTab === 'albums') && results.albums.length > 0 && (
                <motion.section
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  className="space-y-4"
                >
                  <h2 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase mb-4 flex items-center gap-2">
                    <Music size={14} className="text-brand-gold" /> 音乐专辑
                  </h2>
                  <div className={resultGridClassName}>
                    {results.albums.map((album) => (
                      <SearchResultCard
                        key={(album as AlbumItem).docId}
                        config={albumToConfig(album as AlbumItem)}
                        viewMode={viewMode}
                        cardHeight={VIEW_MODE_CONFIG[viewMode].cardHeight}
                      />
                    ))}
                  </div>
                </motion.section>
              )}
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
