import React, { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { SongCard } from '../Music/SongCard'
import { useMusic } from '../../context/MusicContext'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../Toast'
import { apiDelete, apiPost } from '../../lib/apiClient'
import { VIEW_MODE_CONFIG } from '../../lib/viewModes'
import type { SongItem } from '../../types/entities'
import type { ViewMode } from '../../types/userPreferences'

interface MusicSearchResultsProps {
  songs: SongItem[]
  viewMode: ViewMode
}

/**
 * 搜索页“音乐曲目”结果：复用音乐列表页的 SongCard 行/卡片，
 * 包含当前播放高亮、收藏切换与单曲播放。
 */
export const MusicSearchResults: React.FC<MusicSearchResultsProps> = ({ songs, viewMode }) => {
  const { currentSong, setCurrentSong, setIsPlaying } = useMusic()
  const { user } = useAuth()
  const { show } = useToast()
  const [displaySongs, setDisplaySongs] = useState<SongItem[]>(songs)
  const [favoriting, setFavoriting] = useState<string | null>(null)

  // 新搜索到达时同步数据；收藏切换只更新本地副本，避免被 props 回置
  useEffect(() => {
    setDisplaySongs(songs)
  }, [songs])

  const playSong = (song: SongItem) => {
    // SongCard 在无源时禁用按钮，setCurrentSong 内部也有可播放性守卫
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
    const next = !song.favoritedByMe
    const applyFavorite = (favoritedByMe: boolean) =>
      setDisplaySongs((prev) =>
        prev.map((item) => (item.docId === song.docId ? { ...item, favoritedByMe } : item))
      )

    applyFavorite(next)
    try {
      if (song.favoritedByMe) {
        await apiDelete(`/api/favorites/music/${song.docId}`)
      } else {
        await apiPost('/api/favorites', {
          targetType: 'music',
          targetId: song.docId,
        })
      }
    } catch (error) {
      console.error('Toggle music favorite error:', error)
      applyFavorite(song.favoritedByMe)
      show('收藏操作失败，请稍后重试', { variant: 'error' })
    } finally {
      setFavoriting(null)
    }
  }

  return (
    <div
      className={
        viewMode === 'list'
          ? 'flex flex-col gap-0.5'
          : clsx(
              'mobile-grid grid',
              VIEW_MODE_CONFIG[viewMode].gridCols,
              VIEW_MODE_CONFIG[viewMode].gap
            )
      }
    >
      {displaySongs.map((song) => (
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
  )
}
