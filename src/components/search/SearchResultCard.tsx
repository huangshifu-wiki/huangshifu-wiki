import React from 'react'
import { Link } from 'react-router-dom'
import { clsx } from 'clsx'
import { Book, Image as ImageIcon, Music, MessageSquare, Clock } from '@/src/components/icons'
import { SmartImage } from '../SmartImage'
import { CARD } from '../../styles/cardStyles'

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
  viewMode: string
  cardHeight?: string
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
  ({ config, viewMode, cardHeight }) => {
    const isList = viewMode === 'list'
    const fallbackContent = config.imagePlaceholder || typeIconMap[config.type]

    return (
      <Link
        to={config.link}
        className={clsx(
          CARD.base,
          isList
            ? clsx(CARD.listLayout, 'mobile-list-card')
            : clsx(CARD.gridLayout, 'block', cardHeight)
        )}
      >
        {isList ? (
          <>
            {config.image ? (
              <div className={clsx(CARD.imageWrapperList, 'mobile-list-thumb')}>
                <SmartImage src={config.image} alt="" className={CARD.imageFill} />
              </div>
            ) : (
              <div
                className={clsx(
                  CARD.imageWrapperList,
                  'mobile-list-thumb flex items-center justify-center'
                )}
              >
                {fallbackContent}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {config.tags &&
                  config.tags.length > 0 &&
                  config.tags.map((tag) => (
                    <span key={tag} className={CARD.tag}>
                      {tag}
                    </span>
                  ))}
                {config.matchSource && (
                  <span
                    className={clsx(
                      'px-1.5 py-0.5 rounded text-[10px] font-medium',
                      MATCH_SOURCE_STYLES[config.matchSource]
                    )}
                  >
                    {MATCH_SOURCE_LABELS[config.matchSource]}
                  </span>
                )}
              </div>
              <h3 className={CARD.title}>{config.title}</h3>
              {config.chunkPreview && (
                <p className="text-xs theme-text-warning-soft mt-0.5 line-clamp-2 leading-relaxed">
                  {config.chunkPreview}
                </p>
              )}
              {config.description && (
                <p className={clsx(CARD.descMuted, 'italic')}>{config.description}</p>
              )}
              {config.meta && (
                <p className="text-text-muted/70 text-[10px] mt-1 flex items-center gap-1">
                  <Clock size={10} />
                  {config.meta}
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            {(config.image || config.imagePlaceholder) && (
              <div className="overflow-hidden h-48 flex-shrink-0">
                {config.image ? (
                  <SmartImage
                    src={config.image}
                    alt=""
                    className={clsx(CARD.imageFill, CARD.imageHoverZoom)}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-surface-alt px-2 text-center text-xs text-text-muted">
                    {config.imagePlaceholder}
                  </div>
                )}
              </div>
            )}
            <div
              className={clsx(
                'p-4',
                !config.image && !config.imagePlaceholder && 'flex-1 flex flex-col'
              )}
            >
              <div className="flex items-center gap-2 mb-2">
                {config.tags &&
                  config.tags.length > 0 &&
                  config.tags.map((tag) => (
                    <span key={tag} className={CARD.tag}>
                      {tag}
                    </span>
                  ))}
                {config.matchSource && (
                  <span
                    className={clsx(
                      'px-1.5 py-0.5 rounded text-[10px] font-medium',
                      MATCH_SOURCE_STYLES[config.matchSource]
                    )}
                  >
                    {MATCH_SOURCE_LABELS[config.matchSource]}
                  </span>
                )}
              </div>
              <h3 className={clsx(CARD.title, 'mb-2')}>{config.title}</h3>
              {config.chunkPreview && (
                <p className="text-xs theme-text-warning-soft mb-2 line-clamp-2 leading-relaxed">
                  {config.chunkPreview}
                </p>
              )}
              {config.subtitle && (
                <p className="text-xs text-text-muted truncate">{config.subtitle}</p>
              )}
              {config.description && !config.image && (
                <p className={clsx(CARD.descMuted, 'mb-3 italic flex-1')}>{config.description}</p>
              )}
              {config.meta && (
                <div className="flex items-center gap-1 text-[10px] text-text-muted mt-auto">
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
