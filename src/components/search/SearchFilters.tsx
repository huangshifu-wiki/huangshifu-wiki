import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { clsx } from "clsx";
import { Tag, Calendar, Book, Sparkles, Filter } from "lucide-react";
import type { SearchFilters as SearchFiltersType } from "../../hooks/useSearchPage";

interface SearchFiltersProps {
  filters: SearchFiltersType;
  hotKeywords: string[];
  showFilters: boolean;
  onToggleShowFilters: () => void;
  onToggleTag: (tag: string) => void;
  onUpdateFilters: (filters: Partial<SearchFiltersType>) => void;
  onResetFilters: () => void;
  onApplyFilters: () => void;
  onSearchKeyword: (keyword: string) => void;
}

const contentTypeLabels: Record<string, string> = {
  all: "全部",
  wiki: "百科",
  posts: "帖子",
  galleries: "图集",
  music: "音乐",
  albums: "专辑",
};

export const SearchFilters: React.FC<SearchFiltersProps> = ({
  filters,
  hotKeywords,
  showFilters,
  onToggleShowFilters,
  onToggleTag,
  onUpdateFilters,
  onResetFilters,
  onApplyFilters,
  onSearchKeyword,
}) => {
  return (
    <div className="bg-white border border-[#e0dcd3] rounded p-6 mb-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[#9e968e]">热门:</span>
          {hotKeywords.slice(0, 6).map((tag) => (
            <button
              key={tag}
              onClick={() => onSearchKeyword(tag)}
              className="px-3 py-1 bg-[#f7f5f0] text-[#6b6560] text-xs rounded hover:text-[#c8951e] hover:bg-[#f7f5f0] transition-all"
            >
              {tag}
            </button>
          ))}
        </div>
        <button
          onClick={onToggleShowFilters}
          className={clsx(
            "flex items-center gap-2 text-sm transition-colors",
            showFilters
              ? "text-[#c8951e]"
              : "text-[#9e968e] hover:text-[#c8951e]"
          )}
        >
          <Filter size={16} /> {showFilters ? "隐藏筛选" : "高级筛选"}
        </button>
      </div>

      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mt-5 pt-5 border-t border-[#e0dcd3]"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* 标签筛选 */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-[#6b6560] tracking-[0.12em] uppercase flex items-center gap-2">
                  <Tag size={12} /> 标签筛选
                </h4>
                <div className="flex flex-wrap gap-2">
                  {hotKeywords.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => onToggleTag(tag)}
                      className={clsx(
                        "px-3 py-1 rounded text-xs transition-all",
                        filters.selectedTags.includes(tag)
                          ? "bg-[#c8951e] text-white border border-transparent"
                          : "bg-white border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e]"
                      )}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              {/* 时间范围 */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-[#6b6560] tracking-[0.12em] uppercase flex items-center gap-2">
                  <Calendar size={12} /> 时间范围
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={filters.dateRange.start}
                    onChange={(e) =>
                      onUpdateFilters({
                        dateRange: { ...filters.dateRange, start: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 bg-white border border-[#e0dcd3] rounded text-xs focus:outline-none focus:border-[#c8951e]"
                  />
                  <input
                    type="date"
                    value={filters.dateRange.end}
                    onChange={(e) =>
                      onUpdateFilters({
                        dateRange: { ...filters.dateRange, end: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 bg-white border border-[#e0dcd3] rounded text-xs focus:outline-none focus:border-[#c8951e]"
                  />
                </div>
              </div>

              {/* 内容类型 */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-[#6b6560] tracking-[0.12em] uppercase flex items-center gap-2">
                  <Book size={12} /> 内容类型
                </h4>
                <div className="flex flex-wrap gap-2">
                  {["all", "wiki", "posts", "galleries", "music", "albums"].map((type) => (
                    <button
                      key={type}
                      onClick={() => onUpdateFilters({ contentType: type as SearchFiltersType["contentType"] })}
                      className={clsx(
                        "px-3 py-1 rounded text-xs transition-all capitalize",
                        filters.contentType === type
                          ? "bg-[#c8951e] text-white border border-transparent"
                          : "bg-white border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e]"
                      )}
                    >
                      {contentTypeLabels[type]}
                    </button>
                  ))}
                </div>
              </div>

              {/* AI 搜图 */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-[#6b6560] tracking-[0.12em] uppercase flex items-center gap-2">
                  <Sparkles size={12} /> AI 搜图
                </h4>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() =>
                      onUpdateFilters({ semanticImageSearch: !filters.semanticImageSearch })
                    }
                    className={clsx(
                      "px-3 py-1 rounded text-xs transition-all flex items-center gap-1.5",
                      filters.semanticImageSearch
                        ? "bg-[#c8951e] text-white border border-transparent"
                        : "bg-white border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e]"
                    )}
                  >
                    <Sparkles size={12} />
                    智能混合搜索
                  </button>
                </div>
                <p className="text-[10px] text-[#9e968e]">
                  关键词+语义向量融合搜索
                </p>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={onResetFilters}
                className="text-xs text-[#9e968e] hover:text-red-500 transition-colors"
              >
                重置筛选
              </button>
              <button
                onClick={onApplyFilters}
                className="px-5 py-2 bg-[#c8951e] text-white rounded text-xs font-medium hover:bg-[#dca828] transition-all"
              >
                应用筛选
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
