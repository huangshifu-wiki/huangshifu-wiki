import React, { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useUserPreferences } from '../context/UserPreferencesContext'
import { useMusic } from '../context/MusicContext'
import { clsx } from 'clsx'
import { useToast } from '../components/Toast'
import { apiDelete, apiGet, apiPost } from '../lib/apiClient'
import { copyToClipboard, toAbsoluteInternalUrl } from '../lib/copyLink'
import Pagination from '../components/Pagination'
import { useRoutedPagination } from '../hooks/useRoutedPagination'
import { useI18n } from '../lib/i18n'
import { PageSkeleton } from '../components/PageSkeleton'
import { SongCard } from '../components/Music/SongCard'
import { AlbumCard } from '../components/Music/AlbumCard'
import { MusicFilters, type SortBy } from '../components/Music/MusicFilters'
import { VIEW_MODE_CONFIG } from '../lib/viewModes'
import { isPlayableSong } from '../lib/musicPlayback'
import type { SongItem, AlbumItem } from '../types/entities'
import type { AlbumListResponse, MusicListResponse } from '../types/api'

const MUSIC_PAGE_SIZE_OPTIONS = [25, 50, 100]

const Music = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const [songs, setSongs] = useState<SongItem[]>([])
  const [songTotal, setSongTotal] = useState<number>()
  const [loading, setLoading] = useState(true)
  const [favoriting, setFavoriting] = useState<string | null>(null)
  const [albums, setAlbums] = useState<AlbumItem[]>([])
  const [albumTotal, setAlbumTotal] = useState<number>()
  const [loadingAlbums, setLoadingAlbums] = useState(false)
  const tabParam = searchParams.get('tab')
  const activeTab: 'music' | 'albums' = tabParam === 'albums' ? 'albums' : 'music'
  const { user } = useAuth()
  const { currentSong, setCurrentSong, setIsPlaying, setPlaylist, playSongAtIndex } = useMusic()
  const { preferences, setViewMode } = useUserPreferences()
  const viewMode = preferences.viewMode
  const { show } = useToast()
  const { t } = useI18n()

  const [sortBy, setSortBy] = useState<SortBy>('releaseDate')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  const playableSongs = useMemo(() => songs.filter(isPlayableSong), [songs])

  const musicPagination = useRoutedPagination({
    totalCount: songTotal,
    defaultPageSize: 50,
    pageParam: 'musicPage',
    pageSizeParam: 'musicPageSize',
    pageSizeOptions: MUSIC_PAGE_SIZE_OPTIONS,
  })
  const albumPagination = useRoutedPagination({
    totalCount: albumTotal,
    defaultPageSize: 24,
    pageParam: 'albumPage',
    pageSizeParam: null,
    showPageSizeSelector: false,
  })
  const [showAccompaniments, setShowAccompaniments] = useState(false)

  useEffect(() => {
    if (tabParam && tabParam !== 'albums') {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('tab')
          return next
        },
        { replace: true }
      )
    }
  }, [setSearchParams, tabParam])

  const handleTabChange = (tab: 'music' | 'albums') => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (tab === 'albums') {
        next.set('tab', 'albums')
      } else {
        next.delete('tab')
      }
      return next
    })
  }

  useEffect(() => {
    let cancelled = false

    const fetchSongs = async () => {
      setLoading(true)
      try {
        const data = await apiGet<MusicListResponse>('/api/music', {
          limit: musicPagination.pageSize,
          page: musicPagination.page,
          includeInstrumentals: showAccompaniments,
          sortBy,
          sortOrder,
        })
        if (cancelled) return
        setSongs(data.songs || [])
        setSongTotal(data.total || 0)
      } catch (e) {
        if (cancelled) return
        console.error('Fetch songs error:', e)
        setSongs([])
        setSongTotal(0)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchSongs()

    return () => {
      cancelled = true
    }
  }, [showAccompaniments, sortBy, sortOrder, musicPagination.page, musicPagination.pageSize])

  useEffect(() => {
    setPlaylist(songs)
  }, [songs, setPlaylist])

  useEffect(() => {
    let cancelled = false

    const fetchAlbums = async () => {
      setLoadingAlbums(true)
      try {
        const data = await apiGet<AlbumListResponse>('/api/albums', {
          limit: albumPagination.pageSize,
          page: albumPagination.page,
        })
        if (cancelled) return
        setAlbums(data.albums || [])
        setAlbumTotal(data.total || 0)
      } catch (error) {
        if (cancelled) return
        console.error('Fetch albums error:', error)
        setAlbums([])
        setAlbumTotal(0)
      } finally {
        if (!cancelled) setLoadingAlbums(false)
      }
    }

    fetchAlbums()

    return () => {
      cancelled = true
    }
  }, [albumPagination.page, albumPagination.pageSize])

  const playSong = (song: SongItem) => {
    if (!isPlayableSong(song)) {
      show('暂无可播放音源', { variant: 'error' })
      return
    }
    const index = playableSongs.findIndex((item) => item.docId === song.docId)
    if (index >= 0) {
      playSongAtIndex(index)
      return
    }
    setCurrentSong(song)
    setIsPlaying(true)
  }

  const handleCopyAlbumLink = async (
    event: React.MouseEvent<HTMLButtonElement>,
    albumId: string
  ) => {
    event.stopPropagation()
    const copied = await copyToClipboard(toAbsoluteInternalUrl(`/album/${albumId}`))
    if (copied) {
      show('专辑内链已复制')
      return
    }
    show('复制链接失败，请稍后重试', { variant: 'error' })
  }

  const handleToggleFavorite = async (song: SongItem) => {
    if (!user || !song.docId) {
      show('请先登录后收藏', { variant: 'error' })
      return
    }

    if (favoriting === song.docId) return
    setFavoriting(song.docId)
    try {
      if (song.favoritedByMe) {
        await apiDelete(`/api/favorites/music/${song.docId}`)
        setSongs((prev) =>
          prev.map((item) => (item.docId === song.docId ? { ...item, favoritedByMe: false } : item))
        )
      } else {
        await apiPost('/api/favorites', {
          targetType: 'music',
          targetId: song.docId,
        })
        setSongs((prev) =>
          prev.map((item) => (item.docId === song.docId ? { ...item, favoritedByMe: true } : item))
        )
      }
    } catch (error) {
      console.error('Toggle music favorite error:', error)
      show('收藏操作失败，请稍后重试', { variant: 'error' })
    } finally {
      setFavoriting(null)
    }
  }

  if (loading) {
    return <PageSkeleton variant="music" />
  }

  return (
    <div
      className="gufeng-music-page min-h-screen bg-bg-primary"
      style={{
        fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
        lineHeight: 1.8,
      }}
    >
      <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 md:pb-32">
        {/* Header */}
        <header className="mb-7">
          <div className="flex items-end justify-between flex-wrap gap-3">
            <h1 className="text-[1.75rem] font-semibold tracking-[0.12em] text-text-primary">
              {t('music.title')}
            </h1>
          </div>
        </header>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-8 items-start">
          {/* Main Content */}
          <div className="min-w-0">
            <MusicFilters
              activeTab={activeTab}
              onTabChange={handleTabChange}
              sortBy={sortBy}
              onSortByChange={(value) => {
                setSortBy(value)
                musicPagination.setPage(1)
              }}
              sortOrder={sortOrder}
              onSortOrderChange={(value) => {
                setSortOrder(value)
                musicPagination.setPage(1)
              }}
              showAccompaniments={showAccompaniments}
              onShowAccompanimentsChange={(value) => {
                setShowAccompaniments(value)
                musicPagination.setPage(1)
              }}
              musicCount={songTotal ?? 0}
              albumCount={albumTotal ?? 0}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
            />

            {/* Content */}
            {activeTab === 'music' ? (
              <div className="flex flex-col mt-6">
                {songs.length > 0 ? (
                  <>
                    <div
                      className={clsx(
                        viewMode === 'list'
                          ? 'divide-y divide-border'
                          : clsx(
                              'grid',
                              VIEW_MODE_CONFIG[viewMode].gridCols,
                              VIEW_MODE_CONFIG[viewMode].gap
                            )
                      )}
                    >
                      {songs.map((song, index) => (
                        <SongCard
                          key={song.docId}
                          song={song}
                          sequenceNumber={
                            (musicPagination.page - 1) * musicPagination.pageSize + index + 1
                          }
                          viewMode={viewMode}
                          isCurrentSong={currentSong?.docId === song.docId}
                          isFavoriting={favoriting === song.docId}
                          onPlay={playSong}
                          onToggleFavorite={handleToggleFavorite}
                        />
                      ))}
                    </div>

                    {musicPagination.totalPages > 1 && (
                      <div className="mt-8">
                        <Pagination
                          page={musicPagination.page}
                          totalPages={musicPagination.totalPages}
                          onPageChange={musicPagination.handlePageChange}
                          pageSize={musicPagination.pageSize}
                          onPageSizeChange={musicPagination.handlePageSizeChange}
                          pageSizeOptions={MUSIC_PAGE_SIZE_OPTIONS}
                          showPageSizeSelector
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="py-20 text-center text-text-muted italic tracking-[0.1em]">
                    {t('music.noMusic')}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-6">
                {loadingAlbums ? (
                  <div
                    className={clsx(
                      'grid',
                      VIEW_MODE_CONFIG[viewMode].gridCols,
                      VIEW_MODE_CONFIG[viewMode].gap
                    )}
                  >
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                      <div key={i} className="animate-pulse">
                        <div className="aspect-square rounded bg-surface-alt mb-2.5" />
                        <div className="h-4 bg-surface-alt rounded w-2/3 mb-1.5" />
                        <div className="h-3 bg-surface-alt rounded w-1/2" />
                      </div>
                    ))}
                  </div>
                ) : albums.length > 0 ? (
                  <>
                    <div
                      className={clsx(
                        'grid',
                        VIEW_MODE_CONFIG[viewMode].gridCols,
                        VIEW_MODE_CONFIG[viewMode].gap
                      )}
                    >
                      {albums.map((album) => (
                        <AlbumCard
                          key={album.docId}
                          album={album}
                          viewMode={viewMode === 'list' ? 'list' : 'grid'}
                          onCopyLink={handleCopyAlbumLink}
                        />
                      ))}
                    </div>
                    {albumPagination.totalPages > 1 && (
                      <div className="mt-8">
                        <Pagination
                          page={albumPagination.page}
                          totalPages={albumPagination.totalPages}
                          onPageChange={albumPagination.handlePageChange}
                          pageSize={albumPagination.pageSize}
                          showPageSizeSelector={false}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="py-20 text-center text-text-muted italic tracking-[0.1em]">
                    {t('music.noAlbums')}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <aside className="lg:sticky lg:top-20">
            {/* Stats */}
            <div className="py-5">
              <h3 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase mb-3.5">
                统计
              </h3>
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">单曲</span>
                  <span className="text-text-primary font-medium">{songTotal ?? 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">专辑</span>
                  <span className="text-text-primary font-medium">{albumTotal ?? 0}</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

export default Music
