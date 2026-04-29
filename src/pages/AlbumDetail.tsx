import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Disc3, Play, Heart, ExternalLink, Link2, ChevronDown, ChevronUp } from 'lucide-react';
import { clsx } from 'clsx';

import { apiDelete, apiGet, apiPost } from '../lib/apiClient';
import { useMusic } from '../context/MusicContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { AlbumCoverManager } from '../components/AlbumCoverManager';
import { SmartImage } from '../components/SmartImage';
import { copyToClipboard, toAbsoluteInternalUrl } from '../lib/copyLink';
import { Platform, PlatformIds } from '../types/PlatformIds';

type SongItem = {
  docId: string;
  id: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  audioUrl: string;
  sourceUrl?: string | null;
  lyric?: string | null;
  favoritedByMe?: boolean;
  trackOrder?: number;
  primaryPlatform?: Platform | null;
  platformIds?: PlatformIds;
};

type AlbumResponse = {
  album: {
    id: string;
    title: string;
    artist: string;
    cover: string;
    description?: string | null;
    platformUrl?: string | null;
    tracks: SongItem[];
  };
};

const AlbumDetail = () => {
  const { albumId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [album, setAlbum] = useState<AlbumResponse['album'] | null>(null);
  const [favoriting, setFavoriting] = useState<string | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const [descNeedExpand, setDescNeedExpand] = useState(false);
  const descRef = useRef<HTMLDivElement>(null);
  const { user, isAdmin } = useAuth();

  useEffect(() => {
    if (descRef.current && !descExpanded) {
      setDescNeedExpand(descRef.current.scrollHeight > descRef.current.clientHeight + 1);
    }
  }, [album?.description, descExpanded]);
  const { currentSong, playAlbumTracks } = useMusic();
  const { show } = useToast();

  const fetchAlbum = async () => {
    if (!albumId) return;
    setLoading(true);
    try {
      const response = await apiGet<AlbumResponse>(`/api/albums/${albumId}`);
      setAlbum(response.album || null);
    } catch (error) {
      console.error('Fetch album detail error:', error);
      setAlbum(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlbum();
  }, [albumId]);

  const handlePlay = (index = 0) => {
    if (!album) return;
    const tracks = [...album.tracks].sort((a, b) => (a.trackOrder || 0) - (b.trackOrder || 0));
    playAlbumTracks(album.id, album.title, tracks, index);
  };

  const toggleFavorite = async (song: SongItem) => {
    if (!user || !song.docId || favoriting === song.docId) {
      if (!user) show('请先登录后收藏', { variant: 'error' });
      return;
    }

    setFavoriting(song.docId);
    try {
      if (song.favoritedByMe) {
        await apiDelete(`/api/favorites/music/${song.docId}`);
      } else {
        await apiPost('/api/favorites', {
          targetType: 'music',
          targetId: song.docId,
        });
      }

      setAlbum((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tracks: prev.tracks.map((track) => (
            track.docId === song.docId
              ? { ...track, favoritedByMe: !track.favoritedByMe }
              : track
          )),
        };
      });
    } catch (error) {
      console.error('Toggle favorite in album detail error:', error);
      show('收藏操作失败，请稍后重试', { variant: 'error' });
    } finally {
      setFavoriting(null);
    }
  };

  const handleCopyAlbumLink = async () => {
    if (!album?.id) return;
    const copied = await copyToClipboard(toAbsoluteInternalUrl(`/album/${album.id}`));
    if (copied) {
      show('专辑内链已复制');
      return;
    }
    show('复制链接失败，请稍后重试', { variant: 'error' });
  };

  if (loading) {
    return (
      <div
        className="min-h-screen"
        style={{ backgroundColor: '#f7f5f0', fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif" }}
      >
        <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32">
          <div className="h-40 bg-[#f0ece3] rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (!album) {
    return (
      <div
        className="min-h-screen"
        style={{ backgroundColor: '#f7f5f0', fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif" }}
      >
        <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32">
          <Link to="/music" className="inline-flex items-center gap-2 text-sm text-[#9e968e] hover:text-[#c8951e] transition-colors">
            <ArrowLeft size={16} /> 返回音乐馆
          </Link>
          <div className="mt-6 bg-white rounded border border-[#e0dcd3] p-10 text-center text-[#9e968e] italic tracking-[0.1em]">
            专辑不存在或已被删除
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: '#f7f5f0', color: '#2c2c2c', fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif", lineHeight: 1.8 }}
    >
      <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32">
        <Link to="/music" className="inline-flex items-center gap-2 text-sm text-[#9e968e] hover:text-[#c8951e] transition-colors mb-5">
          <ArrowLeft size={16} /> 返回音乐馆
        </Link>

        {/* Detail Header */}
        <div className="flex flex-col md:flex-row gap-5 mb-6 pb-6 border-b border-[#e0dcd3]">
          <SmartImage
            src={album.cover}
            alt={album.title}
            className="w-40 h-40 md:w-44 md:h-44 object-cover flex-shrink-0 rounded bg-[#f0ece3]"
          />
          <div className="flex-1 flex flex-col justify-center min-w-0">
            <h1 className="text-[1.75rem] font-bold text-[#2c2c2c] tracking-[0.12em] mb-1.5">{album.title}</h1>
            <p className="text-base text-[#6b6560] tracking-[0.08em] mb-4">{album.artist} · {album.tracks.length} 首歌曲</p>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => handlePlay(0)}
                disabled={album.tracks.length === 0}
                className="inline-flex items-center gap-2 px-6 py-2 bg-[#c8951e] text-white rounded text-[0.9375rem] tracking-[0.08em] hover:bg-[#dca828] transition-all disabled:opacity-50"
              >
                <Play size={16} /> 播放专辑
              </button>
              <button
                onClick={handleCopyAlbumLink}
                className="inline-flex items-center gap-2 px-5 py-2.5 border border-[#e0dcd3] text-[0.9375rem] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] rounded transition-all"
              >
                <Link2 size={15} /> 复制内链
              </button>
              {album.platformUrl ? (
                <a
                  href={album.platformUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 border border-[#e0dcd3] text-[0.9375rem] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] rounded transition-all"
                >
                  <ExternalLink size={15} /> 原始链接
                </a>
              ) : null}
            </div>
          </div>
        </div>

        {/* Description */}
        {album.description ? (
          <div className="mb-10">
            <h2 className="text-base font-semibold text-[#2c2c2c] tracking-[0.12em] mb-4 flex items-center gap-2">
              <span className="w-[3px] h-4 bg-[#c8951e] rounded-[1px] opacity-60 inline-block" />
              专辑简介
            </h2>
            <div ref={descRef} className={clsx('text-[#6b6560] leading-relaxed whitespace-pre-wrap', !descExpanded && 'line-clamp-3')}>
              {album.description}
            </div>
            {descNeedExpand && (
              <button
                onClick={() => setDescExpanded(!descExpanded)}
                className="text-xs px-3 py-1.5 border border-[#e0dcd3] text-[#9e968e] hover:text-[#c8951e] hover:border-[#c8951e] rounded transition-all duration-300 mt-3 inline-flex items-center gap-0.5"
              >
                {descExpanded ? (
                  <>收起 <ChevronUp size={12} /></>
                ) : (
                  <>展开 <ChevronDown size={12} /></>
                )}
              </button>
            )}
          </div>
        ) : null}

        {/* Track List */}
        <div className="mb-10">
          <h2 className="text-base font-semibold text-[#2c2c2c] tracking-[0.12em] mb-4 flex items-center gap-2">
            <span className="w-[3px] h-4 bg-[#c8951e] rounded-[1px] opacity-60 inline-block" />
            曲目列表
          </h2>
          <div className="flex flex-col">
            {album.tracks.map((track, index) => (
              <div
                key={track.docId}
                onClick={() => navigate(`/music/${track.docId}`)}
                className={clsx(
                  'flex items-center gap-4 py-3 px-1 border-b border-[#e0dcd3] cursor-pointer transition-colors',
                  currentSong?.docId === track.docId && 'bg-[#fdf5d8]/40'
                )}
              >
                <span className="text-sm text-[#9e968e] w-7 text-right flex-shrink-0">{(track.trackOrder ?? index) + 1}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handlePlay(index); }}
                  className="w-8 h-8 flex items-center justify-center text-[#6b6560] hover:text-[#c8951e] hover:bg-[#f0ece3] rounded-full transition-all flex-shrink-0"
                >
                  <Play size={14} />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-base text-[#2c2c2c] truncate hover:text-[#c8951e] transition-colors">{track.title}</p>
                  <p className="text-xs text-[#9e968e] truncate">{track.artist}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleFavorite(track); }}
                  disabled={favoriting === track.docId}
                  className={clsx(
                    'p-2 transition-colors flex-shrink-0',
                    track.favoritedByMe ? 'text-red-500' : 'text-[#9e968e] hover:text-red-500',
                    favoriting === track.docId && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  <Heart size={15} />
                </button>
              </div>
            ))}
          </div>
          {album.tracks.length === 0 ? (
            <div className="py-10 text-center text-[#9e968e] italic">
              <Disc3 className="mx-auto mb-2" size={28} />
              当前专辑暂无曲目
            </div>
          ) : null}
        </div>

        {/* Admin */}
        {isAdmin && albumId && (
          <div className="mb-10">
            <h2 className="text-base font-semibold text-[#2c2c2c] tracking-[0.12em] mb-4 flex items-center gap-2">
              <span className="w-[3px] h-4 bg-[#c8951e] rounded-[1px] opacity-60 inline-block" />
              管理功能
            </h2>
            <AlbumCoverManager
              albumDocId={albumId}
              currentCover={album.cover}
              onCoverUpdated={(newCoverUrl) => setAlbum((prev) => prev ? { ...prev, cover: newCoverUrl } : prev)}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default AlbumDetail;
