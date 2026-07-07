import React from 'react'
import { Link } from 'react-router-dom'
import { clsx } from 'clsx'
import { Image as ImageIcon, Book, MessageSquare, Sparkles, Clock } from '@/src/components/icons'
import { SmartImage } from './SmartImage'
import type { MixedSearchResult, ImageSourceType } from '../hooks/useSearch'
import type { GalleryItem, WikiItem, PostItem } from '../types/entities'
import { formatDate } from '../lib/dateUtils'
import { getFirstGalleryImage, shouldWaitForGalleryThumbnail } from '../lib/galleryThumbnails'
import type { ViewMode } from '../types/userPreferences'

interface MixedSearchResultCardProps {
  result: MixedSearchResult
  viewMode: ViewMode
  showSimilarity?: boolean
}

function getSourceTypeLabel(sourceType: ImageSourceType): string {
  switch (sourceType) {
    case 'gallery':
      return '图库'
    case 'wiki':
      return '百科'
    case 'post':
      return '帖子'
    default:
      return '其他'
  }
}

function getSourceTypeIcon(sourceType: ImageSourceType) {
  switch (sourceType) {
    case 'gallery':
      return ImageIcon
    case 'wiki':
      return Book
    case 'post':
      return MessageSquare
    default:
      return Sparkles
  }
}

function getResultLink(result: MixedSearchResult): string {
  switch (result.sourceType) {
    case 'gallery':
      return `/gallery/${(result.data as GalleryItem | undefined)?.slug || result.sourceId}`
    case 'wiki':
      return `/wiki/${result.sourceId}`
    case 'post':
      return `/forum/${(result.data as PostItem | undefined)?.slug || result.sourceId}`
    default:
      return '#'
  }
}

function formatSimilarity(similarity: number): string {
  return `${(similarity * 100).toFixed(1)}%`
}

export const MixedSearchResultCard = React.memo(
  ({ result, viewMode, showSimilarity = true }: MixedSearchResultCardProps) => {
    const { sourceType, data, imageUrl, similarity } = result
    const SourceIcon = getSourceTypeIcon(sourceType)
    const link = getResultLink(result)
    const gallery = sourceType === 'gallery' ? (data as GalleryItem) : undefined
    const galleryImage = gallery ? getFirstGalleryImage(gallery) : undefined
    const galleryThumb = galleryImage?.thumbnailUrl || ''
    const thumbnailPending = gallery ? shouldWaitForGalleryThumbnail(gallery) : false
    const displayImageUrl = sourceType === 'gallery' ? galleryThumb : imageUrl
    const isSmallGrid = viewMode === 'small'
    const imageContent = displayImageUrl ? (
      <SmartImage
        src={displayImageUrl}
        alt=""
        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
      />
    ) : thumbnailPending ? (
      <div className="flex h-full w-full items-center justify-center bg-surface-alt px-2 text-center text-xs text-text-muted">
        生成中...
      </div>
    ) : (
      <div className="flex h-full w-full items-center justify-center bg-surface-alt">
        <SourceIcon size={20} className="text-brand-gold/40" />
      </div>
    )

    if (viewMode === 'list') {
      return (
        <Link
          to={link}
          className="group flex w-full gap-4 rounded px-3 py-3 transition-all duration-300 hover:bg-[color-mix(in_srgb,var(--color-surface-alt)_50%,transparent)]"
        >
          <div className="mobile-list-thumb h-20 w-20 flex-shrink-0 overflow-hidden rounded bg-surface-alt">
            {imageContent}
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-sm px-2 py-0.5 text-[0.625rem] font-semibold tracking-[0.08em] theme-tag">
                <SourceIcon size={10} className="inline mr-0.5" />
                {getSourceTypeLabel(sourceType)}
              </span>
              {showSimilarity && (
                <span className="rounded-sm px-2 py-0.5 text-[0.625rem] font-semibold tracking-[0.08em] theme-tag">
                  {formatSimilarity(similarity)}
                </span>
              )}
            </div>
            <h3 className="truncate text-[0.975rem] font-semibold tracking-[0.04em] text-text-primary transition-colors group-hover:text-brand-gold">
              {(data as GalleryItem | WikiItem | PostItem).title}
            </h3>
            <p className="mt-0.5 line-clamp-1 text-xs text-text-muted">
              {sourceType === 'gallery' && (data as GalleryItem).description}
              {sourceType === 'wiki' && (data as WikiItem).category}
              {sourceType === 'post' && (data as PostItem).section}
            </p>
            <p className="mt-1 flex items-center gap-1 text-[0.6875rem] text-text-muted">
              <Clock size={10} />
              {formatDate((data as GalleryItem | WikiItem | PostItem).updatedAt, 'yyyy-MM-dd')}
            </p>
          </div>
        </Link>
      )
    }

    return (
      <Link
        to={link}
        className="group block min-w-0 overflow-hidden rounded-lg border border-[var(--book-ink-line)]/50 bg-[var(--book-panel-bg)] transition-all duration-300 hover:shadow-[0_14px_36px_rgba(72,53,25,0.1)]"
      >
        <div className="relative aspect-[4/3] flex-shrink-0 overflow-hidden bg-surface-alt">
          {displayImageUrl ? (
            <SmartImage
              src={displayImageUrl}
              alt=""
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
            />
          ) : thumbnailPending ? (
            <div className="flex h-full w-full items-center justify-center bg-surface-alt px-2 text-center text-xs text-text-muted">
              生成中...
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-surface-alt">
              <SourceIcon size={24} className="text-brand-gold/40" />
            </div>
          )}
          <div className="absolute top-2 left-2">
            <span className="rounded bg-[var(--book-panel-bg-strong)] px-2 py-0.5 text-[10px] font-medium text-brand-gold">
              <SourceIcon size={10} className="inline mr-0.5" />
              {getSourceTypeLabel(sourceType)}
            </span>
          </div>
          {showSimilarity && (
            <div className="absolute top-2 right-2">
              <span className="rounded bg-[var(--book-panel-bg-strong)] px-2 py-0.5 text-[10px] font-medium text-brand-gold">
                {formatSimilarity(similarity)}
              </span>
            </div>
          )}
        </div>
        <div className="p-3">
          <h3
            className={clsx(
              'mb-2 line-clamp-2 min-w-0 max-w-full text-wrap-anywhere font-semibold leading-snug tracking-[0.02em] text-text-primary transition-colors group-hover:text-brand-gold',
              isSmallGrid ? 'min-h-[2.25rem] text-[0.875rem]' : 'min-h-[2.55rem] text-[1rem]'
            )}
          >
            {(data as GalleryItem | WikiItem | PostItem).title}
          </h3>
          <p className="mt-1 line-clamp-1 text-xs text-text-muted">
            {sourceType === 'gallery' && ((data as GalleryItem).description || '暂无描述')}
            {sourceType === 'wiki' && (data as WikiItem).category}
            {sourceType === 'post' && (data as PostItem).section}
          </p>
          <div className="mt-2 flex items-center text-[0.6875rem] text-text-muted">
            <Clock size={10} className="mr-1" />
            {formatDate((data as GalleryItem | WikiItem | PostItem).updatedAt, 'yyyy-MM-dd')}
          </div>
        </div>
      </Link>
    )
  }
)

MixedSearchResultCard.displayName = 'MixedSearchResultCard'

export default MixedSearchResultCard
