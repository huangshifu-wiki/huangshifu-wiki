import { Link } from 'react-router-dom'
import { clsx } from 'clsx'
import { ViewModeSelector } from '../ViewModeSelector'
import type { WikiCategoryItem } from '../../types/entities'
import type { ViewMode } from '../../types/userPreferences'

interface WikiFiltersProps {
  categories: WikiCategoryItem[]
  activeCategory: string
  total: number
  viewMode: ViewMode
  getCategoryUrl: (category: string) => string
  getCategoryLabel: (category: string) => string
  onViewModeChange: (mode: ViewMode) => void
}

const categoryFilterClassName = (active: boolean) =>
  clsx(
    'relative cursor-pointer pb-2 text-[1.0625rem] tracking-[0.06em] transition-all',
    active ? 'font-semibold text-text-primary' : 'text-text-muted hover:text-text-secondary'
  )

const WikiFilters = ({
  categories,
  activeCategory,
  total,
  viewMode,
  getCategoryUrl,
  getCategoryLabel,
  onViewModeChange,
}: WikiFiltersProps) => (
  <div className="mobile-filterbar">
    <div className="mobile-filter-tabs">
      {['all', ...categories.map((item) => item.id)].map((category) => {
        const active = activeCategory === category

        return (
          <Link
            key={category}
            to={getCategoryUrl(category)}
            className={categoryFilterClassName(active)}
          >
            {category === 'all' ? '全部' : getCategoryLabel(category)}
            {active && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-brand-gold" />
            )}
          </Link>
        )
      })}
    </div>

    <div className="mobile-filter-actions">
      <ViewModeSelector value={viewMode} onChange={onViewModeChange} size="sm" />
      <span className="text-border/50">|</span>
      <span className="text-text-muted/70">{total} 个页面</span>
    </div>
  </div>
)

export { WikiFilters }
export type { WikiFiltersProps }
