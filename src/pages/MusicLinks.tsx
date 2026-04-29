import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Filter, Link2, Loader2, Search } from 'lucide-react';
import { clsx } from 'clsx';

import { apiGet } from '../lib/apiClient';
import { useAuth } from '../context/AuthContext';
import Pagination from '../components/Pagination';
import { Platform, PlatformIds } from '../types/PlatformIds';

const DEFAULT_PAGE_SIZE = 50;

type SongItem = {
  docId: string;
  id: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  primaryPlatform?: Platform | null;
  platformIds?: PlatformIds;
};

const platformInfo: Array<{ key: keyof PlatformIds; label: string; color: string; bgColor: string }> = [
  { key: 'neteaseId', label: '网易云', color: 'text-[#c8951e]', bgColor: 'bg-[#fdf5d8]' },
  { key: 'tencentId', label: 'QQ音乐', color: 'text-[#c8951e]', bgColor: 'bg-[#fdf5d8]' },
  { key: 'kugouId', label: '酷狗', color: 'text-[#c8951e]', bgColor: 'bg-[#fdf5d8]' },
  { key: 'baiduId', label: '百度', color: 'text-[#c8951e]', bgColor: 'bg-[#fdf5d8]' },
  { key: 'kuwoId', label: '酷我', color: 'text-[#c8951e]', bgColor: 'bg-[#fdf5d8]' },
];

function buildPlatformUrl(platform: Platform, id: string): string {
  if (platform === 'netease') return `https://music.163.com/song?id=${id}`;
  if (platform === 'tencent') return `https://y.qq.com/n/ryqq/songDetail/${id}`;
  if (platform === 'kugou') return `https://www.kugou.com/song/#hash=${id}`;
  if (platform === 'baidu') return `https://music.baidu.com/song/${id}`;
  return `https://www.kuwo.cn/song_detail/${id}`;
}

const MusicLinks = () => {
  const [songs, setSongs] = useState<SongItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterPlatform, setFilterPlatform] = useState<Platform | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'partial' | 'unlinked'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const { isAdmin } = useAuth();

  useEffect(() => {
    const fetchSongs = async () => {
      setLoading(true);
      try {
        const data = await apiGet<{ songs: SongItem[] }>('/api/music');
        setSongs(data.songs || []);
      } catch (error) {
        console.error('Fetch songs error:', error);
        setSongs([]);
      } finally {
        setLoading(false);
      }
    };
    fetchSongs();
  }, []);

  const filteredSongs = useMemo(() => {
    let result = songs;

    if (filterPlatform !== 'all') {
      result = result.filter((song) => {
        const fieldKey = `${filterPlatform}Id` as keyof PlatformIds;
        return song.platformIds?.[fieldKey];
      });
    }

    if (filterStatus === 'partial') {
      result = result.filter((song) => {
        const linkedCount = platformInfo.filter(
          (p) => song.platformIds?.[p.key]
        ).length;
        return linkedCount > 0 && linkedCount < 5;
      });
    } else if (filterStatus === 'unlinked') {
      result = result.filter((song) => {
        return platformInfo.every((p) => !song.platformIds?.[p.key]);
      });
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (song) =>
          song.title.toLowerCase().includes(query) ||
          song.artist.toLowerCase().includes(query)
      );
    }

    return result;
  }, [songs, filterPlatform, filterStatus, searchQuery]);

  const totalFilteredPages = Math.ceil(filteredSongs.length / pageSize);
  const paginatedSongs = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredSongs.slice(start, start + pageSize);
  }, [filteredSongs, page, pageSize]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setPage(1);
  };

  useEffect(() => {
    setPage(1);
  }, [filterPlatform, filterStatus, searchQuery]);

  const stats = useMemo(() => {
    const total = songs.length;
    const linkedCount = songs.filter((song) =>
      platformInfo.some((p) => song.platformIds?.[p.key])
    ).length;
    const partialCount = songs.filter((song) => {
      const count = platformInfo.filter((p) => song.platformIds?.[p.key]).length;
      return count > 0 && count < 5;
    }).length;
    const fullyLinkedCount = songs.filter((song) =>
      platformInfo.every((p) => song.platformIds?.[p.key])
    ).length;
    return { total, linkedCount, partialCount, fullyLinkedCount };
  }, [songs]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center" style={{ backgroundColor: '#f7f5f0' }}>
        <Loader2 size={32} className="animate-spin text-[#c8951e]" />
      </div>
    );
  }

  return (
    <div
      className="min-h-[calc(100vh-60px)]"
      style={{
        backgroundColor: '#f7f5f0',
        fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
        lineHeight: 1.8,
      }}
    >
      <div className="max-w-[1100px] mx-auto px-6 py-12">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Link2 size={20} className="text-[#c8951e]" />
            <h1 className="text-2xl font-bold text-[#2c2c2c] tracking-[0.05em]">歌曲关联管理</h1>
          </div>
          <p className="text-sm text-[#9e968e]">管理同一歌曲在不同平台的关联</p>
        </header>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <div className="bg-white border border-[#e0dcd3] rounded p-4">
            <p className="text-2xl font-semibold text-[#2c2c2c]">{stats.total}</p>
            <p className="text-xs text-[#9e968e] mt-1">总歌曲数</p>
          </div>
          <div className="bg-white border border-[#e0dcd3] rounded p-4">
            <p className="text-2xl font-semibold text-[#c8951e]">{stats.linkedCount}</p>
            <p className="text-xs text-[#9e968e] mt-1">已关联</p>
          </div>
          <div className="bg-white border border-[#e0dcd3] rounded p-4">
            <p className="text-2xl font-semibold text-[#c8951e]">{stats.partialCount}</p>
            <p className="text-xs text-[#9e968e] mt-1">部分关联</p>
          </div>
          <div className="bg-white border border-[#e0dcd3] rounded p-4">
            <p className="text-2xl font-semibold text-[#c8951e]">{stats.fullyLinkedCount}</p>
            <p className="text-xs text-[#9e968e] mt-1">全部关联</p>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-white border border-[#e0dcd3] rounded mb-6 overflow-hidden">
          <div className="p-4 border-b border-[#e0dcd3] flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9e968e]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索歌名或艺术家..."
                className="w-full pl-9 pr-4 py-2 text-sm bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none text-[#2c2c2c]"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as 'all' | 'partial' | 'unlinked')}
                className="px-3 py-2 text-sm bg-white border border-[#e0dcd3] rounded focus:border-[#c8951e] focus:outline-none text-[#6b6560]"
              >
                <option value="all">全部状态</option>
                <option value="partial">部分关联</option>
                <option value="unlinked">未关联</option>
              </select>
              <select
                value={filterPlatform}
                onChange={(e) => setFilterPlatform(e.target.value as Platform | 'all')}
                className="px-3 py-2 text-sm bg-white border border-[#e0dcd3] rounded focus:border-[#c8951e] focus:outline-none text-[#6b6560]"
              >
                <option value="all">全部平台</option>
                <option value="netease">网易云</option>
                <option value="tencent">QQ音乐</option>
                <option value="kugou">酷狗</option>
                <option value="baidu">百度</option>
                <option value="kuwo">酷我</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e0dcd3] bg-[#f7f5f0]">
                  <th className="text-left font-medium text-[#6b6560] px-4 py-3">歌曲</th>
                  <th className="text-center font-medium text-[#6b6560] px-3 py-3">网易云</th>
                  <th className="text-center font-medium text-[#6b6560] px-3 py-3">QQ音乐</th>
                  <th className="text-center font-medium text-[#6b6560] px-3 py-3">酷狗</th>
                  <th className="text-center font-medium text-[#6b6560] px-3 py-3">百度</th>
                  <th className="text-center font-medium text-[#6b6560] px-3 py-3">酷我</th>
                  <th className="text-center font-medium text-[#6b6560] px-3 py-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredSongs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-[#9e968e]">
                      未找到匹配的歌曲
                    </td>
                  </tr>
                ) : (
                  paginatedSongs.map((song) => {
                    const linkedPlatforms = platformInfo.filter((p) => song.platformIds?.[p.key]);
                    const unlinkedPlatforms = platformInfo.filter((p) => !song.platformIds?.[p.key]);
                    return (
                      <tr key={song.docId} className="border-b border-[#e0dcd3] hover:bg-[#f7f5f0]/50 transition-colors">
                        <td className="px-4 py-3">
                          <Link to={`/music/${song.docId}`} className="flex items-center gap-3 group">
                            <img
                              src={song.cover}
                              alt=""
                              className="w-10 h-10 rounded object-cover border border-[#e0dcd3]"
                              referrerPolicy="no-referrer"
                            />
                            <div className="min-w-0">
                              <p className="font-medium text-[#2c2c2c] truncate max-w-[180px] group-hover:text-[#c8951e] transition-colors">{song.title}</p>
                              <p className="text-xs text-[#9e968e] truncate max-w-[180px]">{song.artist}</p>
                            </div>
                          </Link>
                        </td>
                        {platformInfo.map((platform) => {
                          const isLinked = Boolean(song.platformIds?.[platform.key]);
                          return (
                            <td key={platform.key} className="px-3 py-3 text-center">
                              {isLinked ? (
                                <a
                                  href={buildPlatformUrl(
                                    platform.key.replace('Id', '') as Platform,
                                    song.platformIds![platform.key]!
                                  )}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={clsx(
                                    'inline-flex items-center justify-center w-7 h-7 rounded text-xs font-medium transition-all hover:scale-110',
                                    platform.bgColor,
                                    platform.color
                                  )}
                                  title={song.platformIds![platform.key]}
                                >
                                  ✓
                                </a>
                              ) : (
                                <span className="inline-flex items-center justify-center w-7 h-7 rounded text-xs text-[#e0dcd3]">
                                  —
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-3 text-center">
                          <Link
                            to={`/music/${song.docId}`}
                            className="p-1.5 text-[#9e968e] hover:text-[#c8951e] transition-colors inline-flex"
                            title="编辑"
                          >
                            <ExternalLink size={16} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-4 py-3 border-t border-[#e0dcd3] bg-[#f7f5f0]">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <p className="text-xs text-[#9e968e]">
                显示 {paginatedSongs.length} / {filteredSongs.length} 首歌曲（共 {songs.length} 首）
              </p>
              {totalFilteredPages > 1 && (
                <Pagination
                  page={page}
                  totalPages={totalFilteredPages}
                  onPageChange={handlePageChange}
                  pageSize={pageSize}
                  onPageSizeChange={handlePageSizeChange}
                  showPageSizeSelector
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MusicLinks;
