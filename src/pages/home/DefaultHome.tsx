import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Disc3, Image as ImageIcon, Music, Play } from '@/src/components/icons'
import { clsx } from 'clsx'
import { SmartImage } from '../../components/SmartImage'
import { useMusic } from '../../context/MusicContext'
import { apiGet } from '../../lib/apiClient'
import { formatMusicCredits } from '../../lib/musicCredits'
import {
  getFirstGalleryImage,
  getGalleryThumbnailPlaceholderLabel,
} from '../../lib/galleryThumbnails'
import type { GalleryListResponse } from '../../types/api'
import type { AlbumItem, GalleryImageItem, GalleryItem, SongItem } from '../../types/entities'

type LoadState = 'loading' | 'ready' | 'error'

interface HomeLoadState {
  galleries: LoadState
  songs: LoadState
  albums: LoadState
}

interface AlbumsResponse {
  albums: AlbumItem[]
  total: number
  page?: number
  limit?: number
  hasMore?: boolean
}

interface SongsResponse {
  songs: SongItem[]
  total: number
  page?: number
  limit?: number
  hasMore?: boolean
}

const HOME_SERIF_FONT =
  "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif"

const initialLoadState: HomeLoadState = {
  galleries: 'loading',
  songs: 'loading',
  albums: 'loading',
}

function SectionHeader({
  icon,
  title,
  to,
  actionLabel,
}: {
  icon: React.ReactNode
  title: string
  to: string
  actionLabel: string
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4 border-b border-border">
      <h2 className="relative flex items-center gap-2 pb-2 text-[1.0625rem] font-semibold tracking-[0.05em] text-brand-gold after:absolute after:bottom-0 after:left-0 after:h-[2px] after:w-full after:rounded-[1px] after:bg-brand-gold">
        {icon}
        {title}
      </h2>
      <Link
        to={to}
        className="flex items-center gap-1 pb-2 text-[0.8125rem] font-medium text-brand-gold transition-colors hover:text-brand-gold/90"
      >
        {actionLabel} <ArrowRight size={14} />
      </Link>
    </div>
  )
}

function EmptyState({
  label,
  to,
  actionLabel,
}: {
  label: string
  to: string
  actionLabel: string
}) {
  return (
    <div className="border-y border-border py-10 text-center">
      <p className="mb-3 text-sm text-text-muted">{label}</p>
      <Link
        to={to}
        className="inline-flex items-center gap-1 text-sm font-medium text-brand-gold transition-colors hover:text-brand-gold/90"
      >
        {actionLabel} <ArrowRight size={14} />
      </Link>
    </div>
  )
}

function CoverFallback({
  icon,
  label,
  className,
}: {
  icon: React.ReactNode
  label: string
  className?: string
}) {
  return (
    <div
      className={clsx(
        'flex h-full w-full flex-col items-center justify-center gap-2 bg-surface-alt text-text-muted',
        className
      )}
    >
      <span className="text-brand-gold/55">{icon}</span>
      <span className="px-2 text-center text-[0.6875rem] leading-tight">{label}</span>
    </div>
  )
}

function GalleryImage({
  gallery,
  image,
  className,
  eager = false,
}: {
  gallery: GalleryItem
  image?: GalleryImageItem
  className?: string
  eager?: boolean
}) {
  if (image?.thumbnailUrl) {
    return (
      <SmartImage
        src={image.thumbnailUrl}
        alt={gallery.title}
        className={clsx('h-full w-full object-cover transition-transform duration-500', className)}
        loading={eager ? 'eager' : 'lazy'}
        fetchpriority={eager ? 'high' : 'auto'}
      />
    )
  }

  return (
    <CoverFallback
      icon={<ImageIcon size={22} />}
      label={getGalleryThumbnailPlaceholderLabel(image)}
      className={className}
    />
  )
}

function GalleryTile({ gallery, featured = false }: { gallery: GalleryItem; featured?: boolean }) {
  const image = getFirstGalleryImage(gallery)
  const imageCount = Array.isArray(gallery.images) ? gallery.images.length : 0

  return (
    <Link
      to={`/gallery/${gallery.slug || gallery.id}`}
      className={clsx(
        'group relative block overflow-hidden rounded bg-surface-alt',
        featured ? 'min-h-[320px] sm:min-h-[420px]' : 'aspect-[4/3] min-h-[132px]'
      )}
    >
      <GalleryImage
        gallery={gallery}
        image={image}
        className="group-hover:scale-[1.04]"
        eager={featured}
      />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/72 via-black/28 to-transparent px-4 pb-4 pt-12 text-white">
        <div className="mb-1 flex items-center gap-2 text-[0.6875rem] text-white/75">
          <ImageIcon size={12} />
          <span>{imageCount} 张</span>
        </div>
        <h3
          className={clsx(
            'truncate font-semibold tracking-[0.03em]',
            featured ? 'text-[1.25rem]' : 'text-[0.9375rem]'
          )}
        >
          {gallery.title}
        </h3>
        {featured ? (
          <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-6 text-white/78">
            {gallery.description || '暂无描述'}
          </p>
        ) : null}
      </div>
    </Link>
  )
}

function GallerySkeleton() {
  return (
    <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]" aria-label="图集加载中" role="status">
      <div className="min-h-[320px] animate-pulse rounded bg-surface-alt sm:min-h-[420px]" />
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((item) => (
          <div
            key={item}
            className="aspect-[4/3] min-h-[132px] animate-pulse rounded bg-surface-alt"
          />
        ))}
      </div>
    </div>
  )
}

function SongCover({ song, active }: { song: SongItem; active: boolean }) {
  if (!song.cover) {
    return (
      <CoverFallback
        icon={<Music size={18} />}
        label="无封面"
        className={clsx('h-14 w-14 rounded', active && 'text-brand-gold')}
      />
    )
  }

  return (
    <SmartImage
      src={song.coverThumbnail || song.cover}
      alt={`${song.title} 封面`}
      className="h-14 w-14 rounded object-cover"
      loading="lazy"
    />
  )
}

function SongsSkeleton() {
  return (
    <div className="border-y border-border" aria-label="曲目加载中" role="status">
      {[1, 2, 3, 4, 5].map((item) => (
        <div
          key={item}
          className="flex items-center gap-4 border-b border-border py-4 last:border-b-0"
        >
          <div className="h-14 w-14 animate-pulse rounded bg-surface-alt" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-1/2 animate-pulse rounded bg-border" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-border" />
          </div>
          <div className="h-9 w-9 animate-pulse rounded-full bg-surface-alt" />
        </div>
      ))}
    </div>
  )
}

function AlbumSkeleton() {
  return (
    <div
      className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-1"
      aria-label="专辑加载中"
      role="status"
    >
      {[1, 2, 3, 4].map((item) => (
        <div key={item} className="flex gap-3 lg:items-center">
          <div className="aspect-square w-full max-w-[120px] animate-pulse rounded bg-surface-alt lg:h-16 lg:w-16" />
          <div className="hidden min-w-0 flex-1 space-y-2 lg:block">
            <div className="h-4 w-2/3 animate-pulse rounded bg-border" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-border" />
          </div>
        </div>
      ))}
    </div>
  )
}

export const DefaultHome = () => {
  const [galleries, setGalleries] = useState<GalleryItem[]>([])
  const [songs, setSongs] = useState<SongItem[]>([])
  const [albums, setAlbums] = useState<AlbumItem[]>([])
  const [loadState, setLoadState] = useState<HomeLoadState>(initialLoadState)
  const { currentSong, isPlaying, playAlbumTracks } = useMusic()

  useEffect(() => {
    let cancelled = false

    const loadHomeContent = async () => {
      setLoadState(initialLoadState)

      const [galleryResult, songResult, albumResult] = await Promise.allSettled([
        apiGet<GalleryListResponse>('/api/galleries', { page: 1, limit: 6 }),
        apiGet<SongsResponse>('/api/music', {
          page: 1,
          limit: 8,
          includeInstrumentals: false,
        }),
        apiGet<AlbumsResponse>('/api/albums', { page: 1, limit: 4 }),
      ])

      if (cancelled) return

      if (galleryResult.status === 'fulfilled') {
        setGalleries(galleryResult.value.galleries || [])
      } else {
        setGalleries([])
      }

      if (songResult.status === 'fulfilled') {
        setSongs(songResult.value.songs || [])
      } else {
        setSongs([])
      }

      if (albumResult.status === 'fulfilled') {
        setAlbums(albumResult.value.albums || [])
      } else {
        setAlbums([])
      }

      setLoadState({
        galleries: galleryResult.status === 'fulfilled' ? 'ready' : 'error',
        songs: songResult.status === 'fulfilled' ? 'ready' : 'error',
        albums: albumResult.status === 'fulfilled' ? 'ready' : 'error',
      })
    }

    void loadHomeContent()

    return () => {
      cancelled = true
    }
  }, [])

  const featuredGallery = galleries[0]
  const secondaryGalleries = useMemo(() => galleries.slice(1, 6), [galleries])

  const handlePlaySong = useCallback(
    (song: SongItem) => {
      const songIndex = songs.findIndex((item) => item.docId === song.docId)
      playAlbumTracks('home-latest', '首页最新曲目', songs, songIndex >= 0 ? songIndex : 0)
    },
    [playAlbumTracks, songs]
  )

  return (
    <div
      className="min-h-[calc(100vh-60px)] bg-bg-primary"
      style={{
        fontFamily: HOME_SERIF_FONT,
        lineHeight: 1.8,
      }}
    >
      <div className="home-page mx-auto max-w-[1100px] px-6 py-10 pb-32">
        <header className="mb-14 grid gap-8 border-b border-border pb-10 lg:grid-cols-[1fr_360px] lg:items-end">
          <div>
            <p className="mb-3 text-sm tracking-[0.22em] text-brand-gold">诗扶小筑</p>
            <p className="max-w-[34rem] text-[1rem] leading-8 tracking-[0.08em] text-text-secondary sm:text-[1.125rem]">
              人生难得一知音
            </p>
          </div>

          <div className="flex flex-wrap justify-start gap-3 lg:justify-end">
            <Link
              to="/gallery"
              className="flex items-center gap-2 rounded border border-border px-5 py-2.5 text-[0.9375rem] text-text-secondary transition-all hover:border-brand-gold hover:text-brand-gold"
            >
              <ImageIcon size={16} /> 画廊
            </Link>
            <Link
              to="/music"
              className="flex items-center gap-2 rounded border border-border px-5 py-2.5 text-[0.9375rem] text-text-secondary transition-all hover:border-brand-gold hover:text-brand-gold"
            >
              <Music size={16} /> 曲库
            </Link>
          </div>
        </header>

        <section className="mb-14">
          <SectionHeader
            icon={<ImageIcon size={18} />}
            title="最近图集"
            to="/gallery"
            actionLabel="进入画廊"
          />
          {loadState.galleries === 'loading' ? (
            <GallerySkeleton />
          ) : loadState.galleries === 'error' ? (
            <EmptyState label="图集暂时无法加载" to="/gallery" actionLabel="进入画廊" />
          ) : featuredGallery ? (
            <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
              <GalleryTile gallery={featuredGallery} featured />
              <div className="grid grid-cols-2 gap-3">
                {secondaryGalleries.map((gallery) => (
                  <GalleryTile key={gallery.id} gallery={gallery} />
                ))}
              </div>
            </div>
          ) : (
            <EmptyState label="暂无已发布图集" to="/gallery" actionLabel="进入画廊" />
          )}
        </section>

        <section className="grid gap-10 lg:grid-cols-[1fr_300px] lg:items-start">
          <div>
            <SectionHeader
              icon={<Music size={18} />}
              title="最新曲目"
              to="/music"
              actionLabel="进入曲库"
            />
            {loadState.songs === 'loading' ? (
              <SongsSkeleton />
            ) : loadState.songs === 'error' ? (
              <EmptyState label="曲目暂时无法加载" to="/music" actionLabel="进入曲库" />
            ) : songs.length > 0 ? (
              <div className="border-y border-border">
                {songs.map((song) => {
                  const active = currentSong?.docId === song.docId
                  return (
                    <div
                      key={song.docId}
                      className={clsx(
                        'flex items-center gap-4 border-b border-border py-4 last:border-b-0',
                        active && 'bg-brand-gold/10'
                      )}
                    >
                      <SongCover song={song} active={active} />
                      <Link
                        to={`/music/${song.slug || song.docId}`}
                        className="min-w-0 flex-1 group"
                      >
                        <h3
                          className={clsx(
                            'truncate text-[1rem] font-semibold tracking-[0.03em] transition-colors group-hover:text-brand-gold',
                            active ? 'text-brand-gold' : 'text-text-primary'
                          )}
                        >
                          {song.title}
                        </h3>
                        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[0.8125rem] text-text-muted">
                          <span className="truncate">
                            {formatMusicCredits(song.artists, '未知歌手')}
                          </span>
                          {song.album ? (
                            <>
                              <span className="h-[3px] w-[3px] rounded-full bg-border" />
                              <span className="truncate">{song.album}</span>
                            </>
                          ) : null}
                        </p>
                      </Link>
                      <button
                        type="button"
                        onClick={() => handlePlaySong(song)}
                        className={clsx(
                          'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
                          active && isPlaying
                            ? 'border-brand-gold bg-brand-gold text-white'
                            : 'border-border text-text-secondary hover:border-brand-gold hover:text-brand-gold'
                        )}
                        aria-label={`播放 ${song.title}`}
                        title={`播放 ${song.title}`}
                      >
                        <Play size={16} fill="currentColor" />
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <EmptyState label="暂无曲目" to="/music" actionLabel="进入曲库" />
            )}
          </div>

          <aside>
            <SectionHeader
              icon={<Disc3 size={18} />}
              title="新近专辑"
              to="/music"
              actionLabel="更多"
            />
            {loadState.albums === 'loading' ? (
              <AlbumSkeleton />
            ) : loadState.albums === 'error' ? (
              <EmptyState label="专辑暂时无法加载" to="/music" actionLabel="进入曲库" />
            ) : albums.length > 0 ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-1">
                {albums.map((album) => {
                  const albumId = album.docId || ''
                  const albumSlug = album.slug || album.docId || ''
                  return (
                    <Link
                      key={albumId}
                      to={`/album/${albumSlug}`}
                      className="group min-w-0 lg:flex lg:items-center lg:gap-3"
                    >
                      <div className="mb-2 aspect-square overflow-hidden rounded bg-surface-alt lg:mb-0 lg:h-16 lg:w-16 lg:flex-shrink-0">
                        {album.cover ? (
                          <SmartImage
                            src={album.coverThumbnail || album.cover}
                            alt={album.title}
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                            loading="lazy"
                          />
                        ) : (
                          <CoverFallback icon={<Disc3 size={18} />} label="无封面" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-[0.9375rem] font-semibold text-text-primary transition-colors group-hover:text-brand-gold">
                          {album.title}
                        </h3>
                        <p className="truncate text-xs text-text-muted">
                          {album.trackCount ? `${album.trackCount} 首` : album.artist}
                        </p>
                      </div>
                    </Link>
                  )
                })}
              </div>
            ) : (
              <EmptyState label="暂无专辑" to="/music" actionLabel="进入曲库" />
            )}
          </aside>
        </section>
      </div>
    </div>
  )
}

export default DefaultHome
