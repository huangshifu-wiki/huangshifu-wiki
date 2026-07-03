import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Heart } from '@/src/components/icons'
import { clsx } from 'clsx'
import { useI18n } from '../../lib/i18n'
import { formatMusicCredits } from '../../lib/musicCredits'
import { isPlayableSong } from '../../lib/musicPlayback'
import { SmartImage } from '../SmartImage'
import type { SongItem } from '../../types/entities'
import type { ViewMode } from '../../types/userPreferences'

interface SongCardProps {
  song: SongItem
  isCurrentSong: boolean
  isFavoriting: boolean
  sequenceNumber?: number
  viewMode?: ViewMode
  onPlay: (song: SongItem) => void
  onToggleFavorite: (song: SongItem) => void
}

const SongCard = React.memo(function SongCard({
  song,
  isCurrentSong,
  isFavoriting,
  sequenceNumber,
  viewMode = 'list',
  onPlay,
  onToggleFavorite,
}: SongCardProps) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const isList = viewMode === 'list'
  const isSmallGrid = viewMode === 'small'
  const artistsText = formatMusicCredits(song.artists, '未知歌手')
  const canPlay = isPlayableSong(song)
  const albumText = (song.displayAlbum ? song.displayAlbum.title : song.album).trim()
  const releaseDateText = song.releaseDate ? `发行日期：${song.releaseDate}` : null
  const listMetaItems = [artistsText, albumText, releaseDateText].filter(Boolean)

  const handleRowClick = () => {
    navigate(`/music/${song.docId}`)
  }

  const renderFavoriteButton = (compact = false) => (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onToggleFavorite(song)
      }}
      disabled={isFavoriting}
      className={clsx(
        'rounded transition-colors',
        compact ? 'p-1.5' : 'p-2',
        song.favoritedByMe ? 'theme-text-error' : 'text-text-muted hover:text-text-secondary'
      )}
      title={t('music.favorite')}
      aria-label={`${t('music.favorite')} ${song.title}`}
    >
      <Heart size={compact ? 14 : 15} fill={song.favoritedByMe ? 'currentColor' : 'none'} />
    </button>
  )

  const renderCoverPlayButton = (compact = false) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        if (!canPlay) return
        onPlay(song)
      }}
      disabled={!canPlay}
      className={clsx(
        'absolute inset-0 flex items-center justify-center bg-black/35 text-white opacity-0 transition-opacity',
        'hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
        isCurrentSong && 'opacity-100 bg-black/25',
        !canPlay && 'cursor-not-allowed opacity-0 hover:opacity-0 focus-visible:opacity-0'
      )}
      title={canPlay ? t('music.play') : '暂无可播放音源'}
      aria-label={canPlay ? `播放 ${song.title}` : `${song.title} 暂无可播放音源`}
    >
      <span
        className={clsx(
          'flex items-center justify-center rounded-full bg-black/55 backdrop-blur-sm',
          compact ? 'h-8 w-8' : 'h-10 w-10'
        )}
      >
        <Play size={compact ? 16 : 20} fill="currentColor" />
      </span>
    </button>
  )

  if (!isList) {
    return (
      <div
        onClick={handleRowClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleRowClick()
          }
        }}
        className={clsx(
          'gufeng-song-item group cursor-pointer rounded transition-all',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
          isCurrentSong && 'bg-brand-gold/10'
        )}
        role="button"
        tabIndex={0}
        aria-label={`${song.title} - ${artistsText}`}
      >
        <div className="relative aspect-square overflow-hidden bg-surface-alt rounded mb-2.5">
          <SmartImage
            src={song.cover}
            alt={song.title + ' 封面'}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            lazy={false}
          />
          {renderCoverPlayButton(isSmallGrid)}
          {isCurrentSong && (
            <div className="absolute left-2 top-2 rounded bg-[var(--color-theme-accent)] px-2 py-0.5 text-[10px] font-semibold text-white">
              {t('music.playing')}
            </div>
          )}
        </div>

        <div className={clsx(isSmallGrid ? 'space-y-1' : 'space-y-1.5')}>
          <p
            className={clsx(
              'font-semibold truncate tracking-[0.02em] transition-colors',
              isSmallGrid ? 'text-[0.875rem]' : 'text-[0.9375rem]',
              isCurrentSong ? 'text-brand-gold' : 'text-text-primary group-hover:text-brand-gold'
            )}
          >
            {song.title}
          </p>
          <p
            className={clsx(
              'text-text-muted truncate',
              isSmallGrid ? 'text-[0.6875rem]' : 'text-xs'
            )}
          >
            {artistsText}
          </p>
          {!isSmallGrid && albumText && (
            <p className="text-xs text-text-muted/80 truncate">{albumText}</p>
          )}
          {releaseDateText && (
            <p
              className={clsx(
                'text-text-muted/80 truncate',
                isSmallGrid ? 'text-[0.6875rem]' : 'text-xs'
              )}
            >
              {isSmallGrid ? `发行：${song.releaseDate}` : releaseDateText}
            </p>
          )}
        </div>

        <div className="mt-2 flex min-h-8 items-center justify-between gap-2">
          {renderFavoriteButton(isSmallGrid)}
        </div>
      </div>
    )
  }

  return (
    <div
      onClick={handleRowClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleRowClick()
        }
      }}
      className={clsx(
        'gufeng-song-item group flex items-center gap-4 py-4 px-1 border-b border-border transition-all cursor-pointer',
        isCurrentSong && 'bg-brand-gold/10'
      )}
      role="button"
      tabIndex={0}
      aria-label={`${song.title} - ${artistsText}`}
    >
      {sequenceNumber !== undefined ? (
        <span
          className="w-9 flex-shrink-0 text-right text-sm tabular-nums text-text-muted"
          aria-hidden="true"
        >
          {sequenceNumber}
        </span>
      ) : null}

      {/* Cover */}
      <div className="relative w-14 h-14 flex-shrink-0 overflow-hidden rounded">
        <SmartImage
          src={song.cover}
          alt={song.title + ' 封面'}
          className="w-full h-full object-cover rounded"
          lazy={false}
        />
        {renderCoverPlayButton(true)}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 pointer-events-none">
        <p
          className={clsx(
            'block text-[1.0625rem] font-semibold truncate tracking-[0.03em] transition-colors',
            isCurrentSong ? 'text-brand-gold' : 'text-text-primary group-hover:text-brand-gold'
          )}
        >
          {song.title}
        </p>
        <p className="text-[0.8125rem] text-text-muted truncate mt-0.5 flex items-center gap-2 flex-wrap">
          {listMetaItems.map((item, index) => (
            <React.Fragment key={`${index}-${item}`}>
              {index > 0 && (
                <span className="w-[3px] h-[3px] bg-border rounded-full inline-block" />
              )}
              <span>{item}</span>
            </React.Fragment>
          ))}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <div className="hidden md:flex items-center gap-0.5">{renderFavoriteButton()}</div>
        <div className="flex md:hidden items-center gap-0.5">{renderFavoriteButton()}</div>
      </div>
    </div>
  )
})

export { SongCard }
export type { SongCardProps }
