import React from 'react'
import { Link } from 'react-router-dom'
import { List, ChevronRight } from '@/src/components/icons'
import { clsx } from 'clsx'
import { useI18n } from '../../lib/i18n'
import { SmartImage } from '../SmartImage'
import type { AlbumItem } from '../../types/entities'

interface AlbumCardProps {
  album: AlbumItem
  viewMode?: 'grid' | 'list'
}

const AlbumCard = React.memo(function AlbumCard({ album, viewMode = 'grid' }: AlbumCardProps) {
  const { t } = useI18n()
  const albumSlug = album.slug || album.docId || ''
  const trackCount = album.trackCount ?? album.tracks?.length ?? 0
  const coverSrc = album.coverThumbnail || album.cover

  if (viewMode === 'list') {
    return (
      <div className="group flex items-center gap-3 border-y border-[var(--book-ink-line)] px-1 py-3 transition-all hover:bg-surface-alt sm:gap-4 sm:py-4">
        <div className="relative h-12 w-12 flex-shrink-0 sm:h-14 sm:w-14">
          <SmartImage
            src={coverSrc}
            alt={album.title}
            className="w-full h-full object-cover rounded"
          />
        </div>
        <div className="flex-1 min-w-0">
          <Link
            to={`/album/${albumSlug}`}
            className="block text-[1.0625rem] font-semibold truncate text-text-primary group-hover:text-brand-gold transition-colors"
          >
            {album.title}
          </Link>
          <p className="text-[0.8125rem] text-text-muted truncate mt-0.5">{album.artist}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2 sm:gap-3">
          <span className="hidden text-xs text-text-muted sm:inline">
            {trackCount} {t('music.unit.song')}
          </span>
          <Link
            to={`/album/${albumSlug}`}
            className="text-brand-gold hover:text-brand-gold/80 transition-colors"
          >
            <ChevronRight size={16} />
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="group transition-all">
      <Link to={`/album/${albumSlug}`} className="block">
        <div className="relative aspect-square overflow-hidden bg-surface-alt rounded mb-2.5">
          <SmartImage
            src={coverSrc}
            alt={album.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
          {trackCount > 0 && (
            <div className="absolute top-2 right-2 bg-black/45 text-white text-xs px-2 py-0.5 rounded flex items-center gap-1">
              <List size={12} /> {trackCount}
            </div>
          )}
        </div>
        <h3 className="text-[0.9375rem] font-semibold text-text-primary truncate mb-0.5 tracking-[0.02em] group-hover:text-brand-gold transition-colors">
          {album.title}
        </h3>
        <p className="text-xs text-text-muted truncate">{album.artist}</p>
      </Link>

      <div className="mt-2 flex items-center">
        <Link
          to={`/album/${albumSlug}`}
          className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-brand-gold transition-colors"
        >
          {t('music.viewAlbum')} <ChevronRight size={14} />
        </Link>
      </div>
    </div>
  )
})

export { AlbumCard }
export type { AlbumCardProps }
