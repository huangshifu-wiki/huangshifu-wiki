import React from "react";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { motion, AnimatePresence } from "motion/react";
import { Book, MessageSquare, Image as ImageIcon, Music, Sparkles, Search as SearchIcon, Tag, Clock } from "lucide-react";
import { VIEW_MODE_CONFIG } from "../../lib/viewModes";
import type { ViewMode } from "../../types/userPreferences";
import { toDateValue } from "../../lib/dateUtils";
import { format } from "date-fns";
import type { SearchState } from "../../hooks/useSearchPage";
import type { WikiItem, PostItem, GalleryItem, SongItem, AlbumItem } from "../../types/entities";
import { MixedSearchResultCard } from "../MixedSearchResultCard";
import { SearchResultCard } from "./SearchResultCard";

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

export const SearchResults: React.FC<SearchResultsProps> = ({
  state,
  viewMode,
  tabItems,
  onTabChange,
}) => {
  const { loading, hasSearched, activeTab, isMixedSearch, mixedResults, results, filters } = state;

  const hasFilters = filters.selectedTags.length > 0 || filters.dateRange.start || filters.dateRange.end;

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
    results.albums.length;

  if (!isMixedSearch && totalResults === 0) {
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

      <div className="space-y-8">
        <AnimatePresence mode="wait">
          {isMixedSearch && mixedResults.length > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="space-y-4"
            >
              <div
                className={clsx(
                  "grid",
                  VIEW_MODE_CONFIG[viewMode].gridCols,
                  VIEW_MODE_CONFIG[viewMode].gap
                )}
              >
                {mixedResults
                  .filter((result) => {
                    if (activeTab === "semantic") return true;
                    return result.sourceType === activeTab;
                  })
                  .map((result, index) => (
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
                  </h2>
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
