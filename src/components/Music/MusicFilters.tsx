import React from 'react'
import { ArrowUpDown } from '@/src/components/icons'
import { Checkbox } from '@/src/components/ui'
import { clsx } from 'clsx'
import { useI18n } from '../../lib/i18n'
import { ViewModeSelector } from '../ViewModeSelector'
import type { ViewMode } from '../../types/userPreferences'

type SortOrder = 'asc' | 'desc'
type ActiveTab = 'music' | 'albums'

interface MusicFiltersProps {
  activeTab: ActiveTab
  onTabChange: (tab: ActiveTab) => void
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

  return (
    <div className="mobile-filterbar">
      <div className="mobile-filter-tabs">
        <button
          onClick={() => onTabChange('music')}
          data-press-feedback="inline"
          className={clsx(
            'relative cursor-pointer pb-2 text-[1.0625rem] tracking-[0.06em] transition-all',
            activeTab === 'music'
              ? 'font-semibold text-text-primary'
              : 'text-text-muted hover:text-text-secondary'
          )}
        >
          {t('music.tabMusic')}
          {activeTab === 'music' && (
            <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-brand-gold" />
          )}
        </button>
        <button
          onClick={() => onTabChange('albums')}
          data-press-feedback="inline"
          className={clsx(
            'relative cursor-pointer pb-2 text-[1.0625rem] tracking-[0.06em] transition-all',
            activeTab === 'albums'
              ? 'font-semibold text-text-primary'
              : 'text-text-muted hover:text-text-secondary'
          )}
        >
          {t('music.tabAlbums')}
          {activeTab === 'albums' && (
            <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-brand-gold" />
          )}
        </button>
      </div>

      <div className="mobile-filter-actions">
        {viewMode && onViewModeChange && (
          <ViewModeSelector value={viewMode} onChange={onViewModeChange} size="sm" />
        )}
        <span className="text-border/50">|</span>
        <button
          onClick={() => onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc')}
          data-press-feedback="ripple"
          className="cursor-pointer p-0.5 transition-colors hover:text-brand-gold"
          title={sortOrder === 'asc' ? t('music.sortOrder.asc') : t('music.sortOrder.desc')}
        >
          <ArrowUpDown size={12} />
        </button>
        {activeTab === 'music' && (
          <>
            <span className="text-border/50">|</span>
            <label
              htmlFor="music-show-accompaniments"
              className="flex cursor-pointer select-none items-center gap-1.5 transition-colors hover:text-text-secondary"
            >
              <Checkbox
                id="music-show-accompaniments"
                checked={showAccompaniments}
                onCheckedChange={(checked) => onShowAccompanimentsChange(checked === true)}
                className="h-3 w-3"
                aria-label={t('music.showAccompaniments')}
              />
              <span className="hidden sm:inline">{t('music.showAccompaniments')}</span>
              <span className="sm:hidden">伴奏</span>
            </label>
          </>
        )}
        <span className="text-border/50">|</span>
        <span className="text-text-muted/70">
          {activeTab === 'music'
            ? `${musicCount} ${t('music.unit.song')}`
            : `${albumCount} ${t('music.unit.album')}`}
        </span>
      </div>
    </div>
  )
}

export { MusicFilters }
