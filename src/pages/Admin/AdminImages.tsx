import React, { useEffect, useMemo, useState } from 'react'
import {
  Download,
  Upload,
  Edit2,
  Trash2,
  CheckCircle,
  XCircle,
  FileText,
  Settings,
  RefreshCw,
  Sparkles,
  Search,
} from '@/src/components/icons'
import { apiGet, apiPatch, apiDelete, apiPost, apiDownload } from '../../lib/apiClient'
import { useDialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import { formatDateTime } from '../../lib/dateUtils'
import { clsx } from 'clsx'
import { SmartImage } from '../../components/SmartImage'
import { clearImagePreferenceCache } from '../../services/imageService'
import { useFloatingPresence } from '../../hooks/useFloatingPresence'
import type {
  MediaHealthBlockReason,
  MediaHealthCleanupApiResponse,
  MediaHealthCleanupTarget,
  MediaHealthRecordType,
  MediaHealthScanResponse,
  MediaHealthScanMode,
  MediaHealthScanResult,
} from '../../types/api'
import { Checkbox, Switch } from '@/src/components/ui'

interface ImageMap {
  id: string
  md5: string
  localUrl: string
  externalUrl?: string
  s3Url?: string
  thumbnailUrl?: string
  storageType?: 'local' | 's3' | 'external'
  blurhash?: string
  thumbhash?: string
  createdAt: string
}

interface ImageStats {
  total: number
  stats: { local: number; external: number; s3: number }
}

interface ImagePreference {
  strategy: 'local' | 's3' | 'external'
  fallback: boolean
}

type MediaHealthItem = {
  recordType: MediaHealthRecordType
  id: string
  label: string
  storageKey?: string
  localUrl?: string
  canCleanup: boolean
  blockedReasons: MediaHealthBlockReason[]
  kinds: Array<'missing' | 'unused'>
  referencesCount?: number
}

const MEDIA_HEALTH_MODE_OPTIONS: Array<{ value: MediaHealthScanMode; label: string }> = [
  { value: 'strict', label: '严格' },
  { value: 'business', label: '业务内容' },
]

const getStrategyLabel = (strategy: string) => {
  const labels: Record<string, string> = {
    local: '本地服务器',
    s3: 'S3 图床',
    external: '外部图床',
  }
  return labels[strategy] || strategy
}

const getStorageBadge = (type?: string) => {
  const badges: Record<string, { cls: string; label: string }> = {
    local: { cls: 'bg-surface-alt text-brand-gold', label: '本地' },
    s3: { cls: 'bg-brand-gold/10 text-brand-gold', label: 'S3' },
    external: { cls: 'bg-bg-tertiary text-text-secondary', label: '外部' },
  }
  const b = badges[type || 'local']
  return (
    <span className={clsx('px-2 py-0.5 rounded text-[10px] font-medium', b.cls)}>{b.label}</span>
  )
}

const mediaHealthKey = (recordType: MediaHealthRecordType, id: string) => `${recordType}:${id}`

const getRecordTypeLabel = (recordType: MediaHealthRecordType) =>
  recordType === 'mediaAsset' ? '上传资源' : '图片映射'

const getBlockedReasonLabel = (reason: MediaHealthBlockReason) => {
  const labels: Record<MediaHealthBlockReason, string> = {
    referenced: '仍有引用',
    shared_image_map: '共享映射',
    processing: '正在处理',
    not_found: '记录不存在',
    already_deleted: '已删除',
    active_upload_session: '上传会话进行中',
  }
  return labels[reason] || reason
}

const buildMediaHealthItems = (mediaHealth: MediaHealthScanResult | null): MediaHealthItem[] => {
  if (!mediaHealth) return []

  const items = new Map<string, MediaHealthItem>()
  const upsert = (item: MediaHealthItem) => {
    const key = mediaHealthKey(item.recordType, item.id)
    const existing = items.get(key)
    if (!existing) {
      items.set(key, item)
      return
    }

    items.set(key, {
      ...existing,
      label: existing.label || item.label,
      storageKey: existing.storageKey || item.storageKey,
      localUrl: existing.localUrl || item.localUrl,
      canCleanup: existing.canCleanup && item.canCleanup,
      blockedReasons: [...new Set([...existing.blockedReasons, ...item.blockedReasons])],
      kinds: [...new Set([...existing.kinds, ...item.kinds])],
      referencesCount: Math.max(existing.referencesCount || 0, item.referencesCount || 0),
    })
  }

  for (const item of mediaHealth.missingLocalFiles) {
    upsert({
      recordType: item.recordType,
      id: item.id,
      label: item.label,
      storageKey: item.storageKey,
      canCleanup: item.canCleanup,
      blockedReasons: item.blockedReasons,
      kinds: ['missing'],
      referencesCount: item.references.length,
    })
  }

  for (const item of mediaHealth.unusedMediaRecords) {
    upsert({
      recordType: item.recordType,
      id: item.id,
      label: item.label,
      storageKey: item.storageKey,
      localUrl: item.localUrl,
      canCleanup: item.canCleanup,
      blockedReasons: item.blockedReasons,
      kinds: ['unused'],
    })
  }

  return [...items.values()]
}

const AdminImages: React.FC = () => {
  const [images, setImages] = useState<ImageMap[]>([])
  const [stats, setStats] = useState<ImageStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingImage, setEditingImage] = useState<ImageMap | null>(null)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showPreferenceModal, setShowPreferenceModal] = useState(false)
  const editModalPresence = useFloatingPresence(Boolean(editingImage))
  const preferenceModalPresence = useFloatingPresence(showPreferenceModal)
  const [preference, setPreference] = useState<ImagePreference>({
    strategy: 'local',
    fallback: true,
  })
  const [mediaHealthMode, setMediaHealthMode] = useState<MediaHealthScanMode>('strict')
  const [mediaHealth, setMediaHealth] = useState<MediaHealthScanResult | null>(null)
  const [mediaHealthLoading, setMediaHealthLoading] = useState(false)
  const [mediaHealthCleaning, setMediaHealthCleaning] = useState(false)
  const [selectedHealthItems, setSelectedHealthItems] = useState<string[]>([])
  const dialog = useDialog()
  const { show } = useToast()

  const fetchImages = async () => {
    setLoading(true)
    try {
      const response = await apiGet<{ items: ImageMap[] }>('/api/image-maps')
      setImages(response.items || [])
    } catch (error) {
      console.error(error)
      show('获取图片列表失败', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const fetchStats = async () => {
    try {
      const response = await apiGet<ImageStats>('/api/image-maps/stats')
      setStats(response)
    } catch (error) {
      console.error(error)
    }
  }

  const fetchPreference = async () => {
    try {
      const response = await apiGet<ImagePreference>('/api/config/image-preference')
      setPreference(response)
    } catch (error) {
      console.error(error)
    }
  }

  useEffect(() => {
    fetchImages()
    fetchStats()
    fetchPreference()
  }, [])

  const handleExport = async (format: 'json' | 'csv') => {
    try {
      const response = await apiDownload(`/api/image-maps/export?format=${format}`)
      if (!response.ok)
        throw new Error((await response.json().catch(() => ({}))).error || '导出失败')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `image-maps-${Date.now()}.${format}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      show(`成功导出 ${images.length} 条图片记录`, { variant: 'success' })
    } catch (error) {
      show(error instanceof Error ? error.message : '导出失败', { variant: 'error' })
    }
  }

  const handleDelete = async (id: string) => {
    const confirmed = await dialog.confirm({
      title: '删除图片映射',
      message: '确定要删除这张图片的映射吗？',
      confirmText: '删除',
      variant: 'danger',
    })
    if (!confirmed) return
    try {
      await apiDelete(`/api/image-maps/${id}`)
      setImages((prev) => prev.filter((img) => img.id !== id))
      show('删除成功', { variant: 'success' })
      fetchStats()
    } catch {
      show('删除失败', { variant: 'error' })
    }
  }

  const handleRefreshBlurhash = async (id: string) => {
    try {
      const response = await apiPost<{ success: boolean; item: ImageMap }>(
        `/api/image-maps/${id}/refresh-blurhash`,
        {}
      )
      if (response.success) {
        setImages((prev) => prev.map((img) => (img.id === id ? response.item : img)))
        show('Blurhash 生成成功', { variant: 'success' })
      }
    } catch {
      show('生成 Blurhash 失败', { variant: 'error' })
    }
  }

  const handleUpdate = async () => {
    if (!editingImage) return
    try {
      const response = await apiPatch<{ item: ImageMap }>(`/api/image-maps/${editingImage.id}`, {
        localUrl: editingImage.localUrl || null,
        externalUrl: editingImage.externalUrl || null,
        s3Url: editingImage.s3Url || null,
        storageType: editingImage.storageType,
      })
      setImages((prev) => prev.map((img) => (img.id === editingImage.id ? response.item : img)))
      setEditingImage(null)
      show('更新成功', { variant: 'success' })
      fetchStats()
    } catch {
      show('更新失败', { variant: 'error' })
    }
  }

  const handlePreferenceUpdate = async () => {
    try {
      await apiPatch('/api/config/image-preference', preference)
      clearImagePreferenceCache()
      setShowPreferenceModal(false)
      show('设置已保存', { variant: 'success' })
    } catch {
      show('保存设置失败', { variant: 'error' })
    }
  }

  const handleScanMediaHealth = async (mode = mediaHealthMode) => {
    setMediaHealthLoading(true)
    try {
      const response = await apiGet<MediaHealthScanResponse>(
        '/api/admin/media-health/scan',
        { mode, limit: 500 },
        { staleTime: 0, swr: false }
      )
      setMediaHealth(response.data)
      setSelectedHealthItems([])
    } catch (error) {
      show(error instanceof Error ? error.message : '媒体健康扫描失败', { variant: 'error' })
    } finally {
      setMediaHealthLoading(false)
    }
  }

  const mediaHealthItems = useMemo(() => buildMediaHealthItems(mediaHealth), [mediaHealth])
  const selectedHealthItemSet = useMemo(() => new Set(selectedHealthItems), [selectedHealthItems])

  const cleanupTargets = useMemo<MediaHealthCleanupTarget[]>(
    () =>
      mediaHealthItems
        .filter((item) => selectedHealthItemSet.has(mediaHealthKey(item.recordType, item.id)))
        .map((item) => ({ recordType: item.recordType, id: item.id })),
    [mediaHealthItems, selectedHealthItemSet]
  )

  const setHealthItemSelected = (item: MediaHealthItem, selected: boolean) => {
    if (!item.canCleanup) return
    const key = mediaHealthKey(item.recordType, item.id)
    setSelectedHealthItems((current) => {
      if (selected) return current.includes(key) ? current : [...current, key]
      if (!current.includes(key)) return current
      return current.filter((value) => value !== key)
    })
  }

  const handleCleanupMediaHealth = async () => {
    if (cleanupTargets.length === 0) return
    const confirmed = await dialog.confirm({
      title: '清理媒体数据库记录',
      message: `确定软清理 ${cleanupTargets.length} 条媒体记录吗？数据库行不会被硬删除。`,
      confirmText: '软清理',
      variant: 'warning',
    })
    if (!confirmed) return

    setMediaHealthCleaning(true)
    try {
      const response = await apiPost<MediaHealthCleanupApiResponse>(
        '/api/admin/media-health/cleanup',
        { mode: mediaHealthMode, targets: cleanupTargets }
      )
      show(`已清理 ${response.data.cleaned} 条，跳过 ${response.data.skipped} 条`, {
        variant: response.data.skipped > 0 ? 'error' : 'success',
      })
      await Promise.all([handleScanMediaHealth(mediaHealthMode), fetchImages(), fetchStats()])
    } catch (error) {
      show(error instanceof Error ? error.message : '媒体记录清理失败', { variant: 'error' })
    } finally {
      setMediaHealthCleaning(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-text-primary tracking-[0.12em]">图片管理</h2>
          <p className="text-sm text-text-muted mt-1">管理本地图片和外部图床映射</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => fetchImages()}
            className="px-4 py-2 border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded text-sm transition-all inline-flex items-center gap-2"
          >
            <RefreshCw size={16} /> 刷新
          </button>
          <button
            onClick={() => setShowPreferenceModal(true)}
            className="px-4 py-2 border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded text-sm transition-all inline-flex items-center gap-2"
          >
            <Settings size={16} /> 图片策略
          </button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-surface border border-border rounded p-4">
            <p className="text-xs text-text-muted mb-1">总数量</p>
            <p className="text-2xl font-bold text-text-primary">{stats.total}</p>
          </div>
          <div className="bg-surface border border-border rounded p-4">
            <p className="text-xs text-text-muted mb-1">本地图片</p>
            <p className="text-2xl font-bold text-brand-gold">{stats.stats.local}</p>
          </div>
          <div className="bg-surface border border-border rounded p-4">
            <p className="text-xs text-text-muted mb-1">S3 图床</p>
            <p className="text-2xl font-bold text-brand-gold">{stats.stats.s3}</p>
          </div>
          <div className="bg-surface border border-border rounded p-4">
            <p className="text-xs text-text-muted mb-1">外部图床</p>
            <p className="text-2xl font-bold text-brand-gold">{stats.stats.external}</p>
          </div>
        </div>
      )}

      <div className="bg-surface border border-border rounded p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">媒体健康检查</h3>
            <p className="text-xs text-text-muted mt-1">
              扫描缺失本地文件和未被内容使用的媒体数据库记录
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {MEDIA_HEALTH_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  const nextMode = option.value
                  setMediaHealthMode(nextMode)
                  if (mediaHealth) void handleScanMediaHealth(nextMode)
                }}
                className={clsx(
                  'px-3 py-1.5 rounded text-xs font-medium transition-all',
                  mediaHealthMode === option.value
                    ? 'bg-brand-gold-dark text-white'
                    : 'bg-surface-alt text-text-secondary hover:text-brand-gold'
                )}
              >
                {option.label}
              </button>
            ))}
            <button
              onClick={() => handleScanMediaHealth()}
              disabled={mediaHealthLoading}
              className="px-3 py-1.5 border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded text-xs transition-all inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {mediaHealthLoading ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Search size={14} />
              )}
              扫描
            </button>
            <button
              onClick={handleCleanupMediaHealth}
              disabled={mediaHealthCleaning || cleanupTargets.length === 0}
              className="px-3 py-1.5 bg-brand-gold-dark text-white rounded text-xs font-medium hover:bg-brand-gold transition-all disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <Trash2 size={14} />
              软清理 {cleanupTargets.length || ''}
            </button>
          </div>
        </div>

        {mediaHealth ? (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: '缺失本地文件', value: mediaHealth.summary.missingLocalFiles },
                { label: '未用上传资源', value: mediaHealth.summary.unusedMediaAssets },
                { label: '未用图片映射', value: mediaHealth.summary.unusedImageMaps },
                { label: '可清理', value: mediaHealth.summary.cleanupCandidates },
                { label: '被阻止', value: mediaHealth.summary.blockedRecords },
              ].map((item) => (
                <div key={item.label} className="bg-surface-alt rounded p-3">
                  <p className="text-[11px] text-text-muted">{item.label}</p>
                  <p className="text-lg font-bold text-text-primary">{item.value}</p>
                </div>
              ))}
            </div>

            {mediaHealthItems.length > 0 ? (
              <div className="max-h-96 overflow-y-auto border border-border rounded divide-y divide-border">
                {mediaHealthItems.slice(0, 80).map((item) => {
                  const key = mediaHealthKey(item.recordType, item.id)
                  const selected = selectedHealthItemSet.has(key)
                  return (
                    <div
                      role={item.canCleanup ? 'button' : undefined}
                      tabIndex={item.canCleanup ? 0 : undefined}
                      key={key}
                      onClick={() => setHealthItemSelected(item, !selected)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        setHealthItemSelected(item, !selected)
                      }}
                      className={clsx(
                        'w-full text-left p-3 transition-colors',
                        item.canCleanup ? 'hover:bg-surface-alt' : 'cursor-not-allowed opacity-70',
                        selected && 'bg-brand-gold/10'
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={selected}
                          disabled={!item.canCleanup}
                          onCheckedChange={(checked) =>
                            setHealthItemSelected(item, checked === true)
                          }
                          onClick={(event) => event.stopPropagation()}
                          className="mt-1 h-4 w-4"
                          aria-label={`选择 ${item.label}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-text-primary break-all">
                              {item.label}
                            </span>
                            {item.kinds.map((kind) => (
                              <span
                                key={kind}
                                className="px-2 py-0.5 rounded text-[10px] theme-tag"
                              >
                                {kind === 'missing' ? '缺失文件' : '未使用'}
                              </span>
                            ))}
                            <span className="px-2 py-0.5 rounded text-[10px] bg-surface border border-border text-text-secondary">
                              {getRecordTypeLabel(item.recordType)}
                            </span>
                          </div>
                          <p className="text-xs text-text-muted mt-1 break-all">
                            {item.storageKey || item.localUrl || item.id}
                          </p>
                          {!item.canCleanup ? (
                            <p className="text-xs theme-text-warning mt-1">
                              {item.blockedReasons.map(getBlockedReasonLabel).join('、')}
                              {item.referencesCount ? `，引用 ${item.referencesCount} 处` : ''}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-sm text-text-muted bg-surface-alt rounded p-4">
                没有发现媒体健康问题。
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="bg-surface border border-border rounded p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text-primary">图片列表</h3>
          <div className="flex gap-2">
            <button
              onClick={() => handleExport('csv')}
              className="px-3 py-1.5 border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded text-xs transition-all inline-flex items-center gap-1.5"
            >
              <Download size={14} /> 导出 CSV
            </button>
            <button
              onClick={() => handleExport('json')}
              className="px-3 py-1.5 border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded text-xs transition-all inline-flex items-center gap-1.5"
            >
              <Download size={14} /> 导出 JSON
            </button>
            <button
              onClick={() => setShowImportModal(true)}
              className="px-3 py-1.5 border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded text-xs transition-all inline-flex items-center gap-1.5"
            >
              <Upload size={14} /> 导入
            </button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-20 bg-surface-alt rounded animate-pulse" />
            ))}
          </div>
        ) : images.length === 0 ? (
          <div className="text-center py-16 text-text-muted">
            <FileText size={48} className="mx-auto mb-4 opacity-50" />
            <p>暂无图片记录</p>
          </div>
        ) : (
          <div className="space-y-3">
            {images.map((image) => {
              const imageUrl = image.thumbnailUrl || ''
              return (
                <div
                  key={image.id}
                  className="border border-border rounded p-4 hover:bg-surface-alt transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex gap-4">
                      <div className="w-20 h-20 flex-shrink-0">
                        <SmartImage
                          src={imageUrl || ''}
                          alt={image.id}
                          className="w-full h-full rounded object-cover"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="px-2 py-1 bg-surface-alt text-text-muted rounded text-xs font-mono">
                            {image.id.slice(0, 8)}
                          </span>
                          <span className="text-xs text-text-muted font-mono">
                            {image.md5.slice(0, 12)}
                          </span>
                          {getStorageBadge(image.storageType)}
                          {image.blurhash && (
                            <span className="px-2 py-0.5 theme-tag rounded text-[10px]">
                              Blurhash
                            </span>
                          )}
                        </div>
                        <div className="space-y-1">
                          {image.localUrl && (
                            <div className="flex items-center gap-2">
                              <CheckCircle size={14} className="text-brand-gold flex-shrink-0" />
                              <span className="text-xs text-text-secondary truncate">
                                本地: {image.localUrl}
                              </span>
                            </div>
                          )}
                          {image.s3Url && (
                            <div className="flex items-center gap-2">
                              <CheckCircle size={14} className="text-brand-gold flex-shrink-0" />
                              <span className="text-xs text-text-secondary truncate">
                                S3: {image.s3Url}
                              </span>
                            </div>
                          )}
                          {image.externalUrl && (
                            <div className="flex items-center gap-2">
                              <CheckCircle size={14} className="text-text-muted flex-shrink-0" />
                              <span className="text-xs text-text-muted truncate">
                                外部: {image.externalUrl}
                              </span>
                            </div>
                          )}
                        </div>
                        <p className="text-[10px] text-text-muted mt-2">
                          创建于: {formatDateTime(image.createdAt)}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {!image.blurhash && imageUrl && (
                        <button
                          onClick={() => handleRefreshBlurhash(image.id)}
                          className="p-2 text-brand-gold hover:bg-brand-gold/10 rounded transition-all"
                          title="生成 Blurhash"
                        >
                          <Sparkles size={18} />
                        </button>
                      )}
                      <button
                        onClick={() => setEditingImage(image)}
                        className="p-2 text-brand-gold hover:bg-surface-alt rounded transition-all"
                        title="编辑"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(image.id)}
                        className="p-2 theme-icon-button-danger hover:bg-surface-alt rounded transition-all"
                        title="删除"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {editModalPresence.mounted && editingImage && (
        <div
          className="floating-overlay fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          data-state={editModalPresence.state}
          aria-hidden={!editingImage}
        >
          <div className="floating-panel bg-surface border border-border rounded p-6 max-w-2xl w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-text-primary">编辑图片映射</h3>
              <button
                onClick={() => setEditingImage(null)}
                className="p-2 hover:bg-surface-alt rounded"
              >
                <XCircle size={20} className="text-text-muted" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">ID</label>
                <input
                  type="text"
                  value={editingImage.id}
                  disabled
                  className="w-full px-4 py-2 bg-surface-alt border border-border rounded text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">MD5</label>
                <input
                  type="text"
                  value={editingImage.md5}
                  disabled
                  className="w-full px-4 py-2 bg-surface-alt border border-border rounded text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  本地 URL
                </label>
                <input
                  type="text"
                  value={editingImage.localUrl}
                  onChange={(e) => setEditingImage({ ...editingImage, localUrl: e.target.value })}
                  className="w-full px-4 py-2 border border-border rounded text-sm focus:outline-none focus:border-brand-gold"
                  placeholder="https://..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  S3 URL{' '}
                  {editingImage.s3Url && <span className="theme-text-success text-xs">已配置</span>}
                </label>
                <input
                  type="text"
                  value={editingImage.s3Url || ''}
                  onChange={(e) => setEditingImage({ ...editingImage, s3Url: e.target.value })}
                  className="w-full px-4 py-2 border border-border rounded text-sm focus:outline-none focus:border-brand-gold"
                  placeholder="https://cdn.yourdomain.com/..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  外部图床 URL{' '}
                  {editingImage.externalUrl && (
                    <span className="theme-text-success text-xs">已配置</span>
                  )}
                </label>
                <input
                  type="text"
                  value={editingImage.externalUrl || ''}
                  onChange={(e) =>
                    setEditingImage({ ...editingImage, externalUrl: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-border rounded text-sm focus:outline-none focus:border-brand-gold"
                  placeholder="https://..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  存储类型
                </label>
                <select
                  value={editingImage.storageType || 'local'}
                  onChange={(e) =>
                    setEditingImage({ ...editingImage, storageType: e.target.value as any })
                  }
                  className="w-full px-4 py-2 border border-border rounded text-sm focus:outline-none focus:border-brand-gold"
                >
                  <option value="local">本地服务器</option>
                  <option value="s3">S3 图床</option>
                  <option value="external">外部图床</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setEditingImage(null)}
                  className="flex-1 px-4 py-2 bg-bg-tertiary text-text-secondary rounded font-medium hover:bg-surface-alt transition-all"
                >
                  取消
                </button>
                <button
                  onClick={handleUpdate}
                  className="flex-1 px-4 py-2 bg-brand-gold-dark text-white rounded font-medium hover:bg-brand-gold transition-all"
                >
                  保存修改
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ImportModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        onSuccess={() => {
          fetchImages()
          fetchStats()
          setShowImportModal(false)
        }}
      />

      {preferenceModalPresence.mounted && (
        <div
          className="floating-overlay fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          data-state={preferenceModalPresence.state}
          aria-hidden={!showPreferenceModal}
        >
          <div className="floating-panel bg-surface border border-border rounded p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-text-primary">图片加载策略</h3>
              <button
                onClick={() => setShowPreferenceModal(false)}
                className="p-2 hover:bg-surface-alt rounded"
              >
                <XCircle size={20} className="text-text-muted" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  优先使用
                </label>
                <select
                  value={preference.strategy}
                  onChange={(e) =>
                    setPreference({ ...preference, strategy: e.target.value as any })
                  }
                  className="w-full px-4 py-2 border border-border rounded text-sm focus:outline-none focus:border-brand-gold"
                >
                  <option value="local">本地服务器</option>
                  <option value="s3">S3 图床</option>
                  <option value="external">外部图床</option>
                </select>
                <p className="text-xs text-text-muted mt-1">图片加载时会优先使用选定的 URL</p>
              </div>
              <div>
                <Switch
                  id="fallback"
                  checked={preference.fallback}
                  onCheckedChange={(checked) => setPreference({ ...preference, fallback: checked })}
                  label={<span className="text-text-secondary">启用备用方案</span>}
                />
              </div>
              <p className="text-xs text-text-muted">
                启用后，如果优先 URL 加载失败，会自动尝试其他可用 URL
              </p>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowPreferenceModal(false)}
                  className="flex-1 px-4 py-2 bg-bg-tertiary text-text-secondary rounded font-medium hover:bg-surface-alt transition-all"
                >
                  取消
                </button>
                <button
                  onClick={handlePreferenceUpdate}
                  className="flex-1 px-4 py-2 bg-brand-gold-dark text-white rounded font-medium hover:bg-brand-gold transition-all"
                >
                  保存设置
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface ImportModalProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

const ImportModal: React.FC<ImportModalProps> = ({ open, onClose, onSuccess }) => {
  const presence = useFloatingPresence(open)
  const [mode, setMode] = useState<'upsert' | 'update' | 'create'>('upsert')
  const [data, setData] = useState('')
  const [loading, setLoading] = useState(false)
  const { show } = useToast()

  const handleImport = async () => {
    if (!data.trim()) {
      show('请输入导入数据', { variant: 'error' })
      return
    }
    setLoading(true)
    try {
      let items: any[]
      try {
        items = JSON.parse(data)
        if (!Array.isArray(items)) items = [items]
      } catch {
        const lines = data.trim().split('\n')
        items = lines.map((line) => {
          const parts = line.split(',').map((p) => p.trim().replace(/^"|"$/g, ''))
          return {
            id: parts[0],
            md5: parts[1],
            localUrl: parts[2],
            s3Url: parts[3] || undefined,
            externalUrl: parts[4] || undefined,
            storageType: (parts[5] as 'local' | 's3' | 'external') || undefined,
          }
        })
      }
      const response = await apiPost<{ success: number; failed: number; errors: string[] }>(
        '/api/image-maps/import',
        { items, mode }
      )
      if (response.failed > 0)
        show(`导入完成: 成功 ${response.success} 条, 失败 ${response.failed} 条`, {
          variant: 'error',
        })
      else show(`成功导入 ${response.success} 条记录`, { variant: 'success' })
      onSuccess()
    } catch {
      show('导入失败', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  if (!presence.mounted) return null

  return (
    <div
      className="floating-overlay fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      data-state={presence.state}
      aria-hidden={!open}
    >
      <div className="floating-panel bg-surface border border-border rounded p-6 max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-text-primary">批量导入图片映射</h3>
          <button onClick={onClose} className="p-2 hover:bg-surface-alt rounded">
            <XCircle size={20} className="text-text-muted" />
          </button>
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-text-secondary mb-2">导入模式</label>
          <div className="flex gap-2">
            {[
              { value: 'upsert', label: '智能更新', desc: '按MD5匹配，已存在则更新' },
              { value: 'update', label: '仅更新', desc: '按ID更新已有记录' },
              { value: 'create', label: '仅创建', desc: '只创建新记录' },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setMode(option.value as any)}
                className={clsx(
                  'flex-1 px-4 py-2 border rounded text-sm font-medium transition-all',
                  mode === option.value
                    ? 'border-brand-gold bg-brand-gold/10 text-brand-gold'
                    : 'border-border text-text-secondary hover:bg-surface-alt'
                )}
              >
                <div>{option.label}</div>
                <div className="text-xs opacity-70 mt-1">{option.desc}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="mb-4 flex-1 overflow-hidden flex flex-col">
          <label className="block text-sm font-medium text-text-secondary mb-2">
            导入数据 (JSON 或 CSV)
          </label>
          <textarea
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="flex-1 w-full px-4 py-2 border border-border rounded text-sm font-mono resize-none focus:outline-none focus:border-brand-gold"
            placeholder={
              mode === 'upsert'
                ? '[\n  { "md5": "abc123", "localUrl": "https://...", "s3Url": "https://...", "externalUrl": "https://...", "storageType": "s3" }\n]'
                : '[\n  { "id": "xxx", "localUrl": "https://...", "s3Url": "https://...", "externalUrl": "https://...", "storageType": "local" }\n]'
            }
          />
        </div>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-bg-tertiary text-text-secondary rounded font-medium hover:bg-surface-alt transition-all"
            disabled={loading}
          >
            取消
          </button>
          <button
            onClick={handleImport}
            className="flex-1 px-4 py-2 bg-brand-gold-dark text-white rounded font-medium hover:bg-brand-gold transition-all disabled:opacity-50"
            disabled={loading}
          >
            {loading ? '导入中...' : '开始导入'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default AdminImages
