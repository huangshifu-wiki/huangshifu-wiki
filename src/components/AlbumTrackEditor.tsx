import React, { useEffect, useMemo, useState } from 'react'

import { ChevronDown, ChevronUp, Loader2, Plus, Save, Trash2, X } from '@/src/components/icons'
import { apiDelete, apiGet, apiPatch, apiPost, invalidateMusicApiCaches } from '../lib/apiClient'
import type { AdminDataItem } from '../types/entities'
import { Button, Dialog, DialogContent, Input, Select } from '@/src/components/ui'
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

export interface AlbumTrackEditorProps {
  open: boolean
  album: AdminDataItem | null
  onClose: () => void
  onChanged: () => void
}

export const AlbumTrackEditor = ({ open, album, onClose, onChanged }: AlbumTrackEditorProps) => {
  const [detail, setDetail] = useState<AlbumDetail | null>(null)
  const [songQuery, setSongQuery] = useState('')
  const [songs, setSongs] = useState<AdminDataItem[]>([])
  const [selectedSongDocId, setSelectedSongDocId] = useState('')
  const [selectedDisc, setSelectedDisc] = useState('')
  const [trackOrder, setTrackOrder] = useState('0')
  const [newDiscNumber, setNewDiscNumber] = useState('')
  const [newDiscName, setNewDiscName] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const { show } = useToast()

  const albumId = album?.docId || ''
  const albumSlug = album?.slug || albumId

  const fetchDetail = async (signal?: AbortSignal) => {
    if (!albumSlug) return
    setLoading(true)
    try {
      const response = await apiGet<{ album: AlbumDetail }>(
        `/api/albums/${albumSlug}`,
        undefined,
        undefined,
        signal
      )
      if (signal?.aborted) return
      setDetail(response.album)
      setSelectedDisc(response.album.discs?.[0] ? String(response.album.discs[0].disc) : '')
    } catch (error) {
      if (!signal?.aborted) {
        show(error instanceof Error ? error.message : '获取专辑详情失败', { variant: 'error' })
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    if (!open || !albumSlug) return
    setDetail(null)
    setSongQuery('')
    setSongs([])
    setSelectedSongDocId('')
    setSelectedDisc('')
    setTrackOrder('0')
    setNewDiscNumber('')
    setNewDiscName('')
    const controller = new AbortController()
    void fetchDetail(controller.signal)
    return () => controller.abort()
  }, [albumSlug, open])

  useEffect(() => {
    if (!open) return
    const query = songQuery.trim()
    if (!query) {
      setSongs([])
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
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
          if (!controller.signal.aborted) {
            show(error instanceof Error ? error.message : '搜索歌曲失败', { variant: 'error' })
          }
        })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, show, songQuery])

  const discNumbers = useMemo(
    () => (detail?.discs || []).map((disc) => disc.disc).sort((a, b) => a - b),
    [detail]
  )
  const tracksByDisc = useMemo(() => {
    const grouped = new Map<number, EditorTrack[]>()
    for (const track of detail?.tracks || []) {
      const tracks = grouped.get(track.discNumber)
      if (tracks) tracks.push(track)
      else grouped.set(track.discNumber, [track])
    }
    return grouped
  }, [detail])

  const notifyChanged = () => {
    invalidateMusicApiCaches()
    onChanged()
    void fetchDetail()
  }

  const handleCreateDisc = async () => {
    if (!albumId) return
    const discNumber = Number(newDiscNumber)
    const name = newDiscName.trim()
    if (!Number.isInteger(discNumber) || discNumber < 1 || !name) {
      show('请输入有效的 Disc 编号和名称', { variant: 'error' })
      return
    }
    if (discNumbers.includes(discNumber)) {
      show('Disc 已存在', { variant: 'error' })
      return
    }
    setSaving(true)
    try {
      await apiPost(`/api/albums/${albumId}/discs`, { discNumber, name })
      show('Disc 已创建')
      setNewDiscNumber('')
      setNewDiscName('')
      setSelectedDisc(String(discNumber))
      notifyChanged()
    } catch (error) {
      show(error instanceof Error ? error.message : '创建 Disc 失败', { variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const handleAddTrack = async () => {
    if (!albumId || !selectedSongDocId) {
      show('请选择要添加的歌曲', { variant: 'error' })
      return
    }
    if (!selectedDisc) {
      show('请先选择或创建 Disc', { variant: 'error' })
      return
    }
    if (detail?.tracks.some((track) => track.songDocId === selectedSongDocId)) {
      show('同一专辑不能重复添加歌曲', { variant: 'error' })
      return
    }
    const order = Number(trackOrder)
    const disc = Number(selectedDisc)
    if (!Number.isInteger(order) || order < 0) {
      show('轨序不能为负数', { variant: 'error' })
      return
    }
    setSaving(true)
    try {
      await apiPost(`/api/music/${selectedSongDocId}/albums`, {
        albumDocId: albumId,
        discNumber: disc,
        trackOrder: order,
        isDisplay: false,
      })
      show('歌曲已添加')
      setSelectedSongDocId('')
      setSongQuery('')
      notifyChanged()
    } catch (error) {
      show(error instanceof Error ? error.message : '添加歌曲失败', { variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteTrack = async (track: EditorTrack) => {
    if (!albumId) return
    setSaving(true)
    try {
      await apiDelete(`/api/music/${track.songDocId}/albums/${albumId}`)
      show('歌曲已移出专辑')
      notifyChanged()
    } catch (error) {
      show(error instanceof Error ? error.message : '删除歌曲失败', { variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const handleReorder = async (tracks: EditorTrack[]) => {
    if (!albumId) return
    const grouped = new Map<number, EditorTrack[]>()
    tracks.forEach((track) => {
      const list = grouped.get(track.discNumber) || []
      list.push(track)
      grouped.set(track.discNumber, list)
    })
    const payload = [...grouped.entries()]
      .sort(([left], [right]) => left - right)
      .map(([disc, items]) => ({
        disc,
        name: detail?.discs.find((item) => item.disc === disc)?.name || `Disc ${disc}`,
        songs: items
          .sort((left, right) => left.trackOrder - right.trackOrder)
          .map((item, index) => ({
            songDocId: item.songDocId,
            trackOrder: item.trackOrder,
            song: item.song || undefined,
            index,
          })),
      }))
    setSaving(true)
    try {
      await apiPatch(`/api/albums/${albumId}/tracks/reorder`, { tracks: payload })
      show('曲目编排已保存')
      notifyChanged()
    } catch (error) {
      show(error instanceof Error ? error.message : '保存曲目编排失败', { variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteDisc = async (disc: number) => {
    if (!albumId) return
    if (detail?.tracks.some((track) => track.discNumber === disc)) {
      show('Disc 下仍有歌曲，无法删除', { variant: 'error' })
      return
    }
    setSaving(true)
    try {
      await apiDelete(`/api/albums/${albumId}/discs/${disc}`)
      show('Disc 已删除')
      notifyChanged()
    } catch (error) {
      show(error instanceof Error ? error.message : '删除 Disc 失败', { variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        title="管理曲目"
        description={album ? `${album.title || '专辑'} 的曲目编排` : undefined}
        maxWidthClassName="max-w-4xl"
      >
        <div className="space-y-5">
          <section className="space-y-3 rounded border border-border bg-surface-alt p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[7rem_minmax(0,1fr)_auto]">
              <Input
                type="number"
                min={1}
                value={newDiscNumber}
                onChange={(event) => setNewDiscNumber(event.target.value)}
                placeholder="Disc 编号"
                aria-label="Disc 编号"
              />
              <Input
                value={newDiscName}
                onChange={(event) => setNewDiscName(event.target.value)}
                placeholder="Disc 名称，例如 Disc 1"
                aria-label="Disc 名称"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => void handleCreateDisc()}
                loading={saving}
                leftIcon={<Plus size={14} />}
              >
                新建 Disc
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_8rem_8rem_auto]">
              <Input
                value={songQuery}
                onChange={(event) => setSongQuery(event.target.value)}
                placeholder="搜索歌曲标题或艺术家"
              />
              <Select
                value={selectedDisc}
                onChange={(event) => setSelectedDisc(event.target.value)}
                aria-label="选择 Disc"
              >
                <option value="">选择 Disc</option>
                {discNumbers.map((disc) => (
                  <option key={disc} value={disc}>
                    Disc {disc}
                  </option>
                ))}
              </Select>
              <Input
                type="number"
                min={0}
                value={trackOrder}
                onChange={(event) => setTrackOrder(event.target.value)}
                placeholder="轨序"
                aria-label="轨序"
              />
              <Button
                type="button"
                onClick={() => void handleAddTrack()}
                loading={saving}
                leftIcon={<Plus size={14} />}
              >
                添加歌曲
              </Button>
            </div>
            {songs.length > 0 && (
              <Select
                value={selectedSongDocId}
                onChange={(event) => setSelectedSongDocId(event.target.value)}
                aria-label="选择歌曲"
              >
                <option value="">请选择搜索结果</option>
                {songs.map((song) => (
                  <option key={song.docId} value={song.docId}>
                    {song.title} / {song.artist || (song.artists || []).join('、')}
                  </option>
                ))}
              </Select>
            )}
          </section>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={22} className="animate-spin text-brand-gold" />
            </div>
          ) : detail?.discs?.length ? (
            <div className="space-y-3">
              {detail.discs.map((disc) => (
                <DiscSection
                  key={disc.disc}
                  disc={disc}
                  tracks={tracksByDisc.get(disc.disc) || []}
                  saving={saving}
                  onDeleteDisc={() => void handleDeleteDisc(disc.disc)}
                  onDeleteTrack={handleDeleteTrack}
                  onSave={handleReorder}
                />
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-text-muted">暂无 Disc，请先创建 Disc</p>
          )}
          <div className="flex justify-end border-t border-border pt-3">
            <Button type="button" variant="secondary" onClick={onClose} leftIcon={<X size={15} />}>
              关闭
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const DiscSection = ({
  disc,
  tracks,
  saving,
  onDeleteDisc,
  onDeleteTrack,
  onSave,
}: {
  disc: EditorDisc
  tracks: EditorTrack[]
  saving: boolean
  onDeleteDisc: () => void
  onDeleteTrack: (track: EditorTrack) => void
  onSave: (tracks: EditorTrack[]) => Promise<void>
}) => {
  const [expanded, setExpanded] = useState(true)
  const [draftTracks, setDraftTracks] = useState(tracks)
  useEffect(() => setDraftTracks(tracks), [tracks])
  return (
    <section className="rounded border border-border bg-surface p-4">
      <header className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="flex items-center gap-2 text-left"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          <span className="font-medium text-text-primary">{disc.name || `Disc ${disc.disc}`}</span>
          <span className="text-xs text-text-muted">{draftTracks.length} 首</span>
        </button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={onDeleteDisc}
          disabled={saving || draftTracks.length > 0}
          leftIcon={<Trash2 size={14} />}
        >
          删除 Disc
        </Button>
      </header>
      {expanded && (
        <div className="mt-3 space-y-2">
          {draftTracks.map((track, index) => (
            <div
              key={track.songDocId}
              className="grid grid-cols-[2rem_minmax(0,1fr)_7rem_auto] items-center gap-2 rounded border border-border p-2"
            >
              <span className="text-xs text-text-muted">{index + 1}</span>
              <div className="min-w-0">
                <p className="truncate text-sm text-text-primary">
                  {track.song?.title || track.songDocId}
                </p>
                <p className="truncate text-xs text-text-muted">
                  {track.song?.artists?.join('、') || '未知艺术家'}
                </p>
              </div>
              <Input
                type="number"
                min={0}
                value={track.trackOrder}
                onChange={(event) =>
                  setDraftTracks((previous) =>
                    previous.map((item) =>
                      item.songDocId === track.songDocId
                        ? { ...item, trackOrder: Number(event.target.value) }
                        : item
                    )
                  )
                }
                aria-label="轨序"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void onSave(draftTracks)}
                  disabled={saving}
                  leftIcon={<Save size={14} />}
                  aria-label="保存轨序"
                />
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => onDeleteTrack(track)}
                  disabled={saving}
                  aria-label="删除歌曲"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default AlbumTrackEditor
