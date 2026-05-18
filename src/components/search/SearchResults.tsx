import React, { useRef } from "react";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { motion, AnimatePresence } from "motion/react";
import { Book, MessageSquare, Image as ImageIcon, Music, Sparkles, Search as SearchIcon, Tag, Clock, FileText } from "lucide-react";
import { VIEW_MODE_CONFIG } from "../../lib/viewModes";
import type { ViewMode } from "../../types/userPreferences";
import { toDateValue } from "../../lib/dateUtils";
import { format } from "date-fns";
import type { SearchState } from "../../hooks/useSearchPage";
import type { WikiItem, PostItem, GalleryItem, SongItem, AlbumItem } from "../../types/entities";
import type { TextSearchResult } from "../../types/api";
import { MixedSearchResultCard } from "../MixedSearchResultCard";
import { SearchResultCard } from "./SearchResultCard";
import { useVirtualizer } from "@tanstack/react-virtual";

interface SearchResultsProps {
  state: SearchState;
  viewMode: ViewMode;
  tabItems: Array<{ id: string; label: string; count: number }>;
  onTabChange: (tab: string) => void;
}

function wikiToConfig(page: WikiItem): import("./SearchResultCard").SearchResultCardConfig {
  return {
    id: page.id,
    title: page.title,
    description: page.content.replace(/[#*`]/g, "").substring(0, 80),
    link: `/wiki/${page.slug}`,
    tags: [page.category],
    meta: toDateValue(page.updatedAt) ? format(toDateValue(page.updatedAt)!, "yyyy-MM-dd") : "刚刚",
    type: "wiki",
  };
}

function galleryToConfig(gallery: GalleryItem): import("./SearchResultCard").SearchResultCardConfig {
  return {
    id: gallery.id,
    title: gallery.title,
    description: gallery.description || undefined,
    link: `/gallery/${gallery.id}`,
    image: (Array.isArray(gallery.images) && gallery.images[0]?.url) || undefined,
    meta: `${Array.isArray(gallery.images) ? gallery.images.length : 0} 张图片`,
    type: "gallery",
  };
}

function musicToConfig(track: SongItem): import("./SearchResultCard").SearchResultCardConfig {
  return {
    id: track.id,
    title: track.title,
    subtitle: `${track.artist} — ${track.album}`,
    link: `/music/${track.id}`,
    image: track.cover || undefined,
    type: "music",
  };
}

function albumToConfig(album: AlbumItem): import("./SearchResultCard").SearchResultCardConfig {
  return {
    id: album.id,
    title: album.title,
    subtitle: album.artist,
    link: `/album/${album.id}`,
    image: album.cover || undefined,
    meta: `${album.trackCount} 曲`,
    type: "album",
  };
}

const TEXT_SEMANTIC_SOURCE_LABELS: Record<string, string> = {
  wiki: '百科',
  post: '帖子',
  music: '音乐',
  album: '专辑',
}

const TEXT_SEMANTIC_SOURCE_ICONS: Record<string, React.ReactNode> = {
  wiki: <Book size={12} className="text-[#c8951e]" />,
  post: <MessageSquare size={12} className="text-[#c8951e]" />,
  music: <Music size={12} className="text-[#c8951e]" />,
  album: <Music size={12} className="text-[#c8951e]" />,
}

function getTextSemanticLink(result: TextSearchResult): string {
  switch (result.sourceType) {
    case 'wiki':
      return `/wiki/${result.entity.slug || result.sourceId}`
    case 'post':
      return `/forum/${result.sourceId}`
    case 'music':
      return `/music/${result.sourceId}`
    case 'album':
      return `/album/${result.sourceId}`
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
      return result.entity.title || result.entity.artist || result.sourceId
    case 'album':
      return result.entity.title || result.entity.artist || result.sourceId
    default:
      return ''
  }
}

export const SearchResults: React.FC<SearchResultsProps> = ({
  state,
  viewMode,
  tabItems,
  onTabChange,
}) => {
  const { loading, hasSearched, activeTab, isMixedSearch, mixedResults, results, filters, textSemanticResults } = state;

  const hasFilters = filters.selectedTags.length > 0 || filters.dateRange.start || filters.dateRange.end;
  const mixedParentRef = useRef<HTMLDivElement>(null);
  const wikiParentRef = useRef<HTMLDivElement>(null);

  const mixedVirtualizer = useVirtualizer({
    count: isMixedSearch
      ? mixedResults.filter((r) => activeTab === "semantic" || r.sourceType === activeTab).length
      : 0,
    getScrollElement: () => mixedParentRef.current,
    overscan: 5,
    estimateSize: () => VIEW_MODE_CONFIG[viewMode].cardHeight === 'auto' ? 180 : parseInt(VIEW_MODE_CONFIG[viewMode].cardHeight as string, 10) || 200,
  });

  const wikiVirtualizer = useVirtualizer({
    count: (!isMixedSearch && (activeTab === "all" || activeTab === "wiki")) ? results.wiki.length : 0,
    getScrollElement: () => wikiParentRef.current,
    overscan: 5,
    estimateSize: () => VIEW_MODE_CONFIG[viewMode].cardHeight === 'auto' ? 180 : parseInt(VIEW_MODE_CONFIG[viewMode].cardHeight as string, 10) || 200,
  });

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 bg-white border border-[#e0dcd3] rounded" />
        ))}
      </div>
    );
  }

  if (!hasSearched && !hasFilters) {
    return (
      <div className="bg-white border border-[#e0dcd3] rounded p-20 text-center">
        <Tag size={48} className="mx-auto text-[#e0dcd3] mb-6" />
        <p className="text-[#9e968e] italic">输入关键词、上传图片或使用高级筛选开始探索</p>
      </div>
    );
  }

  const totalResults =
    results.wiki.length +
    results.posts.length +
    results.galleries.length +
    results.music.length +
    results.albums.length +
    (textSemanticResults?.length ?? 0);

  if (!isMixedSearch && totalResults === 0 && (textSemanticResults?.length ?? 0) === 0) {
    return (
      <div className="bg-white border border-[#e0dcd3] rounded p-20 text-center">
        <SearchIcon size={48} className="mx-auto text-[#e0dcd3] mb-6" />
        <p className="text-[#9e968e] italic">未找到符合筛选条件的结果</p>
      </div>
    );
  }

  if (isMixedSearch && mixedResults.length === 0) {
    return (
      <div className="bg-white border border-[#e0dcd3] rounded p-20 text-center">
        <Sparkles size={48} className="mx-auto text-[#e0dcd3] mb-6" />
        <p className="text-[#9e968e] italic">未找到语义匹配的结果</p>
        <p className="text-[#9e968e]/70 text-sm mt-2">尝试使用其他关键词或上传图片搜索</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Tab bar */}
      <div className="flex items-end justify-between border-b border-[#e0dcd3] mb-5">
        <div className="flex gap-5">
          {tabItems.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={clsx(
                "text-[1.125rem] pb-2 relative tracking-[0.05em] transition-all cursor-pointer",
                activeTab === tab.id
                  ? "text-[#c8951e] font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#c8951e] after:rounded-[1px]"
                  : "text-[#9e968e] hover:text-[#c8951e]"
              )}
            >
              {tab.label}
              <span className="text-[0.8125rem] text-[#9e968e] ml-1.5">{tab.count}</span>
            </button>
          ))}
        </div>
        <div className="pb-2 text-[0.8125rem] text-[#9e968e]">
          {isMixedSearch ? `${mixedResults.length} 个结果` : `${totalResults} 个结果`}
        </div>
      </div>

      {state.searchMeta?.degraded && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-700 dark:text-amber-300">
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
              <div
                ref={mixedParentRef}
                className="max-h-[70vh] overflow-auto"
                style={{ contain: 'strict' }}
              >
                <div
                  style={{
                    height: `${mixedVirtualizer.getTotalSize()}px`,
                    position: 'relative',
                    width: '100%',
                  }}
                >
                  {mixedVirtualizer.getVirtualItems().map((virtualItem) => {
                    const filtered = mixedResults.filter((r) =>
                      activeTab === "semantic" ? true : r.sourceType === activeTab
                    );
                    const result = filtered[virtualItem.index];
                    if (!result) return null;
                    return (
                      <div
                        key={`${result.sourceType}-${result.sourceId}-${virtualItem.index}`}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${virtualItem.start}px)`,
                        }}
                      >
                        <MixedSearchResultCard
                          result={result}
                          viewMode="list"
                          cardHeight={VIEW_MODE_CONFIG[viewMode].cardHeight}
                          showSimilarity={true}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.section>
          )}

          {!isMixedSearch && (
            <>
              {/* Text Semantic Results */}
              {(activeTab === "all" || activeTab === "textSemantic") && textSemanticResults.length > 0 && (
                <motion.section
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  className="space-y-4"
                >
                  <h2 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-4 flex items-center gap-2">
                    <FileText size={14} className="text-[#c8951e]" /> 语义匹配
                  </h2>
                  <div className="space-y-3">
                    {Object.entries(
                      textSemanticResults.reduce<Record<string, TextSearchResult[]>>((acc, r) => {
                        const group = r.sourceType
                        if (!acc[group]) acc[group] = []
                        acc[group].push(r)
                        return acc
                      }, {})
                    ).map(([sourceType, items]) => (
                      <div key={sourceType} className="space-y-2">
                        <div className="flex items-center gap-1.5 text-xs text-[#9e968e] font-medium">
                          {TEXT_SEMANTIC_SOURCE_ICONS[sourceType]}
                          {TEXT_SEMANTIC_SOURCE_LABELS[sourceType] || sourceType}
                          <span className="text-[#9e968e]/60">({items.length})</span>
                        </div>
                        {items.map((result) => (
                          <Link
                            key={`${result.sourceType}-${result.sourceId}`}
                            to={getTextSemanticLink(result)}
                            className="block bg-white border border-[#e0dcd3] rounded p-4 hover:border-[#c8951e] transition-all group"
                          >
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="px-2 py-0.5 bg-[#f7f5f0] text-[#c8951e] text-[10px] font-medium rounded">
                                {TEXT_SEMANTIC_SOURCE_LABELS[result.sourceType] || result.sourceType}
                              </span>
                              <span className="text-[10px] text-[#9e968e]">
                                相似度 {(result.score * 100).toFixed(1)}%
                              </span>
                            </div>
                            <h3 className="text-sm font-semibold text-[#2c2c2c] group-hover:text-[#c8951e] transition-colors">
                              {getTextSemanticTitle(result)}
                            </h3>
                            {result.chunkPreview && (
                              <p className="text-xs text-[#9e968e] mt-1.5 line-clamp-2 leading-relaxed">
                                {result.chunkPreview}
                              </p>
                            )}
                          </Link>
                        ))}
                      </div>
                    ))}
                  </div>
                </motion.section>
              )}

              {/* Wiki Results */}
              {(activeTab === "all" || activeTab === "wiki") && results.wiki.length > 0 && (
                <motion.section
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  className="space-y-4"
                >
                  <h2 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-4 flex items-center gap-2">
                    <Book size={14} className="text-[#c8951e]" /> 百科页面
                    {results.wiki.length > 50 && <span className="text-xs text-[#9e968e] font-normal">（虚拟滚动已启用）</span>}
                  </h2>
                  {results.wiki.length > 30 ? (
                    <div
                      ref={wikiParentRef}
                      className="max-h-[60vh] overflow-auto"
                      style={{ contain: 'strict' }}
                    >
                      <div
                        style={{
                          height: `${wikiVirtualizer.getTotalSize()}px`,
                          position: 'relative',
                          width: '100%',
                        }}
                      >
                        {wikiVirtualizer.getVirtualItems().map((virtualItem) => {
                          const page = results.wiki[virtualItem.index];
                          if (!page) return null;
                          return (
                            <div
                              key={page.id}
                              style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                transform: `translateY(${virtualItem.start}px)`,
                              }}
                            >
                              <SearchResultCard
                                config={wikiToConfig(page)}
                                viewMode="list"
                                cardHeight={VIEW_MODE_CONFIG[viewMode].cardHeight}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div
                      className={clsx(
                        "grid",
                        VIEW_MODE_CONFIG[viewMode].gridCols,
                        VIEW_MODE_CONFIG[viewMode].gap
                      )}
                    >
                      {results.wiki.map((page) => (
                        <SearchResultCard
                          key={page.id}
                          config={wikiToConfig(page)}
                          viewMode={viewMode}
                          cardHeight={VIEW_MODE_CONFIG[viewMode].cardHeight}
                        />
                      ))}
                    </div>
                  )}
                </motion.section>
              )}

              {/* Posts Results */}
              {(activeTab === "all" || activeTab === "posts") && results.posts.length > 0 && (
                <motion.section
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  className="space-y-4"
                >
                  <h2 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-4 flex items-center gap-2">
                    <MessageSquare size={14} className="text-[#c8951e]" /> 社区帖子
                  </h2>
                  <div className="space-y-3">
                    {results.posts.map((post) => (
                      <Link
                        key={post.id}
                        to={`/forum/${post.id}`}
                        className="block bg-white border border-[#e0dcd3] rounded p-4 hover:border-[#c8951e] transition-all group"
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="px-2 py-0.5 bg-[#f7f5f0] text-[#c8951e] text-[10px] font-medium rounded">
                            {post.section}
                          </span>
                          <span className="text-[10px] text-[#9e968e] flex items-center gap-1">
                            <Clock size={10} />
                            {toDateValue(post.updatedAt)
                              ? format(toDateValue(post.updatedAt)!, "yyyy-MM-dd")
                              : "刚刚"}
                          </span>
                        </div>
                        <h3 className="text-sm font-semibold text-[#2c2c2c] group-hover:text-[#c8951e] transition-colors">
                          {post.title}
                        </h3>
                      </Link>
                    ))}
                  </div>
                </motion.section>
              )}

              {/* Galleries Results */}
              {(activeTab === "all" || activeTab === "galleries") && results.galleries.length > 0 && (
                <motion.section
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  className="space-y-4"
                >
                  <h2 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-4 flex items-center gap-2">
                    <ImageIcon size={14} className="text-[#c8951e]" /> 图集馆
                  </h2>
                  <div
                    className={clsx(
                      "grid",
                      VIEW_MODE_CONFIG[viewMode].gridCols,
                      VIEW_MODE_CONFIG[viewMode].gap
                    )}
                  >
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
              {(activeTab === "all" || activeTab === "music") && results.music.length > 0 && (
                <motion.section
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  className="space-y-4"
                >
                  <h2 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-4 flex items-center gap-2">
                    <Music size={14} className="text-[#c8951e]" /> 音乐曲目
                  </h2>
                  <div
                    className={clsx(
                      "grid",
                      VIEW_MODE_CONFIG[viewMode].gridCols,
                      VIEW_MODE_CONFIG[viewMode].gap
                    )}
                  >
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
              {(activeTab === "all" || activeTab === "albums") && results.albums.length > 0 && (
                <motion.section
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  className="space-y-4"
                >
                  <h2 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-4 flex items-center gap-2">
                    <Music size={14} className="text-[#c8951e]" /> 音乐专辑
                  </h2>
                  <div
                    className={clsx(
                      "grid",
                      VIEW_MODE_CONFIG[viewMode].gridCols,
                      VIEW_MODE_CONFIG[viewMode].gap
                    )}
                  >
                    {results.albums.map((album) => (
                      <SearchResultCard
                        key={(album as AlbumItem).docId || (album as AlbumItem).id}
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
  );
};
