import React, { useEffect, useState } from 'react'

import { Loader2, Plus, Save, Trash2, X } from '@/src/components/icons'
import { Button, Checkbox, Dialog, DialogContent, Input, Select } from '@/src/components/ui'
import { apiDelete, apiGet, apiPatch, apiPost, invalidateMusicApiCaches } from '../lib/apiClient'
import type { AdminDataItem } from '../types/entities'
import { useToast } from './Toast'

interface SongAlbumRelation {
  id: string
  songDocId: string
  albumDocId: string
  discNumber: number
  trackOrder: number
  isDisplay: boolean
  album: { docId: string; title: string; artist: string; cover?: string }
}

export interface SongAlbumRelationsModalProps {
  open: boolean
  song: AdminDataItem | null
  onClose: () => void
  onChanged: () => void
}

export const SongAlbumRelationsModal = ({
  open,
  song,
  onClose,
  onChanged,
}: SongAlbumRelationsModalProps) => {
  const [relations, setRelations] = useState<SongAlbumRelation[]>([])
  const [albumQuery, setAlbumQuery] = useState('')
  const [albums, setAlbums] = useState<AdminDataItem[]>([])
  const [selectedAlbumDocId, setSelectedAlbumDocId] = useState('')
  const [discNumber, setDiscNumber] = useState('1')
  const [trackOrder, setTrackOrder] = useState('0')
  const [isDisplay, setIsDisplay] = useState(false)
  const [loading, setLoading] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const { show } = useToast()

  const fetchRelations = async (signal?: AbortSignal) => {
    if (!song?.docId) return
    setLoading(true)
    try {
      const response = await apiGet<{ relations: SongAlbumRelation[] }>(
        `/api/music/${song.docId}/albums`,
        undefined,
        undefined,
        signal
      )
      if (signal?.aborted) return
      setRelations(response.relations || [])
    } catch (error) {
      if (!signal?.aborted) {
        show(error instanceof Error ? error.message : '获取歌曲专辑关系失败', { variant: 'error' })
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    if (!open || !song?.docId) return
    setAlbumQuery('')
    setAlbums([])
    setSelectedAlbumDocId('')
    setDiscNumber('1')
    setTrackOrder('0')
    setIsDisplay(false)
    const controller = new AbortController()
    void fetchRelations(controller.signal)
    return () => controller.abort()
  }, [open, song?.docId])

  useEffect(() => {
    if (!open) return
    const query = albumQuery.trim()
    if (!query) {
      setAlbums([])
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void apiGet<{ data: AdminDataItem[] }>(
        '/api/admin/albums',
        { q: query, limit: 20 },
        undefined,
        controller.signal
      )
        .then((response) => {
          if (!controller.signal.aborted) setAlbums(response.data || [])
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            show(error instanceof Error ? error.message : '搜索专辑失败', { variant: 'error' })
          }
        })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [albumQuery, open, show])

  const notifyChanged = () => {
    invalidateMusicApiCaches()
    onChanged()
    void fetchRelations()
  }

  const handleAdd = async () => {
    if (!song?.docId || !selectedAlbumDocId) {
      show('请选择要关联的专辑', { variant: 'error' })
      return
    }
    if (relations.some((relation) => relation.albumDocId === selectedAlbumDocId)) {
      show('该歌曲已经关联此专辑', { variant: 'error' })
      return
    }
    const disc = Number(discNumber)
    const order = Number(trackOrder)
    if (!Number.isInteger(disc) || disc < 1 || !Number.isInteger(order) || order < 0) {
      show('Disc 必须为正整数，轨序不能为负数', { variant: 'error' })
      return
    }
    setSavingKey('new')
    try {
      await apiPost(`/api/music/${song.docId}/albums`, {
        albumDocId: selectedAlbumDocId,
        discNumber: disc,
        trackOrder: order,
        isDisplay,
      })
      show('专辑关系已添加')
      setSelectedAlbumDocId('')
      setAlbumQuery('')
      notifyChanged()
    } catch (error) {
      show(error instanceof Error ? error.message : '添加专辑关系失败', { variant: 'error' })
    } finally {
      setSavingKey(null)
    }
  }

  const handleUpdate = async (relation: SongAlbumRelation, next: Partial<SongAlbumRelation>) => {
    if (!song?.docId) return
    const nextDisc = next.discNumber ?? relation.discNumber
    const nextOrder = next.trackOrder ?? relation.trackOrder
    if (
      !Number.isInteger(nextDisc) ||
      nextDisc < 1 ||
      !Number.isInteger(nextOrder) ||
      nextOrder < 0
    ) {
      show('Disc 必须为正整数，轨序不能为负数', { variant: 'error' })
      return
    }
    setSavingKey(relation.id)
    try {
      await apiPatch(`/api/music/${song.docId}/albums/${relation.albumDocId}`, {
        discNumber: nextDisc,
        trackOrder: nextOrder,
        isDisplay: next.isDisplay ?? relation.isDisplay,
      })
      show('专辑关系已更新')
      notifyChanged()
    } catch (error) {
      show(error instanceof Error ? error.message : '更新专辑关系失败', { variant: 'error' })
    } finally {
      setSavingKey(null)
    }
  }

  const handleDelete = async (relation: SongAlbumRelation) => {
    if (!song?.docId) return
    setSavingKey(relation.id)
    try {
      await apiDelete(`/api/music/${song.docId}/albums/${relation.albumDocId}`)
      show('专辑关系已删除')
      notifyChanged()
    } catch (error) {
      show(error instanceof Error ? error.message : '删除专辑关系失败', { variant: 'error' })
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        title="管理专辑关系"
        description={song ? `${song.title || '歌曲'} 的关联专辑` : undefined}
        maxWidthClassName="max-w-3xl"
      >
        <div className="space-y-5">
          <section className="space-y-3 rounded border border-border bg-surface-alt p-4">
            <h3 className="text-sm font-semibold text-text-primary">添加专辑</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_7rem_7rem_auto]">
              <Input
                value={albumQuery}
                onChange={(event) => setAlbumQuery(event.target.value)}
                placeholder="搜索专辑标题或艺术家"
              />
              <Input
                type="number"
                min={1}
                value={discNumber}
                onChange={(event) => setDiscNumber(event.target.value)}
                aria-label="Disc"
                placeholder="Disc"
              />
              <Input
                type="number"
                min={0}
                value={trackOrder}
                onChange={(event) => setTrackOrder(event.target.value)}
                aria-label="轨序"
                placeholder="轨序"
              />
              <Button
                type="button"
                onClick={() => void handleAdd()}
                loading={savingKey === 'new'}
                leftIcon={<Plus size={14} />}
              >
                添加
              </Button>
            </div>
            {albums.length > 0 && (
              <Select
                value={selectedAlbumDocId}
                onChange={(event) => setSelectedAlbumDocId(event.target.value)}
                aria-label="选择专辑"
              >
                <option value="">请选择搜索结果</option>
                {albums.map((album) => (
                  <option key={album.docId} value={album.docId}>
                    {album.title} / {album.artist || '未知艺术家'}
                  </option>
                ))}
              </Select>
            )}
            <Checkbox
              checked={isDisplay}
              onCheckedChange={(checked) => setIsDisplay(checked === true)}
              label="设为展示专辑"
            />
          </section>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={22} className="animate-spin text-brand-gold" />
            </div>
          ) : relations.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-muted">暂无关联专辑</p>
          ) : (
            <div className="space-y-2">
              {relations.map((relation) => (
                <RelationRow
                  key={relation.id}
                  relation={relation}
                  saving={savingKey === relation.id}
                  onUpdate={(next) => void handleUpdate(relation, next)}
                  onDelete={() => void handleDelete(relation)}
                />
              ))}
            </div>
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

const RelationRow = ({
  relation,
  saving,
  onUpdate,
  onDelete,
}: {
  relation: SongAlbumRelation
  saving: boolean
  onUpdate: (next: Partial<SongAlbumRelation>) => void
  onDelete: () => void
}) => {
  const [disc, setDisc] = useState(String(relation.discNumber))
  const [order, setOrder] = useState(String(relation.trackOrder))
  const [display, setDisplay] = useState(relation.isDisplay)
  useEffect(() => {
    setDisc(String(relation.discNumber))
    setOrder(String(relation.trackOrder))
    setDisplay(relation.isDisplay)
  }, [relation.discNumber, relation.isDisplay, relation.trackOrder])
  return (
    <div className="grid grid-cols-1 items-center gap-3 rounded border border-border p-3 md:grid-cols-[minmax(0,1fr)_6rem_6rem_auto_auto]">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-text-primary">{relation.album.title}</p>
        <p className="truncate text-xs text-text-muted">
          {relation.album.artist || '未知艺术家'} · {relation.albumDocId}
        </p>
      </div>
      <Input
        type="number"
        min={1}
        value={disc}
        onChange={(event) => setDisc(event.target.value)}
        aria-label="Disc"
      />
      <Input
        type="number"
        min={0}
        value={order}
        onChange={(event) => setOrder(event.target.value)}
        aria-label="轨序"
      />
      <Checkbox
        checked={display}
        onCheckedChange={(checked) => setDisplay(checked === true)}
        label="展示"
      />
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            onUpdate({ discNumber: Number(disc), trackOrder: Number(order), isDisplay: display })
          }
          loading={saving}
          aria-label="保存关系"
        >
          <Save size={14} />
        </Button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={onDelete}
          disabled={saving}
          aria-label="删除关系"
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </div>
  )
}

export default SongAlbumRelationsModal
