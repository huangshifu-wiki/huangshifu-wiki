import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, Disc3, Image as ImageIcon, Music, Pause, Play } from '@/src/components/icons'
import { clsx } from 'clsx'
import { SmartImage } from '../../components/SmartImage'
import { useMusic } from '../../context/MusicContext'
import { apiGet } from '../../lib/apiClient'
import { formatEventListDate, getEventCoverSrc } from '../../lib/eventFormat'
import {
  getFirstGalleryImage,
  getGalleryThumbnailPlaceholderLabel,
} from '../../lib/galleryThumbnails'
import { formatMusicCredits } from '../../lib/musicCredits'
import type { EventListResponse, GalleryListResponse } from '../../types/api'
import type {
  AlbumItem,
  EventItem,
  GalleryImageItem,
  GalleryItem,
  SongItem,
} from '../../types/entities'

type LoadState = 'loading' | 'ready' | 'error'

interface HomeLoadState {
  events: LoadState
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

const initialLoadState: HomeLoadState = {
  events: 'loading',
  galleries: 'loading',
  songs: 'loading',
  albums: 'loading',
}

function useRevealOnScroll(refreshKey: number) {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      document.querySelectorAll('.home-reveal').forEach((element) => {
        element.classList.add('is-visible')
      })
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    )

    document.querySelectorAll('.home-reveal').forEach((element) => {
      observer.observe(element)
    })

    return () => {
      observer.disconnect()
    }
  }, [refreshKey])
}

function SectionHeader({
  title,
  to,
  actionLabel,
}: {
  title: string
  to: string
  actionLabel: string
}) {
  return (
    <div className="home-section-hd">
      <h2>{title}</h2>
      <Link to={to} className="home-section-link">
        {actionLabel} <span aria-hidden="true">→</span>
      </Link>
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return <div className="home-empty">{label}</div>
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
    <div className={clsx('home-cover-fallback', className)}>
      <span>{icon}</span>
      <span>{label}</span>
    </div>
  )
}

function GalleryImage({
  gallery,
  image,
  eager = false,
}: {
  gallery: GalleryItem
  image?: GalleryImageItem
  eager?: boolean
}) {
  if (image?.thumbnailUrl || image?.url) {
    return (
      <SmartImage
        src={image.thumbnailUrl || image.url}
        alt={gallery.title}
        className="home-gallery-img"
        loading={eager ? 'eager' : 'lazy'}
        fetchpriority={eager ? 'high' : 'auto'}
      />
    )
  }

  return (
    <CoverFallback
      icon={<ImageIcon size={22} />}
      label={getGalleryThumbnailPlaceholderLabel(image)}
      className="home-gallery-fallback"
    />
  )
}

function GalleryTile({ gallery, index }: { gallery: GalleryItem; index: number }) {
  const image = getFirstGalleryImage(gallery)
  const meta = gallery.publishedAt?.slice(0, 10) || gallery.locationName || '图集'

  return (
    <Link
      to={`/gallery/${gallery.slug || gallery.id}`}
      className={clsx('home-gallery-item home-reveal', `home-reveal-d${Math.min(index + 1, 4)}`)}
    >
      <GalleryImage gallery={gallery} image={image} eager={index === 0} />
      <div className="home-gallery-info">
        <h3>{gallery.title}</h3>
        <p>{meta}</p>
      </div>
    </Link>
  )
}

function EventCover({ event }: { event: EventItem }) {
  const src = getEventCoverSrc(event)

  if (src) {
    return <SmartImage src={src} alt={event.title} className="home-list-cover-img" loading="lazy" />
  }

  return <CoverFallback icon={<Calendar size={18} />} label="暂无封面" />
}

function EventRow({ event }: { event: EventItem }) {
  const date = formatEventListDate(event.timeSlots)

  return (
    <Link to={`/events/${event.slug}`} className="home-list-item">
      <div className="home-list-cover">
        <EventCover event={event} />
      </div>
      <div className="home-list-info">
        <div className="home-list-name">{event.title}</div>
        <div className="home-list-meta">
          {date || '时间待定'}
          {event.location ? ` · ${event.location}` : ''}
        </div>
      </div>
    </Link>
  )
}

function SongCover({ song, active }: { song: SongItem; active: boolean }) {
  if (song.cover) {
    return (
      <SmartImage
        src={song.coverThumbnail || song.cover}
        alt={`${song.title} 封面`}
        className="home-list-cover-img"
        loading="lazy"
      />
    )
  }

  return (
    <CoverFallback
      icon={<Music size={18} />}
      label="无封面"
      className={clsx(active && 'home-cover-fallback-active')}
    />
  )
}

function SongRow({
  song,
  active,
  playing,
  onPlay,
}: {
  song: SongItem
  active: boolean
  playing: boolean
  onPlay: () => void
}) {
  return (
    <div className={clsx('home-list-item', active && 'home-list-item-active')}>
      <Link to={`/music/${song.slug || song.docId}`} className="home-list-cover">
        <SongCover song={song} active={active} />
      </Link>
      <Link to={`/music/${song.slug || song.docId}`} className="home-list-info">
        <div className="home-list-name">{song.title}</div>
        <div className="home-list-meta">
          {formatMusicCredits(song.artists, '未知歌手')}
          {song.album ? ` · ${song.album}` : ''}
        </div>
      </Link>
      <button
        type="button"
        className={clsx('home-track-play', active && playing && 'home-track-play-active')}
        onClick={onPlay}
        aria-label={`播放 ${song.title}`}
        title={`播放 ${song.title}`}
      >
        {active && playing ? (
          <Pause size={13} fill="currentColor" />
        ) : (
          <Play size={13} fill="currentColor" />
        )}
      </button>
    </div>
  )
}

function AlbumFeature({ album }: { album: AlbumItem }) {
  const albumSlug = album.slug || album.docId || ''

  return (
    <Link to={`/album/${albumSlug}`} className="home-album-item">
      <div className="home-album-cover">
        {album.cover ? (
          <SmartImage
            src={album.coverThumbnail || album.cover}
            alt={album.title}
            className="home-list-cover-img"
            loading="lazy"
          />
        ) : (
          <CoverFallback icon={<Disc3 size={20} />} label="无封面" />
        )}
      </div>
      <div className="home-album-info">
        <div className="home-album-name">{album.title}</div>
        <div className="home-album-desc">
          {album.description || (album.trackCount ? `${album.trackCount} 首` : album.artist)}
        </div>
      </div>
    </Link>
  )
}

function ListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="home-list" aria-label="内容加载中" role="status">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="home-list-item">
          <div className="home-list-cover home-skeleton" />
          <div className="home-list-info">
            <div className="home-skeleton home-skeleton-line" />
            <div className="home-skeleton home-skeleton-line home-skeleton-line-sm" />
          </div>
        </div>
      ))}
    </div>
  )
}

function GallerySkeleton() {
  return (
    <div className="home-gallery-grid" aria-label="图集加载中" role="status">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="home-gallery-item home-skeleton" />
      ))}
    </div>
  )
}

export const DefaultHome = () => {
  const [events, setEvents] = useState<EventItem[]>([])
  const [galleries, setGalleries] = useState<GalleryItem[]>([])
  const [songs, setSongs] = useState<SongItem[]>([])
  const [albums, setAlbums] = useState<AlbumItem[]>([])
  const [loadState, setLoadState] = useState<HomeLoadState>(initialLoadState)
  const { currentSong, isPlaying, playAlbumTracks } = useMusic()

  useEffect(() => {
    let cancelled = false

    const loadHomeContent = async () => {
      setLoadState(initialLoadState)

      const [eventResult, galleryResult, songResult, albumResult] = await Promise.allSettled([
        apiGet<EventListResponse>('/api/events', { page: 1, limit: 4 }),
        apiGet<GalleryListResponse>('/api/galleries', { page: 1, limit: 5 }),
        apiGet<SongsResponse>('/api/music', {
          page: 1,
          limit: 3,
          includeInstrumentals: false,
        }),
        apiGet<AlbumsResponse>('/api/albums', { page: 1, limit: 1 }),
      ])

      if (cancelled) return

      setEvents(eventResult.status === 'fulfilled' ? eventResult.value.events || [] : [])
      setGalleries(galleryResult.status === 'fulfilled' ? galleryResult.value.galleries || [] : [])
      setSongs(songResult.status === 'fulfilled' ? songResult.value.songs || [] : [])
      setAlbums(albumResult.status === 'fulfilled' ? albumResult.value.albums || [] : [])

      setLoadState({
        events: eventResult.status === 'fulfilled' ? 'ready' : 'error',
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

  const displayedGalleries = useMemo(() => galleries.slice(0, 5), [galleries])
  const featuredAlbum = albums[0]

  useRevealOnScroll(displayedGalleries.length)

  const handlePlaySong = useCallback(
    (song: SongItem) => {
      const songIndex = songs.findIndex((item) => item.docId === song.docId)
      playAlbumTracks('home-latest', '首页新近曲目', songs, songIndex >= 0 ? songIndex : 0)
    },
    [playAlbumTracks, songs]
  )

  return (
    <div className="home-shell">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero-bg" />
        <div className="home-hero-pattern" />
        <div className="home-hero-content">
          <h1 id="home-title" className="home-hero-title">
            黄诗扶
          </h1>
          <p className="home-hero-subtitle">人生难得一知音</p>
          <div className="home-hero-actions">
            <Link to="/gallery" className="home-btn home-btn-fill">
              浏览图集
            </Link>
            <Link to="/music" className="home-btn home-btn-ghost">
              探索音乐
            </Link>
          </div>
        </div>
      </section>

      <main>
        <section className="home-section" id="music">
          <div className="home-container">
            <div className="home-music-grid">
              <div className="home-reveal">
                <SectionHeader title="最近活动" to="/events" actionLabel="全部活动" />
                {loadState.events === 'loading' ? (
                  <ListSkeleton />
                ) : loadState.events === 'error' ? (
                  <EmptyState label="活动暂时无法加载" />
                ) : events.length > 0 ? (
                  <div className="home-list">
                    {events.map((event) => (
                      <EventRow key={event.id} event={event} />
                    ))}
                  </div>
                ) : (
                  <EmptyState label="暂无活动" />
                )}
              </div>

              <div className="home-reveal home-reveal-d1">
                <SectionHeader title="新近曲目" to="/music" actionLabel="进入曲库" />
                {loadState.songs === 'loading' ? (
                  <ListSkeleton count={3} />
                ) : loadState.songs === 'error' ? (
                  <EmptyState label="曲目暂时无法加载" />
                ) : songs.length > 0 ? (
                  <div className="home-list">
                    {songs.map((song) => {
                      const active = currentSong?.docId === song.docId
                      return (
                        <SongRow
                          key={song.docId}
                          song={song}
                          active={active}
                          playing={active && isPlaying}
                          onPlay={() => handlePlaySong(song)}
                        />
                      )
                    })}
                  </div>
                ) : (
                  <EmptyState label="暂无曲目" />
                )}

                <div className="home-sub-heading">最新专辑</div>
                {loadState.albums === 'loading' ? (
                  <ListSkeleton count={1} />
                ) : loadState.albums === 'error' ? (
                  <EmptyState label="专辑暂时无法加载" />
                ) : featuredAlbum ? (
                  <div className="home-albums-list">
                    <AlbumFeature album={featuredAlbum} />
                  </div>
                ) : (
                  <EmptyState label="暂无专辑" />
                )}
              </div>
            </div>
          </div>
        </section>

        <div className="home-divider home-reveal" />

        <section className="home-section" id="gallery">
          <div className="home-container">
            <div className="home-reveal">
              <SectionHeader title="最近图集" to="/gallery" actionLabel="进入图集" />
            </div>
            {loadState.galleries === 'loading' ? (
              <GallerySkeleton />
            ) : loadState.galleries === 'error' ? (
              <EmptyState label="图集暂时无法加载" />
            ) : displayedGalleries.length > 0 ? (
              <div className="home-gallery-grid">
                {displayedGalleries.map((gallery, index) => (
                  <GalleryTile key={gallery.id} gallery={gallery} index={index} />
                ))}
              </div>
            ) : (
              <EmptyState label="暂无已发布图集" />
            )}
          </div>
        </section>
      </main>

      <footer className="home-footer" role="contentinfo" aria-label="首页底部">
        <p>黄诗扶 Wiki</p>
      </footer>
    </div>
  )
}

export default DefaultHome
