import React, { useEffect, useMemo, useState } from 'react'
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DragStart,
  type DragUpdate,
  type DraggableProvidedDragHandleProps,
  type DropResult,
  type ResponderProvided,
} from '@hello-pangea/dnd'

import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from '@/src/components/icons'
import { CONTENT_LIMITS } from '../lib/contentLimits'
import { formatMusicCredits } from '../lib/musicCredits'
import { apiDelete, apiGet, apiPatch, apiPost, invalidateMusicApiCaches } from '../lib/apiClient'
import type { AdminDataItem } from '../types/entities'
import {
  Button,
  Dialog,
  DialogContent,
  EmptyState,
  Field,
  IconButton,
  Input,
  LoadErrorState,
  Spinner,
} from '@/src/components/ui'
import { useDialog } from './Dialog'
import { useToast } from './Toast'

interface EditorSong {
  docId: string
  title: string
  artists: string[]
}

interface EditorTrack {
  songDocId: string
  trackOrder: number
  discNumber: number
  song: EditorSong | null
}

interface EditorDisc {
  disc: number
  name: string
  songs: Array<{ songDocId: string; trackOrder: number; song?: EditorSong }>
}

interface AlbumDetail {
  docId: string
  tracks: EditorTrack[]
  discs: EditorDisc[]
}

interface EditorDiscDraft {
  disc: number
  name: string
  tracks: EditorTrack[]
}

type PendingAction =
  | null
  | { type: 'save-order' | 'create-disc' }
  | { type: 'add-track' | 'delete-track'; id: string }
  | { type: 'delete-disc'; disc: number }

const normalizeEditorTracks = (rawTracks: unknown): EditorTrack[] => {
  if (!Array.isArray(rawTracks)) return []
  return rawTracks.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const nestedSong =
      record.song && typeof record.song === 'object'
        ? (record.song as Record<string, unknown>)
        : undefined
    const songDocId =
      (typeof record.songDocId === 'string' && record.songDocId) ||
      (typeof record.docId === 'string' && record.docId) ||
      (typeof nestedSong?.docId === 'string' && nestedSong.docId)
    if (!songDocId) return []

    const rawArtists = nestedSong?.artists ?? record.artists
    const artists = Array.isArray(rawArtists)
      ? rawArtists.filter((artist): artist is string => typeof artist === 'string')
      : typeof rawArtists === 'string'
        ? [rawArtists]
        : []
    const title =
      (typeof nestedSong?.title === 'string' && nestedSong.title) ||
      (typeof record.title === 'string' && record.title) ||
      songDocId

    return [
      {
        songDocId,
        trackOrder:
          typeof record.trackOrder === 'number' && Number.isFinite(record.trackOrder)
            ? record.trackOrder
            : index,
        discNumber:
          typeof record.discNumber === 'number' && Number.isFinite(record.discNumber)
            ? record.discNumber
            : 1,
        song: { docId: songDocId, title, artists },
      },
    ]
  })
}

const reindexTracks = (tracks: EditorTrack[]) =>
  tracks.map((track, index) => ({ ...track, trackOrder: index }))

const buildEditorDraft = (detail: AlbumDetail): EditorDiscDraft[] => {
  const discs = new Map<number, EditorDiscDraft>()

  for (const disc of detail.discs || []) {
    discs.set(disc.disc, { disc: disc.disc, name: disc.name || `Disc ${disc.disc}`, tracks: [] })
  }

  for (const track of detail.tracks) {
    const draft = discs.get(track.discNumber)
    if (draft) draft.tracks.push(track)
    else {
      discs.set(track.discNumber, {
        disc: track.discNumber,
        name: `Disc ${track.discNumber}`,
        tracks: [track],
      })
    }
  }

  return [...discs.values()]
    .sort((left, right) => left.disc - right.disc)
    .map((disc) => ({
      ...disc,
      tracks: [...disc.tracks].sort((left, right) => left.trackOrder - right.trackOrder),
    }))
}

const buildReorderPayload = (drafts: EditorDiscDraft[]) => ({
  tracks: drafts.map((disc) => ({
    disc: disc.disc,
    name: disc.name || `Disc ${disc.disc}`,
    songs: disc.tracks.map((track, index) => ({
      songDocId: track.songDocId,
      trackOrder: index,
    })),
  })),
})

const trackTitle = (track: EditorTrack) => track.song?.title || track.songDocId

export interface AlbumTrackEditorProps {
  open: boolean
  album: AdminDataItem | null
  onClose: () => void
  onChanged: () => void
}

export const AlbumTrackEditor = ({ open, album, onClose, onChanged }: AlbumTrackEditorProps) => {
  const [detail, setDetail] = useState<AlbumDetail | null>(null)
  const [detailError, setDetailError] = useState<unknown | null>(null)
  const [loading, setLoading] = useState(false)
  const [draftDiscs, setDraftDiscs] = useState<EditorDiscDraft[]>([])
  const [activeDiscNumber, setActiveDiscNumber] = useState<number | null>(null)
  const [orderDirty, setOrderDirty] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [newDiscOpen, setNewDiscOpen] = useState(false)
  const [newDiscNumber, setNewDiscNumber] = useState('')
  const [newDiscName, setNewDiscName] = useState('')
  const [songQuery, setSongQuery] = useState('')
  const [songs, setSongs] = useState<AdminDataItem[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<unknown | null>(null)
  const [searchRetryKey, setSearchRetryKey] = useState(0)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [liveAnnouncement, setLiveAnnouncement] = useState('')
  const { show } = useToast()
  const dialog = useDialog()

  const albumId = album?.docId || ''
  const albumSlug = album?.slug || albumId
  const isBusy = pendingAction !== null
  const canStructure = !isBusy && !orderDirty

  const activeDisc = useMemo(
    () => draftDiscs.find((disc) => disc.disc === activeDiscNumber) || null,
    [activeDiscNumber, draftDiscs]
  )
  const activeTracks = activeDisc?.tracks || []
  const discNumbers = useMemo(() => draftDiscs.map((disc) => disc.disc), [draftDiscs])

  const fetchDetail = async (signal?: AbortSignal) => {
    if (!albumSlug) return
    setLoading(true)
    setDetailError(null)
    try {
      const response = await apiGet<{ album: AlbumDetail }>(
        `/api/albums/${albumSlug}`,
        undefined,
        undefined,
        signal
      )
      if (signal?.aborted) return
      const nextDetail = { ...response.album, tracks: normalizeEditorTracks(response.album.tracks) }
      const nextDrafts = buildEditorDraft(nextDetail)
      setDetail(nextDetail)
      setDraftDiscs(nextDrafts)
      setActiveDiscNumber((current) =>
        current !== null && nextDrafts.some((disc) => disc.disc === current)
          ? current
          : (nextDrafts[0]?.disc ?? null)
      )
      setOrderDirty(false)
    } catch (error) {
      if (!signal?.aborted) {
        setDetailError(error)
        if (!detail) {
          show(error instanceof Error ? error.message : '获取专辑详情失败', { variant: 'error' })
        }
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    if (!open || !albumSlug) return
    setDetail(null)
    setDetailError(null)
    setDraftDiscs([])
    setActiveDiscNumber(null)
    setOrderDirty(false)
    setPendingAction(null)
    setNewDiscOpen(false)
    setNewDiscNumber('')
    setNewDiscName('')
    setSongQuery('')
    setSongs([])
    setSearchLoading(false)
    setSearchError(null)
    setHighlightedIndex(-1)
    setLiveAnnouncement('')
    const controller = new AbortController()
    void fetchDetail(controller.signal)
    return () => controller.abort()
  }, [albumSlug, open])

  useEffect(() => {
    if (!open) return
    const query = songQuery.trim()
    setSongs([])
    setSearchError(null)
    setHighlightedIndex(-1)
    if (!query) {
      setSearchLoading(false)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setSearchLoading(true)
      void apiGet<{ data: AdminDataItem[] }>(
        '/api/admin/music',
        { q: query, limit: 20 },
        undefined,
        controller.signal
      )
        .then((response) => {
          if (!controller.signal.aborted) setSongs(response.data || [])
        })
        .catch((error) => {
          if (!controller.signal.aborted) setSearchError(error)
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchLoading(false)
        })
    }, 250)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, searchRetryKey, songQuery])

  const notifyChanged = async () => {
    invalidateMusicApiCaches()
    onChanged()
    await fetchDetail()
  }

  const requestClose = async () => {
    if (isBusy) return
    if (!orderDirty) {
      onClose()
      return
    }
    const confirmed = await dialog.confirm({
      title: '放弃未保存的编排？',
      message: '曲目顺序尚未保存，关闭后将丢失这些调整。',
      confirmText: '放弃并关闭',
      cancelText: '继续编辑',
      variant: 'warning',
    })
    if (confirmed) onClose()
  }

  const moveTrack = (discNumber: number, fromIndex: number, toIndex: number) => {
    if (isBusy || fromIndex === toIndex) return
    setDraftDiscs((current) =>
      current.map((disc) => {
        if (disc.disc !== discNumber) return disc
        const nextTracks = [...disc.tracks]
        const [moved] = nextTracks.splice(fromIndex, 1)
        if (!moved) return disc
        nextTracks.splice(toIndex, 0, moved)
        return { ...disc, tracks: reindexTracks(nextTracks) }
      })
    )
    setOrderDirty(true)
  }

  const handleMoveTrack = (fromIndex: number, toIndex: number) => {
    if (!activeDisc || fromIndex === toIndex) return
    const moved = activeTracks[fromIndex]
    if (!moved) return
    moveTrack(activeDisc.disc, fromIndex, toIndex)
    setLiveAnnouncement(
      `《${trackTitle(moved)}》已移至第 ${toIndex + 1} 首，共 ${activeTracks.length} 首`
    )
  }

  const handleDragStart = (result: DragStart, provided: ResponderProvided) => {
    const track = activeTracks[result.source.index]
    if (track) {
      provided.announce(
        `已拿起《${trackTitle(track)}》，当前位置第 ${result.source.index + 1} 首，共 ${activeTracks.length} 首。`
      )
    }
  }

  const handleDragUpdate = (result: DragUpdate, provided: ResponderProvided) => {
    const track = activeTracks[result.source.index]
    if (track && result.destination) {
      provided.announce(
        `《${trackTitle(track)}》将移动到第 ${result.destination.index + 1} 首，共 ${activeTracks.length} 首。`
      )
    }
  }

  const handleDragEnd = (result: DropResult, provided: ResponderProvided) => {
    const track = activeTracks[result.source.index]
    if (!track || activeDiscNumber === null) return
    if (result.reason === 'CANCEL') {
      provided.announce(`已取消移动《${trackTitle(track)}》。`)
      return
    }
    if (!result.destination || result.destination.index === result.source.index) {
      provided.announce(`《${trackTitle(track)}》的位置未改变。`)
      return
    }
    moveTrack(activeDiscNumber, result.source.index, result.destination.index)
    const message = `《${trackTitle(track)}》已移至第 ${result.destination.index + 1} 首，共 ${activeTracks.length} 首。`
    provided.announce(message)
    setLiveAnnouncement(message)
  }

  const handleSaveOrder = async () => {
    if (!albumId || !orderDirty) return
    setPendingAction({ type: 'save-order' })
    try {
      await apiPatch(`/api/albums/${albumId}/tracks/reorder`, buildReorderPayload(draftDiscs))
      setOrderDirty(false)
      show('曲目编排已保存')
      await notifyChanged()
    } catch (error) {
      show(error instanceof Error ? error.message : '保存曲目编排失败', { variant: 'error' })
    } finally {
      setPendingAction(null)
    }
  }

  const handleCreateDisc = async () => {
    if (!albumId) return
    const discNumber = Number(newDiscNumber)
    const name = newDiscName.trim()
    if (!Number.isInteger(discNumber) || discNumber < 1 || discNumber > 20 || !name) {
      show('请输入有效的 Disc 编号和名称', { variant: 'error' })
      return
    }
    if (discNumbers.includes(discNumber)) {
      show('Disc 已存在', { variant: 'error' })
      return
    }

    setPendingAction({ type: 'create-disc' })
    try {
      await apiPost(`/api/albums/${albumId}/discs`, { discNumber, name })
      setNewDiscNumber('')
      setNewDiscName('')
      setNewDiscOpen(false)
      setActiveDiscNumber(discNumber)
      show('Disc 已创建')
      await notifyChanged()
    } catch (error) {
      show(error instanceof Error ? error.message : '创建 Disc 失败', { variant: 'error' })
    } finally {
      setPendingAction(null)
    }
  }

  const handleAddTrack = async (song: AdminDataItem) => {
    if (!albumId || !activeDisc) return
    const songDocId = song.docId || ''
    if (!songDocId) return
    if (draftDiscs.some((disc) => disc.tracks.some((track) => track.songDocId === songDocId))) {
      show('同一专辑不能重复添加歌曲', { variant: 'error' })
      return
    }
    const maxPersistedTrackOrder = Math.max(
      -1,
      ...(detail?.tracks
        .filter((track) => track.discNumber === activeDisc.disc)
        .map((track) => track.trackOrder) || [])
    )
    if (maxPersistedTrackOrder >= 5000) {
      show('当前轨序已达上限，请先调整并保存编排', { variant: 'error' })
      return
    }

    setPendingAction({ type: 'add-track', id: songDocId })
    try {
      await apiPost(`/api/music/${songDocId}/albums`, {
        albumDocId: albumId,
        discNumber: activeDisc.disc,
        trackOrder: maxPersistedTrackOrder + 1,
        isDisplay: false,
      })
      setSongQuery('')
      setSongs([])
      show('歌曲已添加')
      await notifyChanged()
    } catch (error) {
      show(error instanceof Error ? error.message : '添加歌曲失败', { variant: 'error' })
    } finally {
      setPendingAction(null)
    }
  }

  const handleDeleteTrack = async (track: EditorTrack) => {
    if (!albumId) return
    const confirmed = await dialog.confirm({
      title: '移出曲目',
      message: `确定将《${trackTitle(track)}》从专辑中移除吗？`,
      confirmText: '移出',
      variant: 'danger',
    })
    if (!confirmed) return

    setPendingAction({ type: 'delete-track', id: track.songDocId })
    try {
      await apiDelete(`/api/music/${track.songDocId}/albums/${albumId}`)
      show('歌曲已移出专辑')
      await notifyChanged()
    } catch (error) {
      show(error instanceof Error ? error.message : '删除歌曲失败', { variant: 'error' })
    } finally {
      setPendingAction(null)
    }
  }

  const handleDeleteDisc = async (disc: EditorDiscDraft) => {
    if (!albumId || disc.tracks.length) return
    const confirmed = await dialog.confirm({
      title: '删除 Disc',
      message: `确定删除“${disc.name}”吗？`,
      confirmText: '删除',
      variant: 'danger',
    })
    if (!confirmed) return

    setPendingAction({ type: 'delete-disc', disc: disc.disc })
    try {
      await apiDelete(`/api/albums/${albumId}/discs/${disc.disc}`)
      const nextDisc = draftDiscs.find((item) => item.disc > disc.disc) || draftDiscs.at(-2)
      setActiveDiscNumber(nextDisc?.disc ?? null)
      show('Disc 已删除')
      await notifyChanged()
    } catch (error) {
      show(error instanceof Error ? error.message : '删除 Disc 失败', { variant: 'error' })
    } finally {
      setPendingAction(null)
    }
  }

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || !songs.length || !activeDisc) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex((current) => Math.min(current + 1, songs.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex((current) => Math.max(current - 1, 0))
    } else if (event.key === 'Enter' && highlightedIndex >= 0) {
      event.preventDefault()
      void handleAddTrack(songs[highlightedIndex])
    } else if (event.key === 'Escape') {
      setHighlightedIndex(-1)
    }
  }

  const initialLoading = loading && !detail
  const initialError = detailError && !detail
  const refreshError = detailError && detail

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) void requestClose()
      }}
    >
      <DialogContent
        title="管理曲目"
        description={album ? `${album.title || '专辑'} 的曲目编排` : undefined}
        hideClose
        maxWidthClassName="max-w-6xl"
        className="flex h-[min(48rem,calc(100vh-2rem))] flex-col overflow-hidden"
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          void requestClose()
        }}
        onPointerDownOutside={(event) => {
          event.preventDefault()
          void requestClose()
        }}
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" aria-busy={loading || isBusy}>
          {initialLoading ? (
            <div className="flex min-h-64 items-center justify-center">
              <Spinner label="正在加载专辑曲目" size="lg" />
            </div>
          ) : initialError ? (
            <LoadErrorState
              description={detailError instanceof Error ? detailError.message : '获取专辑详情失败'}
              onRetry={() => void fetchDetail()}
            />
          ) : (
            <div className="space-y-4">
              {refreshError && (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 border border-[var(--color-warning)] bg-surface-alt px-3 py-2 text-sm text-text-secondary"
                  role="alert"
                >
                  <span>
                    {detailError instanceof Error ? detailError.message : '刷新专辑详情失败'}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void fetchDetail()}
                  >
                    重新加载
                  </Button>
                </div>
              )}
              {orderDirty && (
                <p
                  className="border border-brand-gold bg-surface-alt px-3 py-2 text-sm text-text-secondary"
                  role="status"
                >
                  先保存或撤销当前顺序，再增删 Disc 或曲目。
                </p>
              )}

              {draftDiscs.length === 0 ? (
                <div className="mx-auto max-w-xl border-y border-[var(--book-ink-line)]">
                  <EmptyState
                    title="暂无 Disc"
                    description="先创建 Disc，再为它添加歌曲。"
                    action={
                      <Button
                        type="button"
                        onClick={() => setNewDiscOpen(true)}
                        leftIcon={<Plus size={16} />}
                      >
                        新建 Disc
                      </Button>
                    }
                  />
                  <CreateDiscForm
                    open={newDiscOpen}
                    number={newDiscNumber}
                    name={newDiscName}
                    disabled={!canStructure}
                    loading={pendingAction?.type === 'create-disc'}
                    onNumberChange={setNewDiscNumber}
                    onNameChange={setNewDiscName}
                    onSubmit={() => void handleCreateDisc()}
                  />
                </div>
              ) : (
                <div className="grid min-w-0 gap-5 lg:grid-cols-[14rem_minmax(0,1fr)]">
                  <aside className="min-w-0 lg:border-r lg:border-[var(--book-ink-line)] lg:pr-5">
                    <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
                      {draftDiscs.map((disc) => (
                        <Button
                          key={disc.disc}
                          type="button"
                          variant={disc.disc === activeDiscNumber ? 'primary' : 'ghost'}
                          size="sm"
                          aria-pressed={disc.disc === activeDiscNumber}
                          onClick={() => setActiveDiscNumber(disc.disc)}
                          className="shrink-0 justify-start whitespace-nowrap lg:w-full"
                        >
                          <span className="truncate">{disc.name}</span>
                          <span className="text-xs opacity-70">{disc.tracks.length} 首</span>
                        </Button>
                      ))}
                    </div>
                    <div className="mt-3 border-t border-[var(--book-ink-line)] pt-3">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={!canStructure}
                        onClick={() => setNewDiscOpen((value) => !value)}
                        leftIcon={newDiscOpen ? <ChevronUp size={14} /> : <Plus size={14} />}
                        className="w-full"
                      >
                        新建 Disc
                      </Button>
                      <CreateDiscForm
                        open={newDiscOpen}
                        number={newDiscNumber}
                        name={newDiscName}
                        disabled={!canStructure}
                        loading={pendingAction?.type === 'create-disc'}
                        onNumberChange={setNewDiscNumber}
                        onNameChange={setNewDiscName}
                        onSubmit={() => void handleCreateDisc()}
                      />
                    </div>
                  </aside>

                  {activeDisc && (
                    <section className="min-w-0 space-y-4" aria-labelledby="active-disc-heading">
                      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--book-ink-line)] pb-3">
                        <div className="min-w-0">
                          <p className="text-xs tracking-[0.16em] text-brand-gold">
                            DISC {activeDisc.disc}
                          </p>
                          <h3
                            id="active-disc-heading"
                            className="mt-1 font-[var(--book-title-font)] text-xl text-text-primary"
                          >
                            {activeDisc.name}
                          </h3>
                          <p className="mt-1 text-sm text-text-muted">
                            {activeTracks.length} 首曲目
                          </p>
                        </div>
                        <div className="space-y-1 text-right">
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            disabled={!canStructure || activeTracks.length > 0}
                            loading={
                              pendingAction?.type === 'delete-disc' &&
                              pendingAction.disc === activeDisc.disc
                            }
                            onClick={() => void handleDeleteDisc(activeDisc)}
                            leftIcon={<Trash2 size={14} />}
                          >
                            删除 Disc
                          </Button>
                          {activeTracks.length > 0 && (
                            <p className="text-xs text-text-muted">请先移出该 Disc 的全部曲目</p>
                          )}
                        </div>
                      </header>

                      <SongSearch
                        query={songQuery}
                        songs={songs}
                        loading={searchLoading}
                        error={searchError}
                        highlightedIndex={highlightedIndex}
                        disabled={!canStructure}
                        existingSongIds={
                          new Set(
                            draftDiscs.flatMap((disc) =>
                              disc.tracks.map((track) => track.songDocId)
                            )
                          )
                        }
                        onQueryChange={setSongQuery}
                        onKeyDown={handleSearchKeyDown}
                        onSelect={(song) => void handleAddTrack(song)}
                        onRetry={() => setSearchRetryKey((value) => value + 1)}
                      />

                      {activeTracks.length === 0 ? (
                        <EmptyState
                          title="这个 Disc 还没有歌曲"
                          description="搜索歌曲并直接添加到当前 Disc。"
                          className="border-y border-[var(--book-ink-line)]"
                        />
                      ) : (
                        <>
                          <DragDropContext
                            dragHandleUsageInstructions="按空格键拿起曲目，使用上下方向键移动，再按空格键放下；按 Esc 取消。"
                            onDragStart={handleDragStart}
                            onDragUpdate={handleDragUpdate}
                            onDragEnd={handleDragEnd}
                          >
                            <Droppable
                              droppableId={`disc-${activeDisc.disc}`}
                              direction="vertical"
                              isDropDisabled={isBusy}
                              getContainerForClone={() => document.body}
                              renderClone={(provided, snapshot, rubric) => {
                                const track = activeTracks[rubric.source.index]
                                if (!track) return null
                                return (
                                  <div
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    className="border border-[var(--book-ink-line)] bg-[var(--ui-floating-bg)] shadow-[var(--ui-floating-shadow)]"
                                  >
                                    <TrackRowContent
                                      track={track}
                                      index={rubric.source.index}
                                      total={activeTracks.length}
                                      dragHandleProps={provided.dragHandleProps}
                                      reorderDisabled
                                      deleteDisabled
                                      onMove={handleMoveTrack}
                                      onDelete={handleDeleteTrack}
                                    />
                                  </div>
                                )
                              }}
                            >
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.droppableProps}
                                  className={`divide-y divide-[var(--book-ink-line)] border-y border-[var(--book-ink-line)] ${
                                    snapshot.isDraggingOver ? 'bg-surface-alt' : ''
                                  }`}
                                >
                                  {activeTracks.map((track, index) => (
                                    <Draggable
                                      key={track.songDocId}
                                      draggableId={track.songDocId}
                                      index={index}
                                      isDragDisabled={isBusy}
                                      disableInteractiveElementBlocking
                                    >
                                      {(dragProvided, snapshot) => (
                                        <div
                                          ref={dragProvided.innerRef}
                                          {...dragProvided.draggableProps}
                                          className={
                                            snapshot.isDragging
                                              ? 'bg-surface-alt opacity-75 shadow-[var(--ui-floating-shadow)]'
                                              : 'bg-surface'
                                          }
                                        >
                                          <TrackRowContent
                                            track={track}
                                            index={index}
                                            total={activeTracks.length}
                                            dragHandleProps={dragProvided.dragHandleProps}
                                            reorderDisabled={isBusy}
                                            deleteDisabled={isBusy || orderDirty}
                                            onMove={handleMoveTrack}
                                            onDelete={handleDeleteTrack}
                                          />
                                        </div>
                                      )}
                                    </Draggable>
                                  ))}
                                  {provided.placeholder}
                                </div>
                              )}
                            </Droppable>
                          </DragDropContext>
                          <p className="sr-only" role="status" aria-live="polite">
                            {liveAnnouncement}
                          </p>
                        </>
                      )}
                    </section>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <footer className="flex flex-wrap justify-end gap-3 border-t border-[var(--book-ink-line)] bg-surface-alt/60 px-5 py-3 pb-safe">
          <Button
            type="button"
            variant="secondary"
            disabled={isBusy || !orderDirty}
            onClick={() => {
              if (!detail) return
              setDraftDiscs(buildEditorDraft(detail))
              setOrderDirty(false)
              setLiveAnnouncement('已撤销未保存的曲目顺序调整。')
            }}
          >
            撤销调整
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={isBusy}
            onClick={() => void requestClose()}
            leftIcon={<X size={15} />}
          >
            关闭
          </Button>
          <Button
            type="button"
            disabled={!orderDirty}
            loading={pendingAction?.type === 'save-order'}
            loadingText="正在保存"
            onClick={() => void handleSaveOrder()}
            leftIcon={<Save size={15} />}
          >
            保存编排
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}

const CreateDiscForm = ({
  open,
  number,
  name,
  disabled,
  loading,
  onNumberChange,
  onNameChange,
  onSubmit,
}: {
  open: boolean
  number: string
  name: string
  disabled: boolean
  loading: boolean
  onNumberChange: (value: string) => void
  onNameChange: (value: string) => void
  onSubmit: () => void
}) => {
  if (!open) return null
  return (
    <div className="mt-3 space-y-3 border-t border-[var(--book-ink-line)] pt-3">
      <Field label="Disc 编号">
        <Input
          type="number"
          min={1}
          max={20}
          value={number}
          disabled={disabled}
          onChange={(event) => onNumberChange(event.target.value)}
          placeholder="例如 2"
        />
      </Field>
      <Field label="Disc 名称">
        <Input
          value={name}
          maxLength={CONTENT_LIMITS.album.discName}
          disabled={disabled}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="例如 附碟"
        />
      </Field>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        fullWidth
        disabled={disabled}
        loading={loading}
        onClick={onSubmit}
      >
        创建 Disc
      </Button>
    </div>
  )
}

const SongSearch = ({
  query,
  songs,
  loading,
  error,
  highlightedIndex,
  disabled,
  existingSongIds,
  onQueryChange,
  onKeyDown,
  onSelect,
  onRetry,
}: {
  query: string
  songs: AdminDataItem[]
  loading: boolean
  error: unknown | null
  highlightedIndex: number
  disabled: boolean
  existingSongIds: Set<string>
  onQueryChange: (value: string) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onSelect: (song: AdminDataItem) => void
  onRetry: () => void
}) => {
  const listboxId = 'album-track-search-results'
  const hasQuery = Boolean(query.trim())
  return (
    <Field label="添加歌曲" description="搜索后选择结果，即可追加到当前 Disc。">
      <div className="relative">
        <Input
          value={query}
          disabled={disabled}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="搜索歌曲标题或艺术家"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={hasQuery && (loading || Boolean(error) || songs.length > 0)}
          aria-activedescendant={
            highlightedIndex >= 0 && highlightedIndex < songs.length
              ? `${listboxId}-${highlightedIndex}`
              : undefined
          }
          autoComplete="off"
        />
        <Search
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted"
        />
      </div>
      {hasQuery && (
        <div className="mt-2 overflow-hidden border border-[var(--book-ink-line)] bg-[var(--ui-floating-bg)]">
          {loading ? (
            <div
              className="flex items-center gap-2 px-3 py-3 text-sm text-text-muted"
              role="status"
            >
              <Spinner size="sm" label="正在搜索歌曲" />
              正在搜索歌曲
            </div>
          ) : error ? (
            <div
              className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 text-sm text-text-secondary"
              role="alert"
            >
              <span>{error instanceof Error ? error.message : '搜索歌曲失败'}</span>
              <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
                重新搜索
              </Button>
            </div>
          ) : songs.length === 0 ? (
            <p className="px-3 py-3 text-sm text-text-muted">未找到匹配歌曲</p>
          ) : (
            <div id={listboxId} role="listbox" aria-label="歌曲搜索结果">
              {songs.map((song, index) => {
                const songDocId = song.docId || ''
                const exists = Boolean(songDocId && existingSongIds.has(songDocId))
                return (
                  <Button
                    key={songDocId || `${song.title || 'song'}-${index}`}
                    id={`${listboxId}-${index}`}
                    type="button"
                    variant="ghost"
                    role="option"
                    aria-selected={index === highlightedIndex}
                    disabled={disabled || exists || !songDocId}
                    onClick={() => onSelect(song)}
                    className={`h-auto w-full justify-start rounded-none border-x-0 border-t-0 border-b border-[var(--book-ink-line)] px-3 py-2.5 text-left last:border-b-0 ${
                      index === highlightedIndex ? 'bg-surface-alt' : ''
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-text-primary">
                        {song.title || songDocId}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-text-muted">
                        {formatMusicCredits(song.artists || song.artist, '未知艺术家')}
                      </span>
                    </span>
                    {exists && <span className="shrink-0 text-xs text-text-muted">已在专辑</span>}
                  </Button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </Field>
  )
}

const TrackRowContent = ({
  track,
  index,
  total,
  dragHandleProps,
  reorderDisabled,
  deleteDisabled,
  onMove,
  onDelete,
}: {
  track: EditorTrack
  index: number
  total: number
  dragHandleProps: DraggableProvidedDragHandleProps | null
  reorderDisabled: boolean
  deleteDisabled: boolean
  onMove: (fromIndex: number, toIndex: number) => void
  onDelete: (track: EditorTrack) => void
}) => {
  const title = trackTitle(track)
  return (
    <div className="grid min-w-0 grid-cols-[auto_auto_minmax(0,1fr)] gap-x-3 gap-y-2 px-3 py-3 sm:grid-cols-[2rem_auto_minmax(0,1fr)_auto] sm:items-center">
      <span className="row-span-2 self-center text-sm tabular-nums text-text-muted sm:row-span-1">
        {index + 1}
      </span>
      <IconButton
        {...dragHandleProps}
        type="button"
        variant="ghost"
        size="sm"
        disabled={reorderDisabled || !dragHandleProps}
        aria-label={`拖动《${title}》调整顺序，当前第 ${index + 1} 首，共 ${total} 首`}
        data-press-feedback="none"
        className="row-span-2 self-center text-text-muted hover:text-text-primary sm:row-span-1"
      >
        <GripVertical size={16} />
      </IconButton>
      <div className="min-w-0 sm:col-start-3">
        <p className="truncate text-sm font-medium text-text-primary">{title}</p>
        <p className="mt-0.5 truncate text-xs text-text-muted">
          {formatMusicCredits(track.song?.artists, '未知艺术家')}
        </p>
      </div>
      <div className="col-span-3 flex flex-wrap justify-end gap-1 sm:col-span-1 sm:col-start-4 sm:row-start-1 sm:flex-nowrap">
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          disabled={reorderDisabled || index === 0}
          aria-label={`将《${title}》上移`}
          onClick={() => onMove(index, index - 1)}
        >
          <ChevronUp size={15} />
        </IconButton>
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          disabled={reorderDisabled || index === total - 1}
          aria-label={`将《${title}》下移`}
          onClick={() => onMove(index, index + 1)}
        >
          <ChevronDown size={15} />
        </IconButton>
        <IconButton
          type="button"
          variant="danger"
          size="sm"
          disabled={deleteDisabled}
          aria-label={`移出《${title}》`}
          onClick={() => void onDelete(track)}
        >
          <Trash2 size={15} />
        </IconButton>
      </div>
    </div>
  )
}

export default AlbumTrackEditor
