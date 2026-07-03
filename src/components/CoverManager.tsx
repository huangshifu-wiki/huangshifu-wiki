import React, { useState } from 'react'
import { Loader2, Trash2, Star, Upload, X } from '@/src/components/icons'
import { clsx } from 'clsx'

import { apiDelete, apiGet, apiPatch, apiPost, invalidateApiCacheByPrefix } from '../lib/apiClient'
import { useDialog } from './Dialog'
import { useToast } from './Toast'
import { uploadImageWithStrategy, type UploadImageResult } from '../services/imageService'
import { UPLOAD_MAX_FILE_SIZE_BYTES, formatUploadLimitWithSize } from '../lib/uploadLimits'
import { useFloatingPresence } from '../hooks/useFloatingPresence'

type CoverItem = {
  id: string
  url: string
  isDefault: boolean
  createdAt?: string
  sortOrder?: number
}

type CoversResponse = {
  covers: CoverItem[]
}

type ResourceType = 'song' | 'album'

const RESOURCE_CONFIG: Record<
  ResourceType,
  { title: string; subtitle: string; apiPrefix: string }
> = {
  song: {
    title: '歌曲封面管理',
    subtitle: '上传、设置默认封面或删除现有封面',
    apiPrefix: '/api/music',
  },
  album: {
    title: '专辑封面管理',
    subtitle: '上传、管理专辑封面或将封面同步到歌曲',
    apiPrefix: '/api/albums',
  },
}

interface CoverManagerProps {
  resourceType: ResourceType
  resourceId: string
  currentCover: string
  onCoverUpdated?: (newCoverUrl: string) => void
  onSyncToSongs?: () => void
}

export const CoverManager = ({
  resourceType,
  resourceId,
  currentCover,
  onCoverUpdated,
  onSyncToSongs,
}: CoverManagerProps) => {
  const config = RESOURCE_CONFIG[resourceType]
  const [covers, setCovers] = useState<CoverItem[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [settingDefault, setSettingDefault] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [selectedCoverIds, setSelectedCoverIds] = useState<Set<string>>(new Set())
  const [isOpen, setIsOpen] = useState(false)
  const presence = useFloatingPresence(isOpen)
  const dialog = useDialog()
  const { show } = useToast()
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const fetchCovers = React.useCallback(async () => {
    setLoading(true)
    try {
      const response = await apiGet<CoversResponse>(`${config.apiPrefix}/${resourceId}/covers`)
      const nextCovers = response.covers || []
      setCovers(nextCovers)
      setSelectedCoverIds((prev) => {
        const existingIds = new Set(nextCovers.map((cover) => cover.id))
        return new Set([...prev].filter((coverId) => existingIds.has(coverId)))
      })
      return nextCovers
    } catch (error) {
      console.error('Fetch covers failed:', error)
      return []
    } finally {
      setLoading(false)
    }
  }, [config.apiPrefix, resourceId])

  const invalidateCoversCache = React.useCallback(() => {
    invalidateApiCacheByPrefix(`${config.apiPrefix}/${resourceId}/covers`)
  }, [config.apiPrefix, resourceId])

  React.useEffect(() => {
    if (isOpen) {
      fetchCovers()
    }
  }, [isOpen, fetchCovers])

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      show('请选择图片文件', { variant: 'error' })
      return
    }
    if (file.size > UPLOAD_MAX_FILE_SIZE_BYTES) {
      show(`图片大小不能超过 ${formatUploadLimitWithSize()}`, { variant: 'error' })
      return
    }

    setUploading(true)
    try {
      const result: UploadImageResult = await uploadImageWithStrategy(file, {
        type: 'cover',
        reuseExisting: false,
      })
      if (!result.assetId) throw new Error('上传失败')
      await apiPost(`${config.apiPrefix}/${resourceId}/covers`, { assetId: result.assetId })
      show('封面上传成功')
      fetchCovers()
    } catch (error) {
      console.error('Upload cover failed:', error)
      show(error instanceof Error ? error.message : '上传封面失败', { variant: 'error' })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleSetDefault = async (coverId: string) => {
    setSettingDefault(coverId)
    try {
      await apiPatch(`${config.apiPrefix}/${resourceId}/covers/${coverId}/default`)
      setCovers((prev) => prev.map((c) => ({ ...c, isDefault: c.id === coverId })))
      const newDefaultCover = covers.find((c) => c.id === coverId)
      if (newDefaultCover && onCoverUpdated) {
        onCoverUpdated(newDefaultCover.url)
      }
      show('默认封面已更新')
    } catch (error) {
      console.error('Set default cover failed:', error)
      show('设置默认封面失败', { variant: 'error' })
    } finally {
      setSettingDefault(null)
    }
  }

  const handleDelete = async (coverId: string) => {
    const confirmed = await dialog.confirm({
      title: '删除封面',
      message: '确定要删除这个封面吗？',
      confirmText: '删除',
      variant: 'danger',
    })
    if (!confirmed) return
    setDeleting(coverId)
    try {
      await apiDelete(`${config.apiPrefix}/${resourceId}/covers/${coverId}`)
      invalidateCoversCache()
      const nextCovers = await fetchCovers()
      setSelectedCoverIds((prev) => {
        const next = new Set(prev)
        next.delete(coverId)
        return next
      })
      const deletedCover = covers.find((cover) => cover.id === coverId)
      if (deletedCover?.url === currentCover && onCoverUpdated) {
        const nextDefaultCover = nextCovers.find((cover) => cover.isDefault) || nextCovers[0]
        onCoverUpdated(nextDefaultCover?.url || '')
      }
      show('封面已删除')
    } catch (error) {
      console.error('Delete cover failed:', error)
      show('删除封面失败', { variant: 'error' })
    } finally {
      setDeleting(null)
    }
  }

  const toggleSelectedCover = (coverId: string) => {
    setSelectedCoverIds((prev) => {
      const next = new Set(prev)
      if (next.has(coverId)) {
        next.delete(coverId)
      } else {
        next.add(coverId)
      }
      return next
    })
  }

  const selectAllCovers = () => {
    setSelectedCoverIds((prev) =>
      prev.size === covers.length ? new Set() : new Set(covers.map((cover) => cover.id))
    )
  }

  const handleBatchDelete = async () => {
    if (!selectedCoverIds.size || batchDeleting) return
    const selectedIds = [...selectedCoverIds]
    const confirmed = await dialog.confirm({
      title: '批量删除封面',
      message: `确定要删除选中的 ${selectedIds.length} 张封面吗？默认封面被删除时会自动回退到剩余封面。`,
      confirmText: '批量删除',
      variant: 'danger',
    })
    if (!confirmed) return

    setBatchDeleting(true)
    try {
      await apiDelete(`${config.apiPrefix}/${resourceId}/covers`, { coverIds: selectedIds })
      invalidateCoversCache()
      const removedCurrentCover = covers.some(
        (cover) => selectedIds.includes(cover.id) && cover.url === currentCover
      )
      const nextCovers = await fetchCovers()
      setSelectedCoverIds(new Set())
      if (removedCurrentCover && onCoverUpdated) {
        const nextDefaultCover = nextCovers.find((cover) => cover.isDefault) || nextCovers[0]
        onCoverUpdated(nextDefaultCover?.url || '')
      }
      show('封面已批量删除')
    } catch (error) {
      console.error('Batch delete covers failed:', error)
      show(error instanceof Error ? error.message : '批量删除封面失败', { variant: 'error' })
    } finally {
      setBatchDeleting(false)
    }
  }

  const handleSyncToSongsInternal = async () => {
    const confirmed = await dialog.confirm({
      title: '同步封面',
      message: '确定要将此封面同步到专辑内的所有歌曲吗？',
      confirmText: '同步',
      variant: 'warning',
    })
    if (!confirmed) return
    try {
      await apiPost(`${config.apiPrefix}/${resourceId}/sync-covers-to-songs`)
      show('封面已同步到专辑内歌曲')
      onSyncToSongs?.()
    } catch (error) {
      console.error('Sync covers to songs failed:', error)
      show('同步封面失败', { variant: 'error' })
    }
  }

  if (!presence.mounted) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="px-4 py-2 rounded theme-button-secondary text-sm transition-all"
      >
        封面管理
      </button>
    )
  }

  return (
    <div
      className="floating-overlay fixed inset-0 z-[120] bg-black/40 p-4 flex items-center justify-center"
      data-state={presence.state}
      aria-hidden={!isOpen}
    >
      <div className="floating-panel w-full max-w-2xl max-h-[90vh] overflow-hidden bg-surface rounded border border-border flex flex-col">
        <header className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-text-primary">{config.title}</h3>
            <p className="text-xs text-text-muted mt-0.5">{config.subtitle}</p>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-alt transition-colors"
          >
            <X size={18} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          <div className="rounded border border-border bg-surface-alt/60 p-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-text-primary">当前封面</span>
              <div className="w-14 h-14 rounded overflow-hidden bg-surface-alt border border-border">
                <img
                  src={currentCover}
                  alt="封面"
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
            {resourceType === 'album' ? (
              <div className="flex gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex-1 px-4 py-2.5 rounded theme-button-primary font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2 text-sm transition-all"
                >
                  {uploading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Upload size={14} />
                  )}
                  {uploading ? '上传中...' : '上传新封面'}
                </button>
                <button
                  onClick={handleSyncToSongsInternal}
                  className="px-4 py-2.5 rounded theme-button-secondary text-sm transition-all"
                >
                  同步到歌曲
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full px-4 py-2.5 rounded theme-button-primary font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2 text-sm transition-all"
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {uploading ? '上传中...' : '上传新封面'}
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={22} className="animate-spin text-brand-gold" />
            </div>
          ) : covers.length > 0 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-text-primary">
                  已上传的封面 ({covers.length})
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllCovers}
                    className="px-3 py-1.5 rounded border border-border text-xs text-text-secondary hover:text-brand-gold hover:border-brand-gold transition-all"
                  >
                    {selectedCoverIds.size === covers.length ? '取消全选' : '全选'}
                  </button>
                  <button
                    type="button"
                    onClick={handleBatchDelete}
                    disabled={!selectedCoverIds.size || batchDeleting}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded theme-button-danger text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {batchDeleting ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Trash2 size={13} />
                    )}
                    删除 {selectedCoverIds.size || ''}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {covers.map((cover) => (
                  <div
                    key={cover.id}
                    className={clsx(
                      'relative rounded overflow-hidden border transition-all',
                      cover.isDefault
                        ? 'border-brand-gold ring-1 ring-brand-gold/20'
                        : 'border-border'
                    )}
                  >
                    <div className="aspect-square">
                      <img
                        src={cover.url}
                        alt="封面"
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    {cover.isDefault && (
                      <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-[var(--color-theme-accent)] text-white text-[10px] font-medium rounded flex items-center gap-1">
                        <Star size={10} /> 默认
                      </div>
                    )}
                    <label className="absolute top-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded bg-black/55 text-white shadow-sm">
                      <input
                        type="checkbox"
                        checked={selectedCoverIds.has(cover.id)}
                        onChange={() => toggleSelectedCover(cover.id)}
                        className="h-4 w-4 accent-brand-gold"
                        aria-label="选择封面"
                      />
                    </label>
                    <div className="absolute inset-0 bg-black/0 hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 hover:opacity-100">
                      {!cover.isDefault && (
                        <button
                          onClick={() => handleSetDefault(cover.id)}
                          disabled={settingDefault === cover.id}
                          className="p-1.5 bg-surface rounded text-text-secondary hover:text-brand-gold transition-colors disabled:opacity-50"
                          title="设为默认"
                        >
                          {settingDefault === cover.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Star size={14} />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(cover.id)}
                        disabled={deleting === cover.id || cover.isDefault}
                        className="p-1.5 bg-surface rounded theme-text-error transition-colors disabled:opacity-50"
                        title="删除"
                      >
                        {deleting === cover.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-text-muted text-sm">暂无额外封面</div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-border bg-surface-alt/60 flex justify-end">
          <button
            onClick={() => setIsOpen(false)}
            className="px-4 py-2 rounded theme-button-secondary text-sm transition-all"
          >
            关闭
          </button>
        </footer>
      </div>
    </div>
  )
}
