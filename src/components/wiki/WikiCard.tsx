import React from 'react'
import { Link } from 'react-router-dom'
import type { WikiItem } from '../../types/entities'
import { clsx } from 'clsx'
import { Book, Clock, Heart, Pin } from '@/src/components/icons'
import { formatDate } from '../../lib/dateUtils'
import type { ViewMode } from '../../types/userPreferences'

interface WikiCardProps {
  page: WikiItem
  viewMode: ViewMode
  categoryLabel: string
}

const getWikiExcerpt = (content: string | undefined, length: number) =>
  (content || '').replace(/[#*`]/g, '').substring(0, length)

const WikiCard = React.memo(({ page, viewMode, categoryLabel }: WikiCardProps) => {
  const isListMode = viewMode === 'list'
  const isLargeGrid = viewMode === 'large'
  const excerpt = getWikiExcerpt(page.content, isListMode ? 80 : isLargeGrid ? 120 : 72)
  const updatedAt = formatDate(page.updatedAt, 'yyyy-MM-dd')
  const likesCount = page.likesCount || 0

  return (
    <article
      className="relative min-w-0 max-w-full"
      aria-label={`${page.title} - ${categoryLabel}`}
    >
      <Link
        to={`/wiki/${page.slug}`}
        className={clsx(
          'group min-w-0 max-w-full transition-all duration-300',
          isListMode
            ? 'flex w-full gap-4 rounded px-3 py-3 hover:bg-[color-mix(in_srgb,var(--color-surface-alt)_50%,transparent)]'
            : 'flex flex-col overflow-hidden rounded-lg border border-[var(--book-ink-line)]/50 bg-[var(--book-panel-bg)] p-4 hover:shadow-[0_14px_36px_rgba(72,53,25,0.1)]',
          page.isPinned && 'border-l-[3px] border-l-brand-gold'
        )}
      >
        {isListMode ? (
          <>
            <div className="mobile-list-thumb flex h-16 w-16 flex-shrink-0 items-center justify-center rounded bg-surface-alt shadow-[0_4px_20px_rgba(42,37,32,0.06)]">
              <Book size={24} className="text-brand-gold/60" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex min-w-0 items-center gap-2">
                {page.isPinned && (
                  <span className="flex shrink-0 items-center gap-1 rounded-sm px-2 py-0.5 text-[0.625rem] font-semibold tracking-[0.08em] theme-tag">
                    <Pin size={8} /> 已置顶
                  </span>
                )}
                <span className="max-w-full truncate rounded-sm bg-surface-alt px-2 py-0.5 text-[0.625rem] font-semibold tracking-[0.08em] text-text-secondary">
                  {categoryLabel}
                </span>
              </div>
              <h3 className="mb-1 truncate text-[0.975rem] font-semibold tracking-[0.04em] text-text-primary transition-colors group-hover:text-brand-gold">
                {page.title}
              </h3>
              <p className="line-clamp-2 text-[0.8125rem] leading-relaxed text-text-muted/80">
                {excerpt || '暂无摘要'}
              </p>
              <div className="mt-2 flex items-center gap-3 text-[0.75rem] text-text-muted">
                <span className="flex items-center gap-1">
                  <Clock size={10} /> {updatedAt}
                </span>
                <span className="flex items-center gap-1">
                  <Heart size={10} /> {likesCount}
                </span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="mb-3 flex min-w-0 items-center gap-2">
              {page.isPinned && (
                <span className="flex shrink-0 items-center gap-1 rounded-sm px-2 py-0.5 text-[0.625rem] font-semibold tracking-[0.08em] theme-tag">
                  <Pin size={8} /> 已置顶
                </span>
              )}
              <span className="max-w-full truncate rounded-sm bg-surface-alt px-2 py-0.5 text-[0.625rem] font-semibold tracking-[0.08em] text-text-secondary">
                {categoryLabel}
              </span>
            </div>
            <h3 className="mb-2 line-clamp-2 min-h-[2.65rem] min-w-0 max-w-full text-wrap-anywhere text-[1.0625rem] font-semibold leading-snug tracking-[0.02em] text-text-primary transition-colors group-hover:text-brand-gold">
              {page.title}
            </h3>
            <p
              className={clsx(
                'mb-4 text-[0.875rem] leading-relaxed text-text-muted',
                isLargeGrid ? 'line-clamp-3 min-h-[4.25rem]' : 'line-clamp-2 min-h-[2.875rem]'
              )}
            >
              {excerpt ? `${excerpt}...` : '暂无摘要'}
            </p>
            <div className="flex items-center justify-between text-[0.75rem] text-text-muted">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <Clock size={10} /> {updatedAt}
                </span>
                <span className="flex items-center gap-1">
                  <Heart size={10} /> {likesCount}
                </span>
              </div>
            </div>
          </>
        )}
      </Link>
    </article>
  )
})

WikiCard.displayName = 'WikiCard'

export default WikiCard
