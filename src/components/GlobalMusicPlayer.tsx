import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useMusic } from '../context/MusicContext';
import { formatTime } from '../lib/formatUtils';
import { apiGet } from '../lib/apiClient';
import type { MusicPlayUrlResponse } from '../types/api';

interface AudioStats {
  bufferHealth: number;
  isStalling: boolean;
  stallCount: number;
  readyState: number;
}

export const GlobalMusicPlayer = () => {
  const { 
    currentSong, setCurrentSong, isPlaying, setIsPlaying, playNext, playPrevious,
    currentTime: contextCurrentTime, duration: contextDuration, volume: contextVolume, isMuted: contextIsMuted,
    seekTo, setVolume: contextSetVolume, toggleMute: contextToggleMute, setDuration: contextSetDuration
  } = useMusic();
  const [resolvedPlayUrl, setResolvedPlayUrl] = useState('');
  const [resolvingPlayUrl, setResolvingPlayUrl] = useState(false);
  const [playUrlError, setPlayUrlError] = useState('');
  const [volumeSliderExpanded, setVolumeSliderExpanded] = useState(false);
  const [audioStats, setAudioStats] = useState<AudioStats>({
    bufferHealth: 0,
    isStalling: false,
    stallCount: 0,
    readyState: 0
  });
  const volumeHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const timeUpdateRef = useRef<number>(0);

  useEffect(() => {
    const resolvePlayUrl = async () => {
      if (!currentSong) {
        setResolvedPlayUrl('');
        setResolvingPlayUrl(false);
        setPlayUrlError('');
        return;
      }

      const fallback = currentSong.audioUrl || '';
      if (!currentSong.docId) {
        setResolvedPlayUrl(currentSong.playUrl || fallback);
        setResolvingPlayUrl(false);
        setPlayUrlError('');
        return;
      }

      const neteaseId = currentSong.platformIds?.neteaseId;
      if (currentSong.primaryPlatform === 'netease' && neteaseId) {
        const directUrl = `https://music.163.com/song/media/outer/url?id=${neteaseId}.mp3`;
        setResolvedPlayUrl(directUrl);
        setResolvingPlayUrl(false);
        setPlayUrlError('');
        return;
      }

      setResolvingPlayUrl(true);
      setPlayUrlError('');

      try {
        const data = await apiGet<MusicPlayUrlResponse>(`/api/music/${encodeURIComponent(currentSong.docId)}/play-url`);
        const nextUrl = typeof data.playUrl === 'string' && data.playUrl.trim()
          ? data.playUrl.trim()
          : (currentSong.playUrl || fallback);
        setResolvedPlayUrl(nextUrl);
      } catch (error) {
        console.error('Resolve play url failed:', error);
        setResolvedPlayUrl(currentSong.playUrl || fallback);
        setPlayUrlError('播放地址获取失败，已使用备用链接');
      } finally {
        setResolvingPlayUrl(false);
      }
    };

    resolvePlayUrl();
  }, [currentSong]);

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
        readyState: 0
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
      audioRef.current.volume = contextIsMuted ? 0 : contextVolume;
    }
  }, [contextVolume, contextIsMuted]);

  useEffect(() => {
    if (audioRef.current && Math.abs(audioRef.current.currentTime - contextCurrentTime) > 0.5) {
      audioRef.current.currentTime = contextCurrentTime;
    }
  }, [contextCurrentTime]);

  const handleVolumeMouseEnter = () => {
    if (volumeHideTimeoutRef.current) {
      clearTimeout(volumeHideTimeoutRef.current);
      volumeHideTimeoutRef.current = null;
    }
    setVolumeSliderExpanded(true);
  };

  const handleVolumeMouseLeave = () => {
    volumeHideTimeoutRef.current = setTimeout(() => {
      setVolumeSliderExpanded(false);
    }, 1000);
  };

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsPlaying(!isPlaying);
  };

  const handlePlayPrevious = (e: React.MouseEvent) => {
    e.stopPropagation();
    playPrevious();
  };

  const handlePlayNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    playNext();
  };

  // 节流的时间更新处理 - 每 250ms 最多更新一次
  const onTimeUpdate = useCallback(() => {
    const now = Date.now();
    if (now - timeUpdateRef.current < 250) return;
    timeUpdateRef.current = now;
    
    if (audioRef.current) {
      seekTo(audioRef.current.currentTime);
      
      // 更新音频统计
      const audio = audioRef.current;
      let bufferHealth = 0;
      if (audio.buffered.length > 0) {
        const bufferedEnd = audio.buffered.end(audio.buffered.length - 1);
        bufferHealth = bufferedEnd - audio.currentTime;
      }
      
      setAudioStats(prev => ({
        ...prev,
        bufferHealth,
        readyState: audio.readyState
      }));
    }
  }, [seekTo]);

  const onLoadedMetadata = useCallback(() => {
    if (audioRef.current && audioRef.current.duration) {
      contextSetDuration(audioRef.current.duration);
    }
  }, [contextSetDuration]);

  // 卡顿检测
  const onWaiting = useCallback(() => {
    setAudioStats(prev => ({
      ...prev,
      isStalling: true,
      stallCount: prev.stallCount + 1
    }));
    console.warn('[音频缓冲] 正在等待数据...');
  }, []);

  const onCanPlay = useCallback(() => {
    setAudioStats(prev => ({
      ...prev,
      isStalling: false
    }));
  }, []);

  const onError = useCallback((e: React.SyntheticEvent<HTMLAudioElement>) => {
    const audio = e.currentTarget;
    console.error('[音频错误]', {
      error: audio.error,
      networkState: audio.networkState,
      readyState: audio.readyState,
      currentSrc: audio.currentSrc
    });
    setPlayUrlError('音频加载失败，请检查网络连接');
  }, []);

  const handleProgressChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      seekTo(time);
    }
  }, [seekTo]);

  if (!currentSong) return null;

  return (
    <div
      className="fixed left-0 right-0 z-[200] bg-white/96 border-t border-[#e0dcd3]"
      style={{ bottom: 0, backdropFilter: 'blur(16px)' }}
    >
      {/* Progress bar */}
      <div className="absolute top-[-1px] left-0 right-0 h-[2px] bg-[#ebe8e0] cursor-pointer">
        <input
          type="range"
          min="0"
          max={contextDuration || 0}
          value={contextCurrentTime}
          onChange={handleProgressChange}
          disabled={!contextDuration || resolvingPlayUrl}
          className="absolute top-0 left-0 w-full h-[2px] appearance-none cursor-pointer bg-transparent"
          style={{ accentColor: 'var(--color-accent-antique)' }}
        />
        <div
          className="h-full bg-[var(--color-accent-antique)] pointer-events-none"
          style={{ width: `${contextDuration > 0 ? (contextCurrentTime / contextDuration) * 100 : 0}%`, transition: 'width 0.3s linear' }}
        />
      </div>

      <div className="max-w-[1100px] mx-auto px-6 flex items-center gap-4" style={{ padding: '10px 24px' }}>
        {/* Cover */}
        <img
          src={currentSong.cover}
          alt={currentSong?.title + ' 封面' || ''}
          className="w-11 h-11 rounded object-cover flex-shrink-0 bg-[#f0ece3]"
          referrerPolicy="no-referrer"
        />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-[0.875rem] font-semibold text-[#2c2c2c] truncate tracking-wide">{currentSong.title}</p>
          <p className="text-xs text-[#9e968e] truncate mt-0.5">{currentSong.artist}</p>
          {audioStats.isStalling && (
            <p className="text-[0.7rem] text-amber-600 animate-pulse">缓冲中...</p>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            onClick={handlePlayPrevious}
            className="p-1.5 text-[#6b6560] hover:text-[#c8951e] hover:bg-[#f0ece3] rounded-full transition-all"
          >
            <SkipBack size={18} />
          </button>
          <button
            onClick={togglePlay}
            className="w-9 h-9 bg-[#c8951e] text-white rounded-full flex items-center justify-center hover:bg-[#dca828] transition-all"
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
          </button>
          <button
            onClick={handlePlayNext}
            className="p-1.5 text-[#6b6560] hover:text-[#c8951e] hover:bg-[#f0ece3] rounded-full transition-all"
          >
            <SkipForward size={18} />
          </button>
        </div>

        {/* Time */}
        <div className="hidden md:flex items-center gap-1 text-xs text-[#9e968e] w-20 justify-end flex-shrink-0">
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
            className="p-1.5 text-[#6b6560] hover:text-[#c8951e] hover:bg-[#f0ece3] rounded-full transition-all"
          >
            <Volume2 size={18} />
          </button>
          <AnimatePresence>
            {volumeSliderExpanded && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-white rounded border border-[#e0dcd3] flex items-center gap-2"
              >
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={contextIsMuted ? 0 : contextVolume}
                  onChange={(e) => contextSetVolume(parseFloat(e.target.value))}
                  className="w-20 h-1 bg-[#ebe8e0] rounded-full appearance-none cursor-pointer"
                  style={{ accentColor: 'var(--color-accent-antique)' }}
                />
                <span className="text-xs text-[var(--color-text-antique-muted)] w-6 text-right">
                  {Math.round((contextIsMuted ? 0 : contextVolume) * 100)}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <button
          onClick={() => setCurrentSong(null)}
          className="p-1.5 text-[#9e968e] hover:text-red-500 hover:bg-[#f0ece3] rounded-full transition-all flex-shrink-0"
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
  );
};
