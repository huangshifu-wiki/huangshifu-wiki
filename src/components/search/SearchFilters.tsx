import React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { clsx } from 'clsx'
import { Tag, Calendar, Book, Sparkles, Filter } from '@/src/components/icons'
import type { SearchFilters as SearchFiltersType } from '../../hooks/useSearchPage'
import { Button, Input, Switch } from '@/src/components/ui'

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        {hotKeywords.length > 0 && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-xs text-text-muted">热门:</span>
            {hotKeywords.slice(0, 6).map((tag) => (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                key={tag}
                onClick={() => onSearchKeyword(tag)}
                className="cursor-pointer rounded-sm bg-transparent"
              >
                {tag}
              </Button>
            ))}
          </div>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onToggleShowFilters}
          className={clsx(
            'ml-auto flex items-center gap-2 rounded px-2 py-1 text-sm transition-colors',
            showFilters ? 'text-brand-gold' : 'text-text-muted hover:text-brand-gold'
          )}
        >
          <Filter size={16} /> {showFilters ? '隐藏筛选' : '高级筛选'}
        </Button>
      </div>

      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mt-5 overflow-hidden border-t border-[var(--book-ink-line)] pt-5"
          >
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4 lg:gap-6">
              {hotKeywords.length > 0 && (
                <div className="space-y-3">
                  <h4 className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-text-secondary">
                    <Tag size={12} /> 标签筛选
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {hotKeywords.map((tag) => (
                      <Button
                        type="button"
                        size="sm"
                        variant={filters.selectedTags.includes(tag) ? 'primary' : 'secondary'}
                        key={tag}
                        onClick={() => onToggleTag(tag)}
                        className="rounded-sm"
                      >
                        {tag}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* 时间范围 */}
              <div className="space-y-3">
                <h4 className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-text-secondary">
                  <Calendar size={12} /> 时间范围
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="date"
                    value={filters.dateRange.start}
                    onChange={(e) =>
                      onUpdateFilters({
                        dateRange: { ...filters.dateRange, start: e.target.value },
                      })
                    }
                    className="theme-input w-full rounded px-3 py-2 text-xs"
                  />
                  <Input
                    type="date"
                    value={filters.dateRange.end}
                    onChange={(e) =>
                      onUpdateFilters({
                        dateRange: { ...filters.dateRange, end: e.target.value },
                      })
                    }
                    className="theme-input w-full rounded px-3 py-2 text-xs"
                  />
                </div>
              </div>

              {/* 内容类型 */}
              <div className="space-y-3">
                <h4 className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-text-secondary">
                  <Book size={12} /> 内容类型
                </h4>
                <div className="flex flex-wrap gap-2">
                  {['all', 'wiki', 'posts', 'galleries', 'music', 'albums'].map((type) => (
                    <Button
                      type="button"
                      size="sm"
                      variant={filters.contentType === type ? 'primary' : 'secondary'}
                      key={type}
                      onClick={() =>
                        onUpdateFilters({ contentType: type as SearchFiltersType['contentType'] })
                      }
                      className="rounded-sm capitalize"
                    >
                      {contentTypeLabels[type]}
                    </Button>
                  ))}
                </div>
              </div>

              {semanticSearchEnabled && (
                <div className="space-y-3">
                  <h4 className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-text-secondary">
                    <Sparkles size={12} /> AI 搜图
                  </h4>
                  <Switch
                    label="智能混合搜索"
                    checked={filters.semanticImageSearch}
                    onCheckedChange={(checked) => onUpdateFilters({ semanticImageSearch: checked })}
                  />
                </div>
              )}
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onResetFilters}
                className="text-text-muted theme-icon-button-danger"
              >
                重置筛选
              </Button>
              <Button type="button" size="sm" onClick={onApplyFilters} className="px-5">
                应用筛选
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
