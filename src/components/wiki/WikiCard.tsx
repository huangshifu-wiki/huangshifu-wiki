import React from 'react'
import { Link } from 'react-router-dom'
import type { WikiItem } from '../../types/entities'
import { clsx } from 'clsx'
import { Book, Clock, Heart, Link2, Pin } from '@/src/components/icons'
import { formatDate } from '../../lib/dateUtils'
import { CARD } from '../../styles/cardStyles'
import type { ViewMode } from '../../types/userPreferences'

interface WikiCardProps {
  page: WikiItem
  viewMode: ViewMode
  cardHeight?: string
  categoryLabel: string
  onCopyLink: (event: React.MouseEvent<HTMLButtonElement>, slug: string) => void
}

const getWikiExcerpt = (content: string | undefined, length: number) =>
  (content || '').replace(/[#*`]/g, '').substring(0, length)

const WikiCard = React.memo(
  ({ page, viewMode, cardHeight, categoryLabel, onCopyLink }: WikiCardProps) => {
    const isListMode = viewMode === 'list'

    return (
      <div
        className={clsx('relative group', isListMode && 'flex')}
        role="article"
        aria-label={`${page.title} - ${categoryLabel}`}
      >
        <Link
          to={`/wiki/${page.slug}`}
          className={clsx(
            isListMode
              ? clsx(
                  CARD.wikiListLayout,
                  'mobile-list-card bg-surface rounded border border-border hover:border-brand-gold transition-all'
                )
              : clsx(
                  CARD.gridLayout,
                  'bg-surface p-6 rounded border border-border hover:border-brand-gold transition-all',
                  cardHeight
                ),
            page.isPinned ? 'border-l-[3px] border-l-brand-gold' : ''
          )}
        >
          {isListMode ? (
            <>
              <div className="mobile-list-thumb flex h-16 w-16 flex-shrink-0 items-center justify-center rounded bg-surface-alt">
                <Book size={24} className="text-brand-gold/60" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {page.isPinned && (
                    <span className={CARD.pinnedTag}>
                      <Pin size={8} /> 已置顶
                    </span>
                  )}
                  <span className={CARD.wikiTag}>{categoryLabel}</span>
                </div>
                <h3 className={CARD.wikiTitleList}>{page.title}</h3>
                <p className={CARD.wikiDesc}>{getWikiExcerpt(page.content, 80)}</p>
                <div className={clsx(CARD.meta, 'gap-3 mt-2')}>
                  <span className="flex items-center gap-1">
                    <Clock size={10} /> {formatDate(page.updatedAt, 'yyyy-MM-dd')}
                  </span>
                  <span className="flex items-center gap-1">
                    <Heart size={10} /> {page.likesCount || 0}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3">
                <span className={CARD.wikiTag}>{categoryLabel}</span>
              </div>
              <h3 className={CARD.wikiTitleGrid}>{page.title}</h3>
              <p className={clsx(CARD.wikiDesc, 'mb-4 leading-relaxed flex-1')}>
                {getWikiExcerpt(page.content, 100)}...
              </p>
              <div className={clsx(CARD.meta, 'justify-between mt-auto')}>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <Clock size={10} /> {formatDate(page.updatedAt, 'yyyy-MM-dd')}
                  </span>
                  <span className="flex items-center gap-1">
                    <Heart size={10} /> {page.likesCount || 0}
                  </span>
                </div>
              </div>
            </>
          )}
        </Link>
        <button
          onClick={(event) => onCopyLink(event, page.slug)}
          className={clsx(
            'mobile-card-action inline-flex items-center justify-center gap-1.5 rounded border bg-surface/90 px-3 py-2 text-xs font-medium text-text-muted hover:border-brand-gold hover:text-brand-gold transition-all',
            isListMode
              ? 'absolute top-3 right-3 sm:top-4 sm:right-4'
              : 'absolute bottom-3 right-3 opacity-100 sm:bottom-4 sm:right-4 sm:opacity-0 sm:group-hover:opacity-100'
          )}
          title="复制链接"
          aria-label="复制链接"
        >
          <Link2 size={14} />
          <span className="hidden sm:inline">复制链接</span>
        </button>
      </div>
    )
  }
)

WikiCard.displayName = 'WikiCard'

export default WikiCard
