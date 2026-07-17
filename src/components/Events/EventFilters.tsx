import { Link } from 'react-router-dom'
import { ArrowUpDown } from '@/src/components/icons'
import { clsx } from 'clsx'
import { ViewModeSelector } from '../ViewModeSelector'
import { Button } from '@/src/components/ui'
import type { ViewMode } from '../../types/userPreferences'

type EventSortOrder = 'asc' | 'desc'

interface EventFiltersProps {
  tags: string[]
  selectedTag: string
  sortOrder: EventSortOrder
  viewMode: ViewMode
  getTagUrl: (tag: string) => string
  onSortOrderChange: (value: EventSortOrder) => void
  onViewModeChange: (mode: ViewMode) => void
}

const EVENT_VIEW_MODES = ['large', 'list'] as const

const tagFilterClassName = (active: boolean) =>
  clsx(
    'relative cursor-pointer pb-2 text-[1.0625rem] tracking-[0.06em] transition-all',
    active ? 'font-semibold text-text-primary' : 'text-text-muted hover:text-text-secondary'
  )

const EventFilters = ({
  tags,
  selectedTag,
  sortOrder,
  viewMode,
  getTagUrl,
  onSortOrderChange,
  onViewModeChange,
}: EventFiltersProps) => (
  <div className="mobile-filterbar">
    {tags.length > 0 ? (
      <div className="mobile-filter-tabs">
        <Link to={getTagUrl('')} className={tagFilterClassName(!selectedTag)}>
          全部标签
          {!selectedTag && (
            <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-brand-gold" />
          )}
        </Link>
        {tags.map((tag) => (
          <Link key={tag} to={getTagUrl(tag)} className={tagFilterClassName(selectedTag === tag)}>
            {tag}
            {selectedTag === tag && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-brand-gold" />
            )}
          </Link>
        ))}
      </div>
    ) : (
      <div />
    )}

    <div className="mobile-filter-actions">
      <ViewModeSelector
        value={viewMode}
        modes={EVENT_VIEW_MODES}
        onChange={onViewModeChange}
        size="sm"
      />
      <span className="text-border/50">|</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc')}
        className="h-auto min-h-0 cursor-pointer px-1.5 py-0.5"
        rightIcon={<ArrowUpDown size={12} />}
        title={sortOrder === 'asc' ? '时间正序' : '时间倒序'}
      >
        <span>{sortOrder === 'desc' ? '时间倒序' : '时间正序'}</span>
      </Button>
    </div>
  </div>
)

export { EventFilters }
export type { EventFiltersProps, EventSortOrder }
