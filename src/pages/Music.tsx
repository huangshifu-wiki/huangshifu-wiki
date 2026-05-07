import React, { useState, useEffect, useMemo } from 'react';
import { auth } from '../lib/auth';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useMusic } from '../context/MusicContext';
import { Search, Plus, List, Sparkles, X, Heart, MessageSquare, Link2 } from 'lucide-react';
import { clsx } from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { MusicPlayer } from '../components/MusicPlayer';
import { MusicImportModal } from '../components/MusicImportModal';
import { AlbumEditModal } from '../components/AlbumEditModal';
import { useToast } from '../components/Toast';
import { apiDelete, apiGet, apiPost } from '../lib/apiClient';
import { copyToClipboard, toAbsoluteInternalUrl } from '../lib/copyLink';
import Pagination from '../components/Pagination';
import { PlatformIds } from '../types/PlatformIds';
import { useI18n } from '../lib/i18n';
import { Loader2 } from 'lucide-react';
import { SongCard } from '../components/Music/SongCard';
import { AlbumCard } from '../components/Music/AlbumCard';
import { MusicFilters } from '../components/Music/MusicFilters';
import { BatchActions } from '../components/Music/BatchActions';
import type { SongItem, AlbumItem, PostItem } from '../types/entities';

const DEFAULT_PAGE_SIZE = 40;

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const Music = () => {
  const [songs, setSongs] = useState<SongItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchId, setSearchId] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [editingAlbum, setEditingAlbum] = useState<AlbumItem | null>(null);
  const [isAlbumModalOpen, setIsAlbumModalOpen] = useState(false);
  const [selectedSongs, setSelectedSongs] = useState<Set<string>>(new Set());
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{ show: boolean, type: 'single' | 'batch', id?: string }>({ show: false, type: 'single' });
  const [favoriting, setFavoriting] = useState<string | null>(null);
  const [selectedSongForPosts, setSelectedSongForPosts] = useState<SongItem | null>(null);
  const [songPosts, setSongPosts] = useState<PostItem[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [albums, setAlbums] = useState<AlbumItem[]>([]);
  const [loadingAlbums, setLoadingAlbums] = useState(false);
  const [activeTab, setActiveTab] = useState<'music' | 'albums'>('music');
  const [selectedPlatform, setSelectedPlatform] = useState<'netease' | 'qq' | 'kugou' | 'baidu' | 'kuwo'>('netease');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [showAccompaniments, setShowAccompaniments] = useState(false);
  const [sortBy, setSortBy] = useState<'createdAt' | 'title' | 'artist'>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [filterPlatform, setFilterPlatform] = useState<'netease' | 'tencent' | 'kugou' | 'baidu' | 'kuwo' | 'all'>('all');
  const { user, isAdmin, isBanned } = useAuth();
  const { currentSong, setCurrentSong, setIsPlaying, setPlaylist, playSongAtIndex } = useMusic();
  const { show } = useToast();
  const { t } = useI18n();

  const fetchInstrumentalTargets = async () => {
    try {
      const data = await apiGet<{ docIds: string[] }>('/api/music/instrumental-targets');
      return new Set(data.docIds || []);
    } catch {
      return new Set<string>();
    }
  };

  const [instrumentalTargetDocIds, setInstrumentalTargetDocIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (activeTab === 'music') {
      fetchInstrumentalTargets().then(setInstrumentalTargetDocIds);
    }
  }, [activeTab]);

  const displaySongs = useMemo(() => {
    let result = [...songs];

    if (!showAccompaniments) {
      result = result.filter(song => !instrumentalTargetDocIds.has(song.docId));
    }

    if (filterPlatform !== 'all') {
      const fieldKey = `${filterPlatform}Id` as keyof PlatformIds;
      result = result.filter(song => song.platformIds?.[fieldKey]);
    }

    result.sort((a, b) => {
      if (sortBy === 'title') {
        return sortOrder === 'asc'
          ? a.title.localeCompare(b.title, 'zh-CN')
          : b.title.localeCompare(a.title, 'zh-CN');
      }
      if (sortBy === 'artist') {
        return sortOrder === 'asc'
          ? a.artist.localeCompare(b.artist, 'zh-CN')
          : b.artist.localeCompare(a.artist, 'zh-CN');
      }
      return sortOrder === 'asc'
        ? (a.createdAt || '').localeCompare(b.createdAt || '')
        : (b.createdAt || '').localeCompare(a.createdAt || '');
    });

    return result;
  }, [songs, showAccompaniments, instrumentalTargetDocIds, filterPlatform, sortBy, sortOrder]);

  const totalMusicPages = Math.ceil(displaySongs.length / pageSize);
  const paginatedSongs = useMemo(() => {
    const start = (page - 1) * pageSize;
    return displaySongs.slice(start, start + pageSize);
  }, [displaySongs, page, pageSize]);

  const handleMusicPageChange = (newPage: number) => {
    setPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setPage(1);
  };

  useEffect(() => {
    setPage(1);
  }, [activeTab]);

  const fetchSongs = async () => {
    setLoading(true);
    try {
      const data = await apiGet<{ songs: SongItem[] }>('/api/music');
      const fetchedSongs = data.songs || [];
      setSongs(fetchedSongs);
      setPlaylist(fetchedSongs);
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, '/api/music');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchSongs();
    fetchAlbums();
  }, []);

  const fetchAlbums = async () => {
    setLoadingAlbums(true);
    try {
      const data = await apiGet<{ albums: AlbumItem[] }>('/api/albums');
      setAlbums(data.albums || []);
    } catch (error) {
      console.error('Fetch albums error:', error);
      setAlbums([]);
    }
    setLoadingAlbums(false);
  };

  const fetchSongPosts = async (song: SongItem) => {
    setLoadingPosts(true);
    try {
      const data = await apiGet<{ posts: PostItem[] }>(`/api/music/${song.docId}/posts`);
      setSongPosts(data.posts || []);
    } catch (error) {
      console.error('Fetch song posts error:', error);
      setSongPosts([]);
    }
    setLoadingPosts(false);
  };

  const handleShowPosts = (song: SongItem) => {
    if (selectedSongForPosts?.docId === song.docId) {
      setSelectedSongForPosts(null);
      setSongPosts([]);
    } else {
      setSelectedSongForPosts(song);
      fetchSongPosts(song);
    }
  };

  const handleAddSong = async () => {
    if (!searchId) return;
    if (isBanned) {
      show('账号已被封禁，无法执行此操作', { variant: 'error' });
      return;
    }
    
    const ids = searchId.split(/[\s,\n]+/).map(s => {
      let id = s.trim();
      if (id.includes('id=')) {
        id = id.split('id=')[1].split('&')[0];
      }
      return id;
    }).filter(id => id);

    if (ids.length === 0) return;

    setLoading(true);
    let addedCount = 0;
    let skippedCount = 0;
    const existingSongs = new Set(songs.map((song) => String(song.id).trim()));

    for (const id of ids) {
      try {
        if (existingSongs.has(id)) {
          skippedCount++;
          continue;
        }

        try {
          await apiPost<{ song: SongItem }>(`/api/music/from-${selectedPlatform}`, { id });
          existingSongs.add(id);
          addedCount++;
        } catch (error) {
          console.error(`Failed to add metadata for ID: ${id}`, error);
          skippedCount++;
        }
      } catch (e) {
        console.error(`Error adding song ${id}:`, e);
        skippedCount++;
      }
    }

    show(`添加完成！成功: ${addedCount}, 跳过/失败: ${skippedCount}`);
    setSearchId('');
    setIsAdding(false);
    fetchSongs();
    setLoading(false);
  };

  const playSong = (song: SongItem) => {
    if (isBatchMode) {
      toggleSelect(song.docId);
      return;
    }
    const index = songs.findIndex((item) => item.docId === song.docId);
    if (index >= 0) {
      playSongAtIndex(index);
      return;
    }
    setCurrentSong(song);
    setIsPlaying(true);
  };

  const handleCopySongLink = async (event: React.MouseEvent<HTMLButtonElement>, song: SongItem) => {
    event.stopPropagation();
    const copied = await copyToClipboard(toAbsoluteInternalUrl(`/music/${song.docId}`));
    if (copied) {
      show('歌曲内链已复制');
      return;
    }
    show('复制链接失败，请稍后重试', { variant: 'error' });
  };

  const handleCopyAlbumLink = async (event: React.MouseEvent<HTMLButtonElement>, albumId: string) => {
    event.stopPropagation();
    const copied = await copyToClipboard(toAbsoluteInternalUrl(`/album/${albumId}`));
    if (copied) {
      show('专辑内链已复制');
      return;
    }
    show('复制链接失败，请稍后重试', { variant: 'error' });
  };

  const handleDeleteSong = async (songId: string) => {
    try {
      if (currentSong?.docId === songId) {
        setCurrentSong(null);
      }
      await apiDelete(`/api/music/${songId}`);
      fetchSongs();
      setConfirmModal({ show: false, type: 'single' });
    } catch (e) {
      console.error("Delete error:", e);
      show("删除失败，请检查权限", { variant: 'error' });
    }
  };

  const handleToggleFavorite = async (song: SongItem) => {
    if (!user || !song.docId) {
      show('请先登录后收藏', { variant: 'error' });
      return;
    }

    if (favoriting === song.docId) return;
    setFavoriting(song.docId);
    try {
      if (song.favoritedByMe) {
        await apiDelete(`/api/favorites/music/${song.docId}`);
        setSongs((prev) => prev.map((item) => (item.docId === song.docId ? { ...item, favoritedByMe: false } : item)));
      } else {
        await apiPost('/api/favorites', {
          targetType: 'music',
          targetId: song.docId,
        });
        setSongs((prev) => prev.map((item) => (item.docId === song.docId ? { ...item, favoritedByMe: true } : item)));
      }
    } catch (error) {
      console.error('Toggle music favorite error:', error);
      show('收藏操作失败，请稍后重试', { variant: 'error' });
    } finally {
      setFavoriting(null);
    }
  };

  const toggleSelect = (docId: string) => {
    const newSelected = new Set(selectedSongs);
    if (newSelected.has(docId)) {
      newSelected.delete(docId);
    } else {
      newSelected.add(docId);
    }
    setSelectedSongs(newSelected);
  };

  const handleBatchDelete = async () => {
    if (selectedSongs.size === 0) return;

    setLoading(true);
    let successCount = 0;
    let failCount = 0;

    for (const docId of Array.from(selectedSongs)) {
      try {
        await apiDelete(`/api/music/${docId}`);
        successCount++;
      } catch (e) {
        console.error(`Error deleting ${docId}:`, e);
        failCount++;
      }
    }
    
    if (failCount > 0) {
      show(`批量删除完成。成功: ${successCount}, 失败: ${failCount}`, { variant: failCount > 0 ? 'error' : 'success' });
    }

    setSelectedSongs(new Set());
    setIsBatchMode(false);
    setConfirmModal({ show: false, type: 'single' });
    fetchSongs();
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f7f5f0' }}>
        <Loader2 size={32} className="animate-spin text-[#c8951e]" />
      </div>
    );
  }

  return (
    <div
      className="gufeng-music-page min-h-screen"
      style={{
        backgroundColor: '#f7f5f0',
        color: '#2c2c2c',
        fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
        lineHeight: 1.8,
      }}
    >
      <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 md:pb-32">
        {/* Header */}
        <header className="mb-7">
          <div className="flex items-end justify-between flex-wrap gap-3">
            <h1 className="text-[1.75rem] font-semibold tracking-[0.12em] text-[#2c2c2c]">{t('music.title')}</h1>
            {isAdmin && (
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => {
                    if (isBanned) { show('账号已被封禁，无法执行此操作', { variant: 'error' }); return; }
                    setIsBatchMode(!isBatchMode);
                    setSelectedSongs(new Set());
                  }}
                   className={clsx(
                     "px-4 py-2 text-[0.9375rem] rounded border transition-all",
                     isBatchMode
                       ? "bg-[#c8951e] text-white border-[#c8951e]"
                       : "bg-transparent text-[#6b6560] border-[#e0dcd3] hover:text-[#c8951e] hover:border-[#c8951e]"
                   )}
                >
                  <List size={16} className="inline mr-1.5 -mt-0.5" />
                  {isBatchMode ? t('music.batchExit') : t('music.batchManage')}
                </button>
                <button
                  onClick={() => {
                    if (isBanned) { show('账号已被封禁，无法执行此操作', { variant: 'error' }); return; }
                    setIsImportModalOpen(true);
                  }}
                  className="px-4 py-2 text-[0.9375rem] rounded border border-[#e0dcd3] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] transition-all"
                >
                  <Search size={16} className="inline mr-1.5 -mt-0.5" />
                  {t('music.linkImport')}
                </button>
                <button
                  onClick={() => {
                    if (isBanned) { show('账号已被封禁，无法执行此操作', { variant: 'error' }); return; }
                    setIsAdding(!isAdding);
                  }}
                  className="px-4 py-2 text-[0.9375rem] rounded bg-[#c8951e] text-white hover:bg-[#dca828] transition-all"
                >
                  {isAdding ? <X size={16} className="inline mr-1.5 -mt-0.5" /> : <Plus size={16} className="inline mr-1.5 -mt-0.5" />}
                  {isAdding ? t('music.cancelAdd') : t('music.addMusic')}
                </button>
                <Link
                  to="/music/links"
                  className="px-4 py-2 text-[0.9375rem] rounded border border-[#e0dcd3] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] transition-all"
                >
                  <Link2 size={16} className="inline mr-1.5 -mt-0.5" />
                  {t('music.linkManage')}
                </Link>
              </div>
            )}
          </div>
        </header>

        {/* Add Panel */}
        <AnimatePresence>
          {isAdding && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mb-7 p-6 md:p-8 bg-white rounded border border-[#e0dcd3]"
            >
              <h3 className="text-lg font-semibold text-[#2c2c2c] mb-5 flex items-center gap-2">
                <Sparkles size={18} className="text-[#c8951e]" /> {t('music.inputMusicId')}
              </h3>
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <label className="text-sm font-medium text-[#6b6560]">{t('music.selectPlatform')}：</label>
                  <select
                    value={selectedPlatform}
                    onChange={e => setSelectedPlatform(e.target.value as typeof selectedPlatform)}
                    className="px-4 py-2 bg-[#f7f5f0] rounded border border-[#e0dcd3] text-sm focus:outline-none focus:border-[#c8951e] text-[#2c2c2c]"
                    style={{ fontFamily: "inherit" }}
                  >
                    <option value="netease">{t('music.platforms.netease')}</option>
                    <option value="qq">{t('music.platforms.tencent')}</option>
                    <option value="kugou">{t('music.platforms.kugou')}</option>
                    <option value="baidu">{t('music.platforms.baidu')}</option>
                    <option value="kuwo">{t('music.platforms.kuwo')}</option>
                  </select>
                </div>
                <textarea
                  value={searchId}
                  onChange={e => setSearchId(e.target.value)}
                  placeholder={`${t('music.inputPlaceholder')} ${selectedPlatform === 'netease' ? t('music.platforms.netease') : selectedPlatform === 'qq' ? t('music.platforms.tencent') : selectedPlatform === 'kugou' ? t('music.platforms.kugou') : selectedPlatform === 'baidu' ? t('music.platforms.baidu') : t('music.platforms.kuwo')} ${t('music.idOrLinkList')}`}
                  className="w-full px-4 py-3 bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:outline-none focus:border-[#c8951e] min-h-[100px] text-sm text-[#2c2c2c] resize-y"
                  style={{ fontFamily: "inherit" }}
                />
                <div className="flex justify-end">
                  <button
                    onClick={handleAddSong}
                    disabled={loading}
                    className="px-6 py-2.5 bg-[#c8951e] text-white rounded text-sm font-medium hover:bg-[#dca828] transition-all disabled:opacity-50"
                  >
                    {loading ? t('music.processing') : t('music.getAndAdd')}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <MusicImportModal
          open={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          onImported={fetchSongs}
        />

        <AlbumEditModal
          open={isAlbumModalOpen}
          onClose={() => setIsAlbumModalOpen(false)}
          onSuccess={fetchAlbums}
          album={editingAlbum}
        />

        {isBatchMode && (
          <BatchActions
            selectedCount={selectedSongs.size}
            onCancelSelect={() => setSelectedSongs(new Set())}
            onBatchDelete={() => setConfirmModal({ show: true, type: 'batch' })}
          />
        )}

        <AnimatePresence>
          {confirmModal.show && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded p-8 max-w-md w-full border border-[#e0dcd3]"
              >
                <h3 className="text-xl font-semibold text-[#2c2c2c] mb-4 tracking-wide">{t('music.confirmDelete')}</h3>
                <p className="text-[#6b6560] mb-8 text-[0.9375rem]">
                  {confirmModal.type === 'single'
                    ? t('music.confirmDeleteSingle')
                    : t('music.confirmDeleteBatch', { count: selectedSongs.size })}
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => setConfirmModal({ show: false, type: 'single' })}
                    className="flex-1 px-6 py-3 bg-[#f0ece3] text-[#6b6560] rounded font-semibold hover:bg-[#e0dcd3] transition-all"
                  >
                    {t('music.cancel')}
                  </button>
                  <button
                    onClick={() => confirmModal.type === 'single' ? handleDeleteSong(confirmModal.id!) : handleBatchDelete()}
                    className="flex-1 px-6 py-3 bg-[#c8951e] text-white rounded font-semibold hover:bg-[#dca828] transition-all"
                  >
                    {t('music.confirmDeleteButton')}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8 items-start">
          {/* Main Content */}
          <div>
            <MusicFilters
              activeTab={activeTab}
              onTabChange={setActiveTab}
              isAdmin={isAdmin}
              onCreateAlbum={() => {
                setEditingAlbum(null);
                setIsAlbumModalOpen(true);
              }}
              sortBy={sortBy}
              onSortByChange={(value) => { setSortBy(value); setPage(1); }}
              sortOrder={sortOrder}
              onSortOrderChange={setSortOrder}
              showAccompaniments={showAccompaniments}
              onShowAccompanimentsChange={setShowAccompaniments}
              musicCount={displaySongs.length}
              albumCount={albums.length}
            />

            {/* Content */}
            {activeTab === 'music' ? (
              <div className="flex flex-col mt-6">
                {paginatedSongs.length > 0 ? (
                  <>
                    {paginatedSongs.map((song) => (
                      <SongCard
                        key={song.docId}
                        song={song}
                        isBatchMode={isBatchMode}
                        isSelected={selectedSongs.has(song.docId)}
                        isCurrentSong={currentSong?.docId === song.docId}
                        isFavoriting={favoriting === song.docId}
                        isAdmin={isAdmin}
                        isPostsSelected={selectedSongForPosts?.docId === song.docId}
                        onPlay={playSong}
                        onToggleSelect={toggleSelect}
                        onToggleFavorite={handleToggleFavorite}
                        onCopyLink={handleCopySongLink}
                        onDelete={(docId) => setConfirmModal({ show: true, type: 'single', id: docId })}
                        onShowPosts={handleShowPosts}
                      />
                    ))}

                    <AnimatePresence>
                      {selectedSongForPosts && (
                        <motion.div
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 12 }}
                          className="border border-[#e0dcd3] rounded overflow-hidden mt-6 bg-white"
                        >
                          <div className="p-5 bg-[#f7f5f0]">
                            <div className="flex items-center justify-between mb-3">
                              <h3 className="font-semibold text-[#2c2c2c] flex items-center gap-2 text-[0.9375rem]">
                                <MessageSquare size={16} />
                                {t('music.relatedPosts')}
                              </h3>
                              <button
                                onClick={() => setSelectedSongForPosts(null)}
                                className="p-1.5 hover:bg-[#f0ece3] rounded transition-colors"
                              >
                                <X size={16} className="text-[#9e968e]" />
                              </button>
                            </div>
                          </div>
                          <div className="divide-y divide-[#ebe8e0]">
                            {loadingPosts ? (
                              <div className="p-8 text-center text-[#9e968e] italic">{t('music.loading')}</div>
                            ) : songPosts.length > 0 ? (
                              songPosts.map((post) => (
                                <div key={post.id} className="p-5 hover:bg-[#f7f5f0] transition-colors">
                                  <div className="flex items-center gap-3 mb-1.5">
                                    <span className="font-semibold text-sm text-[#2c2c2c]">{post.title}</span>
                                    <span className="text-xs text-[#9e968e]">by {post.authorUid?.substring(0, 6)}</span>
                                  </div>
                                  <p className="text-sm text-[#6b6560] line-clamp-2">{post.content}</p>
                                  <div className="flex items-center gap-4 mt-2 text-xs text-[#9e968e]">
                                    <span className="flex items-center gap-1"><Heart size={12} /> {post.likesCount}</span>
                                    <span className="flex items-center gap-1"><MessageSquare size={12} /> {post.commentsCount}</span>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="p-8 text-center text-[#9e968e] italic">{t('music.noPosts')}</div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {totalMusicPages > 1 && (
                      <div className="mt-8">
                        <Pagination
                          page={page}
                          totalPages={totalMusicPages}
                          onPageChange={handleMusicPageChange}
                          pageSize={pageSize}
                          onPageSizeChange={handlePageSizeChange}
                          showPageSizeSelector
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="py-20 text-center text-[#9e968e] italic tracking-[0.1em]">{t('music.noMusic')}</div>
                )}
              </div>
            ) : (
              <div className="mt-6">
                {loadingAlbums ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6">
                    {[1,2,3,4,5,6].map(i => (
                      <div key={i} className="animate-pulse">
                        <div className="aspect-square rounded bg-[#f0ece3] mb-2.5" />
                        <div className="h-4 bg-[#f0ece3] rounded w-2/3 mb-1.5" />
                        <div className="h-3 bg-[#f0ece3] rounded w-1/2" />
                      </div>
                    ))}
                  </div>
                ) : albums.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-6">
                    {albums.map((album) => (
                      <AlbumCard
                        key={album.docId || album.id}
                        album={album}
                        onCopyLink={handleCopyAlbumLink}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="py-20 text-center text-[#9e968e] italic tracking-[0.1em]">{t('music.noAlbums')}</div>
                )}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <aside className="lg:sticky lg:top-20">
            {/* Now Playing */}
            <div className="py-5 border-b border-[#e0dcd3]">
              <h3 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-3.5">
                {t('music.playing')}
              </h3>
              {currentSong ? (
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <img
                      src={currentSong.cover}
                      alt=""
                      className="w-10 h-10 rounded object-cover bg-[#f0ece3] flex-shrink-0"
                      referrerPolicy="no-referrer"
                    />
                    <div className="min-w-0">
                      <p className="text-[0.875rem] text-[#2c2c2c] truncate font-medium">{currentSong.title}</p>
                      <p className="text-xs text-[#9e968e] truncate">{currentSong.artist}</p>
                    </div>
                  </div>
                  <MusicPlayer songId={currentSong.id} />
                </div>
              ) : (
                <div className="py-5 text-center">
                  <p className="text-sm text-[#9e968e]">{t('music.selectSongToPlay')}</p>
                </div>
              )}
            </div>

            {/* Stats */}
            <div className="py-5">
              <h3 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-3.5">
                统计
              </h3>
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#9e968e]">单曲</span>
                  <span className="text-[#2c2c2c] font-medium">{songs.length}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#9e968e]">专辑</span>
                  <span className="text-[#2c2c2c] font-medium">{albums.length}</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default Music;
