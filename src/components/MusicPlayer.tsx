import React, { useState, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { useMusic } from '../context/MusicContext';
import { formatTime } from '../lib/formatUtils';
import { apiGet } from '../lib/apiClient';
import type { Platform, PlatformIds } from '../types/PlatformIds';

interface Song {
  id: string;
  docId?: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  audioUrl: string;
  playUrl?: string;
  lyric?: string | null;
  primaryPlatform?: Platform | null;
  platformIds?: PlatformIds;
}

interface MusicSongApiResponse {
  id: string;
  docId?: string | null;
  title: string;
  artist: string;
  album?: string;
  cover: string;
  coverUrl?: string;
  audioUrl: string;
  playUrl?: string;
  lyric?: string | null;
  primaryPlatform?: Platform | null;
  platformIds?: PlatformIds;
}

export const MusicPlayer = ({ songId }: { songId: string }) => {
  const { 
    currentSong, setCurrentSong, isPlaying, setIsPlaying, playNext, playPrevious,
    currentTime, duration, seekTo
  } = useMusic();
  const [song, setSong] = useState<Song | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSong = async () => {
      setLoading(true);
      try {
        const apiSong = await apiGet<MusicSongApiResponse>(`/api/music/song/${songId}`);
        setSong({
          id: apiSong.id,
          docId: apiSong.docId || undefined,
          title: apiSong.title,
          artist: apiSong.artist,
          album: apiSong.album || '',
          cover: apiSong.cover || apiSong.coverUrl || '',
          audioUrl: apiSong.playUrl || apiSong.audioUrl || '',
          playUrl: apiSong.playUrl,
          lyric: apiSong.lyric || null,
          primaryPlatform: apiSong.primaryPlatform,
          platformIds: apiSong.platformIds,
        });
      } catch (e) {
        console.error("Error fetching song:", e);
      }
      setLoading(false);
    };

    if (songId) fetchSong();
  }, [songId]);

  const togglePlay = () => {
    if (currentSong?.id !== song?.id) {
      setCurrentSong(song);
      setIsPlaying(true);
    } else {
      setIsPlaying(!isPlaying);
    }
  };

  if (loading) return <div className="py-4 text-center text-xs text-[#9e968e] animate-pulse">加载中...</div>;
  if (!song) return null;

  const isCurrent = currentSong?.id === song.id;

  return (
    <div className="bg-[#f7f5f0] rounded border border-[#e0dcd3] p-4">
      <div className="flex items-center gap-3 mb-3">
        <img 
          src={song.cover} 
          alt={song.title + ' 封面'}
          className="w-12 h-12 rounded object-cover bg-[#f0ece3] flex-shrink-0"
          referrerPolicy="no-referrer"
        />
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-[#2c2c2c] truncate">{song.title}</h4>
          <p className="text-xs text-[#9e968e] truncate">{song.artist} — {song.album}</p>
        </div>
      </div>

      <input 
        type="range"
        min="0"
        max={duration || 0}
        value={currentTime}
        onChange={(e) => seekTo(parseFloat(e.target.value))}
        disabled={!duration}
        className="w-full h-1 bg-[#e0dcd3] rounded-full appearance-none cursor-pointer mb-3"
        style={{ accentColor: 'var(--color-accent-antique)' }}
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button 
            onClick={playPrevious}
            className="p-1.5 text-[#6b6560] hover:text-[#c8951e] hover:bg-[#f0ece3] rounded-full transition-all"
          >
            <SkipBack size={16} />
          </button>
          <button 
            onClick={togglePlay}
            className="w-8 h-8 bg-[#c8951e] text-white rounded-full flex items-center justify-center hover:bg-[#dca828] transition-all"
          >
            {(isCurrent && isPlaying) ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
          </button>
          <button 
            onClick={playNext}
            className="p-1.5 text-[#6b6560] hover:text-[#c8951e] hover:bg-[#f0ece3] rounded-full transition-all"
          >
            <SkipForward size={16} />
          </button>
        </div>
        <span className="text-xs text-[#9e968e]">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
    </div>
  );
};
