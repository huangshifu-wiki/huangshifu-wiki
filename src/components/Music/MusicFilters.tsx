import React from 'react'
import { ArrowUpDown } from '@/src/components/icons'
import { clsx } from 'clsx'
import { useI18n } from '../../lib/i18n'
import { ViewModeSelector } from '../ViewModeSelector'
import type { ViewMode } from '../../types/userPreferences'

type SortBy = 'releaseDate' | 'title' | 'artist'
type SortOrder = 'asc' | 'desc'
type ActiveTab = 'music' | 'albums'

interface MusicFiltersProps {
  activeTab: ActiveTab
  onTabChange: (tab: ActiveTab) => void
  sortBy: SortBy
  onSortByChange: (sortBy: SortBy) => void
  sortOrder: SortOrder
  onSortOrderChange: (order: SortOrder) => void
  showAccompaniments: boolean
  onShowAccompanimentsChange: (show: boolean) => void
  musicCount: number
  albumCount: number
  viewMode?: ViewMode
  onViewModeChange?: (mode: ViewMode) => void
}

const MusicFilters: React.FC<MusicFiltersProps> = ({
  activeTab,
  onTabChange,
  sortBy,
  onSortByChange,
  sortOrder,
  onSortOrderChange,
  showAccompaniments,
  onShowAccompanimentsChange,
  musicCount,
  albumCount,
  viewMode,
  onViewModeChange,
}) => {
  const { t } = useI18n()

  const sortLabel = {
    releaseDate: '时间',
    title: '名称',
    artist: '歌手',
  } as const

  return (
    <div className="flex items-end justify-between border-b border-border mb-5">
      <div className="flex gap-5">
        <button
          onClick={() => onTabChange('music')}
          className={clsx(
            'text-[1.125rem] pb-2 relative tracking-[0.05em] transition-all cursor-pointer',
            activeTab === 'music'
              ? "text-brand-gold font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[var(--color-theme-accent)] after:rounded-[1px]"
              : 'text-text-muted hover:text-brand-gold'
          )}
        >
          {t('music.tabMusic')}
        </button>
        <button
          onClick={() => onTabChange('albums')}
          className={clsx(
            'text-[1.125rem] pb-2 relative tracking-[0.05em] transition-all cursor-pointer',
            activeTab === 'albums'
              ? "text-brand-gold font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[var(--color-theme-accent)] after:rounded-[1px]"
              : 'text-text-muted hover:text-brand-gold'
          )}
        >
          {t('music.tabAlbums')}
        </button>
      </div>

      <div className="flex items-center gap-3 pb-2 text-[0.8125rem] text-text-muted">
        {viewMode && onViewModeChange && (
          <ViewModeSelector value={viewMode} onChange={onViewModeChange} size="sm" />
        )}
        {activeTab === 'music' && (
          <>
            <div className="flex items-center">
              {(['releaseDate', 'title', 'artist'] as SortBy[]).map((key) => (
                <button
                  key={key}
                  onClick={() => onSortByChange(key)}
                  className={clsx(
                    'px-2 py-1 transition-colors cursor-pointer',
                    sortBy === key ? 'text-text-primary font-medium' : 'hover:text-text-secondary'
                  )}
                >
                  {sortLabel[key]}
                </button>
              ))}
              <button
                onClick={() => onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc')}
                className="p-1 hover:text-brand-gold transition-colors cursor-pointer"
                title={sortOrder === 'asc' ? t('music.sortOrder.asc') : t('music.sortOrder.desc')}
              >
                <ArrowUpDown size={13} />
              </button>
            </div>
            <span className="mx-1 text-border">|</span>
            <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-text-secondary transition-colors">
              <input
                type="checkbox"
                checked={showAccompaniments}
                onChange={(e) => onShowAccompanimentsChange(e.target.checked)}
                className="w-3 h-3 rounded-sm border-border text-brand-gold focus:ring-0 focus:ring-offset-0 accent-[var(--color-theme-accent)]"
              />
              <span className="hidden sm:inline">{t('music.showAccompaniments')}</span>
              <span className="sm:hidden" title={t('music.showAccompaniments')}>
                伴奏
              </span>
            </label>
            <span className="mx-1 text-border">|</span>
          </>
        )}
        <span className="text-text-muted">
          {activeTab === 'music'
            ? `${musicCount} ${t('music.unit.song')}`
            : `${albumCount} ${t('music.unit.album')}`}
        </span>
      </div>
    </div>
  )
}

export { MusicFilters }
export type { MusicFiltersProps, SortBy, SortOrder, ActiveTab, ViewMode }
