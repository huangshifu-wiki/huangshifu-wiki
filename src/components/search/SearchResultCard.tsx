import React from 'react'
import { Link } from 'react-router-dom'
import { clsx } from 'clsx'
import { Book, Image as ImageIcon, Music, MessageSquare, Clock } from '@/src/components/icons'
import { SmartImage } from '../SmartImage'
import type { ViewMode } from '../../types/userPreferences'

export type SearchResultType = 'wiki' | 'gallery' | 'music' | 'album' | 'post'

export interface SearchResultCardConfig {
  id: string
  title: string
  subtitle?: string
  description?: string
  link: string
  image?: string
  imagePlaceholder?: string
  tags?: string[]
  meta?: string
  type: SearchResultType
  chunkPreview?: string
  matchSource?: 'keyword' | 'semantic' | 'hybrid'
}

interface SearchResultCardProps {
  config: SearchResultCardConfig
  viewMode: ViewMode
}

const typeIconMap: Record<SearchResultType, React.ReactNode> = {
  wiki: <Book size={24} className="text-brand-gold/40" />,
  gallery: <ImageIcon size={24} className="text-brand-gold/40" />,
  music: <Music size={24} className="text-brand-gold/40" />,
  album: <Music size={24} className="text-brand-gold/40" />,
  post: <MessageSquare size={24} className="text-brand-gold/40" />,
}

const MATCH_SOURCE_LABELS: Record<string, string> = {
  keyword: '关键词',
  semantic: '语义',
  hybrid: '混合',
}

const MATCH_SOURCE_STYLES: Record<string, string> = {
  keyword: 'bg-surface-alt text-text-secondary',
  semantic: 'theme-status-warning',
  hybrid: 'theme-tag',
}

export const SearchResultCard: React.FC<SearchResultCardProps> = React.memo(
  ({ config, viewMode }) => {
    const isList = viewMode === 'list'
    const isSmallGrid = viewMode === 'small'
    const hasMedia = Boolean(config.image || config.imagePlaceholder)
    const fallbackContent = config.imagePlaceholder || typeIconMap[config.type]
    const titleClassName = clsx(
      'min-w-0 max-w-full text-wrap-anywhere font-semibold leading-snug tracking-[0.02em] text-text-primary transition-colors group-hover:text-brand-gold',
      isSmallGrid ? 'text-[0.875rem]' : 'text-[1rem]'
    )
    const tagContent = (
      <>
        {config.tags &&
          config.tags.length > 0 &&
          config.tags.map((tag) => (
            <span
              key={tag}
              className="max-w-full truncate rounded-sm px-2 py-0.5 text-[0.625rem] font-semibold tracking-[0.08em] theme-tag"
            >
              {tag}
            </span>
          ))}
        {config.matchSource && (
          <span
            className={clsx(
              'rounded px-2 py-0.5 text-[0.625rem] font-semibold tracking-[0.08em]',
              MATCH_SOURCE_STYLES[config.matchSource]
            )}
          >
            {MATCH_SOURCE_LABELS[config.matchSource]}
          </span>
        )}
      </>
    )

    return (
      <Link
        to={config.link}
        className={clsx(
          'group min-w-0 max-w-full transition-all duration-300',
          isList
            ? 'flex w-full gap-4 rounded px-3 py-3 hover:bg-[color-mix(in_srgb,var(--color-surface-alt)_50%,transparent)]'
            : 'block overflow-hidden rounded-lg border border-[var(--book-ink-line)]/50 bg-[var(--book-panel-bg)] hover:shadow-[0_14px_36px_rgba(72,53,25,0.1)]'
        )}
      >
        {isList ? (
          <>
            {config.image ? (
              <div className="mobile-list-thumb h-20 w-20 flex-shrink-0 overflow-hidden rounded bg-surface-alt">
                <SmartImage
                  src={config.image}
                  alt=""
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
                />
              </div>
            ) : (
              <div className="mobile-list-thumb flex h-20 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-surface-alt">
                {fallbackContent}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex min-w-0 flex-wrap items-center gap-2">{tagContent}</div>
              <h3 className="truncate text-[0.975rem] font-semibold tracking-[0.04em] text-text-primary transition-colors group-hover:text-brand-gold">
                {config.title}
              </h3>
              {config.chunkPreview && (
                <p className="text-xs theme-text-warning-soft mt-0.5 line-clamp-2 leading-relaxed">
                  {config.chunkPreview}
                </p>
              )}
              {config.description && (
                <p className="line-clamp-2 text-xs leading-relaxed text-text-muted/80">
                  {config.description}
                </p>
              )}
              {config.meta && (
                <p className="mt-1 flex items-center gap-1 text-[0.6875rem] text-text-muted/70">
                  <Clock size={10} />
                  {config.meta}
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            {hasMedia && (
              <div className="aspect-[4/3] overflow-hidden bg-surface-alt">
                {config.image ? (
                  <SmartImage
                    src={config.image}
                    alt=""
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-surface-alt px-2 text-center text-xs text-text-muted">
                    {config.imagePlaceholder}
                  </div>
                )}
              </div>
            )}
            <div className={clsx('p-3', !hasMedia && 'p-4')}>
              <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">{tagContent}</div>
              <h3
                className={clsx(
                  titleClassName,
                  'mb-2 line-clamp-2',
                  isSmallGrid ? 'min-h-[2.25rem]' : 'min-h-[2.55rem]'
                )}
              >
                {config.title}
              </h3>
              {config.chunkPreview && (
                <p className="mb-2 line-clamp-2 text-xs leading-relaxed theme-text-warning-soft">
                  {config.chunkPreview}
                </p>
              )}
              {config.subtitle && (
                <p className="truncate text-xs text-text-muted">{config.subtitle}</p>
              )}
              {config.description && !hasMedia && (
                <p className="mb-3 line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-text-muted/80">
                  {config.description}
                </p>
              )}
              {config.meta && (
                <div className="mt-2 flex items-center gap-1 text-[0.6875rem] text-text-muted">
                  <Clock size={10} />
                  {config.meta}
                </div>
              )}
            </div>
          </>
        )}
      </Link>
    )
  }
)

SearchResultCard.displayName = 'SearchResultCard'
