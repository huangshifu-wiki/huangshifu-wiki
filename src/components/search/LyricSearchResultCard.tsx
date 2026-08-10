import React from 'react'
import { Link } from 'react-router-dom'
import { clsx } from 'clsx'
import { Music } from '@/src/components/icons'
import { SmartImage } from '../SmartImage'
import { CoverPlaceholder } from '../CoverPlaceholder'
import { formatMusicCredits } from '../../lib/musicCredits'
import type { ViewMode } from '../../types/userPreferences'
import type { LyricSearchItem } from '../../types/entities'

interface LyricSearchResultCardProps {
  item: LyricSearchItem
  query: string
  viewMode: ViewMode
}

const MAX_VISIBLE_LINES = 4

function highlightQuery(text: string, query: string) {
  if (!query) return text
  const lowerQuery = query.toLowerCase()
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'ig'))
  return parts.map((part, i) =>
    part.toLowerCase() === lowerQuery ? (
      <span key={i} className="font-semibold text-brand-gold">
        {part}
      </span>
    ) : (
      part
    )
  )
}

export const LyricSearchResultCard: React.FC<LyricSearchResultCardProps> = React.memo(
  ({ item, query, viewMode }) => {
    const isList = viewMode === 'list'
    const subtitle = `${formatMusicCredits(item.artists)}${item.album ? ` — ${item.album}` : ''}`

    return (
      <Link
        to={`/music/${item.slug}`}
        data-press-feedback="state"
        className={clsx(
          'group min-w-0 max-w-full transition-all duration-300',
          isList
            ? 'flex w-full gap-4 rounded px-3 py-3 hover:bg-[color-mix(in_srgb,var(--color-surface-alt)_50%,transparent)]'
            : 'block overflow-hidden rounded-lg border border-[var(--book-ink-line)]/50 bg-[var(--book-panel-bg)] hover:shadow-[0_14px_36px_rgba(72,53,25,0.1)]'
        )}
      >
        {isList ? (
          <>
            {item.cover ? (
              <div className="mobile-list-thumb h-20 w-20 flex-shrink-0 overflow-hidden rounded bg-surface-alt">
                <SmartImage
                  src={item.coverThumbnail || item.cover}
                  alt=""
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
                />
              </div>
            ) : (
              <div className="mobile-list-thumb h-20 w-20 flex-shrink-0 overflow-hidden rounded bg-surface-alt">
                <CoverPlaceholder icon={<Music size={20} />} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[0.975rem] font-semibold tracking-[0.04em] text-text-primary transition-colors group-hover:text-brand-gold">
                {item.title}
              </h3>
              {subtitle && <p className="truncate text-xs text-text-muted">{subtitle}</p>}
              <div className="mt-2 space-y-1">
                {item.matchedLines.map((line) => (
                  <p
                    key={line.index}
                    className="truncate text-[0.8125rem] leading-relaxed text-text-secondary"
                  >
                    {highlightQuery(line.text, query)}
                  </p>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="aspect-square overflow-hidden bg-surface-alt">
              {item.cover ? (
                <SmartImage
                  src={item.coverThumbnail || item.cover}
                  alt=""
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
                />
              ) : (
                <CoverPlaceholder icon={<Music size={20} />} />
              )}
            </div>
            <div className="p-3">
              <h3 className="mb-1 line-clamp-2 text-[0.875rem] font-semibold leading-snug tracking-[0.02em] text-text-primary transition-colors group-hover:text-brand-gold">
                {item.title}
              </h3>
              {subtitle && <p className="mb-2 truncate text-xs text-text-muted">{subtitle}</p>}
              <div className="space-y-1">
                {item.matchedLines.slice(0, MAX_VISIBLE_LINES).map((line) => (
                  <p
                    key={line.index}
                    className="truncate text-xs leading-relaxed text-text-secondary"
                  >
                    {highlightQuery(line.text, query)}
                  </p>
                ))}
                {item.matchedLines.length > MAX_VISIBLE_LINES && (
                  <p className="text-[0.6875rem] text-text-muted">
                    还有 {item.matchedLines.length - MAX_VISIBLE_LINES} 行
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </Link>
    )
  }
)

LyricSearchResultCard.displayName = 'LyricSearchResultCard'
