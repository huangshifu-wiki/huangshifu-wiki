import React, { useRef, useEffect, useState, useCallback } from 'react'
import { Music, Pause, Play, SkipBack, SkipForward, Volume2, X } from '@/src/components/icons'
import { Spinner } from '@/src/components/ui'
import { SmartImage } from './SmartImage'
import { CoverPlaceholder } from './CoverPlaceholder'
import { useMusic } from '../context/MusicContext'
import { formatTime } from '../lib/formatUtils'
import { formatMusicCredits } from '../lib/musicCredits'
import { apiGet } from '../lib/apiClient'
import { useFloatingPresence } from '../hooks/useFloatingPresence'
import { getI18n } from '../lib/i18n'
import type { MusicPlayUrlResponse } from '../types/api'

interface AudioStats {
  bufferHealth: number
  isStalling: boolean
  stallCount: number
  readyState: number
}

type PlaybackPhase = 'idle' | 'loading' | 'playing' | 'buffering' | 'paused' | 'ended' | 'error'

type ResolvedPlayUrlState = {
  docId: string
  url: string
}

const { t } = getI18n()
const EMPTY_RESOLVED_PLAY_URL: ResolvedPlayUrlState = { docId: '', url: '' }

export const GlobalMusicPlayer = () => {
  const {
    currentSong,
    setCurrentSong,
    isPlaying,
    setIsPlaying,
    playNext,
    playlist,
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
  const [resolvedPlayUrl, setResolvedPlayUrl] =
    useState<ResolvedPlayUrlState>(EMPTY_RESOLVED_PLAY_URL)
  const [resolvingPlayUrl, setResolvingPlayUrl] = useState(false)
  const [playUrlError, setPlayUrlError] = useState('')
  const [blockedSongDocId, setBlockedSongDocId] = useState('')
  const [phase, setPhase] = useState<PlaybackPhase>('idle')
  const [resolveAttempt, setResolveAttempt] = useState(0)
  const [volumeSliderExpanded, setVolumeSliderExpanded] = useState(false)
  const audioStatsRef = useRef<AudioStats>({
    bufferHealth: 0,
    isStalling: false,
    stallCount: 0,
    readyState: 0,
  })
  const volumeHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const timeUpdateRef = useRef<number>(0)
  const previousAudioUrlRef = useRef('')
  const previousSongRef = useRef<typeof currentSong>(null)
  const hasPlayedRef = useRef(false)
  const failedSourceRef = useRef('')
  const currentSongDocId = currentSong?.docId || ''
  const currentResolvedPlayUrl =
    currentSongDocId && resolvedPlayUrl.docId === currentSongDocId ? resolvedPlayUrl.url : ''
  const playbackBlocked =
    currentSong?.playableOverride === 'disabled' ||
    Boolean(currentSongDocId && currentSongDocId === blockedSongDocId)
  const activeAudioUrl = playbackBlocked
    ? ''
    : currentResolvedPlayUrl || currentSong?.playUrl || currentSong?.audioUrl || ''
  const waitingForResolvedPlayUrl =
    Boolean(currentSongDocId) &&
    !activeAudioUrl &&
    (resolvingPlayUrl || resolvedPlayUrl.docId !== currentSongDocId)
  const sourceKey = JSON.stringify([currentSongDocId || currentSong?.title, activeAudioUrl])
  const statusError = playbackBlocked ? t('music.unplayable') : playUrlError
  const displayPhase = phase === 'error' ? 'idle' : phase
  const statusPhase =
    isPlaying && (displayPhase === 'idle' || displayPhase === 'loading')
      ? waitingForResolvedPlayUrl
        ? 'resolving'
        : 'loading'
      : displayPhase
  const statusText = statusError || t(`music.${statusPhase}`)
  const showSpinner =
    !statusError &&
    (statusPhase === 'loading' || statusPhase === 'buffering' || statusPhase === 'resolving')

  useEffect(() => {
    return () => {
      if (volumeHideTimeoutRef.current) {
        clearTimeout(volumeHideTimeoutRef.current)
        volumeHideTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const resolvePlayUrl = async () => {
      if (!currentSong) {
        setResolvedPlayUrl(EMPTY_RESOLVED_PLAY_URL)
        setResolvingPlayUrl(false)
        setBlockedSongDocId('')
        setPlayUrlError('')
        return
      }

      const fallback = currentSong.audioUrl || ''
      if (!currentSong.docId) {
        setResolvedPlayUrl(EMPTY_RESOLVED_PLAY_URL)
        setResolvingPlayUrl(false)
        setPlayUrlError('')
        return
      }

      setResolvedPlayUrl((prev) =>
        prev.docId === currentSong.docId ? prev : { docId: currentSong.docId, url: '' }
      )
      setResolvingPlayUrl(true)

      try {
        const data = await apiGet<MusicPlayUrlResponse>(
          `/api/music/${encodeURIComponent(currentSong.docId)}/play-url`
        )
        if (cancelled) return
        setBlockedSongDocId(data.mode === 'disabled' ? currentSong.docId : '')
        const nextUrl =
          data.playable !== false && typeof data.playUrl === 'string' && data.playUrl.trim()
            ? data.playUrl.trim()
            : data.mode === 'disabled'
              ? ''
              : currentSong.playUrl || fallback
        setResolvedPlayUrl({ docId: currentSong.docId, url: nextUrl })
        if (!nextUrl) {
          setIsPlaying(false)
          setPlayUrlError(data.mode === 'disabled' ? t('music.unplayable') : t('music.noSource'))
          setPhase('error')
        }
      } catch (error) {
        if (cancelled) return
        console.error('Resolve play url failed:', error)
        const fallbackUrl = currentSong.playUrl || fallback
        setResolvedPlayUrl({ docId: currentSong.docId, url: fallbackUrl })
        if (!fallbackUrl) {
          setIsPlaying(false)
          setPlayUrlError(t('music.resolveFailed'))
          setPhase('error')
        }
      } finally {
        if (!cancelled) {
          setResolvingPlayUrl(false)
        }
      }
    }

    resolvePlayUrl()
    return () => {
      cancelled = true
    }
  }, [currentSong, setIsPlaying, resolveAttempt, t])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const songChanged = previousSongRef.current !== currentSong
    if (activeAudioUrl !== previousAudioUrlRef.current || songChanged) {
      previousSongRef.current = currentSong
      previousAudioUrlRef.current = activeAudioUrl
      hasPlayedRef.current = false
      audio.currentTime = 0
      seekTo(0)
      contextSetDuration(0)
      if (songChanged) {
        failedSourceRef.current = ''
        setPlayUrlError('')
      }
      setPhase((prev) =>
        isPlaying ? 'loading' : !songChanged && prev === 'paused' ? 'paused' : 'idle'
      )
      audioStatsRef.current = {
        bufferHealth: 0,
        isStalling: false,
        stallCount: 0,
        readyState: 0,
      }
    }
  }, [activeAudioUrl, currentSong, contextSetDuration, seekTo])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    if (!isPlaying) {
      audio.pause()
      setPhase((prev) =>
        prev === 'loading' || prev === 'playing' || prev === 'buffering' ? 'paused' : prev
      )
      return
    }

    if (!activeAudioUrl) {
      if (waitingForResolvedPlayUrl || playUrlError) return
      audio.pause()
      setIsPlaying(false)
      setPlayUrlError(playbackBlocked ? t('music.unplayable') : t('music.noSource'))
      setPhase('error')
      return
    }

    setPhase('loading')

    let cancelled = false
    audio.play().catch((e) => {
      if (cancelled || audioRef.current !== audio) return
      console.error('Playback failed:', e)
      failedSourceRef.current = sourceKey
      setIsPlaying(false)
      setPlayUrlError(t('music.startFailed'))
      setPhase('error')
    })

    return () => {
      cancelled = true
    }
  }, [activeAudioUrl, currentSong, isPlaying, setIsPlaying, waitingForResolvedPlayUrl, t])

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = contextIsMuted ? 0 : contextVolume
    }
  }, [contextVolume, contextIsMuted, sourceKey])

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
    if (isPlaying) {
      setPhase('paused')
      setIsPlaying(false)
    } else if (!playbackBlocked) {
      setPhase('loading')
      if (!activeAudioUrl && !waitingForResolvedPlayUrl) {
        setResolveAttempt((attempt) => attempt + 1)
      }
      setIsPlaying(true)
    }
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

      audioStatsRef.current.bufferHealth = bufferHealth
      audioStatsRef.current.readyState = audio.readyState
    }
  }, [seekTo])

  const onLoadedMetadata = useCallback(() => {
    if (audioRef.current && audioRef.current.duration) {
      contextSetDuration(audioRef.current.duration)
    }
  }, [contextSetDuration])

  const onWaiting = useCallback(() => {
    if (!isPlaying) return
    setPhase(hasPlayedRef.current ? 'buffering' : 'loading')
    audioStatsRef.current.isStalling = true
    audioStatsRef.current.stallCount += 1
  }, [isPlaying])

  const onCanPlay = useCallback(() => {
    audioStatsRef.current.isStalling = false
    if (failedSourceRef.current && failedSourceRef.current !== sourceKey) {
      failedSourceRef.current = ''
      setPlayUrlError('')
    }
  }, [sourceKey])

  const onPlaying = useCallback(() => {
    if (!isPlaying) return
    hasPlayedRef.current = true
    setPlayUrlError('')
    setPhase('playing')
    audioStatsRef.current.isStalling = false
  }, [isPlaying])

  const onError = useCallback(
    (e: React.SyntheticEvent<HTMLAudioElement>) => {
      const audio = e.currentTarget
      console.error('[音频错误]', {
        error: audio.error,
        networkState: audio.networkState,
        readyState: audio.readyState,
        currentSrc: audio.currentSrc,
      })
      failedSourceRef.current = sourceKey
      setIsPlaying(false)
      setPhase('error')
      setPlayUrlError(t('music.audioFailed'))
    },
    [setIsPlaying, sourceKey, t]
  )

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
    <div className="global-music-player fixed left-0 right-0 z-[200] border-t border-[var(--book-ink-line)] bg-[var(--book-panel-bg-strong)] shadow-[0_-14px_36px_rgba(72,53,25,0.08)] backdrop-blur-[16px]">
      {/* Progress bar */}
      <div
        className="absolute top-[-1px] left-0 right-0 h-[2px] bg-[var(--book-ink-line)] cursor-pointer"
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

      <div className="mx-auto flex max-w-[1100px] items-center gap-2 px-3 py-[8px] sm:gap-4 sm:px-6 sm:py-[10px] md:px-[24px]">
        {/* Cover */}
        <SmartImage
          src={currentSong.coverThumbnail || currentSong.cover}
          alt={`${currentSong.title} 封面`}
          className="h-10 w-10 flex-shrink-0 rounded shadow-[0_6px_18px_rgba(72,53,25,0.12)] sm:h-11 sm:w-11"
          lazy={false}
          fallback={
            <CoverPlaceholder
              icon={<Music size={16} />}
              label="无封面"
              labelClassName="text-[0.65rem] leading-none"
            />
          }
        />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-[0.875rem] font-semibold text-text-primary truncate tracking-wide">
            {currentSong.title}
          </p>
          <p className="text-xs text-text-muted truncate mt-0.5">
            {formatMusicCredits(currentSong.artists, '未知歌手')}
          </p>
          <div
            className={`mt-0.5 flex min-w-0 items-center gap-1 text-[0.7rem] ${statusError ? 'theme-text-error' : 'text-text-muted'}`}
            aria-live="polite"
            role={statusError ? 'alert' : undefined}
          >
            {showSpinner && (
              <span aria-hidden="true" className="shrink-0">
                <Spinner size="sm" className="h-3 w-3" />
              </span>
            )}
            <span className="truncate">{statusText}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-shrink-0 items-center gap-1 sm:gap-3">
          <button
            onClick={handlePlayPrevious}
            aria-label="上一首"
            className="hidden rounded-full p-1.5 text-text-secondary transition-all hover:bg-[var(--book-panel-hover)] hover:text-brand-gold sm:inline-flex"
          >
            <SkipBack size={18} />
          </button>
          <button
            onClick={togglePlay}
            aria-label={isPlaying ? '暂停' : '播放'}
            className="mobile-touch-target flex h-9 w-9 items-center justify-center rounded-full theme-button-primary transition-all"
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
          </button>
          <button
            onClick={handlePlayNext}
            aria-label="下一首"
            className="hidden rounded-full p-1.5 text-text-secondary transition-all hover:bg-[var(--book-panel-hover)] hover:text-brand-gold sm:inline-flex"
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
            className="p-1.5 text-text-secondary hover:text-brand-gold hover:bg-[var(--book-panel-hover)] rounded-full transition-all"
          >
            <Volume2 size={18} />
          </button>
          {volumePresence.mounted && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2">
              <div
                className="floating-popover-up px-3 py-2 bg-[var(--ui-floating-bg)] rounded border border-[var(--book-ink-line)] flex items-center gap-2 shadow-[var(--book-panel-shadow)]"
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
          aria-label="关闭播放器"
          className="mobile-touch-target p-1.5 text-text-muted theme-icon-button-danger hover:bg-[var(--book-panel-hover)] rounded-full transition-all flex-shrink-0"
        >
          <X size={18} />
        </button>
      </div>

      <audio
        key={sourceKey}
        ref={audioRef}
        src={activeAudioUrl}
        preload="auto"
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onLoadStart={() => {
          if (isPlaying) setPhase('loading')
        }}
        onPlaying={onPlaying}
        onPause={() => {
          if (!audioRef.current?.ended) {
            setPhase((prev) => (prev === 'error' ? prev : 'paused'))
            if (isPlaying) setIsPlaying(false)
          }
        }}
        onSeeking={onWaiting}
        onSeeked={() => {
          const audio = audioRef.current
          if (!audio || !isPlaying) return
          if (audio.paused || audio.seeking || audio.readyState < 3) {
            onWaiting()
          } else if (hasPlayedRef.current) {
            onPlaying()
          }
        }}
        onStalled={onWaiting}
        onWaiting={onWaiting}
        onCanPlay={onCanPlay}
        onCanPlayThrough={onCanPlay}
        onError={onError}
        onEnded={() => {
          if (playlist.length > 1) {
            playNext()
          } else {
            setIsPlaying(false)
            setPhase('ended')
          }
        }}
      />
    </div>
  )
}
