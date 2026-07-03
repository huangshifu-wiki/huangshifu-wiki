import React, { useEffect, useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  FileText,
  Image,
  Loader2,
  RefreshCw,
  Trash2,
  XCircle,
} from '@/src/components/icons'
import { format } from 'date-fns'
import { clsx } from 'clsx'
import { apiGet, apiPost } from '../../lib/apiClient'
import { useToast } from '../../components/Toast'
import { ConfirmModal } from '../../components/Modal'

type Summary = { pending: number; processing: number; ready: number; failed: number; total: number }

type TextSummary = Record<'wiki' | 'post' | 'music' | 'album', Summary>
type ImageSourceAvailability = Record<'gallery' | 'wiki' | 'post', boolean>

type EmbeddingsStatus = {
  modelName: string
  vectorSize: number
  qdrantCollection: string
  modelCacheDir: string
  modelLoaded: boolean
  textModelLoaded: boolean
  tokenizerLoaded: boolean
  modelErrors: { image: string | null; text: string | null; tokenizer: string | null }
  usingModelScope: boolean
  actualDtype: string
  summary: Summary | { gallery: Summary; wiki: Summary; post: Summary }
  imageSourceAvailability: ImageSourceAvailability
  imageEmbeddingReady: boolean
  imageEmbeddingTableMissing: boolean
  imageEmbeddingWarning: string | null
  textSummary: TextSummary
  textEmbeddingReady: boolean
  textEmbeddingTableMissing: boolean
  textEmbeddingWarning: string | null
}

type EmbeddingsError = {
  id: string
  sourceType: 'gallery' | 'wiki' | 'post'
  sourceId?: string
  galleryImageId?: string | null
  gallery?: { id: string; title: string } | null
  wikiPageSlug?: string | null
  postId?: string | null
  imageUrl?: string
  status: string
  errorMessage: string | null
  retryCount: number
  createdAt: string
  updatedAt: string
}

type ImageErrorResponse = {
  errors: EmbeddingsError[]
  total: number
  warnings?: string[]
}

function normalizeSummary(summary: EmbeddingsStatus['summary']) {
  if ('gallery' in summary) {
    return summary as { gallery: Summary; wiki: Summary; post: Summary }
  }
  const old = summary as Summary
  return {
    gallery: old,
    wiki: { pending: 0, processing: 0, ready: 0, failed: 0, total: 0 },
    post: { pending: 0, processing: 0, ready: 0, failed: 0, total: 0 },
  }
}

const StatusBadge = ({ status }: { status: string }) => {
  const cfg: Record<string, { bg: string; text: string; label: string }> = {
    pending: { bg: 'bg-bg-tertiary', text: 'text-text-secondary', label: '等待中' },
    processing: { bg: 'bg-brand-gold/10', text: 'text-brand-gold', label: '处理中' },
    ready: { bg: 'theme-status-success', text: '', label: '就绪' },
    failed: { bg: 'theme-status-error', text: '', label: '失败' },
  }
  const c = cfg[status] || cfg.pending
  return (
    <span className={clsx('px-2 py-0.5 rounded text-[10px] font-medium', c.bg, c.text)}>
      {c.label}
    </span>
  )
}

const StatCard = ({ label, value, accent }: { label: string; value: number; accent?: string }) => (
  <div className="bg-surface border border-border rounded p-4">
    <div className="flex items-center gap-2 mb-2">
      <BarChart3 size={14} className="text-text-muted" />
      <span className="text-xs text-text-muted">{label}</span>
    </div>
    <p className={clsx('text-2xl font-bold', accent || 'text-text-primary')}>{value}</p>
  </div>
)

const SkeletonBlock = ({ className }: { className?: string }) => (
  <div className={clsx('animate-pulse bg-bg-tertiary rounded', className)} />
)

const LoadingSkeleton = () => (
  <div className="space-y-5">
    <div className="flex items-center justify-between">
      <SkeletonBlock className="h-8 w-64" />
      <SkeletonBlock className="h-9 w-20" />
    </div>
    {[1, 2, 3].map((i) => (
      <div key={i} className="bg-surface border border-border rounded p-5">
        <SkeletonBlock className="h-4 w-24 mb-3" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((j) => (
            <div key={j} className="border border-border rounded p-4">
              <SkeletonBlock className="h-3 w-16 mb-2" />
              <SkeletonBlock className="h-7 w-12" />
            </div>
          ))}
        </div>
      </div>
    ))}
    <div className="bg-surface border border-border rounded p-5">
      <SkeletonBlock className="h-4 w-20 mb-3" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((j) => (
          <SkeletonBlock key={j} className="h-5 w-full" />
        ))}
      </div>
    </div>
    <div className="bg-surface border border-border rounded p-5">
      <SkeletonBlock className="h-4 w-20 mb-4" />
      <div className="flex gap-3">
        {[1, 2, 3, 4, 5].map((j) => (
          <SkeletonBlock key={j} className="h-9 w-24" />
        ))}
      </div>
    </div>
  </div>
)

const getSourceLabel = (error: EmbeddingsError) => {
  switch (error.sourceType) {
    case 'gallery':
      return error.gallery?.title || `图库 #${error.galleryImageId}`
    case 'wiki':
      return `百科: ${error.wikiPageSlug || error.sourceId}`
    case 'post':
      return `帖子: ${error.postId || error.sourceId}`
    default:
      return error.sourceId || '未知'
  }
}

const AdminEmbeddings = () => {
  const [status, setStatus] = useState<EmbeddingsStatus | null>(null)
  const [errors, setErrors] = useState<EmbeddingsError[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingErrors, setLoadingErrors] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [textActionLoading, setTextActionLoading] = useState<string | null>(null)
  const [enqueueLimit, setEnqueueLimit] = useState(100)
  const [textEnqueueLimit, setTextEnqueueLimit] = useState(100)
  const [selectedType, setSelectedType] = useState<'all' | 'gallery' | 'wiki' | 'post'>('all')
  const [textSourceType, setTextSourceType] = useState<'all' | 'wiki' | 'post' | 'music' | 'album'>(
    'all'
  )
  const { show } = useToast()

  const [confirmState, setConfirmState] = useState<{
    open: boolean
    variant: 'danger' | 'warning' | 'info'
    title: string
    message: string
    onConfirm: () => void
  }>({ open: false, variant: 'info', title: '', message: '', onConfirm: () => {} })

  const openConfirm = (
    variant: 'danger' | 'warning' | 'info',
    title: string,
    message: string,
    onConfirm: () => void
  ) => {
    setConfirmState({ open: true, variant, title, message, onConfirm })
  }

  const closeConfirm = () => {
    setConfirmState((prev) => ({ ...prev, open: false }))
  }

  const fetchStatus = async () => {
    setLoading(true)
    try {
      const response = await apiGet<EmbeddingsStatus>('/api/embeddings/status')
      setStatus(response)
    } catch (error) {
      console.error(error)
      show('获取向量状态失败', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const fetchErrors = async () => {
    setLoadingErrors(true)
    try {
      const response = await apiGet<ImageErrorResponse>('/api/embeddings/errors', {
        limit: 50,
        type: selectedType,
      })
      setErrors(response.errors || [])
    } catch (error) {
      console.error(error)
      show('获取错误列表失败', { variant: 'error' })
    } finally {
      setLoadingErrors(false)
    }
  }

  useEffect(() => {
    fetchStatus()
  }, [])
  useEffect(() => {
    if (showErrors) fetchErrors()
  }, [showErrors, selectedType])

  useEffect(() => {
    if (!status) return
    const summary = normalizeSummary(status.summary)
    let hasProcessing =
      summary.gallery.processing > 0 || summary.wiki.processing > 0 || summary.post.processing > 0
    if (status.textSummary) {
      const ts = status.textSummary
      if (
        ts.wiki.processing > 0 ||
        ts.post.processing > 0 ||
        ts.music.processing > 0 ||
        ts.album.processing > 0
      ) {
        hasProcessing = true
      }
    }
    if (!hasProcessing) return
    const interval = setInterval(() => {
      fetchStatus()
    }, 30000)
    return () => clearInterval(interval)
  }, [status])

  const handleEnqueueMissing = async () => {
    setActionLoading('enqueue')
    try {
      const response = await apiPost<{
        gallery?: { requested: number; queued: number }
        wiki?: { requested: number; queued: number }
        post?: { requested: number; queued: number }
      }>('/api/embeddings/enqueue-missing', { limit: enqueueLimit, type: selectedType })
      const parts: string[] = []
      if (response.gallery) parts.push(`图库 ${response.gallery.queued} 个`)
      if (response.wiki) parts.push(`百科 ${response.wiki.queued} 个`)
      if (response.post) parts.push(`帖子 ${response.post.queued} 个`)
      show(parts.length > 0 ? `已加入队列: ${parts.join(', ')}` : '没有需要加入队列的任务')
      fetchStatus()
    } catch {
      show('补齐队列失败', { variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  const handleSyncBatch = async () => {
    setActionLoading('sync')
    try {
      const response = await apiPost<{
        gallery?: { ready: number; failed: number }
        wiki?: { ready: number; failed: number }
        post?: { ready: number; failed: number }
      }>('/api/embeddings/sync-batch', { limit: 100, type: selectedType })
      const parts: string[] = []
      if (response.gallery)
        parts.push(
          `图库 ${response.gallery.ready}/${response.gallery.ready + response.gallery.failed}`
        )
      if (response.wiki)
        parts.push(`百科 ${response.wiki.ready}/${response.wiki.ready + response.wiki.failed}`)
      if (response.post)
        parts.push(`帖子 ${response.post.ready}/${response.post.ready + response.post.failed}`)
      show(parts.length > 0 ? `批量同步完成: ${parts.join(', ')}` : '批量同步已启动')
      fetchStatus()
    } catch {
      show('批量同步失败', { variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  const handleRetryFailed = async () => {
    setActionLoading('retry')
    try {
      const response = await apiPost<{
        gallery?: { resetCount: number }
        wiki?: { resetCount: number }
        post?: { resetCount: number }
      }>('/api/embeddings/retry-failed', { type: selectedType })
      const totalReset =
        (response.gallery?.resetCount ?? 0) +
        (response.wiki?.resetCount ?? 0) +
        (response.post?.resetCount ?? 0)
      show(`已重置 ${totalReset} 个失败任务并开始重新同步`)
      fetchStatus()
      if (showErrors) fetchErrors()
    } catch {
      show('重试失败', { variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  const handleRebuildAll = async () => {
    setActionLoading('rebuild')
    try {
      const response = await apiPost<{
        gallery?: { resetCount: number }
        wiki?: { resetCount: number }
        post?: { resetCount: number }
      }>('/api/embeddings/rebuild-all', { type: selectedType })
      const totalReset =
        (response.gallery?.resetCount ?? 0) +
        (response.wiki?.resetCount ?? 0) +
        (response.post?.resetCount ?? 0)
      show(`已重置 ${totalReset} 条记录并开始重建`)
      fetchStatus()
    } catch {
      show('重建失败', { variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  const handleTextEnqueue = async () => {
    setTextActionLoading('enqueue')
    try {
      const response = await apiPost<{
        wiki?: { requested: number; queued: number }
        post?: { requested: number; queued: number }
        music?: { requested: number; queued: number }
        album?: { requested: number; queued: number }
      }>('/api/embeddings/text/enqueue', { sourceType: textSourceType, limit: textEnqueueLimit })
      const parts: string[] = []
      if (response.wiki) parts.push(`百科 ${response.wiki.queued} 个`)
      if (response.post) parts.push(`帖子 ${response.post.queued} 个`)
      if (response.music) parts.push(`音乐 ${response.music.queued} 个`)
      if (response.album) parts.push(`专辑 ${response.album.queued} 个`)
      show(parts.length > 0 ? `已加入队列: ${parts.join(', ')}` : '没有需要加入队列的任务')
      fetchStatus()
    } catch {
      show('补齐队列失败', { variant: 'error' })
    } finally {
      setTextActionLoading(null)
    }
  }

  const handleTextSync = async () => {
    setTextActionLoading('sync')
    try {
      const response = await apiPost<{
        wiki?: { ready: number; failed: number }
        post?: { ready: number; failed: number }
        music?: { ready: number; failed: number }
        album?: { ready: number; failed: number }
      }>('/api/embeddings/text/sync', { limit: 100 })
      const parts: string[] = []
      if (response.wiki)
        parts.push(`百科 ${response.wiki.ready}/${response.wiki.ready + response.wiki.failed}`)
      if (response.post)
        parts.push(`帖子 ${response.post.ready}/${response.post.ready + response.post.failed}`)
      if (response.music)
        parts.push(`音乐 ${response.music.ready}/${response.music.ready + response.music.failed}`)
      if (response.album)
        parts.push(`专辑 ${response.album.ready}/${response.album.ready + response.album.failed}`)
      show(parts.length > 0 ? `批量同步完成: ${parts.join(', ')}` : '批量同步已启动')
      fetchStatus()
    } catch {
      show('批量同步失败', { variant: 'error' })
    } finally {
      setTextActionLoading(null)
    }
  }

  const handleTextRetryFailed = async () => {
    setTextActionLoading('retry')
    try {
      const response = await apiPost<{
        wiki?: { resetCount: number }
        post?: { resetCount: number }
        music?: { resetCount: number }
        album?: { resetCount: number }
      }>('/api/embeddings/text/retry-failed', { sourceType: textSourceType })
      const totalReset =
        (response.wiki?.resetCount ?? 0) +
        (response.post?.resetCount ?? 0) +
        (response.music?.resetCount ?? 0) +
        (response.album?.resetCount ?? 0)
      show(`已重置 ${totalReset} 个失败任务并开始重新同步`)
      fetchStatus()
    } catch {
      show('重试失败', { variant: 'error' })
    } finally {
      setTextActionLoading(null)
    }
  }

  const handleTextRebuildAll = async () => {
    setTextActionLoading('rebuild')
    try {
      const response = await apiPost<{
        wiki?: { resetCount: number }
        post?: { resetCount: number }
        music?: { resetCount: number }
        album?: { resetCount: number }
      }>('/api/embeddings/text/rebuild-all', { sourceType: textSourceType })
      const totalReset =
        (response.wiki?.resetCount ?? 0) +
        (response.post?.resetCount ?? 0) +
        (response.music?.resetCount ?? 0) +
        (response.album?.resetCount ?? 0)
      show(`已重置 ${totalReset} 条记录并开始重建`)
      fetchStatus()
    } catch {
      show('重建失败', { variant: 'error' })
    } finally {
      setTextActionLoading(null)
    }
  }

  const anyActionLoading = actionLoading !== null || textActionLoading !== null

  if (loading && !status) {
    return <LoadingSkeleton />
  }

  const summary = status ? normalizeSummary(status.summary) : null
  const imageFailedTotal = summary
    ? summary.gallery.failed + summary.wiki.failed + summary.post.failed
    : 0
  const textFailedTotal = status?.textSummary
    ? status.textSummary.wiki.failed +
      status.textSummary.post.failed +
      status.textSummary.music.failed +
      status.textSummary.album.failed
    : 0
  const selectedImageTypes =
    selectedType === 'all' ? (['gallery', 'wiki', 'post'] as const) : ([selectedType] as const)
  const isImageTypeSelectable = (type: typeof selectedType) => {
    if (!status) return true
    const targetTypes = type === 'all' ? (['gallery', 'wiki', 'post'] as const) : ([type] as const)
    return targetTypes.every((item) => status.imageSourceAvailability[item])
  }
  const imageEmbeddingsUnavailable = status
    ? selectedImageTypes.some((type) => !status.imageSourceAvailability[type])
    : false
  const textEmbeddingsUnavailable = status?.textEmbeddingReady === false

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-text-primary tracking-[0.12em]">
          向量 Embeddings 管理
        </h2>
        <button
          onClick={fetchStatus}
          className="px-4 py-2 border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded text-sm transition-all inline-flex items-center gap-1.5"
        >
          <RefreshCw size={14} /> 刷新
        </button>
      </div>

      {status && summary && (
        <>
          {[
            { title: '图库图片', key: 'gallery' as const, icon: Image },
            { title: '百科图片', key: 'wiki' as const, icon: Image },
            { title: '帖子图片', key: 'post' as const, icon: Image },
          ].map((section) => (
            <div key={section.key} className="bg-surface border border-border rounded p-5">
              <h3 className="text-sm font-semibold text-text-secondary mb-3">{section.title}</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="等待中" value={summary[section.key].pending} />
                <StatCard
                  label="处理中"
                  value={summary[section.key].processing}
                  accent="text-brand-gold"
                />
                <StatCard
                  label="就绪"
                  value={summary[section.key].ready}
                  accent="theme-text-success"
                />
                <StatCard
                  label="失败"
                  value={summary[section.key].failed}
                  accent="theme-text-error"
                />
              </div>
            </div>
          ))}

          {status.imageEmbeddingWarning && (
            <div className="rounded border border-amber-300/50 bg-amber-100/70 px-4 py-3 text-sm text-amber-900">
              {status.imageEmbeddingWarning}
            </div>
          )}

          {status.textSummary && (
            <div className="bg-surface border border-border rounded p-5">
              <div className="flex items-center gap-3 mb-4">
                <FileText size={16} className="text-text-secondary" />
                <h3 className="text-sm font-semibold text-text-secondary">文本向量</h3>
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-xs text-text-muted">文本模型</span>
                  {status.textModelLoaded ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-medium theme-status-success">
                      已加载
                    </span>
                  ) : status.modelErrors.text ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-medium theme-status-error">
                      加载失败
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-bg-tertiary text-text-secondary">
                      未加载
                    </span>
                  )}
                  <span className="text-xs text-text-muted">分词器</span>
                  {status.tokenizerLoaded ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-medium theme-status-success">
                      已加载
                    </span>
                  ) : status.modelErrors.tokenizer ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-medium theme-status-error">
                      加载失败
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-bg-tertiary text-text-secondary">
                      未加载
                    </span>
                  )}
                </div>
              </div>
              {status.textEmbeddingWarning && (
                <div className="mb-4 rounded border border-amber-300/50 bg-amber-100/70 px-4 py-3 text-sm text-amber-900">
                  {status.textEmbeddingWarning}
                </div>
              )}
              <div className="space-y-3">
                {[
                  { title: '百科文本', key: 'wiki' as const },
                  { title: '帖子文本', key: 'post' as const },
                  { title: '音乐文本', key: 'music' as const },
                  { title: '专辑文本', key: 'album' as const },
                ].map((section) => (
                  <div key={section.key}>
                    <p className="text-xs text-text-muted mb-2">{section.title}</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <StatCard label="等待中" value={status.textSummary[section.key].pending} />
                      <StatCard
                        label="处理中"
                        value={status.textSummary[section.key].processing}
                        accent="text-brand-gold"
                      />
                      <StatCard
                        label="就绪"
                        value={status.textSummary[section.key].ready}
                        accent="theme-text-success"
                      />
                      <StatCard
                        label="失败"
                        value={status.textSummary[section.key].failed}
                        accent="theme-text-error"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-surface border border-border rounded p-5">
            <h3 className="text-sm font-semibold text-text-secondary mb-3">配置信息</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-text-muted">模型：</span>
                <span className="font-medium text-text-primary">{status.modelName}</span>
              </div>
              <div>
                <span className="text-text-muted">向量维度：</span>
                <span className="font-medium text-text-primary">{status.vectorSize}</span>
              </div>
              <div>
                <span className="text-text-muted">集合名称：</span>
                <span className="font-medium text-text-primary">{status.qdrantCollection}</span>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm text-text-muted">图像模型：</span>
                {status.modelLoaded ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium theme-status-success">
                    已加载
                  </span>
                ) : status.modelErrors.image ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium theme-status-error">
                    加载失败
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-bg-tertiary text-text-secondary">
                    未加载
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm text-text-muted">文本模型：</span>
                {status.textModelLoaded ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium theme-status-success">
                    已加载
                  </span>
                ) : status.modelErrors.text ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium theme-status-error">
                    加载失败
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-bg-tertiary text-text-secondary">
                    未加载
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm text-text-muted">分词器：</span>
                {status.tokenizerLoaded ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium theme-status-success">
                    已加载
                  </span>
                ) : status.modelErrors.tokenizer ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium theme-status-error">
                    加载失败
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-bg-tertiary text-text-secondary">
                    未加载
                  </span>
                )}
                <span className="text-[10px] text-text-muted">
                  ({status.usingModelScope ? 'ModelScope 镜像' : 'Hugging Face'})
                </span>
              </div>
              {(status.modelErrors.image ||
                status.modelErrors.text ||
                status.modelErrors.tokenizer) && (
                <div className="p-3 theme-status-error rounded mt-2">
                  <p className="text-xs theme-text-error font-medium mb-1">模型加载错误：</p>
                  {status.modelErrors.image && (
                    <p className="text-xs theme-text-error">图像模型: {status.modelErrors.image}</p>
                  )}
                  {status.modelErrors.text && (
                    <p className="text-xs theme-text-error">文本模型: {status.modelErrors.text}</p>
                  )}
                  {status.modelErrors.tokenizer && (
                    <p className="text-xs theme-text-error">
                      分词器: {status.modelErrors.tokenizer}
                    </p>
                  )}
                </div>
              )}
              <div className="mt-2 text-xs text-text-muted">
                缓存目录：{status.modelCacheDir} | 量化精度：{status.actualDtype}
              </div>
            </div>
          </div>

          <div className="bg-surface border border-border rounded p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-secondary">图片向量批量操作</h3>
              <div className="flex gap-1">
                {[
                  { value: 'all', label: '全部' },
                  { value: 'gallery', label: '图库' },
                  { value: 'wiki', label: '百科' },
                  { value: 'post', label: '帖子' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      const nextType = opt.value as typeof selectedType
                      if (!isImageTypeSelectable(nextType)) {
                        return
                      }
                      setSelectedType(nextType)
                    }}
                    disabled={!isImageTypeSelectable(opt.value as typeof selectedType)}
                    className={clsx(
                      'px-3 py-1.5 rounded text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed',
                      selectedType === opt.value
                        ? 'bg-brand-gold-dark text-white'
                        : 'bg-surface-alt text-text-secondary hover:text-brand-gold'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={enqueueLimit}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 1
                    setEnqueueLimit(Math.min(Math.max(1, val), 2000))
                  }}
                  className="w-24 px-3 py-2 rounded border border-border text-sm focus:outline-none focus:border-brand-gold"
                  min={1}
                  max={2000}
                  disabled={imageEmbeddingsUnavailable}
                />
                <button
                  onClick={handleEnqueueMissing}
                  disabled={actionLoading !== null || imageEmbeddingsUnavailable}
                  className="px-4 py-2 rounded bg-brand-gold-dark text-white text-sm font-medium hover:bg-brand-gold disabled:opacity-50 inline-flex items-center gap-2 transition-all"
                >
                  {actionLoading === 'enqueue' ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : null}{' '}
                  补齐缺失
                </button>
              </div>
              <button
                onClick={() =>
                  openConfirm(
                    'warning',
                    '批量同步确认',
                    '确定要批量同步向量吗？这可能需要一些时间。',
                    handleSyncBatch
                  )
                }
                disabled={actionLoading !== null || imageEmbeddingsUnavailable}
                className="px-4 py-2 rounded border border-border text-text-secondary text-sm font-medium hover:text-brand-gold hover:border-brand-gold disabled:opacity-50 inline-flex items-center gap-2 transition-all"
              >
                {actionLoading === 'sync' ? <Loader2 size={14} className="animate-spin" /> : null}{' '}
                批量同步
              </button>
              <button
                onClick={() => setShowErrors(!showErrors)}
                disabled={actionLoading !== null || imageEmbeddingsUnavailable}
                className={clsx(
                  'px-4 py-2 rounded border text-sm font-medium inline-flex items-center gap-2 transition-all',
                  showErrors
                    ? 'border-border theme-status-error'
                    : 'border-border text-text-secondary hover:bg-surface-alt',
                  (actionLoading !== null || imageEmbeddingsUnavailable) && 'opacity-50'
                )}
              >
                <AlertTriangle size={14} /> 查看错误 ({imageFailedTotal})
              </button>
              <button
                onClick={() =>
                  openConfirm(
                    'warning',
                    '重试确认',
                    '确定要重试所有失败的向量任务吗？',
                    handleRetryFailed
                  )
                }
                disabled={
                  actionLoading !== null || imageFailedTotal === 0 || imageEmbeddingsUnavailable
                }
                className="px-4 py-2 rounded border border-border text-text-secondary text-sm font-medium hover:text-brand-gold hover:border-brand-gold disabled:opacity-50 inline-flex items-center gap-2 transition-all"
              >
                {actionLoading === 'retry' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}{' '}
                重试失败
              </button>
              <button
                onClick={() =>
                  openConfirm(
                    'danger',
                    '重建全部确认',
                    '确定要重建所有向量吗？这将删除现有向量并重新生成，耗时较长。此操作不可逆。',
                    handleRebuildAll
                  )
                }
                disabled={actionLoading !== null || imageEmbeddingsUnavailable}
                className="px-4 py-2 rounded border border-border theme-status-error text-sm font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2 transition-all"
              >
                {actionLoading === 'rebuild' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}{' '}
                重建全部
              </button>
            </div>
          </div>

          <div className="bg-surface border border-border rounded p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-secondary">文本向量批量操作</h3>
              <div className="flex gap-1">
                {[
                  { value: 'all', label: '全部' },
                  { value: 'wiki', label: '百科' },
                  { value: 'post', label: '帖子' },
                  { value: 'music', label: '音乐' },
                  { value: 'album', label: '专辑' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setTextSourceType(opt.value as typeof textSourceType)}
                    className={clsx(
                      'px-3 py-1.5 rounded text-xs font-medium transition-all',
                      textSourceType === opt.value
                        ? 'bg-brand-gold-dark text-white'
                        : 'bg-surface-alt text-text-secondary hover:text-brand-gold'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={textEnqueueLimit}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 1
                    setTextEnqueueLimit(Math.min(Math.max(1, val), 2000))
                  }}
                  className="w-24 px-3 py-2 rounded border border-border text-sm focus:outline-none focus:border-brand-gold"
                  min={1}
                  max={2000}
                  disabled={textEmbeddingsUnavailable}
                />
                <button
                  onClick={handleTextEnqueue}
                  disabled={textActionLoading !== null || textEmbeddingsUnavailable}
                  className="px-4 py-2 rounded bg-brand-gold-dark text-white text-sm font-medium hover:bg-brand-gold disabled:opacity-50 inline-flex items-center gap-2 transition-all"
                >
                  {textActionLoading === 'enqueue' ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : null}{' '}
                  补齐缺失
                </button>
              </div>
              <button
                onClick={() =>
                  openConfirm(
                    'warning',
                    '批量同步确认',
                    '确定要批量同步文本向量吗？这可能需要一些时间。',
                    handleTextSync
                  )
                }
                disabled={textActionLoading !== null || textEmbeddingsUnavailable}
                className="px-4 py-2 rounded border border-border text-text-secondary text-sm font-medium hover:text-brand-gold hover:border-brand-gold disabled:opacity-50 inline-flex items-center gap-2 transition-all"
              >
                {textActionLoading === 'sync' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : null}{' '}
                批量同步
              </button>
              <button
                onClick={() =>
                  openConfirm(
                    'warning',
                    '重试确认',
                    '确定要重试所有失败的文本向量任务吗？',
                    handleTextRetryFailed
                  )
                }
                disabled={
                  textActionLoading !== null || textFailedTotal === 0 || textEmbeddingsUnavailable
                }
                className="px-4 py-2 rounded border border-border text-text-secondary text-sm font-medium hover:text-brand-gold hover:border-brand-gold disabled:opacity-50 inline-flex items-center gap-2 transition-all"
              >
                {textActionLoading === 'retry' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}{' '}
                重试失败
              </button>
              <button
                onClick={() =>
                  openConfirm(
                    'danger',
                    '重建全部确认',
                    '确定要重建所有文本向量吗？这将删除现有向量并重新生成，耗时较长。此操作不可逆。',
                    handleTextRebuildAll
                  )
                }
                disabled={textActionLoading !== null || textEmbeddingsUnavailable}
                className="px-4 py-2 rounded border border-border theme-status-error text-sm font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2 transition-all"
              >
                {textActionLoading === 'rebuild' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}{' '}
                重建全部
              </button>
            </div>
          </div>
        </>
      )}

      {showErrors && (
        <div className="bg-surface border border-border rounded p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-text-secondary">错误列表</h3>
            <button
              onClick={() => setShowErrors(false)}
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-alt transition-colors"
            >
              <XCircle size={18} />
            </button>
          </div>
          {loadingErrors ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={24} className="animate-spin text-text-muted" />
            </div>
          ) : errors.length > 0 ? (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {errors.map((error) => (
                <div
                  key={error.id}
                  className="flex items-start gap-3 p-3 rounded border border-border hover:bg-surface-alt transition-colors"
                >
                  <AlertTriangle size={16} className="theme-text-error mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={clsx(
                          'px-1.5 py-0.5 rounded text-[10px] font-medium',
                          error.sourceType === 'gallery'
                            ? 'bg-surface-alt text-brand-gold'
                            : error.sourceType === 'wiki'
                              ? 'bg-brand-gold/15 text-brand-gold'
                              : 'bg-bg-tertiary text-text-secondary'
                        )}
                      >
                        {error.sourceType === 'gallery'
                          ? '图库'
                          : error.sourceType === 'wiki'
                            ? '百科'
                            : '帖子'}
                      </span>
                      <StatusBadge status={error.status} />
                      <span className="text-xs text-text-muted">
                        {format(new Date(error.updatedAt), 'yyyy-MM-dd HH:mm')}
                      </span>
                    </div>
                    <p className="text-sm text-text-primary truncate">{getSourceLabel(error)}</p>
                    {error.errorMessage && (
                      <p className="text-xs theme-text-error mt-1">{error.errorMessage}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-text-muted">
              <AlertTriangle size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">暂无错误</p>
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        open={confirmState.open}
        onClose={closeConfirm}
        onConfirm={confirmState.onConfirm}
        title={confirmState.title}
        message={confirmState.message}
        variant={confirmState.variant}
        loading={anyActionLoading}
      />
    </div>
  )
}

export default AdminEmbeddings
