import React from 'react'
import { Link } from 'react-router-dom'
import type { WikiItem } from '../../types/entities'
import { clsx } from 'clsx'
import { Book, Clock, Heart, Pin } from '@/src/components/icons'
import { formatDate } from '../../lib/dateUtils'
import { CARD } from '../../styles/cardStyles'
import type { ViewMode } from '../../types/userPreferences'

interface WikiCardProps {
  page: WikiItem
  viewMode: ViewMode
  cardHeight?: string
  categoryLabel: string
}

const getWikiExcerpt = (content: string | undefined, length: number) =>
  (content || '').replace(/[#*`]/g, '').substring(0, length)

const WikiCard = React.memo(({ page, viewMode, cardHeight, categoryLabel }: WikiCardProps) => {
  const isListMode = viewMode === 'list'

  return (
    <div
      className={clsx('relative min-w-0 max-w-full', isListMode && 'flex')}
      role="article"
      aria-label={`${page.title} - ${categoryLabel}`}
    >
      <Link
        to={`/wiki/${page.slug}`}
        className={clsx(
          CARD.base,
          'min-w-0 max-w-full',
          isListMode
            ? clsx(CARD.wikiListLayout, 'mobile-list-card')
            : clsx(CARD.gridLayout, 'min-h-full p-5', cardHeight),
          page.isPinned ? 'border-l-[3px] border-l-brand-gold' : ''
        )}
      >
        {isListMode ? (
          <>
            <div className="mobile-list-thumb flex h-16 w-16 flex-shrink-0 items-center justify-center bg-surface-alt">
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
    </div>
  )
})

WikiCard.displayName = 'WikiCard'

export default WikiCard
