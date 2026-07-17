import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useUserPreferences } from '../context/UserPreferencesContext'
import { useMusic } from '../context/MusicContext'
import { clsx } from 'clsx'
import { useToast } from '../components/Toast'
import { apiDelete, apiGet, apiPost } from '../lib/apiClient'
import Pagination from '../components/Pagination'
import { IncrementalLoadFooter } from '../components/IncrementalLoadFooter'
import { useIncrementalListLoader } from '../hooks/useIncrementalListLoader'
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
  const { preferences, getScopedViewMode, setScopedViewMode } = useUserPreferences()
  const viewMode = getScopedViewMode('music')
  const isIncrementalMode = preferences.listLoadMode === 'incremental'
  const { show } = useToast()
  const { t } = useI18n()

  const [sortBy, setSortBy] = useState<SortBy>('releaseDate')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  const musicPagination = useRoutedPagination({
    totalCount: songTotal,
    defaultPageSize: 50,
    pageParam: 'musicPage',
    pageSizeParam: 'musicPageSize',
    pageSizeOptions: MUSIC_PAGE_SIZE_OPTIONS,
    enabled: !isIncrementalMode,
  })
  const albumPagination = useRoutedPagination({
    totalCount: albumTotal,
    defaultPageSize: 24,
    pageParam: 'albumPage',
    pageSizeParam: null,
    showPageSizeSelector: false,
    enabled: !isIncrementalMode,
  })
  const [showAccompaniments, setShowAccompaniments] = useState(false)
  const fetchSongPage = useCallback(
    async (page: number) => {
      const data = await apiGet<MusicListResponse>('/api/music', {
        limit: musicPagination.pageSize,
        page,
        includeInstrumentals: showAccompaniments,
        sortBy,
        sortOrder,
      })

      return {
        items: data.songs || [],
        total: data.total || 0,
      }
    },
    [musicPagination.pageSize, showAccompaniments, sortBy, sortOrder]
  )
  const fetchAlbumPage = useCallback(
    async (page: number) => {
      const data = await apiGet<AlbumListResponse>('/api/albums', {
        limit: albumPagination.pageSize,
        page,
      })

      return {
        items: data.albums || [],
        total: data.total || 0,
      }
    },
    [albumPagination.pageSize]
  )
  const incrementalSongs = useIncrementalListLoader({
    enabled: isIncrementalMode,
    pageSize: musicPagination.pageSize,
    resetKey: `songs:${showAccompaniments}:${sortBy}:${sortOrder}`,
    fetchPage: fetchSongPage,
    getItemKey: (song) => song.docId,
  })
  const incrementalAlbums = useIncrementalListLoader({
    enabled: isIncrementalMode,
    pageSize: albumPagination.pageSize,
    resetKey: 'albums',
    fetchPage: fetchAlbumPage,
    getItemKey: (album) => album.docId,
  })
  const visibleSongs = isIncrementalMode ? incrementalSongs.items : songs
  const visibleAlbums = isIncrementalMode ? incrementalAlbums.items : albums
  const visibleSongTotal = isIncrementalMode ? incrementalSongs.total : songTotal || 0
  const visibleAlbumTotal = isIncrementalMode ? incrementalAlbums.total : albumTotal || 0
  const playableSongs = useMemo(() => visibleSongs.filter(isPlayableSong), [visibleSongs])

  useEffect(() => {
    if (!isIncrementalMode) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('musicPage')
        next.delete('musicPageSize')
        next.delete('albumPage')
        return next
      },
      { replace: true }
    )
  }, [isIncrementalMode, setSearchParams])

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
    if (isIncrementalMode) return
    let cancelled = false

    const fetchSongs = async () => {
      setLoading(true)
      try {
        const data = await fetchSongPage(musicPagination.page)
        if (cancelled) return
        setSongs(data.items)
        setSongTotal(data.total)
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
  }, [fetchSongPage, isIncrementalMode, musicPagination.page])

  useEffect(() => {
    setPlaylist(visibleSongs)
  }, [setPlaylist, visibleSongs])

  useEffect(() => {
    if (isIncrementalMode) return
    let cancelled = false

    const fetchAlbums = async () => {
      setLoadingAlbums(true)
      try {
        const data = await fetchAlbumPage(albumPagination.page)
        if (cancelled) return
        setAlbums(data.items)
        setAlbumTotal(data.total)
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
  }, [albumPagination.page, fetchAlbumPage, isIncrementalMode])

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

  const handleToggleFavorite = async (song: SongItem) => {
    if (!user || !song.docId) {
      show('请先登录后收藏', { variant: 'error' })
      return
    }

    if (favoriting === song.docId) return
    setFavoriting(song.docId)
    try {
      const updateFavorite = (favoritedByMe: boolean) => (prev: SongItem[]) =>
        prev.map((item) => (item.docId === song.docId ? { ...item, favoritedByMe } : item))
      const setFavoriteInCurrentList = (favoritedByMe: boolean) => {
        const updater = updateFavorite(favoritedByMe)
        if (isIncrementalMode) {
          incrementalSongs.setItems(updater)
          return
        }
        setSongs(updater)
      }

      if (song.favoritedByMe) {
        await apiDelete(`/api/favorites/music/${song.docId}`)
        setFavoriteInCurrentList(false)
      } else {
        await apiPost('/api/favorites', {
          targetType: 'music',
          targetId: song.docId,
        })
        setFavoriteInCurrentList(true)
      }
    } catch (error) {
      console.error('Toggle music favorite error:', error)
      show('收藏操作失败，请稍后重试', { variant: 'error' })
    } finally {
      setFavoriting(null)
    }
  }

  if (isIncrementalMode ? incrementalSongs.loadingInitial : loading) {
    return <PageSkeleton variant="music" />
  }

  return (
    <div className="gufeng-music-page mobile-page-shell">
      <div className="mobile-page-container">
        {/* Header */}
        <header className="mobile-page-header">
          <div className="mobile-page-titlebar">
            <h1 className="mobile-page-title">{t('music.title')}</h1>
          </div>
          <div className="mt-3 flex">
            <div className="h-px w-16 bg-gradient-to-r from-brand-gold/40 to-transparent" />
          </div>
        </header>

        {/* Two Column Layout */}
        <div className="mobile-detail-grid">
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
              musicCount={visibleSongTotal}
              albumCount={visibleAlbumTotal}
              viewMode={viewMode}
              onViewModeChange={(mode) => void setScopedViewMode('music', mode)}
            />

            {/* Content */}
            {activeTab === 'music' ? (
              <div className="mt-5 flex flex-col">
                {visibleSongs.length > 0 ? (
                  <>
                    <div
                      className={clsx(
                        viewMode === 'list'
                          ? 'flex flex-col gap-0.5'
                          : clsx(
                              'mobile-grid grid',
                              viewMode === 'large' && 'music-large-grid',
                              VIEW_MODE_CONFIG[viewMode].gridCols,
                              VIEW_MODE_CONFIG[viewMode].gap
                            )
                      )}
                    >
                      {visibleSongs.map((song, index) => (
                        <SongCard
                          key={song.docId}
                          song={song}
                          sequenceNumber={
                            isIncrementalMode
                              ? index + 1
                              : (musicPagination.page - 1) * musicPagination.pageSize + index + 1
                          }
                          showSequenceOnMobile={preferences.showMobileSongSequence}
                          viewMode={viewMode}
                          isCurrentSong={currentSong?.docId === song.docId}
                          isFavoriting={favoriting === song.docId}
                          onPlay={playSong}
                          onToggleFavorite={handleToggleFavorite}
                        />
                      ))}
                    </div>

                    {isIncrementalMode ? (
                      <IncrementalLoadFooter
                        hasMore={incrementalSongs.hasMore}
                        loading={incrementalSongs.loadingMore}
                        total={visibleSongTotal}
                        loaded={visibleSongs.length}
                        onLoadMore={incrementalSongs.loadMore}
                        sentinelRef={incrementalSongs.sentinelRef}
                      />
                    ) : musicPagination.totalPages > 1 ? (
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
                    ) : null}
                  </>
                ) : (
                  <div className="py-20 text-center">
                    <p className="text-[0.9rem] tracking-[0.08em] text-text-muted">
                      {t('music.noMusic')}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-5">
                {!isIncrementalMode && loadingAlbums ? (
                  <div
                    className={clsx(
                      'grid',
                      VIEW_MODE_CONFIG[viewMode].gridCols,
                      VIEW_MODE_CONFIG[viewMode].gap
                    )}
                  >
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                      <div key={i} className="animate-pulse">
                        <div className="mb-2.5 aspect-square rounded-lg bg-surface-alt" />
                        <div className="mb-1.5 h-4 w-2/3 rounded bg-surface-alt" />
                        <div className="h-3 w-1/2 rounded bg-surface-alt" />
                      </div>
                    ))}
                  </div>
                ) : visibleAlbums.length > 0 ? (
                  <>
                    <div
                      className={clsx(
                        viewMode === 'list'
                          ? 'flex flex-col gap-0.5'
                          : clsx(
                              'mobile-grid grid',
                              viewMode === 'large' && 'music-large-grid',
                              VIEW_MODE_CONFIG[viewMode].gridCols,
                              VIEW_MODE_CONFIG[viewMode].gap
                            )
                      )}
                    >
                      {visibleAlbums.map((album) => (
                        <AlbumCard
                          key={album.docId}
                          album={album}
                          viewMode={viewMode === 'list' ? 'list' : 'grid'}
                        />
                      ))}
                    </div>
                    {isIncrementalMode ? (
                      <IncrementalLoadFooter
                        hasMore={incrementalAlbums.hasMore}
                        loading={incrementalAlbums.loadingMore}
                        total={visibleAlbumTotal}
                        loaded={visibleAlbums.length}
                        onLoadMore={incrementalAlbums.loadMore}
                        sentinelRef={incrementalAlbums.sentinelRef}
                      />
                    ) : albumPagination.totalPages > 1 ? (
                      <div className="mt-8">
                        <Pagination
                          page={albumPagination.page}
                          totalPages={albumPagination.totalPages}
                          onPageChange={albumPagination.handlePageChange}
                          pageSize={albumPagination.pageSize}
                          showPageSizeSelector={false}
                        />
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="py-20 text-center">
                    <p className="text-[0.9rem] tracking-[0.08em] text-text-muted">
                      {t('music.noAlbums')}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <aside className="mobile-detail-aside">
            <div className="py-5">
              <div className="mb-4 flex justify-center">
                <div className="h-px w-8 bg-gradient-to-r from-transparent via-brand-gold/30 to-transparent" />
              </div>
              <h3 className="mb-4 text-center text-[0.8125rem] uppercase tracking-[0.14em] text-text-muted">
                统计
              </h3>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-[0.875rem] text-text-muted">单曲</span>
                  <span className="text-[0.875rem] font-medium tabular-nums text-text-primary">
                    {visibleSongTotal}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[0.875rem] text-text-muted">专辑</span>
                  <span className="text-[0.875rem] font-medium tabular-nums text-text-primary">
                    {visibleAlbumTotal}
                  </span>
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
