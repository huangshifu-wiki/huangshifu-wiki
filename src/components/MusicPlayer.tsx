import React, { useState, useEffect } from 'react'
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react'
import { useMusic } from '../context/MusicContext'
import { formatTime } from '../lib/formatUtils'
import { formatMusicCredits } from '../lib/musicCredits'
import { apiGet } from '../lib/apiClient'

interface Song {
  docId?: string
  title: string
  artists: string[]
  album: string
  cover: string
  audioUrl: string
  playUrl?: string
  lyric?: string | null
  description?: string | null
  playable?: boolean
}

interface MusicSongApiResponse {
  docId?: string | null
  title: string
  artists: string[]
  album?: string
  cover: string
  coverUrl?: string
  audioUrl: string
  playUrl?: string
  lyric?: string | null
  description?: string | null
  playable?: boolean
}

export const MusicPlayer = ({ songId }: { songId: string }) => {
  const {
    currentSong,
    setCurrentSong,
    isPlaying,
    setIsPlaying,
    playNext,
    playPrevious,
    currentTime,
    duration,
    seekTo,
  } = useMusic()
  const [song, setSong] = useState<Song | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchSong = async () => {
      setLoading(true)
      try {
        const apiSong = await apiGet<MusicSongApiResponse>(`/api/music/song/${songId}`)
        setSong({
          docId: apiSong.docId || undefined,
          title: apiSong.title,
          artists: apiSong.artists,
          album: apiSong.album || '',
          cover: apiSong.cover || apiSong.coverUrl || '',
          audioUrl: apiSong.playUrl || apiSong.audioUrl || '',
          playUrl: apiSong.playUrl,
          lyric: apiSong.lyric || null,
          description: apiSong.description || null,
          playable: apiSong.playable,
        })
      } catch (e) {
        console.error('Error fetching song:', e)
      }
      setLoading(false)
    }

    if (songId) fetchSong()
  }, [songId])

  const togglePlay = () => {
    if (currentSong?.docId !== song?.docId) {
      setCurrentSong(song)
      setIsPlaying(true)
    } else {
      setIsPlaying(!isPlaying)
    }
  }

  if (loading)
    return <div className="py-4 text-center text-xs text-text-muted animate-pulse">加载中...</div>
  if (!song) return null

  const isCurrent = currentSong?.docId === song.docId

  return (
    <div className="bg-surface-alt rounded border border-border p-4">
      <div className="flex items-center gap-3 mb-3">
        <img
          src={song.cover}
          alt={song.title + ' 封面'}
          className="w-12 h-12 rounded object-cover bg-surface flex-shrink-0"
          referrerPolicy="no-referrer"
        />
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-text-primary truncate">{song.title}</h4>
          <p className="text-xs text-text-muted truncate">
            {formatMusicCredits(song.artists, '未知歌手')} — {song.album}
          </p>
        </div>
      </div>

      <input
        type="range"
        min="0"
        max={duration || 0}
        value={currentTime}
        onChange={(e) => seekTo(parseFloat(e.target.value))}
        disabled={!duration}
        className="w-full h-1 bg-border rounded-full appearance-none cursor-pointer mb-3 accent-antique"
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={playPrevious}
            className="p-1.5 text-text-secondary hover:text-brand-gold hover:bg-surface rounded-full transition-all"
          >
            <SkipBack size={16} />
          </button>
          <button
            onClick={togglePlay}
            className="w-8 h-8 theme-button-primary rounded-full flex items-center justify-center transition-all"
          >
            {isCurrent && isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
          </button>
          <button
            onClick={playNext}
            className="p-1.5 text-text-secondary hover:text-brand-gold hover:bg-surface rounded-full transition-all"
          >
            <SkipForward size={16} />
          </button>
        </div>
        <span className="text-xs text-text-muted">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
    </div>
  )
}
