import { Link } from 'react-router-dom'
import { clsx } from 'clsx'
import { useI18n } from '../../lib/i18n'
import { ViewModeSelector } from '../ViewModeSelector'
import type { ViewMode } from '../../types/userPreferences'

type ForumSort = 'latest' | 'hot' | 'recommended'

interface ForumSectionItem {
  id: string
  name: string
}

interface ForumFiltersProps {
  sections: ForumSectionItem[]
  activeSection: string
  activeSort: string
  viewMode: ViewMode
  getListUrl: (nextValues: { section?: string; sort?: string }) => string
  onViewModeChange: (mode: ViewMode) => void
}

const sectionFilterClassName = (active: boolean) =>
  clsx(
    'relative cursor-pointer pb-2 text-[1.0625rem] tracking-[0.06em] transition-all',
    active ? 'font-semibold text-text-primary' : 'text-text-muted hover:text-text-secondary'
  )

const sortFilterClassName = (active: boolean) =>
  clsx(
    'rounded px-1.5 py-0.5 transition-colors',
    active ? 'font-medium text-text-primary' : 'hover:text-brand-gold'
  )

const ForumFilters = ({
  sections,
  activeSection,
  activeSort,
  viewMode,
  getListUrl,
  onViewModeChange,
}: ForumFiltersProps) => {
  const { t } = useI18n()

  return (
    <div className="mobile-filterbar">
      <div className="mobile-filter-tabs">
        <Link
          to={getListUrl({ section: 'all' })}
          className={sectionFilterClassName(activeSection === 'all')}
        >
          {t('forum.allSections')}
          {activeSection === 'all' && (
            <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-brand-gold" />
          )}
        </Link>
        {sections.map((section) => {
          const active = activeSection === section.id

          return (
            <Link
              key={section.id}
              to={getListUrl({ section: section.id })}
              className={sectionFilterClassName(active)}
            >
              {section.name}
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
        {(['latest', 'hot', 'recommended'] as ForumSort[]).map((sort) => (
          <Link
            key={sort}
            to={getListUrl({ sort })}
            className={sortFilterClassName(activeSort === sort)}
          >
            {sort === 'latest'
              ? t('forum.sortLatest')
              : sort === 'hot'
                ? t('forum.sortHot')
                : t('forum.sortRecommended')}
          </Link>
        ))}
      </div>
    </div>
  )
}

export { ForumFilters }
export type { ForumFiltersProps, ForumSectionItem, ForumSort }
