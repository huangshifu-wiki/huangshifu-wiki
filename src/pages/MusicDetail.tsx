import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, ExternalLink, Heart, Link2, MessageSquare, Play, ChevronDown, ChevronUp, Music as MusicIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { format } from 'date-fns';

import { apiDelete, apiGet, apiPost } from '../lib/apiClient';
import { useAuth } from '../context/AuthContext';
import { useMusic } from '../context/MusicContext';
import { useToast } from '../components/Toast';
import { SongCoverManager } from '../components/SongCoverManager';
import { SmartImage } from '../components/SmartImage';
import { SongEditModal } from '../components/SongEditModal';
import { LyricsDisplay } from '../components/LyricsDisplay';
import { copyToClipboard, toAbsoluteInternalUrl } from '../lib/copyLink';
import { Platform, PlatformIds } from '../types/PlatformIds';

type CustomPlatformLink = {
  label: string;
  url: string;
};

type CustomPlatformConfig = {
  key: string;
  label: string;
  urlPattern: string;
  color: string;
  bgColor: string;
};

type SongItem = {
  docId: string;
  id: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  audioUrl: string;
  lyric?: string | null;
  description?: string | null;
  primaryPlatform?: Platform | null;
  favoritedByMe?: boolean;
  platformIds?: PlatformIds;
  customPlatformIds?: Record<string, string>;
  customPlatformLinks?: CustomPlatformLink[];
};

type SongDetailResponse = {
  song: SongItem & { platformIds?: PlatformIds };
};

type PostItem = {
  id: string;
  title: string;
  likesCount: number;
  commentsCount: number;
  updatedAt: string;
};

const getSongExternalUrl = (song: SongItem) => {
  const id = (song.id || '').trim();
  if (!id) {
    return '#';
  }

  const platform = song.primaryPlatform || 'netease';
  if (platform === 'tencent') {
    return `https://y.qq.com/n/ryqq/songDetail/${id}`;
  }
  if (platform === 'kugou') {
    return `https://www.kugou.com/song/#hash=${id}`;
  }
  if (platform === 'kuwo') {
    return `https://www.kuwo.cn/play_detail/${id}`;
  }
  if (platform === 'baidu') {
    return `https://music.91q.com/#/song/${id}`;
  }
  return `https://music.163.com/song?id=${id}`;
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return '刚刚';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '刚刚' : format(parsed, 'yyyy-MM-dd');
};

const MusicDetail = () => {
  const { songId } = useParams();
  const navigate = useNavigate();
  const [song, setSong] = useState<SongItem | null>(null);
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [favoriting, setFavoriting] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [customPlatforms, setCustomPlatforms] = useState<CustomPlatformConfig[]>([]);
  const [descExpanded, setDescExpanded] = useState(false);
  const [lyricsExpanded, setLyricsExpanded] = useState(false);
  const [lyricsCopied, setLyricsCopied] = useState(false);
  const { user, isAdmin } = useAuth();
  const { setCurrentSong, setIsPlaying, setPlaylist } = useMusic();
  const { show } = useToast();

  useEffect(() => {
    apiGet<{ platforms: CustomPlatformConfig[] }>('/api/music-platforms')
      .then(data => setCustomPlatforms(data.platforms || []))
      .catch(() => setCustomPlatforms([]));
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      if (!songId) return;
      setLoading(true);
      try {
        const detail = await apiGet<SongDetailResponse>(`/api/music/${songId}`);
        const currentSong = detail.song || null;
        setSong(currentSong);
        if (currentSong?.docId) {
          const postResult = await apiGet<{ posts: PostItem[] }>(`/api/music/${currentSong.docId}/posts`);
          setPosts(postResult.posts || []);
        } else {
          setPosts([]);
        }
      } catch (error) {
        console.error('Fetch song detail failed:', error);
        setSong(null);
        setPosts([]);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [songId]);

  const customPlatformLinks = song?.customPlatformLinks || [];

  const handlePlay = () => {
    if (!song) return;
    setPlaylist([song]);
    setCurrentSong(song);
    setIsPlaying(true);
  };

  const handleCopyLink = async () => {
    if (!song?.docId) return;
    const copied = await copyToClipboard(toAbsoluteInternalUrl(`/music/${song.docId}`));
    if (copied) {
      show('歌曲内链已复制');
      return;
    }
    show('复制链接失败，请稍后重试', { variant: 'error' });
  };

  const handleCopyLyrics = async () => {
    if (!song?.lyric) return;
    try {
      await navigator.clipboard.writeText(song.lyric);
      setLyricsCopied(true);
      setTimeout(() => setLyricsCopied(false), 2000);
    } catch {
      show('复制失败，请手动复制', { variant: 'error' });
    }
  };

  const handleToggleFavorite = async () => {
    if (!song || !song.docId) return;
    if (!user) {
      show('请先登录后收藏', { variant: 'error' });
      return;
    }
    if (favoriting) return;

    setFavoriting(true);
    try {
      if (song.favoritedByMe) {
        await apiDelete(`/api/favorites/music/${song.docId}`);
        setSong((prev) => (prev ? { ...prev, favoritedByMe: false } : prev));
      } else {
        await apiPost('/api/favorites', {
          targetType: 'music',
          targetId: song.docId,
        });
        setSong((prev) => (prev ? { ...prev, favoritedByMe: true } : prev));
      }
    } catch (error) {
      console.error('Toggle song favorite failed:', error);
      show('收藏操作失败，请稍后重试', { variant: 'error' });
    } finally {
      setFavoriting(false);
    }
  };

  if (loading) {
    return (
      <div
        className="min-h-screen"
        style={{ backgroundColor: '#f7f5f0', fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif" }}
      >
        <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32">
          <div className="h-48 bg-[#f0ece3] rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (!song) {
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
            歌曲不存在或已被删除
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

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8 items-start">
          {/* Main Content */}
          <div>
            {/* Detail Header */}
            <div className="flex flex-col md:flex-row gap-5 mb-6 pb-6 border-b border-[#e0dcd3]">
              <SmartImage
                src={song.cover}
                alt={song.title}
                className="w-40 h-40 md:w-44 md:h-44 object-cover flex-shrink-0 rounded bg-[#f0ece3]"
              />
              <div className="flex-1 flex flex-col justify-center min-w-0">
                <h1 className="text-[1.75rem] font-bold text-[#2c2c2c] tracking-[0.12em] mb-1.5">{song.title}</h1>
                <p className="text-base text-[#6b6560] tracking-[0.08em] mb-3">{song.artist}</p>
                <div className="flex flex-wrap gap-x-5 gap-y-2 mb-4 text-sm text-[#9e968e]">
                  <span>专辑：{song.album}</span>
                  <span>ID：{song.id}</span>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handlePlay}
                    className="inline-flex items-center gap-2 px-6 py-2 bg-[#c8951e] text-white rounded text-[0.9375rem] tracking-[0.08em] hover:bg-[#dca828] transition-all"
                  >
                    <Play size={16} /> 播放
                  </button>
                  <button
                    onClick={handleToggleFavorite}
                    disabled={favoriting}
                    className={clsx(
                      'inline-flex items-center gap-2 px-5 py-2.5 border text-[0.9375rem] rounded transition-all',
                      song.favoritedByMe
                        ? 'border-red-200 text-red-500 bg-red-50'
                        : 'border-[#e0dcd3] text-[#6b6560] hover:text-red-500 hover:border-red-200',
                      favoriting && 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    <Heart size={15} /> {song.favoritedByMe ? '已收藏' : '收藏'}
                  </button>
                  <button
                    onClick={handleCopyLink}
                    className="inline-flex items-center gap-2 px-5 py-2.5 border border-[#e0dcd3] text-[0.9375rem] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] rounded transition-all"
                  >
                    <Link2 size={15} /> 复制内链
                  </button>
                  <a
                    href={getSongExternalUrl(song)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-5 py-2.5 border border-[#e0dcd3] text-[0.9375rem] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] rounded transition-all"
                  >
                    <ExternalLink size={15} /> 原始链接
                  </a>
                </div>
              </div>
            </div>

            {/* Lyrics */}
            <div className="mb-10">
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-base font-semibold text-[#2c2c2c] tracking-[0.12em] flex items-center gap-2">
                  <span className="w-[3px] h-4 bg-[#c8951e] rounded-[1px] opacity-60 inline-block" />
                  歌词
                </h2>
                {song?.lyric && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCopyLyrics}
                      className="text-xs px-3 py-1.5 border border-[#e0dcd3] text-[#9e968e] hover:text-[#c8951e] hover:border-[#c8951e] rounded transition-all duration-300"
                    >
                      {lyricsCopied ? '已复制' : '复制歌词'}
                    </button>
                    <button
                      onClick={() => setLyricsExpanded(!lyricsExpanded)}
                      className="text-xs px-3 py-1.5 border border-[#e0dcd3] text-[#9e968e] hover:text-[#c8951e] hover:border-[#c8951e] rounded transition-all duration-300"
                    >
                      {lyricsExpanded ? '收起' : '展开'}
                    </button>
                  </div>
                )}
              </div>
                <div
                className={clsx(
                  'text-lg leading-normal text-[#6b6560] whitespace-pre-line tracking-[0.04em] py-3 px-1 overflow-hidden transition-all',
                  !lyricsExpanded && 'max-h-[300px]'
                )}
              >
                <LyricsDisplay lyric={song?.lyric || ''} />
              </div>
            </div>

            {/* Description */}
            {song?.description && (
              <div className="mb-10">
                <h2 className="text-base font-semibold text-[#2c2c2c] tracking-[0.12em] mb-4 pb-2.5 border-b border-[#e0dcd3] flex items-center gap-2">
                  <span className="w-[3px] h-4 bg-[#c8951e] rounded-[1px] opacity-60 inline-block" />
                  歌曲描述
                </h2>
                <div className={clsx('text-[#6b6560] leading-relaxed whitespace-pre-wrap', !descExpanded && 'line-clamp-6')}>
                  {song.description}
                </div>
                {song.description.length > 200 ? (
                  <button
                    onClick={() => setDescExpanded(!descExpanded)}
                    className="text-xs px-3 py-1.5 border border-[#e0dcd3] text-[#9e968e] hover:text-[#c8951e] hover:border-[#c8951e] rounded transition-all duration-300 mt-3 inline-flex items-center gap-1"
                  >
                    {descExpanded ? (
                      <>收起 <ChevronUp size={14} /></>
                    ) : (
                      <>展开 <ChevronDown size={14} /></>
                    )}
                  </button>
                ) : null}
              </div>
            )}

            {/* Related Posts */}
            <div className="mb-10">
              <div className="flex items-center justify-between mb-4 pb-2.5 border-b border-[#e0dcd3]">
                <h2 className="text-base font-semibold text-[#2c2c2c] tracking-[0.12em] flex items-center gap-2">
                  <span className="w-[3px] h-4 bg-[#c8951e] rounded-[1px] opacity-60 inline-block" />
                  关联乐评
                </h2>
                  <Link
                    to={`/forum/new?musicDocId=${song.docId}&musicTitle=${encodeURIComponent(song.title)}`}
                    className="px-4 py-2 bg-[#c8951e] text-white rounded text-xs font-semibold hover:bg-[#dca828] transition-all"
                  >
                  发表乐评
                </Link>
              </div>

              {posts.length > 0 ? (
                <div className="flex flex-col">
                  {posts.map((post) => (
                    <Link
                      key={post.id}
                      to={`/forum/${post.id}`}
                      className="py-3.5 border-b border-[#e0dcd3] transition-colors group"
                    >
                      <p className="text-[0.9375rem] text-[#2c2c2c] mb-1 tracking-[0.04em] group-hover:text-[#c8951e] transition-colors">{post.title}</p>
                      <div className="flex items-center gap-3 text-xs text-[#9e968e]">
                        <span className="flex items-center gap-1"><Heart size={12} /> {post.likesCount || 0}</span>
                        <span className="flex items-center gap-1"><MessageSquare size={12} /> {post.commentsCount || 0}</span>
                        <span className="flex items-center gap-1"><Clock size={12} /> {formatDate(post.updatedAt)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-[#9e968e] italic tracking-[0.1em] py-6">暂无乐评，快来发表第一篇吧！</div>
              )}
            </div>

            {/* Custom Platform Links */}
            {customPlatformLinks.length > 0 && (
              <div className="mb-10">
                <h2 className="text-base font-semibold text-[#2c2c2c] tracking-[0.12em] mb-4 pb-2.5 border-b border-[#e0dcd3] flex items-center gap-2">
                  <span className="w-[3px] h-4 bg-[#c8951e] rounded-[1px] opacity-60 inline-block" />
                  更多平台
                </h2>
                <div className="flex flex-col">
                  {customPlatformLinks.map((link) => (
                    <a
                      key={`${link.label}-${link.url}`}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2.5 py-2.5 border-b border-[#ebe8e0] text-sm text-[#6b6560] hover:text-[#c8951e] hover:pl-1 transition-all"
                    >
                      <ExternalLink size={16} className="text-[#9e968e] flex-shrink-0" />
                      <span className="truncate">{link.label}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Preset Platforms */}
            {customPlatforms.length > 0 && song?.customPlatformIds && Object.keys(song.customPlatformIds).length > 0 && (
              <div className="mb-10">
                <h2 className="text-base font-semibold text-[#2c2c2c] tracking-[0.12em] mb-4 pb-2.5 border-b border-[#e0dcd3] flex items-center gap-2">
                  <span className="w-[3px] h-4 bg-[#c8951e] rounded-[1px] opacity-60 inline-block" />
                  预设平台
                </h2>
                <div className="flex flex-wrap gap-2">
                  {customPlatforms
                    .filter(p => song.customPlatformIds?.[p.key])
                    .map(platform => {
                      const id = song.customPlatformIds![platform.key];
                      const url = platform.urlPattern.replace('{id}', id);
                      return (
                        <a
                          key={platform.key}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all hover:text-[#c8951e] border-b border-transparent hover:border-[#c8951e]"
                          style={{ color: '#9e968e' }}
                        >
                          {platform.label}
                          <ExternalLink size={12} />
                        </a>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Admin */}
            {isAdmin && song?.docId && (
              <div className="mb-10">
                <h2 className="text-base font-semibold text-[#2c2c2c] tracking-[0.12em] mb-4 pb-2.5 border-b border-[#e0dcd3] flex items-center gap-2">
                  <span className="w-[3px] h-4 bg-[#c8951e] rounded-[1px] opacity-60 inline-block" />
                  管理功能
                </h2>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => setIsEditModalOpen(true)}
                    className="px-5 py-2 border border-[#e0dcd3] text-sm text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] rounded transition-all"
                  >
                    编辑歌曲
                  </button>
                  <SongCoverManager
                    songDocId={song.docId}
                    currentCover={song.cover}
                    onCoverUpdated={(newCoverUrl) => setSong((prev) => prev ? { ...prev, cover: newCoverUrl } : prev)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <aside className="lg:sticky lg:top-20">
            <div className="py-5 border-b border-[#e0dcd3]">
              <h3 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-3.5">歌曲信息</h3>
              <div className="flex flex-col gap-2.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[#9e968e]">歌手</span>
                  <span className="text-[#2c2c2c]">{song.artist}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#9e968e]">专辑</span>
                  <span className="text-[#2c2c2c]">{song.album}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#9e968e]">平台 ID</span>
                  <span className="text-[#2c2c2c]">{song.id}</span>
                </div>
              </div>
            </div>

            <div className="py-5">
              <h3 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-3.5">操作</h3>
              <div className="flex flex-col gap-2">
                <button
                  onClick={handlePlay}
                  className="flex items-center gap-2 text-sm text-[#6b6560] hover:text-[#c8951e] hover:pl-1 transition-all"
                >
                  <Play size={14} /> 播放歌曲
                </button>
                <button
                  onClick={handleToggleFavorite}
                  className="flex items-center gap-2 text-sm text-[#6b6560] hover:text-[#c8951e] hover:pl-1 transition-all"
                >
                  <Heart size={14} /> {song.favoritedByMe ? '取消收藏' : '收藏歌曲'}
                </button>
                <button
                  onClick={handleCopyLink}
                  className="flex items-center gap-2 text-sm text-[#6b6560] hover:text-[#c8951e] hover:pl-1 transition-all"
                >
                  <Link2 size={14} /> 复制内链
                </button>
                <a
                  href={getSongExternalUrl(song)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-[#6b6560] hover:text-[#c8951e] hover:pl-1 transition-all"
                >
                  <ExternalLink size={14} /> 原始链接
                </a>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {isAdmin && song && (
        <SongEditModal
          open={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          onSuccess={() => {
            if (songId) {
              apiGet<SongDetailResponse>(`/api/music/${songId}`).then((res) => setSong(res.song));
            }
          }}
          song={song}
        />
      )}
    </div>
  );
};

export default MusicDetail;
