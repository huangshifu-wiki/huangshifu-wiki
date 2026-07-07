import React from 'react'
import { Link } from 'react-router-dom'
import { Clock, User as UserIcon } from '@/src/components/icons'
import { clsx } from 'clsx'
import { getStatusClassName, getStatusText } from '../../lib/contentUtils'
import { formatDate } from '../../lib/dateUtils'
import { VIEW_MODE_CONFIG } from '../../lib/viewModes'
import type { GalleryItem } from '../../types/entities'
import type { ViewMode } from '../../types/userPreferences'
import { GalleryCover } from './GalleryCover'

interface GalleryCardProps {
  gallery: GalleryItem
  viewMode: ViewMode
  priority?: boolean
}

const getAuthorName = (gallery: GalleryItem) =>
  gallery.authorName || (gallery.authorPublicId ? `#${gallery.authorPublicId}` : '匿名')

const GalleryStatusBadge = ({ gallery }: { gallery: GalleryItem }) =>
  gallery.status && gallery.status !== 'published' ? (
    <span
      className={clsx(
        'inline-flex shrink-0 rounded px-2 py-0.5 text-[0.6875rem] font-medium',
        getStatusClassName(gallery.status)
      )}
    >
      {getStatusText(gallery.status)}
    </span>
  ) : null

const GalleryMeta = ({ gallery, compact = false }: { gallery: GalleryItem; compact?: boolean }) => (
  <div
    className={clsx(
      'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-text-muted',
      compact ? 'text-[0.6875rem]' : 'text-[0.75rem]'
    )}
  >
    <span className="inline-flex min-w-0 items-center gap-1">
      <Clock size={compact ? 10 : 11} aria-hidden="true" />
      <span className="truncate">{formatDate(gallery.createdAt, 'yyyy-MM-dd')}</span>
    </span>
    <span className="inline-flex min-w-0 items-center gap-1">
      <UserIcon size={compact ? 10 : 11} aria-hidden="true" />
      <span className="truncate">{getAuthorName(gallery)}</span>
    </span>
  </div>
)

export const GalleryCard = React.memo(function GalleryCard({
  gallery,
  viewMode,
  priority = false,
}: GalleryCardProps) {
  const imageCount = Array.isArray(gallery.images) ? gallery.images.length : 0
  const galleryUrl = `/gallery/${gallery.slug || gallery.id}`

  if (viewMode === 'list') {
    return (
      <Link
        to={galleryUrl}
        className={clsx(
          'group flex min-w-0 items-center gap-4 rounded px-2 py-3',
          'transition-all duration-300 hover:bg-[color-mix(in_srgb,var(--color-surface-alt)_50%,transparent)]'
        )}
      >
        <div className="relative h-[96px] w-[96px] shrink-0 overflow-hidden rounded bg-surface-alt shadow-[0_4px_20px_rgba(42,37,32,0.06)] transition-shadow duration-300 group-hover:shadow-[0_12px_38px_rgba(42,37,32,0.08)]">
          <GalleryCover
            gallery={gallery}
            priority={priority}
            imageClassName="transition-transform duration-500 group-hover:scale-[1.06]"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex min-w-0 items-center gap-2">
            <h3 className="truncate text-[0.975rem] font-semibold tracking-[0.04em] text-text-primary transition-colors group-hover:text-brand-gold">
              {gallery.title}
            </h3>
            <span className="shrink-0 rounded bg-surface-alt px-1.5 py-0.5 text-[0.6875rem] text-text-muted">
              {imageCount} 张
            </span>
            <GalleryStatusBadge gallery={gallery} />
          </div>
          <p className="line-clamp-2 text-[0.8125rem] leading-relaxed text-text-muted/80">
            {gallery.description || '暂无描述'}
          </p>
          <div className="mt-2">
            <GalleryMeta gallery={gallery} />
          </div>
        </div>
      </Link>
    )
  }

  const isSmallGrid = viewMode === 'small'

  return (
    <Link to={galleryUrl} className="group block min-w-0">
      <div
        className={clsx(
          'relative overflow-hidden rounded bg-surface-alt shadow-[0_4px_20px_rgba(42,37,32,0.06)]',
          'transition-shadow duration-300 group-hover:shadow-[0_12px_48px_rgba(42,37,32,0.09)]',
          VIEW_MODE_CONFIG[viewMode].cardHeight
        )}
      >
        <GalleryCover
          gallery={gallery}
          priority={priority}
          imageClassName="transition-transform duration-500 group-hover:scale-[1.06]"
        />
        <div className="absolute left-2 top-2">
          <GalleryStatusBadge gallery={gallery} />
        </div>
      </div>
      <div className={clsx(isSmallGrid ? 'pt-2' : 'pt-2.5')}>
        <h3
          className={clsx(
            'truncate font-semibold tracking-[0.02em] text-text-primary transition-colors group-hover:text-brand-gold',
            isSmallGrid ? 'text-[0.8125rem]' : 'text-[0.9375rem]'
          )}
        >
          {gallery.title}
        </h3>
        {!isSmallGrid && gallery.tags?.length ? (
          <div className="mt-1 flex min-w-0 flex-wrap gap-1">
            {gallery.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="max-w-full truncate rounded bg-surface-alt px-1.5 py-0.5 text-[0.6875rem] text-brand-gold"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-1.5">
          <GalleryMeta gallery={gallery} compact={isSmallGrid} />
        </div>
      </div>
    </Link>
  )
})
