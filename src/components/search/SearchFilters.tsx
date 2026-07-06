import React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { clsx } from 'clsx'
import { Tag, Calendar, Book, Sparkles, Filter } from '@/src/components/icons'
import type { SearchFilters as SearchFiltersType } from '../../hooks/useSearchPage'

interface SearchFiltersProps {
  filters: SearchFiltersType
  hotKeywords: string[]
  showFilters: boolean
  semanticSearchEnabled?: boolean
  onToggleShowFilters: () => void
  onToggleTag: (tag: string) => void
  onUpdateFilters: (filters: Partial<SearchFiltersType>) => void
  onResetFilters: () => void
  onApplyFilters: () => void
  onSearchKeyword: (keyword: string) => void
}

const contentTypeLabels: Record<string, string> = {
  all: '全部',
  wiki: '百科',
  posts: '帖子',
  galleries: '图集',
  music: '音乐',
  albums: '专辑',
}

export const SearchFilters: React.FC<SearchFiltersProps> = ({
  filters,
  hotKeywords,
  showFilters,
  semanticSearchEnabled = true,
  onToggleShowFilters,
  onToggleTag,
  onUpdateFilters,
  onResetFilters,
  onApplyFilters,
  onSearchKeyword,
}) => {
  return (
    <div className="mb-6 border-b border-[var(--book-ink-line)] pb-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-xs text-text-muted">热门:</span>
          {hotKeywords.slice(0, 6).map((tag) => (
            <button
              key={tag}
              onClick={() => onSearchKeyword(tag)}
              className="min-h-8 rounded-sm border border-[var(--book-ink-line)] bg-transparent px-3 py-1 text-xs text-text-secondary transition-all cursor-pointer hover:border-brand-gold hover:text-brand-gold"
            >
              {tag}
            </button>
          ))}
        </div>
        <button
          onClick={onToggleShowFilters}
          className={clsx(
            'flex items-center gap-2 text-sm transition-colors',
            showFilters ? 'text-brand-gold' : 'text-text-muted hover:text-brand-gold'
          )}
        >
          <Filter size={16} /> {showFilters ? '隐藏筛选' : '高级筛选'}
        </button>
      </div>

      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mt-5 pt-5 border-t border-[var(--book-ink-line)]"
          >
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4 lg:gap-6">
              {/* 标签筛选 */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-text-secondary tracking-[0.12em] flex items-center gap-2">
                  <Tag size={12} /> 标签筛选
                </h4>
                <div className="flex flex-wrap gap-2">
                  {hotKeywords.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => onToggleTag(tag)}
                      className={clsx(
                        'px-3 py-1 rounded-sm text-xs transition-all',
                        filters.selectedTags.includes(tag)
                          ? 'theme-button-primary border border-transparent'
                          : 'theme-button-secondary'
                      )}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              {/* 时间范围 */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-text-secondary tracking-[0.12em] flex items-center gap-2">
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
                    className="theme-input w-full px-3 py-2 rounded text-xs"
                  />
                  <input
                    type="date"
                    value={filters.dateRange.end}
                    onChange={(e) =>
                      onUpdateFilters({
                        dateRange: { ...filters.dateRange, end: e.target.value },
                      })
                    }
                    className="theme-input w-full px-3 py-2 rounded text-xs"
                  />
                </div>
              </div>

              {/* 内容类型 */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-text-secondary tracking-[0.12em] flex items-center gap-2">
                  <Book size={12} /> 内容类型
                </h4>
                <div className="flex flex-wrap gap-2">
                  {['all', 'wiki', 'posts', 'galleries', 'music', 'albums'].map((type) => (
                    <button
                      key={type}
                      onClick={() =>
                        onUpdateFilters({ contentType: type as SearchFiltersType['contentType'] })
                      }
                      className={clsx(
                        'px-3 py-1 rounded-sm text-xs transition-all capitalize',
                        filters.contentType === type
                          ? 'theme-button-primary border border-transparent'
                          : 'theme-button-secondary'
                      )}
                    >
                      {contentTypeLabels[type]}
                    </button>
                  ))}
                </div>
              </div>

              {semanticSearchEnabled && (
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold text-text-secondary tracking-[0.12em] flex items-center gap-2">
                    <Sparkles size={12} /> AI 搜图
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() =>
                        onUpdateFilters({ semanticImageSearch: !filters.semanticImageSearch })
                      }
                      className={clsx(
                        'px-3 py-1 rounded-sm text-xs transition-all flex items-center gap-1.5',
                        filters.semanticImageSearch
                          ? 'theme-button-primary border border-transparent'
                          : 'theme-button-secondary'
                      )}
                    >
                      <Sparkles size={12} />
                      智能混合搜索
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                onClick={onResetFilters}
                className="text-xs text-text-muted theme-icon-button-danger transition-colors"
              >
                重置筛选
              </button>
              <button
                onClick={onApplyFilters}
                className="theme-button-primary px-5 py-2 rounded text-xs font-medium transition-all"
              >
                应用筛选
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
