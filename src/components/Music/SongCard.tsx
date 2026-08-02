import React from 'react'
import { Link } from 'react-router-dom'
import { Music, Play, Heart } from '@/src/components/icons'
import { clsx } from 'clsx'
import { useI18n } from '../../lib/i18n'
import { formatMusicCredits } from '../../lib/musicCredits'
import { isPlayableSong } from '../../lib/musicPlayback'
import { SmartImage } from '../SmartImage'
import { CoverPlaceholder } from '../CoverPlaceholder'
import type { SongItem } from '../../types/entities'
import type { ViewMode } from '../../types/userPreferences'

interface SongCardProps {
  song: SongItem
  isCurrentSong: boolean
  isFavoriting: boolean
  sequenceNumber?: number
  showSequenceOnMobile?: boolean
  viewMode?: ViewMode
  onPlay: (song: SongItem) => void
  onToggleFavorite: (song: SongItem) => void
}

const COVER_FILTER = 'brightness(0.96) saturate(0.92)'

const SongCard = React.memo(function SongCard({
  song,
  isCurrentSong,
  isFavoriting,
  sequenceNumber,
  showSequenceOnMobile = false,
  viewMode = 'list',
  onPlay,
  onToggleFavorite,
}: SongCardProps) {
  const { t } = useI18n()
  const isList = viewMode === 'list'
  const isSmallGrid = viewMode === 'small'
  const artistsText = formatMusicCredits(song.artists, '未知歌手')
  const canPlay = isPlayableSong(song)
  const albumText = (song.displayAlbum ? song.displayAlbum.title : song.album).trim()
  const releaseDateText = song.releaseDate || null
  const coverSrc = song.coverThumbnail || song.cover
  const metaItems = [artistsText, albumText, releaseDateText].filter(Boolean)

  const handlePlayClick = (e: React.MouseEvent) => {
    // 必须 preventDefault：Link 的 preventDefault 在自身 onClick 里，仅
    // stopPropagation 会把它拦掉，导致 <a href> 原生默认导航整页跳转
    e.preventDefault()
    e.stopPropagation()
    if (!canPlay) return
    onPlay(song)
  }

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onToggleFavorite(song)
  }

  if (isList) {
    return (
      <Link
        to={`/music/${song.slug || song.docId}`}
        className={clsx(
          'group flex cursor-pointer items-center gap-2 rounded px-3 py-2.5 sm:gap-3.5',
          'transition-all duration-300',
          isCurrentSong
            ? 'bg-[color-mix(in_srgb,var(--color-theme-accent)_8%,transparent)]'
            : 'hover:bg-[color-mix(in_srgb,var(--color-surface-alt)_50%,transparent)]'
        )}
        aria-label={`${song.title} - ${artistsText}`}
      >
        {sequenceNumber !== undefined && (
          <span
            className={clsx(
              'w-5 flex-shrink-0 text-right text-[0.8125rem] tabular-nums text-text-muted/50 sm:w-8',
              showSequenceOnMobile ? 'inline-block' : 'hidden sm:inline-block'
            )}
            aria-hidden="true"
          >
            {sequenceNumber}
          </span>
        )}

        <div className="relative h-[52px] w-[52px] flex-shrink-0 overflow-hidden rounded shadow-[0_1px_4px_rgba(42,37,32,0.08)]">
          <SmartImage
            src={coverSrc}
            alt={song.title + ' 封面'}
            className="h-full w-full object-cover"
            style={{ filter: COVER_FILTER }}
            lazy={false}
            fallback={<CoverPlaceholder icon={<Music size={18} />} label="无封面" />}
          />
        </div>

        <div className="pointer-events-none min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5">
            <span
              className={clsx(
                'min-w-0 truncate text-[0.9375rem] font-semibold tracking-[0.03em] transition-colors sm:text-[0.975rem]',
                isCurrentSong ? 'text-brand-gold' : 'text-text-primary group-hover:text-brand-gold'
              )}
            >
              {song.title}
            </span>
            {(song.tags?.length ?? 0) > 0 && (
              <span className="flex flex-shrink-0 items-center gap-1">
                {song.tags!.map((tag) => (
                  <span
                    key={tag}
                    className="whitespace-nowrap rounded-[3px] border border-border/60 px-1 py-px text-[0.625rem] font-normal leading-tight text-text-muted/80"
                  >
                    {tag}
                  </span>
                ))}
              </span>
            )}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 truncate text-[0.78rem] text-text-muted">
            {metaItems.map((item, index) => (
              <React.Fragment key={`${index}-${item}`}>
                {index > 0 && <span className="text-text-muted/40">·</span>}
                <span>{item}</span>
              </React.Fragment>
            ))}
          </p>
        </div>

        <div className="pointer-events-auto flex flex-shrink-0 items-center gap-1.5">
          <button
            onClick={handleFavoriteClick}
            disabled={isFavoriting}
            className={clsx(
              'rounded-full p-1.5 transition-colors',
              song.favoritedByMe
                ? 'text-[var(--color-error)]'
                : 'text-text-muted/40 hover:text-text-muted'
            )}
            title={t('music.favorite')}
            aria-label={`${t('music.favorite')} ${song.title}`}
          >
            <Heart size={15} fill={song.favoritedByMe ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            onClick={handlePlayClick}
            disabled={!canPlay}
            className={clsx(
              'flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full border',
              'transition-all duration-300',
              isCurrentSong
                ? 'border-brand-gold bg-brand-gold text-white shadow-[0_0_14px_rgba(138,109,47,0.2)]'
                : canPlay
                  ? 'border-[rgba(138,109,47,0.25)] bg-transparent text-brand-gold hover:border-brand-gold hover:bg-brand-gold hover:text-white hover:shadow-[0_0_18px_rgba(138,109,47,0.15)]'
                  : 'cursor-not-allowed border-border/50 bg-transparent text-text-muted/30'
            )}
            title={canPlay ? t('music.play') : '暂无可播放音源'}
            aria-label={canPlay ? `播放 ${song.title}` : `${song.title} 暂无可播放音源`}
          >
            <Play size={13} fill="currentColor" className="ml-0.5" />
          </button>
        </div>
      </Link>
    )
  }

  return (
    <Link
      to={`/music/${song.slug || song.docId}`}
      className={clsx(
        'group cursor-pointer overflow-hidden rounded-lg',
        'border border-[var(--book-ink-line)]/50 bg-[var(--book-panel-bg)]',
        'transition-all duration-300',
        'hover:shadow-[0_14px_36px_rgba(72,53,25,0.1)]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
        isCurrentSong && 'border-brand-gold/30'
      )}
      aria-label={`${song.title} - ${artistsText}`}
    >
      <div className="relative aspect-square overflow-hidden bg-surface-alt">
        <SmartImage
          src={coverSrc}
          alt={song.title + ' 封面'}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
          style={{ filter: COVER_FILTER }}
          lazy={false}
          fallback={<CoverPlaceholder icon={<Music size={18} />} label="无封面" />}
        />
        <button
          type="button"
          onClick={handlePlayClick}
          disabled={!canPlay}
          className={clsx(
            'absolute inset-0 flex items-center justify-center',
            'bg-black/25 opacity-0 transition-opacity duration-300',
            'group-hover:opacity-100 focus-visible:opacity-100',
            isCurrentSong && 'bg-black/15 opacity-100',
            !canPlay && 'cursor-not-allowed'
          )}
          aria-label={canPlay ? `播放 ${song.title}` : `${song.title} 暂无可播放音源`}
        >
          {canPlay && (
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white shadow-lg backdrop-blur-sm">
              <Play size={20} fill="currentColor" />
            </span>
          )}
        </button>
        {isCurrentSong && (
          <div className="absolute left-2 top-2 rounded bg-brand-gold px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
            {t('music.playing')}
          </div>
        )}
      </div>

      <div className={clsx(isSmallGrid ? 'p-2.5' : 'p-3')}>
        <p className="flex min-w-0 items-center gap-1.5">
          <span
            className={clsx(
              'min-w-0 truncate font-semibold tracking-[0.02em] transition-colors',
              isSmallGrid ? 'text-[0.8125rem]' : 'text-[0.9rem]',
              isCurrentSong ? 'text-brand-gold' : 'text-text-primary group-hover:text-brand-gold'
            )}
          >
            {song.title}
          </span>
          {!isSmallGrid && (song.tags?.length ?? 0) > 0 && (
            <span className="flex flex-shrink-0 items-center gap-1">
              {song.tags!.map((tag) => (
                <span
                  key={tag}
                  className="whitespace-nowrap rounded-[3px] border border-border/60 px-1 py-px text-[0.625rem] font-normal leading-tight text-text-muted/80"
                >
                  {tag}
                </span>
              ))}
            </span>
          )}
        </p>
        <p
          className={clsx(
            'mt-0.5 truncate text-text-muted',
            isSmallGrid ? 'text-[0.6875rem]' : 'text-[0.78rem]'
          )}
        >
          {artistsText}
        </p>
        {!isSmallGrid && albumText && (
          <p className="mt-0.5 truncate text-[0.72rem] text-text-muted/70">{albumText}</p>
        )}
        {!isSmallGrid && releaseDateText && (
          <p className="mt-0.5 truncate text-[0.72rem] text-text-muted/60">{releaseDateText}</p>
        )}
      </div>

      <div className={clsx('flex items-center', isSmallGrid ? 'px-2.5 pb-2' : 'px-3 pb-2.5')}>
        <button
          onClick={handleFavoriteClick}
          disabled={isFavoriting}
          className={clsx(
            'rounded-full p-1.5 transition-colors',
            song.favoritedByMe
              ? 'text-[var(--color-error)]'
              : 'text-text-muted/40 hover:text-text-muted'
          )}
          title={t('music.favorite')}
          aria-label={`${t('music.favorite')} ${song.title}`}
        >
          <Heart size={isSmallGrid ? 13 : 14} fill={song.favoritedByMe ? 'currentColor' : 'none'} />
        </button>
      </div>
    </Link>
  )
})

export { SongCard }
export type { SongCardProps }
