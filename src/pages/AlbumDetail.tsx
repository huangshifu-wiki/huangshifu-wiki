import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Disc3,
  Play,
  Heart,
  Link2,
  ChevronDown,
  ChevronUp,
  Trash2,
} from '@/src/components/icons'
import { clsx } from 'clsx'

import { apiDelete, apiGet, apiPost } from '../lib/apiClient'
import { useMusic } from '../context/MusicContext'
import { useAuth } from '../context/AuthContext'
import { useDialog } from '../components/Dialog'
import { useToast } from '../components/Toast'
import { CoverManager } from '../components/CoverManager'
import { SmartImage } from '../components/SmartImage'
import { Lightbox } from '../components/Lightbox'
import { copyToClipboard, toAbsoluteInternalUrl } from '../lib/copyLink'
import { formatMusicCredits } from '../lib/musicCredits'
import { isPlayableSong } from '../lib/musicPlayback'
import type { MusicExternalSource } from '../types/entities'

type SongItem = {
  docId: string
  slug?: string
  title: string
  artists: string[]
  album: string
  cover: string
  coverThumbnail?: string
  audioUrl: string
  sourceUrl?: string | null
  lyric?: string | null
  favoritedByMe?: boolean
  trackOrder?: number
  discNumber?: number
  sources?: MusicExternalSource[]
  playable?: boolean
}

type AlbumResponse = {
  album: {
    docId: string
    slug?: string
    title: string
    artist: string
    cover: string
    coverThumbnail?: string
    description?: string | null
    tracks: SongItem[]
  }
}

const compareTracks = (a: SongItem, b: SongItem) =>
  (a.discNumber || 0) - (b.discNumber || 0) || (a.trackOrder || 0) - (b.trackOrder || 0)

const AlbumDetail = () => {
  const { albumId } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [album, setAlbum] = useState<AlbumResponse['album'] | null>(null)
  const [favoriting, setFavoriting] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [descExpanded, setDescExpanded] = useState(false)
  const [descNeedExpand, setDescNeedExpand] = useState(false)
  const [coverLightboxOpen, setCoverLightboxOpen] = useState(false)
  const descRef = useRef<HTMLDivElement>(null)
  const { user, isAdmin } = useAuth()
  const dialog = useDialog()

  useEffect(() => {
    if (descRef.current && !descExpanded) {
      setDescNeedExpand(descRef.current.scrollHeight > descRef.current.clientHeight + 1)
    }
  }, [album?.description, descExpanded])
  const { currentSong, playAlbumTracks } = useMusic()
  const { show } = useToast()

  const sortedTracks = useMemo(
    () => [...(album?.tracks || [])].sort(compareTracks),
    [album?.tracks]
  )

  const playableTracks = useMemo(() => sortedTracks.filter(isPlayableSong), [sortedTracks])

  const fetchAlbum = async () => {
    if (!albumId) return
    setLoading(true)
    try {
      const response = await apiGet<AlbumResponse>(`/api/albums/${albumId}`)
      setAlbum(response.album || null)
    } catch (error) {
      console.error('Fetch album detail error:', error)
      setAlbum(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAlbum()
  }, [albumId])

  const handlePlay = (index = 0) => {
    if (!album) return
    if (!playableTracks.length) {
      show('当前专辑暂无可播放音源', { variant: 'error' })
      return
    }

    const selectedTrack = sortedTracks[index]
    if (selectedTrack && !isPlayableSong(selectedTrack)) {
      show('这首歌暂无可播放音源', { variant: 'error' })
      return
    }

    const playableIndex = selectedTrack
      ? Math.max(
          0,
          playableTracks.findIndex((track) => track.docId === selectedTrack.docId)
        )
      : 0
    playAlbumTracks(album.docId, album.title, playableTracks, playableIndex)
  }

  const toggleFavorite = async (song: SongItem) => {
    if (!user || !song.docId || favoriting === song.docId) {
      if (!user) show('请先登录后收藏', { variant: 'error' })
      return
    }

    setFavoriting(song.docId)
    try {
      if (song.favoritedByMe) {
        await apiDelete(`/api/favorites/music/${song.docId}`)
      } else {
        await apiPost('/api/favorites', {
          targetType: 'music',
          targetId: song.docId,
        })
      }

      setAlbum((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          tracks: prev.tracks.map((track) =>
            track.docId === song.docId ? { ...track, favoritedByMe: !track.favoritedByMe } : track
          ),
        }
      })
    } catch (error) {
      console.error('Toggle favorite in album detail error:', error)
      show('收藏操作失败，请稍后重试', { variant: 'error' })
    } finally {
      setFavoriting(null)
    }
  }

  const handleCopyAlbumLink = async () => {
    const albumPublicId = album?.slug || album?.docId
    if (!albumPublicId) return
    const copied = await copyToClipboard(toAbsoluteInternalUrl(`/album/${albumPublicId}`))
    if (copied) {
      show('专辑内链已复制')
      return
    }
    show('复制链接失败，请稍后重试', { variant: 'error' })
  }

  const handleDeleteAlbum = async () => {
    if (!album?.docId || isDeleting) return
    const confirmed = await dialog.confirm({
      title: '删除专辑',
      message: `确定要删除专辑《${album.title}》吗？删除后可在回收站恢复。`,
      confirmText: '删除',
      variant: 'danger',
    })
    if (!confirmed) return

    try {
      setIsDeleting(true)
      await apiDelete(`/api/albums/${album.docId}`)
      show('专辑已删除')
      navigate('/music')
    } catch (error) {
      console.error('Delete album failed:', error)
      show(error instanceof Error ? error.message : '删除专辑失败', { variant: 'error' })
    } finally {
      setIsDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="mobile-page-shell antique-page">
        <div className="mobile-page-container">
          <div className="h-40 bg-surface-alt rounded animate-pulse" />
        </div>
      </div>
    )
  }

  if (!album) {
    return (
      <div className="mobile-page-shell antique-page">
        <div className="mobile-page-container">
          <Link
            to="/music"
            className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-brand-gold transition-colors"
          >
            <ArrowLeft size={16} /> 返回音乐馆
          </Link>
          <div className="mt-6 bg-surface rounded border border-border p-10 text-center text-text-muted italic tracking-[0.1em]">
            专辑不存在或已被删除
          </div>
        </div>
      </div>
    )
  }

  const coverPreviewSrc = album.coverThumbnail || album.cover

  return (
    <div className="mobile-page-shell antique-detail text-[var(--color-text-antique)]">
      <div className="mobile-page-container">
        <Link
          to="/music"
          className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-brand-gold transition-colors mb-5"
        >
          <ArrowLeft size={16} /> 返回音乐馆
        </Link>

        {/* Detail Header */}
        <div className="mb-6 flex flex-col gap-5 border-b border-border pb-6 sm:flex-row">
          <button
            type="button"
            onClick={() => setCoverLightboxOpen(true)}
            className="h-40 w-40 flex-shrink-0 overflow-hidden rounded bg-surface-alt transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary sm:h-44 sm:w-44"
            aria-label={`查看 ${album.title} 封面原图`}
          >
            <SmartImage
              src={coverPreviewSrc}
              alt={album.title}
              className="w-full h-full object-cover"
            />
          </button>
          <div className="flex-1 flex flex-col justify-center min-w-0">
            <h1 className="mobile-page-title mb-1.5">{album.title}</h1>
            <p className="text-base text-text-secondary tracking-[0.08em] mb-4">
              {album.artist} · {album.tracks.length} 首歌曲
            </p>
            <div className="mobile-action-row justify-start">
              <button
                onClick={() => handlePlay(0)}
                disabled={playableTracks.length === 0}
                className="inline-flex items-center gap-2 px-6 py-2 theme-button-primary rounded text-[0.9375rem] tracking-[0.08em] transition-all disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Play size={16} /> {playableTracks.length > 0 ? '播放专辑' : '暂无音源'}
              </button>
              <button
                onClick={handleCopyAlbumLink}
                className="inline-flex items-center gap-2 px-5 py-2.5 border border-border text-[0.9375rem] text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded transition-all"
              >
                <Link2 size={15} /> 复制内链
              </button>
            </div>
          </div>
        </div>

        {/* Description */}
        {album.description ? (
          <div className="mb-10">
            <h2 className="text-base font-semibold text-text-primary tracking-[0.12em] mb-4 flex items-center gap-2">
              <span className="w-[3px] h-4 bg-brand-gold rounded-[1px] opacity-60 inline-block" />
              专辑简介
            </h2>
            <div
              ref={descRef}
              className={clsx(
                'text-text-secondary leading-relaxed whitespace-pre-wrap',
                !descExpanded && 'line-clamp-3'
              )}
            >
              {album.description}
            </div>
            {descNeedExpand && (
              <button
                onClick={() => setDescExpanded(!descExpanded)}
                className="text-xs px-3 py-1.5 border border-border text-text-muted hover:text-brand-gold hover:border-brand-gold rounded transition-all duration-300 mt-3 inline-flex items-center gap-0.5"
              >
                {descExpanded ? (
                  <>
                    收起 <ChevronUp size={12} />
                  </>
                ) : (
                  <>
                    展开 <ChevronDown size={12} />
                  </>
                )}
              </button>
            )}
          </div>
        ) : null}

        {/* Track List */}
        <div className="mb-10">
          <h2 className="text-base font-semibold text-text-primary tracking-[0.12em] mb-4 flex items-center gap-2">
            <span className="w-[3px] h-4 bg-brand-gold rounded-[1px] opacity-60 inline-block" />
            曲目列表
          </h2>
          <div className="flex flex-col">
            {sortedTracks.map((track, index) => {
              const playable = isPlayableSong(track)
              return (
                <div
                  key={track.docId}
                  className={clsx(
                    'flex items-center gap-3 py-3 px-1 border-b border-border transition-colors sm:gap-4',
                    currentSong?.docId === track.docId && 'bg-brand-gold/10'
                  )}
                >
                  <span className="hidden w-7 flex-shrink-0 text-right text-sm text-text-muted sm:inline-block">
                    {(track.trackOrder ?? index) + 1}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handlePlay(index)
                    }}
                    disabled={!playable}
                    className="w-8 h-8 flex items-center justify-center text-text-secondary hover:text-brand-gold hover:bg-surface-alt rounded-full transition-all flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-text-secondary disabled:hover:bg-transparent"
                    title={playable ? '播放' : '暂无可播放音源'}
                  >
                    <Play size={14} />
                  </button>
                  <Link
                    to={`/music/${track.slug || track.docId}`}
                    className="flex min-h-11 min-w-0 flex-1 flex-col justify-center"
                    data-pressable
                    data-press-feedback="state"
                  >
                    <p className="text-base text-text-primary truncate hover:text-brand-gold transition-colors">
                      {track.title}
                    </p>
                    <p className="text-xs text-text-muted truncate">
                      {formatMusicCredits(track.artists, '未知歌手')}
                    </p>
                    {!playable ? (
                      <p className="text-xs text-text-muted truncate">暂无可播放音源</p>
                    ) : null}
                  </Link>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleFavorite(track)
                    }}
                    disabled={favoriting === track.docId}
                    className={clsx(
                      'p-2 transition-colors flex-shrink-0',
                      track.favoritedByMe
                        ? 'theme-text-error'
                        : 'text-text-muted theme-icon-button-danger',
                      favoriting === track.docId && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    <Heart size={15} />
                  </button>
                </div>
              )
            })}
          </div>
          {album.tracks.length === 0 ? (
            <div className="py-10 text-center text-text-muted italic">
              <Disc3 className="mx-auto mb-2" size={28} />
              当前专辑暂无曲目
            </div>
          ) : null}
        </div>

        {/* Admin */}
        {isAdmin && album.docId && (
          <div className="mb-10">
            <h2 className="text-base font-semibold text-text-primary tracking-[0.12em] mb-4 flex items-center gap-2">
              <span className="w-[3px] h-4 bg-brand-gold rounded-[1px] opacity-60 inline-block" />
              管理功能
            </h2>
            <div className="flex flex-wrap gap-3">
              <CoverManager
                resourceType="album"
                resourceId={album.docId}
                currentCover={album.cover}
                onCoverUpdated={(cover) =>
                  setAlbum((prev) =>
                    prev
                      ? {
                          ...prev,
                          cover: cover.url,
                          coverThumbnail: cover.thumbnailUrl || undefined,
                        }
                      : prev
                  )
                }
              />
              <button
                onClick={handleDeleteAlbum}
                disabled={isDeleting}
                className="inline-flex items-center gap-2 px-5 py-2 theme-button-danger rounded text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 size={15} /> {isDeleting ? '删除中...' : '删除专辑'}
              </button>
            </div>
          </div>
        )}
      </div>

      <Lightbox
        open={coverLightboxOpen}
        images={[
          {
            id: album.docId,
            url: coverPreviewSrc,
            originalUrl: album.cover,
            name: `${album.title} 封面`,
          },
        ]}
        initialIndex={0}
        onClose={() => setCoverLightboxOpen(false)}
      />
    </div>
  )
}

export default AlbumDetail
