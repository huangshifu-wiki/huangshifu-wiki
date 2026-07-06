import React from 'react'
import { Link } from 'react-router-dom'
import { List, ChevronRight } from '@/src/components/icons'
import { useI18n } from '../../lib/i18n'
import { SmartImage } from '../SmartImage'
import type { AlbumItem } from '../../types/entities'

interface AlbumCardProps {
  album: AlbumItem
  viewMode?: 'grid' | 'list'
}

const COVER_FILTER = 'brightness(0.96) saturate(0.92)'

const AlbumCard = React.memo(function AlbumCard({ album, viewMode = 'grid' }: AlbumCardProps) {
  const { t } = useI18n()
  const albumSlug = album.slug || album.docId || ''
  const trackCount = album.trackCount ?? album.tracks?.length ?? 0
  const coverSrc = album.coverThumbnail || album.cover

  if (viewMode === 'list') {
    return (
      <div className="group flex cursor-pointer items-center gap-4 rounded px-2 py-3 transition-all duration-300 hover:bg-[color-mix(in_srgb,var(--color-surface-alt)_50%,transparent)]">
        <div className="relative h-[100px] w-[100px] flex-shrink-0 overflow-hidden rounded shadow-[0_4px_20px_rgba(42,37,32,0.06)] transition-shadow duration-300 group-hover:shadow-[0_12px_48px_rgba(42,37,32,0.08)]">
          <SmartImage
            src={coverSrc}
            alt={album.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
            style={{ filter: COVER_FILTER }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <Link
            to={`/album/${albumSlug}`}
            className="block truncate text-[0.975rem] font-semibold tracking-[0.04em] text-text-primary transition-colors group-hover:text-brand-gold"
          >
            {album.title}
          </Link>
          <p className="mt-0.5 truncate text-[0.8125rem] text-text-muted">{album.artist}</p>
          {album.description && (
            <p className="mt-1 line-clamp-2 text-[0.75rem] leading-relaxed text-text-muted/70">
              {album.description}
            </p>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-3">
          <span className="hidden text-[0.75rem] text-text-muted/60 sm:inline">
            {trackCount} {t('music.unit.song')}
          </span>
          <Link
            to={`/album/${albumSlug}`}
            className="text-brand-gold/70 transition-colors hover:text-brand-gold"
          >
            <ChevronRight size={16} />
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="group">
      <Link to={`/album/${albumSlug}`} className="block">
        <div className="relative aspect-square overflow-hidden rounded-lg bg-surface-alt shadow-[0_4px_20px_rgba(42,37,32,0.06)] transition-shadow duration-300 group-hover:shadow-[0_12px_48px_rgba(42,37,32,0.08)]">
          <SmartImage
            src={coverSrc}
            alt={album.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
            style={{ filter: COVER_FILTER }}
          />
          {trackCount > 0 && (
            <div className="absolute right-2 top-2 flex items-center gap-1 rounded bg-black/40 px-2 py-0.5 text-xs text-white backdrop-blur-sm">
              <List size={12} /> {trackCount}
            </div>
          )}
        </div>
        <h3 className="mt-2.5 truncate text-[0.9375rem] font-semibold tracking-[0.02em] text-text-primary transition-colors group-hover:text-brand-gold">
          {album.title}
        </h3>
        <p className="mt-0.5 truncate text-[0.78rem] text-text-muted">{album.artist}</p>
      </Link>
      <div className="mt-2">
        <Link
          to={`/album/${albumSlug}`}
          className="inline-flex items-center gap-1 text-[0.75rem] tracking-[0.04em] text-text-muted transition-colors hover:text-brand-gold"
        >
          {t('music.viewAlbum')} <ChevronRight size={13} />
        </Link>
      </div>
    </div>
  )
})

export { AlbumCard }
export type { AlbumCardProps }
