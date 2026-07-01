import React, { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import { useUserPreferences } from '../context/UserPreferencesContext'
import { useMusic } from '../context/MusicContext'
import { clsx } from 'clsx'
import { useToast } from '../components/Toast'
import { apiDelete, apiGet, apiPost } from '../lib/apiClient'
import { copyToClipboard, toAbsoluteInternalUrl } from '../lib/copyLink'
import Pagination from '../components/Pagination'
import { usePagination } from '../hooks/usePagination'
import { useI18n } from '../lib/i18n'
import { PageSkeleton } from '../components/PageSkeleton'
import { SongCard } from '../components/Music/SongCard'
import { AlbumCard } from '../components/Music/AlbumCard'
import { MusicFilters } from '../components/Music/MusicFilters'
import { VIEW_MODE_CONFIG } from '../lib/viewModes'
import { formatMusicCredits } from '../lib/musicCredits'
import { isPlayableSong } from '../lib/musicPlayback'
import type { SongItem, AlbumItem } from '../types/entities'

const Music = () => {
  const [songs, setSongs] = useState<SongItem[]>([])
  const [loading, setLoading] = useState(true)
  const [favoriting, setFavoriting] = useState<string | null>(null)
  const [albums, setAlbums] = useState<AlbumItem[]>([])
  const [loadingAlbums, setLoadingAlbums] = useState(false)
  const [activeTab, setActiveTab] = useState<'music' | 'albums'>('music')
  const { user } = useAuth()
  const { currentSong, setCurrentSong, setIsPlaying, setPlaylist, playSongAtIndex } = useMusic()
  const { preferences, setViewMode } = useUserPreferences()
  const viewMode = preferences.viewMode
  const { show } = useToast()
  const { t } = useI18n()

  const [sortBy, setSortBy] = useState<'createdAt' | 'title' | 'artist'>('createdAt')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  const displaySongs = useMemo(() => {
    let result = [...songs]

    result.sort((a, b) => {
      if (sortBy === 'title') {
        return sortOrder === 'asc'
          ? a.title.localeCompare(b.title, 'zh-CN')
          : b.title.localeCompare(a.title, 'zh-CN')
      }
      if (sortBy === 'artist') {
        const artistA = formatMusicCredits(a.artists, '')
        const artistB = formatMusicCredits(b.artists, '')
        return sortOrder === 'asc'
          ? artistA.localeCompare(artistB, 'zh-CN')
          : artistB.localeCompare(artistA, 'zh-CN')
      }
      return sortOrder === 'asc'
        ? (a.createdAt || '').localeCompare(b.createdAt || '')
        : (b.createdAt || '').localeCompare(a.createdAt || '')
    })

    return result
  }, [songs, sortBy, sortOrder])
  const playableSongs = useMemo(() => displaySongs.filter(isPlayableSong), [displaySongs])

  const musicPagination = usePagination({ totalCount: displaySongs.length, defaultPageSize: 40 })
  const albumPagination = usePagination({ totalCount: albums.length, defaultPageSize: 24 })
  const [showAccompaniments, setShowAccompaniments] = useState(false)

  const paginatedSongs = useMemo(() => {
    const start = (musicPagination.page - 1) * musicPagination.pageSize
    return displaySongs.slice(start, start + musicPagination.pageSize)
  }, [displaySongs, musicPagination.page, musicPagination.pageSize])

  const paginatedAlbums = useMemo(() => {
    const start = (albumPagination.page - 1) * albumPagination.pageSize
    return albums.slice(start, start + albumPagination.pageSize)
  }, [albums, albumPagination.page, albumPagination.pageSize])

  useEffect(() => {
    musicPagination.setPage(1)
    albumPagination.setPage(1)
  }, [activeTab])

  const fetchSongs = async () => {
    setLoading(true)
    try {
      const data = await apiGet<{ songs: SongItem[]; total: number }>('/api/music', {
        limit: 100,
        page: 1,
        includeInstrumentals: showAccompaniments,
      })
      const fetchedSongs = data.songs || []
      setSongs(fetchedSongs)
    } catch (e) {
      console.error('Fetch songs error:', e)
      setSongs([])
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchSongs()
  }, [showAccompaniments])

  useEffect(() => {
    setPlaylist(displaySongs)
  }, [displaySongs, setPlaylist])

  const fetchAlbums = async () => {
    setLoadingAlbums(true)
    try {
      const data = await apiGet<{ albums: AlbumItem[]; total: number; hasMore?: boolean }>(
        '/api/albums',
        {
          limit: 100,
          page: 1,
        }
      )
      setAlbums(data.albums || [])
    } catch (error) {
      console.error('Fetch albums error:', error)
      setAlbums([])
    }
    setLoadingAlbums(false)
  }

  useEffect(() => {
    fetchAlbums()
  }, [])

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
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8 items-start">
          {/* Main Content */}
          <div>
            <MusicFilters
              activeTab={activeTab}
              onTabChange={setActiveTab}
              sortBy={sortBy}
              onSortByChange={(value) => {
                setSortBy(value)
                musicPagination.setPage(1)
              }}
              sortOrder={sortOrder}
              onSortOrderChange={setSortOrder}
              showAccompaniments={showAccompaniments}
              onShowAccompanimentsChange={setShowAccompaniments}
              musicCount={displaySongs.length}
              albumCount={albums.length}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
            />

            {/* Content */}
            {activeTab === 'music' ? (
              <div className="flex flex-col mt-6">
                {paginatedSongs.length > 0 ? (
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
                      {paginatedSongs.map((song) => (
                        <SongCard
                          key={song.docId}
                          song={song}
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
                      {paginatedAlbums.map((album) => (
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
                  <span className="text-text-primary font-medium">{songs.length}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">专辑</span>
                  <span className="text-text-primary font-medium">{albums.length}</span>
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
