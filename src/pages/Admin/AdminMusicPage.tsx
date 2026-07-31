import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { Music, Plus, RefreshCw } from '@/src/components/icons'
import { AdminMusicFilters, type MusicAdminFilterState } from '../../components/AdminMusicFilters'
import {
  AdminResourceActions,
  type AdminResourcePendingAction,
} from '../../components/AdminResourceActions'
import AlbumTrackEditor from '../../components/AlbumTrackEditor'
import { AlbumFormModal } from '../../components/AlbumFormModal'
import { CoverManager } from '../../components/CoverManager'
import { MusicImportModal } from '../../components/MusicImportModal'
import { SmartImage } from '../../components/SmartImage'
import { Button, Checkbox, Input, Select } from '@/src/components/ui'
import { SongAlbumRelationsModal } from '../../components/SongAlbumRelationsModal'
import { SongFormModal } from '../../components/SongFormModal'
import { useDialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import Pagination from '../../components/Pagination'
import { useRoutedPagination } from '../../hooks/useRoutedPagination'
import { apiDelete, apiGet, apiPatch, apiPost, invalidateMusicApiCaches } from '../../lib/apiClient'
import { formatDateTime } from '../../lib/dateUtils'
import { formatMusicCredits } from '../../lib/musicCredits'
import type { AdminAlbumListResponse, AdminMusicListResponse } from '../../types/api'
import type { AdminDataItem } from '../../types/entities'

const SONG_PAGE_SIZE_OPTIONS = [25, 50, 100]
const DEFAULT_FILTERS: MusicAdminFilterState = {
  query: '',
  platform: 'all',
  cover: 'all',
  displayAlbum: 'all',
  sortBy: 'releaseDate',
  sortOrder: 'desc',
  includeDeleted: false,
}

type CoverTarget = { resourceType: 'song' | 'album'; item: AdminDataItem } | null

const itemId = (item: AdminDataItem) => String(item.docId || item.id || '')
const text = (value: unknown, fallback = '—') =>
  typeof value === 'string' && value.trim() ? value : fallback
type MusicSource = { platform: string; sourceId: string }
const isMusicSource = (source: unknown): source is MusicSource => {
  if (!source || typeof source !== 'object') return false
  if (!('platform' in source) || !('sourceId' in source)) return false
  return typeof source.platform === 'string' && typeof source.sourceId === 'string'
}
const sourceList = (item: AdminDataItem) =>
  Array.isArray(item.sources) ? item.sources.filter(isMusicSource) : []

const MusicListCover = ({ src, alt }: { src?: string | null; alt: string }): React.ReactElement => (
  <div
    data-testid="music-list-cover"
    className="relative aspect-square h-12 w-12 shrink-0 overflow-hidden rounded bg-surface-alt"
  >
    <SmartImage
      src={src || undefined}
      alt={alt}
      className="block h-full w-full"
      fallback={
        <div className="flex h-full w-full items-center justify-center text-xs text-text-muted">
          无封面
        </div>
      }
    />
  </div>
)

export const AdminMusicPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const [draftFilters, setDraftFilters] = useState<MusicAdminFilterState>(DEFAULT_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState<MusicAdminFilterState>(DEFAULT_FILTERS)
  const [songs, setSongs] = useState<AdminDataItem[]>([])
  const [albums, setAlbums] = useState<AdminDataItem[]>([])
  const [songTotal, setSongTotal] = useState(0)
  const [albumTotal, setAlbumTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [pendingActions, setPendingActions] = useState<Record<string, AdminResourcePendingAction>>(
    {}
  )
  const [selectedSongIds, setSelectedSongIds] = useState<Set<string>>(new Set())
  const [batchDisplayOpen, setBatchDisplayOpen] = useState(false)
  const [batchDisplaySaving, setBatchDisplaySaving] = useState(false)
  const [batchDisplayForm, setBatchDisplayForm] = useState({
    displayAlbumMode: 'linked' as 'linked' | 'manual' | 'none',
    manualAlbumName: '',
    displayAlbumDocId: '',
  })
  const [songCreateOpen, setSongCreateOpen] = useState(false)
  const [songImportOpen, setSongImportOpen] = useState(false)
  const [editingSong, setEditingSong] = useState<AdminDataItem | null>(null)
  const [editingAlbum, setEditingAlbum] = useState<AdminDataItem | null>(null)
  const [albumFormOpen, setAlbumFormOpen] = useState(false)
  const [relationsSong, setRelationsSong] = useState<AdminDataItem | null>(null)
  const [tracksAlbum, setTracksAlbum] = useState<AdminDataItem | null>(null)
  const [coverTarget, setCoverTarget] = useState<CoverTarget>(null)
  const dialog = useDialog()
  const { show } = useToast()
  const tab = searchParams.get('musicTab') === 'albums' ? 'albums' : 'songs'

  const songPagination = useRoutedPagination({
    totalCount: songTotal,
    defaultPageSize: 50,
    pageParam: 'songPage',
    pageSizeParam: 'songPageSize',
    pageSizeOptions: SONG_PAGE_SIZE_OPTIONS,
    enabled: tab === 'songs',
  })
  const albumPagination = useRoutedPagination({
    totalCount: albumTotal,
    defaultPageSize: 24,
    pageParam: 'albumPage',
    pageSizeParam: null,
    enabled: tab === 'albums',
  })

  const queryParams = (resource: 'songs' | 'albums', page: number, limit: number) => ({
    q: appliedFilters.query || undefined,
    platform: appliedFilters.platform === 'all' ? undefined : appliedFilters.platform,
    cover: appliedFilters.cover === 'all' ? undefined : appliedFilters.cover,
    displayAlbum:
      resource === 'songs' && appliedFilters.displayAlbum !== 'all'
        ? appliedFilters.displayAlbum
        : undefined,
    sortBy: appliedFilters.sortBy,
    sortOrder: appliedFilters.sortOrder,
    includeDeleted: appliedFilters.includeDeleted ? 'true' : undefined,
    page,
    limit,
  })

  const fetchSongs = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      try {
        const response = await apiGet<AdminMusicListResponse>(
          '/api/admin/music',
          queryParams('songs', songPagination.page, songPagination.pageSize),
          undefined,
          signal
        )
        if (signal?.aborted) return
        setSongs(response.data || [])
        setSongTotal(response.total || 0)
        setSelectedSongIds((previous) => {
          const visibleIds = new Set((response.data || []).map(itemId))
          for (const id of previous) {
            if (!visibleIds.has(id)) {
              return new Set([...previous].filter((selectedId) => visibleIds.has(selectedId)))
            }
          }
          return previous
        })
      } catch (error) {
        if (signal?.aborted) return
        setSongs([])
        setSongTotal(0)
        show(error instanceof Error ? error.message : '获取歌曲列表失败', { variant: 'error' })
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [appliedFilters, show, songPagination.page, songPagination.pageSize]
  )

  const fetchAlbums = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      try {
        const response = await apiGet<AdminAlbumListResponse>(
          '/api/admin/albums',
          queryParams('albums', albumPagination.page, albumPagination.pageSize),
          undefined,
          signal
        )
        if (signal?.aborted) return
        setAlbums(response.data || [])
        setAlbumTotal(response.total || 0)
      } catch (error) {
        if (signal?.aborted) return
        setAlbums([])
        setAlbumTotal(0)
        show(error instanceof Error ? error.message : '获取专辑列表失败', { variant: 'error' })
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [albumPagination.page, appliedFilters, show]
  )

  const fetchInactiveCount = useCallback(
    async (activeTab: 'songs' | 'albums', signal?: AbortSignal) => {
      const resource = activeTab === 'songs' ? 'albums' : 'songs'
      try {
        const response = await apiGet<AdminMusicListResponse | AdminAlbumListResponse>(
          resource === 'songs' ? '/api/admin/music' : '/api/admin/albums',
          queryParams(resource, 1, 1),
          undefined,
          signal
        )
        if (signal?.aborted) return
        if (resource === 'songs') setSongTotal(response.total || 0)
        else setAlbumTotal(response.total || 0)
      } catch {
        // 非激活 tab 数量获取失败：保留旧值、不弹 toast，避免打断当前列表
      }
    },
    [appliedFilters]
  )

  useEffect(() => {
    const controller = new AbortController()
    void fetchInactiveCount(tab, controller.signal)
    if (tab === 'songs') void fetchSongs(controller.signal)
    else void fetchAlbums(controller.signal)
    return () => controller.abort()
  }, [fetchAlbums, fetchInactiveCount, fetchSongs, tab])

  const refreshCurrent = async () => {
    invalidateMusicApiCaches()
    if (tab === 'songs') await fetchSongs()
    else await fetchAlbums()
  }

  const handleFilterChange = (next: MusicAdminFilterState) => {
    setDraftFilters(next)
    if (next.query === draftFilters.query) {
      setAppliedFilters(next)
      if (tab === 'songs') songPagination.setPage(1)
      else albumPagination.setPage(1)
    }
  }

  const handleSearch = () => {
    setAppliedFilters({ ...draftFilters, query: draftFilters.query.trim() })
    if (tab === 'songs') songPagination.setPage(1)
    else albumPagination.setPage(1)
  }

  const handleReset = () => {
    setDraftFilters(DEFAULT_FILTERS)
    setAppliedFilters(DEFAULT_FILTERS)
    songPagination.setPage(1)
    albumPagination.setPage(1)
  }

  const handleTabChange = (nextTab: 'songs' | 'albums') => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous)
      if (nextTab === 'songs') next.delete('musicTab')
      else next.set('musicTab', 'albums')
      return next
    })
    if (nextTab === 'songs') songPagination.setPage(1)
    else albumPagination.setPage(1)
  }

  const setPending = (id: string, action: AdminResourcePendingAction) => {
    setPendingActions((previous) => {
      const next = { ...previous }
      if (action) next[id] = action
      else delete next[id]
      return next
    })
  }

  const runDelete = async (item: AdminDataItem, resource: 'songs' | 'albums') => {
    const id = itemId(item)
    const action = item.isDeleted ? 'permanentDelete' : 'delete'
    const confirmed = await dialog.confirm({
      title: action === 'delete' ? '删除内容' : '永久删除内容',
      message:
        action === 'delete'
          ? '确定删除吗？删除后可在回收站恢复。'
          : '确定永久删除吗？此操作不可恢复。',
      confirmText: action === 'delete' ? '删除' : '永久删除',
      variant: 'danger',
    })
    if (!confirmed) return
    setPending(id, action)
    try {
      await apiDelete(
        `/api/admin/${resource === 'songs' ? 'music' : 'albums'}/${id}${action === 'permanentDelete' ? '/permanent' : ''}`
      )
      show(action === 'delete' ? '已删除' : '已彻底删除', { variant: 'success' })
      await refreshCurrent()
    } catch (error) {
      show(error instanceof Error ? error.message : '删除失败', { variant: 'error' })
    } finally {
      setPending(id, null)
    }
  }

  const runRestore = async (item: AdminDataItem, resource: 'songs' | 'albums') => {
    const id = itemId(item)
    setPending(id, 'restore')
    try {
      await apiPost(`/api/admin/${resource === 'songs' ? 'music' : 'albums'}/${id}/restore`)
      show('已恢复', { variant: 'success' })
      await refreshCurrent()
    } catch (error) {
      show(error instanceof Error ? error.message : '恢复失败', { variant: 'error' })
    } finally {
      setPending(id, null)
    }
  }

  const handleBatchDisplay = async () => {
    if (!selectedSongIds.size || batchDisplaySaving) return
    if (
      batchDisplayForm.displayAlbumMode === 'manual' &&
      !batchDisplayForm.manualAlbumName.trim()
    ) {
      show('手动专辑名不能为空', { variant: 'error' })
      return
    }
    setBatchDisplaySaving(true)
    try {
      await apiPatch('/api/admin/music/batch-display', {
        songDocIds: [...selectedSongIds],
        displayAlbumMode: batchDisplayForm.displayAlbumMode,
        manualAlbumName:
          batchDisplayForm.displayAlbumMode === 'manual'
            ? batchDisplayForm.manualAlbumName.trim()
            : null,
        displayAlbumDocId:
          batchDisplayForm.displayAlbumMode === 'linked'
            ? batchDisplayForm.displayAlbumDocId.trim() || null
            : null,
      })
      show('歌曲展示信息已更新', { variant: 'success' })
      setSelectedSongIds(new Set())
      setBatchDisplayOpen(false)
      await refreshCurrent()
    } catch (error) {
      show(error instanceof Error ? error.message : '批量更新失败', { variant: 'error' })
    } finally {
      setBatchDisplaySaving(false)
    }
  }

  const selectedAllSongs = songs.length > 0 && selectedSongIds.size === songs.length

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-[0.12em] text-text-primary">
            <Music size={24} className="text-brand-gold" /> 音乐工作台
          </h1>
          <p className="mt-1 text-sm text-text-muted">集中维护歌曲、专辑、来源、封面与曲目关系。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() =>
              tab === 'songs'
                ? setSongCreateOpen(true)
                : (setEditingAlbum(null), setAlbumFormOpen(true))
            }
            leftIcon={<Plus size={15} />}
          >
            {tab === 'songs' ? '添加歌曲' : '添加专辑'}
          </Button>
          {tab === 'songs' && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setSongImportOpen(true)}
              leftIcon={<Plus size={15} />}
            >
              导入歌曲
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            onClick={() => void refreshCurrent()}
            leftIcon={<RefreshCw size={15} />}
          >
            刷新
          </Button>
        </div>
      </header>

      <div className="flex gap-2 border-b border-border">
        <Button
          type="button"
          variant="ghost"
          className={`rounded-none border-b-2 px-4 py-2 text-sm ${tab === 'songs' ? 'border-brand-gold text-brand-gold' : 'border-transparent text-text-muted'}`}
          onClick={() => handleTabChange('songs')}
        >
          歌曲 ({songTotal})
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={`rounded-none border-b-2 px-4 py-2 text-sm ${tab === 'albums' ? 'border-brand-gold text-brand-gold' : 'border-transparent text-text-muted'}`}
          onClick={() => handleTabChange('albums')}
        >
          专辑 ({albumTotal})
        </Button>
      </div>

      <AdminMusicFilters
        resource={tab}
        value={draftFilters}
        onChange={handleFilterChange}
        onSearch={handleSearch}
        onReset={handleReset}
      />

      {tab === 'songs' && (
        <section className="rounded border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text-secondary">
              当前页已选 <strong className="text-brand-gold">{selectedSongIds.size}</strong> 首歌曲
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  setSelectedSongIds(selectedAllSongs ? new Set() : new Set(songs.map(itemId)))
                }
                disabled={!songs.length}
              >
                {' '}
                {selectedAllSongs ? '取消全选' : '当前页全选'}{' '}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setBatchDisplayOpen((value) => !value)}
                disabled={!selectedSongIds.size}
              >
                批量设置展示
              </Button>
            </div>
          </div>
          {batchDisplayOpen && (
            <div className="mt-3 grid grid-cols-1 gap-3 border-t border-border pt-3 md:grid-cols-[10rem_1fr_1fr_auto]">
              <Select
                value={batchDisplayForm.displayAlbumMode}
                onChange={(event) =>
                  setBatchDisplayForm((previous) => ({
                    ...previous,
                    displayAlbumMode: event.target.value as typeof previous.displayAlbumMode,
                  }))
                }
              >
                <option value="linked">显示关联专辑</option>
                <option value="manual">显示手动专辑</option>
                <option value="none">不显示专辑</option>
              </Select>
              <Input
                value={batchDisplayForm.manualAlbumName}
                onChange={(event) =>
                  setBatchDisplayForm((previous) => ({
                    ...previous,
                    manualAlbumName: event.target.value,
                  }))
                }
                disabled={batchDisplayForm.displayAlbumMode !== 'manual'}
                placeholder="手动专辑名"
              />
              <Input
                value={batchDisplayForm.displayAlbumDocId}
                onChange={(event) =>
                  setBatchDisplayForm((previous) => ({
                    ...previous,
                    displayAlbumDocId: event.target.value,
                  }))
                }
                disabled={batchDisplayForm.displayAlbumMode !== 'linked'}
                placeholder="展示专辑 docId（可选）"
              />
              <Button
                type="button"
                onClick={() => void handleBatchDisplay()}
                loading={batchDisplaySaving}
              >
                保存
              </Button>
            </div>
          )}
        </section>
      )}

      {tab === 'songs' ? (
        <SongTable
          songs={songs}
          loading={loading}
          selectedIds={selectedSongIds}
          onSelect={(id, selected) =>
            setSelectedSongIds((previous) => {
              const next = new Set(previous)
              if (selected) next.add(id)
              else next.delete(id)
              return next
            })
          }
          onEdit={setEditingSong}
          onManage={setRelationsSong}
          onCover={(item) => setCoverTarget({ resourceType: 'song', item })}
          onDelete={(item) => void runDelete(item, 'songs')}
          onRestore={(item) => void runRestore(item, 'songs')}
          onPermanentDelete={(item) => void runDelete(item, 'songs')}
          pendingActions={pendingActions}
        />
      ) : (
        <AlbumTable
          albums={albums}
          loading={loading}
          onEdit={(item) => {
            setEditingAlbum(item)
            setAlbumFormOpen(true)
          }}
          onManage={setTracksAlbum}
          onCover={(item) => setCoverTarget({ resourceType: 'album', item })}
          onDelete={(item) => void runDelete(item, 'albums')}
          onRestore={(item) => void runRestore(item, 'albums')}
          onPermanentDelete={(item) => void runDelete(item, 'albums')}
          pendingActions={pendingActions}
        />
      )}

      {tab === 'songs' && songPagination.totalPages > 1 && (
        <Pagination
          page={songPagination.page}
          totalPages={songPagination.totalPages}
          onPageChange={songPagination.handlePageChange}
          pageSize={songPagination.pageSize}
          onPageSizeChange={songPagination.handlePageSizeChange}
          pageSizeOptions={SONG_PAGE_SIZE_OPTIONS}
          showPageSizeSelector
        />
      )}
      {tab === 'albums' && albumPagination.totalPages > 1 && (
        <Pagination
          page={albumPagination.page}
          totalPages={albumPagination.totalPages}
          onPageChange={albumPagination.handlePageChange}
        />
      )}

      <SongFormModal
        open={songCreateOpen || Boolean(editingSong)}
        onClose={() => {
          setSongCreateOpen(false)
          setEditingSong(null)
        }}
        onSuccess={() => {
          setSongCreateOpen(false)
          setEditingSong(null)
          void refreshCurrent()
        }}
        mode={editingSong ? 'edit' : 'create'}
        song={editingSong as never}
      />
      <MusicImportModal
        open={songImportOpen}
        onClose={() => setSongImportOpen(false)}
        onImported={() => {
          setSongImportOpen(false)
          void refreshCurrent()
        }}
      />
      <AlbumFormModal
        open={albumFormOpen}
        mode={editingAlbum ? 'edit' : 'create'}
        album={editingAlbum}
        onClose={() => {
          setAlbumFormOpen(false)
          setEditingAlbum(null)
        }}
        onSuccess={() => {
          setAlbumFormOpen(false)
          setEditingAlbum(null)
          void refreshCurrent()
        }}
      />
      <SongAlbumRelationsModal
        open={Boolean(relationsSong)}
        song={relationsSong}
        onClose={() => setRelationsSong(null)}
        onChanged={() => void refreshCurrent()}
      />
      <AlbumTrackEditor
        open={Boolean(tracksAlbum)}
        album={tracksAlbum}
        onClose={() => setTracksAlbum(null)}
        onChanged={() => void refreshCurrent()}
      />
      {coverTarget && (
        <CoverManager
          resourceType={coverTarget.resourceType}
          resourceId={itemId(coverTarget.item)}
          currentCover={text(coverTarget.item.cover, '')}
          onCoverUpdated={() => void refreshCurrent()}
          onSyncToSongs={() => void refreshCurrent()}
        />
      )}
    </div>
  )
}

const SongTable = ({
  songs,
  loading,
  selectedIds,
  onSelect,
  onEdit,
  onManage,
  onCover,
  onDelete,
  onRestore,
  onPermanentDelete,
  pendingActions,
}: {
  songs: AdminDataItem[]
  loading: boolean
  selectedIds: Set<string>
  onSelect: (id: string, selected: boolean) => void
  onEdit: (item: AdminDataItem) => void
  onManage: (item: AdminDataItem) => void
  onCover: (item: AdminDataItem) => void
  onDelete: (item: AdminDataItem) => void
  onRestore: (item: AdminDataItem) => void
  onPermanentDelete: (item: AdminDataItem) => void
  pendingActions: Record<string, AdminResourcePendingAction>
}) => (
  <ResourceTable
    loading={loading}
    empty="暂无歌曲"
    headers={[
      '',
      '封面 / 标题 / 艺术家',
      '平台来源',
      '结构化专辑 / 展示模式',
      '发行日期 / 更新时间',
      '操作',
    ]}
  >
    {songs.map((song) => {
      const id = itemId(song)
      const sources = sourceList(song)
      return (
        <tr key={id} className="border-b border-border align-top hover:bg-surface-alt">
          <td className="px-3 py-4">
            <Checkbox
              checked={selectedIds.has(id)}
              onCheckedChange={(checked) => onSelect(id, checked === true)}
              aria-label={`选择 ${text(song.title)}`}
            />
          </td>
          <td className="px-3 py-4">
            <div className="flex gap-3">
              <MusicListCover
                src={song.coverThumbnail || song.cover}
                alt={`${text(song.title)} 封面`}
              />
              <div>
                <p className="font-medium text-text-primary">
                  {song.slug && !song.isDeleted ? (
                    <Link
                      to={`/music/${song.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-brand-gold hover:underline"
                    >
                      {text(song.title)}
                    </Link>
                  ) : (
                    text(song.title)
                  )}{' '}
                  {song.isDeleted && <span className="theme-text-error">（已删除）</span>}
                </p>
                <p className="text-xs text-text-muted">
                  {formatMusicCredits(song.artists, '未知艺术家')}
                </p>
                <p className="text-[11px] text-text-muted">docId: {id}</p>
              </div>
            </div>
          </td>
          <td className="px-3 py-4">
            <div className="flex max-w-[13rem] flex-wrap gap-1">
              {sources.length ? (
                sources.map((source) => (
                  <span
                    key={`${source.platform}:${source.sourceId}`}
                    className="rounded bg-surface-alt px-2 py-1 text-[11px] text-brand-gold"
                  >
                    {source.platform}: {source.sourceId}
                  </span>
                ))
              ) : (
                <span className="text-xs text-text-muted">无来源</span>
              )}
            </div>
          </td>
          <td className="px-3 py-4 text-xs text-text-muted">
            <p className="font-medium text-text-primary">{text(song.album, '无文本专辑')}</p>
            <p>模式：{text(song.displayAlbumMode, 'linked')}</p>
            {song.manualAlbumName && <p>手动：{text(song.manualAlbumName)}</p>}
          </td>
          <td className="px-3 py-4 text-xs text-text-muted">
            <p>发行：{text(song.releaseDate)}</p>
            <p>更新：{formatDateTime(song.updatedAt, '—')}</p>
          </td>
          <td className="px-3 py-4">
            <AdminResourceActions
              isDeleted={Boolean(song.isDeleted)}
              pendingAction={pendingActions[id] || null}
              onEdit={() => onEdit(song)}
              onManage={() => onManage(song)}
              onCover={() => onCover(song)}
              onDelete={() => onDelete(song)}
              onRestore={() => onRestore(song)}
              onPermanentDelete={() => onPermanentDelete(song)}
            />
          </td>
        </tr>
      )
    })}
  </ResourceTable>
)

const AlbumTable = ({
  albums,
  loading,
  onEdit,
  onManage,
  onCover,
  onDelete,
  onRestore,
  onPermanentDelete,
  pendingActions,
}: {
  albums: AdminDataItem[]
  loading: boolean
  onEdit: (item: AdminDataItem) => void
  onManage: (item: AdminDataItem) => void
  onCover: (item: AdminDataItem) => void
  onDelete: (item: AdminDataItem) => void
  onRestore: (item: AdminDataItem) => void
  onPermanentDelete: (item: AdminDataItem) => void
  pendingActions: Record<string, AdminResourcePendingAction>
}) => (
  <ResourceTable
    loading={loading}
    empty="暂无专辑"
    headers={[
      '封面 / 标题 / 艺术家',
      '曲目数 / Disc 数',
      '平台来源',
      '发行日期 / 更新时间',
      '操作',
    ]}
  >
    {albums.map((album) => {
      const id = itemId(album)
      const sources = sourceList(album)
      return (
        <tr key={id} className="border-b border-border align-top hover:bg-surface-alt">
          <td className="px-3 py-4">
            <div className="flex gap-3">
              <MusicListCover
                src={album.coverThumbnail || album.cover}
                alt={`${text(album.title)} 封面`}
              />
              <div>
                <p className="font-medium text-text-primary">
                  {album.slug && !album.isDeleted ? (
                    <Link
                      to={`/album/${album.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-brand-gold hover:underline"
                    >
                      {text(album.title)}
                    </Link>
                  ) : (
                    text(album.title)
                  )}{' '}
                  {album.isDeleted && <span className="theme-text-error">（已删除）</span>}
                </p>
                <p className="text-xs text-text-muted">{text(album.artist, '未知艺术家')}</p>
                <p className="text-[11px] text-text-muted">docId: {id}</p>
              </div>
            </div>
          </td>
          <td className="px-3 py-4 text-sm text-text-secondary">
            {String(album.trackCount ?? 0)} 首 / {String(album.discCount ?? 0)} Disc
          </td>
          <td className="px-3 py-4">
            <div className="flex max-w-[13rem] flex-wrap gap-1">
              {sources.length ? (
                sources.map((source) => (
                  <span
                    key={`${source.platform}:${source.sourceId}`}
                    className="rounded bg-surface-alt px-2 py-1 text-[11px] text-brand-gold"
                  >
                    {source.platform}: {source.sourceId}
                  </span>
                ))
              ) : (
                <span className="text-xs text-text-muted">无来源</span>
              )}
            </div>
          </td>
          <td className="px-3 py-4 text-xs text-text-muted">
            <p>发行：{text(album.releaseDate)}</p>
            <p>更新：{formatDateTime(album.updatedAt, '—')}</p>
          </td>
          <td className="px-3 py-4">
            <AdminResourceActions
              isDeleted={Boolean(album.isDeleted)}
              pendingAction={pendingActions[id] || null}
              onEdit={() => onEdit(album)}
              onManage={() => onManage(album)}
              onCover={() => onCover(album)}
              onDelete={() => onDelete(album)}
              onRestore={() => onRestore(album)}
              onPermanentDelete={() => onPermanentDelete(album)}
            />
          </td>
        </tr>
      )
    })}
  </ResourceTable>
)

const ResourceTable = ({
  loading,
  empty,
  headers,
  children,
}: {
  loading: boolean
  empty: string
  headers: string[]
  children: React.ReactNode
}) => (
  <div className="overflow-hidden rounded border border-border bg-surface">
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] border-collapse text-left">
        <thead>
          <tr className="border-b border-border bg-surface-alt">
            {headers.map((header) => (
              <th
                key={header}
                className="px-3 py-3 text-[11px] font-semibold tracking-wider text-text-muted"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            [1, 2, 3].map((item) => (
              <tr key={item}>
                <td colSpan={headers.length} className="px-3 py-6">
                  <div className="h-6 animate-pulse rounded bg-surface-alt" />
                </td>
              </tr>
            ))
          ) : React.Children.count(children) > 0 ? (
            children
          ) : (
            <tr>
              <td
                colSpan={headers.length}
                className="px-3 py-16 text-center text-sm text-text-muted"
              >
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </div>
)

export default AdminMusicPage
