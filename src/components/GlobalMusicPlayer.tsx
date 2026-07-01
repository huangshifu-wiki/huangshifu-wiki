import React, { useRef, useEffect, useState, useCallback } from 'react'
import { Play, Pause, SkipBack, SkipForward, Volume2, X } from 'lucide-react'
import { useMusic } from '../context/MusicContext'
import { formatTime } from '../lib/formatUtils'
import { formatMusicCredits } from '../lib/musicCredits'
import { apiGet } from '../lib/apiClient'
import { useFloatingPresence } from '../hooks/useFloatingPresence'
import type { MusicPlayUrlResponse } from '../types/api'

interface AudioStats {
  bufferHealth: number
  isStalling: boolean
  stallCount: number
  readyState: number
}

export const GlobalMusicPlayer = () => {
  const {
    currentSong,
    setCurrentSong,
    isPlaying,
    setIsPlaying,
    playNext,
    playPrevious,
    currentTime: contextCurrentTime,
    duration: contextDuration,
    volume: contextVolume,
    isMuted: contextIsMuted,
    seekTo,
    setVolume: contextSetVolume,
    toggleMute: contextToggleMute,
    setDuration: contextSetDuration,
  } = useMusic()
  const [resolvedPlayUrl, setResolvedPlayUrl] = useState('')
  const [resolvingPlayUrl, setResolvingPlayUrl] = useState(false)
  const [playUrlError, setPlayUrlError] = useState('')
  const [volumeSliderExpanded, setVolumeSliderExpanded] = useState(false)
  const [audioStats, setAudioStats] = useState<AudioStats>({
    bufferHealth: 0,
    isStalling: false,
    stallCount: 0,
    readyState: 0,
  })
  const volumeHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const timeUpdateRef = useRef<number>(0)

  useEffect(() => {
    return () => {
      if (volumeHideTimeoutRef.current) {
        clearTimeout(volumeHideTimeoutRef.current)
        volumeHideTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const resolvePlayUrl = async () => {
      if (!currentSong) {
        setResolvedPlayUrl('')
        setResolvingPlayUrl(false)
        setPlayUrlError('')
        return
      }

      const fallback = currentSong.audioUrl || ''
      if (!currentSong.docId) {
        setResolvedPlayUrl(currentSong.playUrl || fallback)
        setResolvingPlayUrl(false)
        setPlayUrlError('')
        return
      }

      setResolvingPlayUrl(true)
      setPlayUrlError('')

      try {
        const data = await apiGet<MusicPlayUrlResponse>(
          `/api/music/${encodeURIComponent(currentSong.docId)}/play-url`
        )
        const nextUrl =
          data.playable !== false && typeof data.playUrl === 'string' && data.playUrl.trim()
            ? data.playUrl.trim()
            : currentSong.playUrl || fallback
        setResolvedPlayUrl(nextUrl)
        if (!nextUrl) {
          setIsPlaying(false)
          setPlayUrlError('暂无可播放音源')
        }
      } catch (error) {
        console.error('Resolve play url failed:', error)
        setResolvedPlayUrl(currentSong.playUrl || fallback)
        setPlayUrlError('播放地址获取失败，已使用备用链接')
      } finally {
        setResolvingPlayUrl(false)
      }
    }

    resolvePlayUrl()
  }, [currentSong])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    if (resolvedPlayUrl !== audio.src) {
      audio.currentTime = 0
      seekTo(0)
      setAudioStats({
        bufferHealth: 0,
        isStalling: false,
        stallCount: 0,
        readyState: 0,
      })
    }

    if (!isPlaying || !resolvedPlayUrl) {
      audio.pause()
      return
    }

    const tryPlay = () => {
      audio.play().catch((e) => {
        console.error('Playback failed:', e)
        setIsPlaying(false)
      })
    }

    const canPlay =
      audio.readyState >= 3 ||
      (audio.buffered.length > 0 &&
        audio.buffered.end(audio.buffered.length - 1) - audio.currentTime > 2)

    if (canPlay) {
      tryPlay()
    } else {
      let cancelled = false
      const checkBuffer = () => {
        if (cancelled) return
        if (
          audio.buffered.length > 0 &&
          audio.buffered.end(audio.buffered.length - 1) - audio.currentTime > 2
        ) {
          tryPlay()
        } else {
          setTimeout(checkBuffer, 100)
        }
      }
      checkBuffer()
      return () => {
        cancelled = true
      }
    }
  }, [resolvedPlayUrl, isPlaying, seekTo, setIsPlaying])

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = contextIsMuted ? 0 : contextVolume
    }
  }, [contextVolume, contextIsMuted])

  useEffect(() => {
    if (audioRef.current && Math.abs(audioRef.current.currentTime - contextCurrentTime) > 0.5) {
      audioRef.current.currentTime = contextCurrentTime
    }
  }, [contextCurrentTime])

  const handleVolumeMouseEnter = () => {
    if (volumeHideTimeoutRef.current) {
      clearTimeout(volumeHideTimeoutRef.current)
      volumeHideTimeoutRef.current = null
    }
    setVolumeSliderExpanded(true)
  }

  const handleVolumeMouseLeave = () => {
    volumeHideTimeoutRef.current = setTimeout(() => {
      setVolumeSliderExpanded(false)
    }, 1000)
  }

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsPlaying(!isPlaying)
  }

  const handlePlayPrevious = (e: React.MouseEvent) => {
    e.stopPropagation()
    playPrevious()
  }

  const handlePlayNext = (e: React.MouseEvent) => {
    e.stopPropagation()
    playNext()
  }

  // 节流的时间更新处理 - 每 250ms 最多更新一次
  const onTimeUpdate = useCallback(() => {
    const now = Date.now()
    if (now - timeUpdateRef.current < 250) return
    timeUpdateRef.current = now

    if (audioRef.current) {
      seekTo(audioRef.current.currentTime)

      // 更新音频统计
      const audio = audioRef.current
      let bufferHealth = 0
      if (audio.buffered.length > 0) {
        const bufferedEnd = audio.buffered.end(audio.buffered.length - 1)
        bufferHealth = bufferedEnd - audio.currentTime
      }

      setAudioStats((prev) => ({
        ...prev,
        bufferHealth,
        readyState: audio.readyState,
      }))
    }
  }, [seekTo])

  const onLoadedMetadata = useCallback(() => {
    if (audioRef.current && audioRef.current.duration) {
      contextSetDuration(audioRef.current.duration)
    }
  }, [contextSetDuration])

  // 卡顿检测
  const onWaiting = useCallback(() => {
    setAudioStats((prev) => ({
      ...prev,
      isStalling: true,
      stallCount: prev.stallCount + 1,
    }))
    console.warn('[音频缓冲] 正在等待数据...')
  }, [])

  const onCanPlay = useCallback(() => {
    setAudioStats((prev) => ({
      ...prev,
      isStalling: false,
    }))
  }, [])

  const onError = useCallback((e: React.SyntheticEvent<HTMLAudioElement>) => {
    const audio = e.currentTarget
    console.error('[音频错误]', {
      error: audio.error,
      networkState: audio.networkState,
      readyState: audio.readyState,
      currentSrc: audio.currentSrc,
    })
    setPlayUrlError('音频加载失败，请检查网络连接')
  }, [])

  const handleProgressChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const time = parseFloat(e.target.value)
      if (audioRef.current) {
        audioRef.current.currentTime = time
        seekTo(time)
      }
    },
    [seekTo]
  )

  const volumePresence = useFloatingPresence(volumeSliderExpanded)

  if (!currentSong) return null

  return (
    <div
      className="fixed left-0 right-0 z-[200] border-t border-border bg-surface/96"
      style={{ bottom: 0, backdropFilter: 'blur(16px)' }}
    >
      {/* Progress bar */}
      <div
        className="absolute top-[-1px] left-0 right-0 h-[2px] bg-border cursor-pointer"
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={
          contextDuration > 0 ? Math.round((contextCurrentTime / contextDuration) * 100) : 0
        }
      >
        <input
          type="range"
          min="0"
          max={contextDuration || 0}
          value={contextCurrentTime}
          onChange={handleProgressChange}
          disabled={!contextDuration || resolvingPlayUrl}
          className="absolute top-0 left-0 w-full h-[2px] appearance-none cursor-pointer bg-transparent accent-antique"
        />
        <div
          ref={(el) => {
            if (el)
              el.style.width = `${contextDuration > 0 ? (contextCurrentTime / contextDuration) * 100 : 0}%`
          }}
          className="h-full bg-[var(--color-accent-antique)] pointer-events-none progress-bar-fill"
        />
      </div>

      <div className="max-w-[1100px] mx-auto px-6 flex items-center gap-4 py-[10px] px-[24px]">
        {/* Cover */}
        <img
          src={currentSong.cover}
          alt={currentSong?.title + ' 封面' || ''}
          className="w-11 h-11 rounded object-cover flex-shrink-0 bg-surface-alt"
          referrerPolicy="no-referrer"
        />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-[0.875rem] font-semibold text-text-primary truncate tracking-wide">
            {currentSong.title}
          </p>
          <p className="text-xs text-text-muted truncate mt-0.5">
            {formatMusicCredits(currentSong.artists, '未知歌手')}
          </p>
          {audioStats.isStalling && (
            <p className="text-[0.7rem] theme-text-warning animate-pulse">缓冲中...</p>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            onClick={handlePlayPrevious}
            className="p-1.5 text-text-secondary hover:text-brand-gold hover:bg-surface-alt rounded-full transition-all"
          >
            <SkipBack size={18} />
          </button>
          <button
            onClick={togglePlay}
            aria-label={isPlaying ? '暂停' : '播放'}
            className="w-9 h-9 theme-button-primary rounded-full flex items-center justify-center transition-all"
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
          </button>
          <button
            onClick={handlePlayNext}
            className="p-1.5 text-text-secondary hover:text-brand-gold hover:bg-surface-alt rounded-full transition-all"
          >
            <SkipForward size={18} />
          </button>
        </div>

        {/* Time */}
        <div className="hidden md:flex items-center gap-1 text-xs text-text-muted w-20 justify-end flex-shrink-0">
          <span>{formatTime(contextCurrentTime)}</span>
          <span>/</span>
          <span>{formatTime(contextDuration)}</span>
        </div>

        {/* Volume */}
        <div
          className="relative hidden md:block flex-shrink-0"
          onMouseEnter={handleVolumeMouseEnter}
          onMouseLeave={handleVolumeMouseLeave}
        >
          <button
            onClick={contextToggleMute}
            aria-label={contextIsMuted ? '静音' : '音量'}
            className="p-1.5 text-text-secondary hover:text-brand-gold hover:bg-surface-alt rounded-full transition-all"
          >
            <Volume2 size={18} />
          </button>
          {volumePresence.mounted && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2">
              <div
                className="floating-popover-up px-3 py-2 bg-surface rounded border border-border flex items-center gap-2"
                data-state={volumePresence.state}
                aria-hidden={!volumeSliderExpanded}
              >
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={contextIsMuted ? 0 : contextVolume}
                  onChange={(e) => contextSetVolume(parseFloat(e.target.value))}
                  className="w-20 h-1 bg-border rounded-full appearance-none cursor-pointer accent-antique"
                />
                <span className="text-xs text-[var(--color-text-antique-muted)] w-6 text-right">
                  {Math.round((contextIsMuted ? 0 : contextVolume) * 100)}
                </span>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => setCurrentSong(null)}
          className="p-1.5 text-text-muted theme-icon-button-danger hover:bg-surface-alt rounded-full transition-all flex-shrink-0"
        >
          <X size={18} />
        </button>
      </div>

      <audio
        ref={audioRef}
        src={resolvedPlayUrl || currentSong.playUrl || currentSong.audioUrl}
        preload="auto"
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onWaiting={onWaiting}
        onCanPlay={onCanPlay}
        onCanPlayThrough={onCanPlay}
        onError={onError}
        onEnded={playNext}
      />
    </div>
  )
}
