import { ArrowUpDown } from '@/src/components/icons'
import { ViewModeSelector } from '../ViewModeSelector'
import { Button } from '@/src/components/ui'
import type { ViewMode } from '../../types/userPreferences'

type EventSortOrder = 'asc' | 'desc'

interface EventFiltersProps {
  sortOrder: EventSortOrder
  viewMode: ViewMode
  onSortOrderChange: (value: EventSortOrder) => void
  onViewModeChange: (mode: ViewMode) => void
}

const EVENT_VIEW_MODES = ['large', 'list'] as const

const EventFilters = ({
  sortOrder,
  viewMode,
  onSortOrderChange,
  onViewModeChange,
}: EventFiltersProps) => (
  <div className="mobile-filterbar justify-end">
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
        data-press-feedback="ripple"
        size="sm"
        onClick={() => onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc')}
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
