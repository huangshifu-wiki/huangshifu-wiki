import React, { useState, useEffect, useMemo, useRef } from 'react';
import { auth } from '../lib/auth';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import { useMusic } from '../context/MusicContext';
import { Search, Plus, List, Sparkles, X, Heart, Link2 } from 'lucide-react';
import { clsx } from 'clsx';
import { motion, AnimatePresence } from 'motion/react';
import { MusicImportModal } from '../components/MusicImportModal';
import { AlbumEditModal } from '../components/AlbumEditModal';
import { useToast } from '../components/Toast';
import { apiDelete, apiGet, apiPost } from '../lib/apiClient';
import { copyToClipboard, toAbsoluteInternalUrl } from '../lib/copyLink';
import Pagination from '../components/Pagination';
import { usePagination } from '../hooks/usePagination';
import { PlatformIds } from '../types/PlatformIds';
import { useI18n } from '../lib/i18n';
import { PageSkeleton } from '../components/PageSkeleton';
import { SongCard } from '../components/Music/SongCard';
import { AlbumCard } from '../components/Music/AlbumCard';
import { MusicFilters } from '../components/Music/MusicFilters';
import { BatchActions } from '../components/Music/BatchActions';
import { ViewModeSelector } from '../components/ViewModeSelector';
import { VIEW_MODE_CONFIG } from '../lib/viewModes';
import { useFloatingPresence } from '../hooks/useFloatingPresence';
import type { SongItem, AlbumItem } from '../types/entities';

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
  const [confirmModal, setConfirmModal] = useState<{ show: boolean }>({ show: false });
  const confirmModalPresence = useFloatingPresence(confirmModal.show);
  const [favoriting, setFavoriting] = useState<string | null>(null);
  const [albums, setAlbums] = useState<AlbumItem[]>([]);
  const [loadingAlbums, setLoadingAlbums] = useState(false);
  const [activeTab, setActiveTab] = useState<'music' | 'albums'>('music');
  const [selectedPlatform, setSelectedPlatform] = useState<'netease' | 'qq' | 'kugou' | 'baidu' | 'kuwo'>('netease');
  const { user, isAdmin, isBanned } = useAuth();
  const { currentSong, setCurrentSong, setIsPlaying, setPlaylist, playSongAtIndex } = useMusic();
  const { preferences, setViewMode } = useUserPreferences();
  const viewMode = preferences.viewMode;
  const { show } = useToast();
  const { t } = useI18n();

  const [sortBy, setSortBy] = useState<'createdAt' | 'title' | 'artist'>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [filterPlatform, setFilterPlatform] = useState<'netease' | 'tencent' | 'kugou' | 'baidu' | 'kuwo' | 'all'>('all');

  const displaySongs = useMemo(() => {
    let result = [...songs];

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
  }, [songs, filterPlatform, sortBy, sortOrder]);

  const musicPagination = usePagination({ totalCount: displaySongs.length, defaultPageSize: 40 });
  const albumPagination = usePagination({ totalCount: albums.length, defaultPageSize: 24 });
  const [showAccompaniments, setShowAccompaniments] = useState(false);

  const paginatedSongs = useMemo(() => {
    const start = (musicPagination.page - 1) * musicPagination.pageSize;
    return displaySongs.slice(start, start + musicPagination.pageSize);
  }, [displaySongs, musicPagination.page, musicPagination.pageSize]);

  const paginatedAlbums = useMemo(() => {
    const start = (albumPagination.page - 1) * albumPagination.pageSize;
    return albums.slice(start, start + albumPagination.pageSize);
  }, [albums, albumPagination.page, albumPagination.pageSize]);

  useEffect(() => {
    musicPagination.setPage(1);
    albumPagination.setPage(1);
  }, [activeTab]);

  const fetchSongs = async () => {
    setLoading(true);
    try {
      const data = await apiGet<{ songs: SongItem[]; total: number }>('/api/music', {
        limit: 100,
        page: 1,
        includeInstrumentals: showAccompaniments,
      });
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
  }, [showAccompaniments]);

  const fetchAlbums = async () => {
    setLoadingAlbums(true);
    try {
      const data = await apiGet<{ albums: AlbumItem[]; total: number; hasMore?: boolean }>('/api/albums', {
        limit: 100,
        page: 1,
      });
      setAlbums(data.albums || []);
    } catch (error) {
      console.error('Fetch albums error:', error);
      setAlbums([]);
    }
    setLoadingAlbums(false);
  };

  useEffect(() => {
    fetchAlbums();
  }, []);

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

  const handleCopyAlbumLink = async (event: React.MouseEvent<HTMLButtonElement>, albumId: string) => {
    event.stopPropagation();
    const copied = await copyToClipboard(toAbsoluteInternalUrl(`/album/${albumId}`));
    if (copied) {
      show('专辑内链已复制');
      return;
    }
    show('复制链接失败，请稍后重试', { variant: 'error' });
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
    setConfirmModal({ show: false });
    fetchSongs();
    setLoading(false);
  };

  if (loading) {
    return <PageSkeleton variant="music" />;
  }

	return (
		<div
			className="gufeng-music-page min-h-screen bg-bg-primary"
			style={{
				fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
				lineHeight: 1.8,
			}}
    >
      <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 md:pb-32">
        {/* Header */}
        <header className="mb-7">
          <div className="flex items-end justify-between flex-wrap gap-3">
            <h1 className="text-[1.75rem] font-semibold tracking-[0.12em] text-text-primary">{t('music.title')}</h1>
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
                       ? "bg-[var(--color-theme-accent)] text-white border-[var(--color-theme-accent)]"
                       : "bg-transparent text-text-secondary border-border hover:text-brand-gold hover:border-brand-gold"
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
                  className="px-4 py-2 text-[0.9375rem] rounded border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold transition-all"
                >
                  <Search size={16} className="inline mr-1.5 -mt-0.5" />
                  {t('music.linkImport')}
                </button>
                <button
                  onClick={() => {
                    if (isBanned) { show('账号已被封禁，无法执行此操作', { variant: 'error' }); return; }
                    setIsAdding(!isAdding);
                  }}
                  className="px-4 py-2 text-[0.9375rem] rounded theme-button-primary transition-all"
                >
                  {isAdding ? <X size={16} className="inline mr-1.5 -mt-0.5" /> : <Plus size={16} className="inline mr-1.5 -mt-0.5" />}
                  {isAdding ? t('music.cancelAdd') : t('music.addMusic')}
                </button>
                <Link
                  to="/music/links"
                  className="px-4 py-2 text-[0.9375rem] rounded border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold transition-all"
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
              className="mb-7 p-6 md:p-8 bg-surface rounded border border-border"
            >
              <h3 className="text-lg font-semibold text-text-primary mb-5 flex items-center gap-2">
                <Sparkles size={18} className="text-brand-gold" /> {t('music.inputMusicId')}
              </h3>
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <label className="text-sm font-medium text-text-secondary">{t('music.selectPlatform')}：</label>
                  <select
                    value={selectedPlatform}
                    onChange={e => setSelectedPlatform(e.target.value as typeof selectedPlatform)}
                    className="theme-input px-4 py-2 rounded text-sm"
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
                  className="theme-input w-full px-4 py-3 rounded min-h-[100px] text-sm resize-y"
                  style={{ fontFamily: "inherit" }}
                />
                <div className="flex justify-end">
                  <button
                    onClick={handleAddSong}
                    disabled={loading}
                    className="px-6 py-2.5 theme-button-primary rounded text-sm font-medium transition-all disabled:opacity-50"
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
            onBatchDelete={() => setConfirmModal({ show: true })}
          />
        )}

        {confirmModalPresence.mounted && (
          <div
            className="floating-overlay fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/45"
            data-state={confirmModalPresence.state}
            aria-hidden={!confirmModal.show}
          >
            <div className="floating-panel bg-surface rounded p-8 max-w-md w-full border border-border">
                <h3 className="text-xl font-semibold text-text-primary mb-4 tracking-wide">{t('music.confirmDelete')}</h3>
                <p className="text-text-secondary mb-8 text-[0.9375rem]">
                  {t('music.confirmDeleteBatch', { count: selectedSongs.size })}
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => setConfirmModal({ show: false })}
                    className="flex-1 px-6 py-3 bg-surface-alt text-text-secondary rounded font-semibold hover:bg-bg-tertiary transition-all"
                  >
                    {t('music.cancel')}
                  </button>
                  <button
                    onClick={handleBatchDelete}
                    className="flex-1 px-6 py-3 theme-button-primary rounded font-semibold transition-all"
                  >
                    {t('music.confirmDeleteButton')}
                  </button>
                </div>
            </div>
          </div>
        )}

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
              onSortByChange={(value) => { setSortBy(value); musicPagination.setPage(1); }}
              sortOrder={sortOrder}
              onSortOrderChange={setSortOrder}
              showAccompaniments={showAccompaniments}
              onShowAccompanimentsChange={setShowAccompaniments}
              musicCount={displaySongs.length}
              albumCount={albums.length}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
            />

            {/* Content */}
            {activeTab === 'music' ? (
              <div className="flex flex-col mt-6">
                {paginatedSongs.length > 0 ? (
                  <>
                    <div
                      className={clsx(
                        viewMode === 'list'
                          ? 'divide-y divide-border'
                          : clsx('grid', VIEW_MODE_CONFIG[viewMode].gridCols, VIEW_MODE_CONFIG[viewMode].gap)
                      )}
                    >
                      {paginatedSongs.map((song) => (
                        <SongCard
                          key={song.docId}
                          song={song}
                          viewMode={viewMode}
                          isBatchMode={isBatchMode}
                          isSelected={selectedSongs.has(song.docId)}
                          isCurrentSong={currentSong?.docId === song.docId}
                          isFavoriting={favoriting === song.docId}
                          onPlay={playSong}
                          onToggleSelect={toggleSelect}
                          onToggleFavorite={handleToggleFavorite}
                        />
                      ))}
                    </div>

                    {musicPagination.totalPages > 1 && (
                      <div className="mt-8">
                        <Pagination
                          page={musicPagination.page}
                          totalPages={musicPagination.totalPages}
                          onPageChange={musicPagination.handlePageChange}
                          pageSize={musicPagination.pageSize}
                          onPageSizeChange={musicPagination.handlePageSizeChange}
                          showPageSizeSelector
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="py-20 text-center text-text-muted italic tracking-[0.1em]">{t('music.noMusic')}</div>
                )}
              </div>
            ) : (
              <div className="mt-6">
                {loadingAlbums ? (
                  <div className={clsx("grid", VIEW_MODE_CONFIG[viewMode].gridCols, VIEW_MODE_CONFIG[viewMode].gap)}>
                    {[1,2,3,4,5,6].map(i => (
                      <div key={i} className="animate-pulse">
                        <div className="aspect-square rounded bg-surface-alt mb-2.5" />
                        <div className="h-4 bg-surface-alt rounded w-2/3 mb-1.5" />
                        <div className="h-3 bg-surface-alt rounded w-1/2" />
                      </div>
                    ))}
                  </div>
                ) : albums.length > 0 ? (
                  <>
                    <div className={clsx("grid", VIEW_MODE_CONFIG[viewMode].gridCols, VIEW_MODE_CONFIG[viewMode].gap)}>
                      {paginatedAlbums.map((album) => (
                        <AlbumCard
                          key={album.docId || album.id}
                          album={album}
                          viewMode={viewMode === 'list' ? 'list' : 'grid'}
                          onCopyLink={handleCopyAlbumLink}
                        />
                      ))}
                    </div>
                    {albumPagination.totalPages > 1 && (
                      <div className="mt-8">
                        <Pagination
                          page={albumPagination.page}
                          totalPages={albumPagination.totalPages}
                          onPageChange={albumPagination.handlePageChange}
                          pageSize={albumPagination.pageSize}
                          showPageSizeSelector={false}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="py-20 text-center text-text-muted italic tracking-[0.1em]">{t('music.noAlbums')}</div>
                )}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <aside className="lg:sticky lg:top-20">
            {/* Stats */}
            <div className="py-5">
              <h3 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase mb-3.5">
                统计
              </h3>
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">单曲</span>
                  <span className="text-text-primary font-medium">{songs.length}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">专辑</span>
                  <span className="text-text-primary font-medium">{albums.length}</span>
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
