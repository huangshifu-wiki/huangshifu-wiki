import React from 'react'
import { Link } from 'react-router-dom'
import { List, ChevronRight, Link2 } from '@/src/components/icons'
import { clsx } from 'clsx'
import { useI18n } from '../../lib/i18n'
import { SmartImage } from '../SmartImage'
import type { AlbumItem } from '../../types/entities'

interface AlbumCardProps {
  album: AlbumItem
  viewMode?: 'grid' | 'list'
  onCopyLink: (event: React.MouseEvent<HTMLButtonElement>, albumId: string) => void
}

const AlbumCard = React.memo(function AlbumCard({
  album,
  viewMode = 'grid',
  onCopyLink,
}: AlbumCardProps) {
  const { t } = useI18n()
  const albumId = album.docId || ''
  const trackCount = album.trackCount ?? album.tracks?.length ?? 0

  if (viewMode === 'list') {
    return (
      <div className="flex gap-4 py-4 px-1 border-b border-border items-center group transition-all hover:bg-surface-alt">
        <div className="relative w-14 h-14 flex-shrink-0">
          <SmartImage
            src={album.cover}
            alt={album.title}
            className="w-full h-full object-cover rounded"
          />
        </div>
        <div className="flex-1 min-w-0">
          <Link
            to={`/album/${albumId}`}
            className="block text-[1.0625rem] font-semibold truncate text-text-primary group-hover:text-brand-gold transition-colors"
          >
            {album.title}
          </Link>
          <p className="text-[0.8125rem] text-text-muted truncate mt-0.5">{album.artist}</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-xs text-text-muted">
            {trackCount} {t('music.unit.song')}
          </span>
          <Link
            to={`/album/${albumId}`}
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
      <Link to={`/album/${albumId}`} className="block">
        <div className="relative aspect-square overflow-hidden bg-surface-alt rounded mb-2.5">
          <SmartImage
            src={album.cover}
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

      <div className="mt-2 flex items-center justify-between">
        <Link
          to={`/album/${albumId}`}
          className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-brand-gold transition-colors"
        >
          {t('music.viewAlbum')} <ChevronRight size={14} />
        </Link>
        <button
          onClick={(event) => onCopyLink(event, albumId)}
          className="p-1.5 text-text-muted hover:text-brand-gold transition-colors"
          title={t('music.copyAlbumLink')}
        >
          <Link2 size={14} />
        </button>
      </div>
    </div>
  )
})

export { AlbumCard }
export type { AlbumCardProps }
