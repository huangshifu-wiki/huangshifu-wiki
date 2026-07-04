import React, { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react'
import { isPlayableSong } from '../lib/musicPlayback'
import type { MusicExternalSource } from '../types/entities'

interface Song {
  docId?: string
  title: string
  artists: string[]
  album: string
  cover: string
  coverThumbnail?: string
  audioUrl: string
  playUrl?: string
  lyric?: string | null
  description?: string | null
  releaseDate?: string | null
  durationMs?: number | null
  sources?: MusicExternalSource[]
  playable?: boolean
}

interface MusicContextType {
  currentSong: Song | null
  setCurrentSong: (song: Song | null) => void
  isPlaying: boolean
  setIsPlaying: (playing: boolean) => void
  playlist: Song[]
  currentIndex: number
  setPlaylist: (songs: Song[]) => void
  playAlbumTracks: (albumId: string, albumTitle: string, songs: Song[], startIndex?: number) => void
  playSongAtIndex: (index: number) => void
  playNext: () => void
  playPrevious: () => void
  currentTime: number
  duration: number
  setDuration: (duration: number) => void
  volume: number
  isMuted: boolean
  seekTo: (time: number) => void
  setVolume: (volume: number) => void
  toggleMute: () => void
}

const MusicContext = createContext<MusicContextType | undefined>(undefined)

export const MusicProvider = ({ children }: { children: ReactNode }) => {
  const [currentSong, setCurrentSongState] = useState<Song | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playlist, setPlaylistState] = useState<Song[]>([])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(1)
  const [isMuted, setIsMuted] = useState(false)

  const setPlaylist = useCallback(
    (songs: Song[]) => {
      const playableSongs = songs.filter(isPlayableSong)
      setPlaylistState(playableSongs)

      if (!playableSongs.length) {
        setCurrentIndex(-1)
        return
      }

      setCurrentIndex((prevIndex) => {
        if (
          prevIndex >= 0 &&
          prevIndex < playableSongs.length &&
          currentSong &&
          playableSongs[prevIndex] &&
          playableSongs[prevIndex].docId &&
          currentSong.docId &&
          playableSongs[prevIndex].docId === currentSong.docId
        ) {
          return prevIndex
        }

        if (!currentSong) {
          return -1
        }

        const matched = playableSongs.findIndex(
          (song) => song.docId && song.docId === currentSong.docId
        )
        return matched
      })
    },
    [currentSong]
  )

  const setCurrentSong = useCallback(
    (song: Song | null) => {
      if (!song || !isPlayableSong(song)) {
        setCurrentSongState(null)
        setCurrentIndex(-1)
        setIsPlaying(false)
        return
      }

      setCurrentSongState(song)

      const index = playlist.findIndex((item) => item.docId && item.docId === song.docId)
      setCurrentIndex(index)
    },
    [playlist]
  )

  const playSongAtIndex = useCallback(
    (index: number) => {
      if (!playlist.length) return

      const normalizedIndex = ((index % playlist.length) + playlist.length) % playlist.length
      const song = playlist[normalizedIndex]
      if (!song) return

      setCurrentIndex(normalizedIndex)
      setCurrentSongState(song)
      setIsPlaying(true)
    },
    [playlist]
  )

  const playAlbumTracks = useCallback(
    (_albumId: string, _albumTitle: string, songs: Song[], startIndex = 0) => {
      const playableSongs = songs.filter(isPlayableSong)
      if (!playableSongs.length) {
        return
      }

      setPlaylistState(playableSongs)
      const targetSong = songs[startIndex]
      const targetIndex =
        targetSong?.docId && isPlayableSong(targetSong)
          ? playableSongs.findIndex((song) => song.docId === targetSong.docId)
          : -1
      const normalizedIndex =
        targetIndex >= 0
          ? targetIndex
          : ((startIndex % playableSongs.length) + playableSongs.length) % playableSongs.length
      const song = playableSongs[normalizedIndex]
      if (!song) {
        return
      }

      setCurrentIndex(normalizedIndex)
      setCurrentSongState(song)
      setIsPlaying(true)
    },
    []
  )

  const playNext = useCallback(() => {
    if (!playlist.length) return
    if (currentIndex < 0) {
      playSongAtIndex(0)
      return
    }
    playSongAtIndex(currentIndex + 1)
  }, [currentIndex, playSongAtIndex, playlist.length])

  const playPrevious = useCallback(() => {
    if (!playlist.length) return
    if (currentIndex < 0) {
      playSongAtIndex(playlist.length - 1)
      return
    }
    playSongAtIndex(currentIndex - 1)
  }, [currentIndex, playSongAtIndex, playlist.length])

  const seekTo = useCallback((time: number) => {
    setCurrentTime(time)
  }, [])

  const setVolume = useCallback(
    (v: number) => {
      setVolumeState(v)
      if (isMuted && v > 0) {
        setIsMuted(false)
      }
    },
    [isMuted]
  )

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev)
  }, [])

  const value = useMemo(
    () => ({
      currentSong,
      setCurrentSong,
      isPlaying,
      setIsPlaying,
      playlist,
      currentIndex,
      setPlaylist,
      playAlbumTracks,
      playSongAtIndex,
      playNext,
      playPrevious,
      currentTime,
      duration,
      setDuration,
      volume,
      isMuted,
      seekTo,
      setVolume,
      toggleMute,
    }),
    [
      currentSong,
      setCurrentSong,
      isPlaying,
      playlist,
      currentIndex,
      setPlaylist,
      playAlbumTracks,
      playSongAtIndex,
      playNext,
      playPrevious,
      currentTime,
      duration,
      volume,
      isMuted,
      seekTo,
      setVolume,
      toggleMute,
    ]
  )

  return <MusicContext.Provider value={value}>{children}</MusicContext.Provider>
}

export const useMusic = () => {
  const context = useContext(MusicContext)
  if (context === undefined) {
    throw new Error('useMusic must be used within a MusicProvider')
  }
  return context
}
