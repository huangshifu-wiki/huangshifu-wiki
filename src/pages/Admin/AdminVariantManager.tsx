import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  RefreshCw,
  Image,
  Trash2,
  RotateCcw,
  Loader2,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Zap,
  Clock,
  BarChart3,
  Music,
} from '@/src/components/icons'
import { apiGet, apiPost } from '../../lib/apiClient'
import { useDialog } from '../../components/Dialog'
import { clsx } from 'clsx'

interface VariantStats {
  queueLength: number
  processingCount: number
  completedToday: number
  failedToday: number
  averageProcessingTime: number
  timeoutCount: number
}

interface CleanupStats {
  totalImages: number
  completedVariants: number
  failedVariants: number
  pendingOrProcessing: number
  estimatedOrphanedDirectories: number
}

interface RebuildResponse {
  success: boolean
  error?: string
  jobId?: string
  summary?: {
    totalScanned: number
    queuedForRebuild: number
    skipped: number
    errors: number
  }
  estimatedTimeSeconds?: number
}

type MusicCoverThumbnailType = 'all' | 'song' | 'album'

interface MusicCoverThumbnailStats {
  song: {
    total: number
    missing: number
  }
  album: {
    total: number
    missing: number
  }
  total: {
    total: number
    missing: number
  }
}

interface MusicCoverThumbnailBackfillError {
  type: 'song' | 'album'
  coverId: string
  resourceId: string
  message: string
}

interface MusicCoverThumbnailBackfillResponse {
  success: boolean
  data: {
    type: MusicCoverThumbnailType
    batchSize: number
    processed: number
    succeeded: number
    failed: number
    remaining: number
    errors: MusicCoverThumbnailBackfillError[]
  }
  error?: string
}

interface MusicCoverThumbnailBackfillProgress {
  target: number
  processed: number
  succeeded: number
  failed: number
  remaining: number
  stopped: boolean
  errors: MusicCoverThumbnailBackfillError[]
}

const NO_CACHE_OPTIONS = { staleTime: 0, swr: false }
const MUSIC_COVER_THUMBNAIL_BATCH_SIZE = 50
const MAX_MUSIC_COVER_BACKFILL_ERRORS = 5

const MUSIC_COVER_TYPE_OPTIONS: Array<{
  value: MusicCoverThumbnailType
  label: string
  desc: string
}> = [
  { value: 'all', label: '全部', desc: '歌曲和专辑封面' },
  { value: 'song', label: '仅歌曲', desc: '只处理歌曲封面' },
  { value: 'album', label: '仅专辑', desc: '只处理专辑封面' },
]

const createMusicCoverBackfillProgress = (target: number): MusicCoverThumbnailBackfillProgress => ({
  target,
  processed: 0,
  succeeded: 0,
  failed: 0,
  remaining: target,
  stopped: false,
  errors: [],
})

const getMusicCoverStatsBucket = (stats: MusicCoverThumbnailStats, type: MusicCoverThumbnailType) =>
  stats[type === 'all' ? 'total' : type]

const getMusicCoverMissingCount = (
  stats: MusicCoverThumbnailStats | null,
  type: MusicCoverThumbnailType
) => (stats ? getMusicCoverStatsBucket(stats, type).missing : 0)

export const AdminVariantManager: React.FC = () => {
  const [variantStats, setVariantStats] = useState<VariantStats | null>(null)
  const [cleanupStats, setCleanupStats] = useState<CleanupStats | null>(null)
  const [musicCoverStats, setMusicCoverStats] = useState<MusicCoverThumbnailStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rebuildScope, setRebuildScope] = useState<string>('missing')
  const [rebuilding, setRebuilding] = useState(false)
  const [rebuildResult, setRebuildResult] = useState<RebuildResponse | null>(null)
  const [musicCoverType, setMusicCoverType] = useState<MusicCoverThumbnailType>('all')
  const [backfillingMusicCovers, setBackfillingMusicCovers] = useState(false)
  const [musicCoverBackfillProgress, setMusicCoverBackfillProgress] =
    useState<MusicCoverThumbnailBackfillProgress | null>(null)
  const [cleaning, setCleaning] = useState(false)
  const [cleanupResult, setCleanupResult] = useState<{
    type: string
    freedSpace: number
    deletedCount: number
    errorsCount: number
  } | null>(null)
  const stopMusicCoverBackfillRef = useRef(false)
  const dialog = useDialog()
  const selectedMusicCoverOption =
    MUSIC_COVER_TYPE_OPTIONS.find((option) => option.value === musicCoverType) ??
    MUSIC_COVER_TYPE_OPTIONS[0]
  const selectedMusicCoverMissingCount = getMusicCoverMissingCount(musicCoverStats, musicCoverType)

  const fetchStats = useCallback(async (options: { clearError?: boolean } = {}) => {
    try {
      setLoading(true)
      if (options.clearError !== false) {
        setError(null)
      }
      const [statsData, cleanupData, musicCoverData] = await Promise.all([
        apiGet<{ success: boolean; data: VariantStats }>('/api/admin/variants/stats'),
        apiGet<{ success: boolean; data: CleanupStats }>('/api/admin/cleanup/stats').catch(() => ({
          success: false,
          data: null as any,
        })),
        apiGet<{ success: boolean; data: MusicCoverThumbnailStats }>(
          '/api/admin/music-cover-thumbnails/stats',
          undefined,
          NO_CACHE_OPTIONS
        ).catch(() => ({
          success: false,
          data: null as any,
        })),
      ])
      if (statsData.success) setVariantStats(statsData.data)
      if (cleanupData.success) setCleanupStats(cleanupData.data)
      if (musicCoverData.success) setMusicCoverStats(musicCoverData.data)
    } catch (err) {
      console.error('Failed to fetch stats:', err)
      setError(err instanceof Error ? err.message : '网络错误')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
  }, [fetchStats])

  const handleRebuildVariants = async (scope: string) => {
    const actionLabel =
      scope === 'missing' ? '补全缺失' : scope === 'failed' ? '重建失败' : '全部重建'
    const confirmed = await dialog.confirm({
      title: '重建变体',
      message: `确定要执行"${actionLabel}"吗？`,
      confirmText: '执行',
      variant: scope === 'all' ? 'danger' : 'warning',
    })
    if (!confirmed) return
    try {
      setRebuilding(true)
      setRebuildResult(null)
      const result = await apiPost<RebuildResponse>('/api/admin/rebuild-all-variants', {
        scope,
        batchSize: 100,
        dryRun: false,
      })
      if (result.success) {
        setRebuildResult(result)
        setTimeout(() => fetchStats(), 2000)
      } else {
        throw new Error(result.error || '重建失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '重建失败')
    } finally {
      setRebuilding(false)
    }
  }

  const handleCleanupOrphaned = async () => {
    const confirmed = await dialog.confirm({
      title: '清理孤儿变体',
      message: '确定要清理所有孤儿变体文件吗？',
      confirmText: '清理',
      variant: 'warning',
    })
    if (!confirmed) return
    try {
      setCleaning(true)
      setCleanupResult(null)
      const data = await apiPost<{
        success: boolean
        data: { freedSpace: number; deletedCount: number; errorsCount: number }
      }>('/api/admin/cleanup/orphaned')
      if (data.success) {
        setCleanupResult({
          type: 'orphaned',
          freedSpace: data.data.freedSpace,
          deletedCount: data.data.deletedCount,
          errorsCount: data.data.errorsCount,
        })
        setTimeout(() => fetchStats(), 1000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '清理失败')
    } finally {
      setCleaning(false)
    }
  }

  const handleCleanupFailed = async () => {
    const confirmed = await dialog.confirm({
      title: '清理失败变体',
      message: '确定要清理所有失败的变体文件吗？',
      confirmText: '清理',
      variant: 'warning',
    })
    if (!confirmed) return
    try {
      setCleaning(true)
      setCleanupResult(null)
      const data = await apiPost<{
        success: boolean
        data: { freedSpace: number; deletedCount: number; errorsCount: number }
      }>('/api/admin/cleanup/failed')
      if (data.success) {
        setCleanupResult({
          type: 'failed',
          freedSpace: data.data.freedSpace,
          deletedCount: data.data.deletedCount,
          errorsCount: data.data.errorsCount,
        })
        setTimeout(() => fetchStats(), 1000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '清理失败')
    } finally {
      setCleaning(false)
    }
  }

  const handleCleanupAll = async () => {
    const confirmed = await dialog.confirm({
      title: '全量清理',
      message: '确定要执行全量清理吗？这将同时清理孤儿文件和失败残留。',
      confirmText: '清理',
      variant: 'danger',
    })
    if (!confirmed) return
    try {
      setCleaning(true)
      setCleanupResult(null)
      const data = await apiPost<{
        success: boolean
        data: { totalFreedBytes: number; totalDeletedFiles: number; totalErrors: number }
      }>('/api/admin/cleanup/all')
      if (data.success) {
        setCleanupResult({
          type: 'all',
          freedSpace: data.data.totalFreedBytes,
          deletedCount: data.data.totalDeletedFiles,
          errorsCount: data.data.totalErrors,
        })
        setTimeout(() => fetchStats(), 1500)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '全量清理失败')
    } finally {
      setCleaning(false)
    }
  }

  const handleBackfillMusicCoverThumbnails = async () => {
    const missingCount = selectedMusicCoverMissingCount
    if (missingCount === 0) {
      setMusicCoverBackfillProgress(null)
      return
    }

    const confirmed = await dialog.confirm({
      title: '补齐音乐封面缩略图',
      message: `确定要补齐当前范围内的 ${missingCount} 张音乐封面缩略图吗？`,
      confirmText: '补齐',
      variant: 'warning',
    })
    if (!confirmed) return

    stopMusicCoverBackfillRef.current = false
    setBackfillingMusicCovers(true)
    const initialProgress = createMusicCoverBackfillProgress(missingCount)
    setMusicCoverBackfillProgress(initialProgress)

    let nextProgress = initialProgress

    try {
      while (!stopMusicCoverBackfillRef.current && nextProgress.remaining > 0) {
        const result = await apiPost<MusicCoverThumbnailBackfillResponse>(
          '/api/admin/music-cover-thumbnails/backfill',
          {
            type: musicCoverType,
            batchSize: MUSIC_COVER_THUMBNAIL_BATCH_SIZE,
          }
        )

        if (!result.success) {
          throw new Error(result.error || '补齐失败')
        }

        nextProgress = {
          target: missingCount,
          processed: nextProgress.processed + result.data.processed,
          succeeded: nextProgress.succeeded + result.data.succeeded,
          failed: nextProgress.failed + result.data.failed,
          remaining: result.data.remaining,
          stopped: stopMusicCoverBackfillRef.current,
          errors: [...result.data.errors, ...nextProgress.errors].slice(
            0,
            MAX_MUSIC_COVER_BACKFILL_ERRORS
          ),
        }
        setMusicCoverBackfillProgress(nextProgress)

        if (result.data.processed === 0) {
          if (result.data.remaining > 0) {
            throw new Error('本批次没有处理任何封面，已停止继续批处理')
          }
          break
        }

        if (result.data.succeeded === 0 && result.data.remaining > 0) {
          throw new Error('本批次没有成功生成任何缩略图，已停止继续批处理')
        }
      }

      if (stopMusicCoverBackfillRef.current) {
        setMusicCoverBackfillProgress((prev) => (prev ? { ...prev, stopped: true } : prev))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '补齐音乐封面缩略图失败')
      setMusicCoverBackfillProgress((prev) => (prev ? { ...prev, stopped: true } : prev))
    } finally {
      await fetchStats({ clearError: false })
      setBackfillingMusicCovers(false)
    }
  }

  const handleStopMusicCoverBackfill = () => {
    stopMusicCoverBackfillRef.current = true
    setMusicCoverBackfillProgress((prev) => (prev ? { ...prev, stopped: true } : prev))
  }

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  /**
   * 变体管理按钮说明：
   * - 刷新：重新拉取当前变体生成队列和清理统计，不修改数据。
   * - 补全缺失：只处理没有缩略图或状态仍为 pending 的图片，适合历史图片补生成变体。
   * - 重建失败：只把 variantStatus = failed 的图片重新加入生成队列。
   * - 全部重建：当前前端未传 force: true，后端实际只处理 variantStatus != completed 的图片，
   *   不会覆盖所有已完成变体；若要真正强制重建所有变体，需要同步调整请求参数和提示文案。
   * - 开始重建：按当前选中的范围提交后台生成任务，实际生成进度看等待处理、正在处理、今日完成和今日失败。
   * - 清理孤儿文件：删除 uploads/variants/ 中找不到对应 ImageMap 数据库记录的变体目录或文件。
   * - 清理失败残留：清理生成失败后留下的残缺变体文件，用于释放空间并避免影响后续重试。
   * - 全量清理：同时执行清理孤儿文件和清理失败残留。
   * - 错误提示里的垃圾桶按钮：只关闭当前错误提示，不会删除任何文件。
   */
  const scopeOptions = [
    { value: 'missing', label: '补全缺失', desc: '仅处理没有变体的图片' },
    { value: 'failed', label: '重建失败', desc: '仅处理生成失败的图片' },
    { value: 'all', label: '全部重建', desc: '强制重新生成所有变体（慎用）' },
  ]

  const musicCoverCompletionPercent =
    musicCoverBackfillProgress && musicCoverBackfillProgress.target > 0
      ? Math.min(
          100,
          Math.round(
            ((musicCoverBackfillProgress.succeeded + musicCoverBackfillProgress.failed) /
              musicCoverBackfillProgress.target) *
              100
          )
        )
      : 0

  if (loading && !variantStats && !cleanupStats) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-text-primary tracking-[0.12em]">变体管理</h1>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-surface border border-border rounded p-5 animate-pulse">
              <div className="h-4 bg-bg-tertiary rounded w-16 mb-3" />
              <div className="h-8 bg-bg-tertiary rounded w-20" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Image size={24} className="text-brand-gold" />
          <h1 className="text-2xl font-bold text-text-primary tracking-[0.12em]">变体管理</h1>
        </div>
        <button
          onClick={() => fetchStats()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded transition-all disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> 刷新
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-3 p-3 rounded theme-status-error">
          <XCircle size={18} className="theme-text-error shrink-0 mt-0.5" />
          <p className="text-sm theme-text-error flex-1">{error}</p>
          <button onClick={() => setError(null)} className="p-1 theme-icon-button-danger">
            <Trash2 size={14} />
          </button>
        </div>
      )}

      {variantStats && (
        <div className="bg-surface border border-border rounded p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={16} className="text-text-muted" />
            <h3 className="text-sm font-semibold text-text-secondary">生成队列</h3>
            <span className="px-2 py-0.5 theme-status-success text-[10px] font-medium rounded border border-border">
              运行中
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              {
                label: '等待处理',
                value: variantStats.queueLength,
                icon: Clock,
                color: 'text-text-primary',
              },
              {
                label: '正在处理',
                value: variantStats.processingCount,
                icon: Loader2,
                color: 'text-brand-gold',
              },
              {
                label: '今日完成',
                value: variantStats.completedToday,
                icon: CheckCircle,
                color: 'theme-text-success',
              },
              {
                label: '今日失败',
                value: variantStats.failedToday,
                icon: XCircle,
                color: 'theme-text-error',
              },
              {
                label: '超时次数',
                value: variantStats.timeoutCount,
                icon: AlertTriangle,
                color: 'theme-text-warning',
              },
              {
                label: '平均耗时',
                value: `${variantStats.averageProcessingTime}ms`,
                icon: Clock,
                color: 'text-text-secondary',
              },
            ].map((item) => {
              const Icon = item.icon
              return (
                <div key={item.label} className="bg-surface-alt rounded p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon size={12} className="text-text-muted" />
                    <span className="text-[11px] text-text-muted">{item.label}</span>
                  </div>
                  <p className={`text-lg font-bold ${item.color}`}>{item.value}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {cleanupStats && (
        <div className="bg-surface border border-border rounded p-5">
          <div className="flex items-center gap-2 mb-4">
            <Image size={16} className="text-text-muted" />
            <h3 className="text-sm font-semibold text-text-secondary">变体统计</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: '总图片数', value: cleanupStats.totalImages },
              {
                label: '已完成',
                value: cleanupStats.completedVariants,
                badge: 'theme-status-success',
              },
              { label: '失败数', value: cleanupStats.failedVariants, badge: 'theme-status-error' },
              {
                label: '待处理',
                value: cleanupStats.pendingOrProcessing,
                badge: 'theme-status-warning',
              },
              {
                label: '孤儿目录',
                value: cleanupStats.estimatedOrphanedDirectories,
                badge: 'theme-tag',
              },
            ].map((item) => (
              <div key={item.label} className="bg-surface-alt rounded p-3">
                <span className="text-[11px] text-text-muted">{item.label}</span>
                <p className={`text-lg font-bold ${item.badge ?? 'text-text-primary'}`}>
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {musicCoverStats && (
        <div className="bg-surface border border-border rounded p-5">
          <div className="flex items-center gap-2 mb-4">
            <Music size={16} className="text-brand-gold" />
            <h3 className="text-sm font-semibold text-text-secondary">音乐封面缩略图</h3>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              {
                label: '歌曲缺失',
                value: musicCoverStats.song.missing,
                total: musicCoverStats.song.total,
              },
              {
                label: '专辑缺失',
                value: musicCoverStats.album.missing,
                total: musicCoverStats.album.total,
              },
              {
                label: '总缺失',
                value: musicCoverStats.total.missing,
                total: musicCoverStats.total.total,
              },
            ].map((item) => (
              <div key={item.label} className="bg-surface-alt rounded p-3">
                <span className="text-[11px] text-text-muted">{item.label}</span>
                <p
                  className={clsx(
                    'text-lg font-bold',
                    item.value > 0 ? 'theme-text-warning' : 'theme-text-success'
                  )}
                >
                  {item.value}
                </p>
                <p className="text-[11px] text-text-muted">共 {item.total}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {MUSIC_COVER_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setMusicCoverType(opt.value)}
                disabled={backfillingMusicCovers}
                className={clsx(
                  'px-3 py-1.5 rounded text-xs font-medium transition-all disabled:opacity-50',
                  musicCoverType === opt.value
                    ? 'bg-brand-gold-dark text-white'
                    : 'bg-surface-alt text-text-secondary hover:bg-bg-tertiary hover:text-brand-gold'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <p className="text-xs text-text-muted mb-4">{selectedMusicCoverOption.desc}</p>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleBackfillMusicCoverThumbnails}
              disabled={backfillingMusicCovers || selectedMusicCoverMissingCount === 0}
              className="inline-flex items-center gap-2 px-4 py-2 bg-brand-gold-dark text-white rounded text-sm font-medium hover:bg-brand-gold transition-all disabled:opacity-50"
            >
              {backfillingMusicCovers ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              {backfillingMusicCovers ? '正在补齐...' : '补齐缩略图'}
            </button>
            {backfillingMusicCovers && (
              <button
                onClick={handleStopMusicCoverBackfill}
                className="inline-flex items-center gap-2 px-4 py-2 border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded text-sm transition-all"
              >
                <XCircle size={14} /> 停止
              </button>
            )}
          </div>

          {musicCoverBackfillProgress && (
            <div className="mt-4 p-3 rounded theme-bg-warning-soft border theme-border-warning-soft">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  {musicCoverBackfillProgress.remaining === 0 ? (
                    <CheckCircle size={16} className="theme-text-success" />
                  ) : musicCoverBackfillProgress.stopped ? (
                    <XCircle size={16} className="theme-text-warning" />
                  ) : (
                    <Loader2 size={16} className="animate-spin text-brand-gold" />
                  )}
                  <p className="text-sm font-medium text-text-primary">
                    {musicCoverBackfillProgress.remaining === 0
                      ? '补齐完成'
                      : musicCoverBackfillProgress.stopped
                        ? '已停止'
                        : '补齐中'}
                  </p>
                </div>
                <span className="text-xs text-text-muted">{musicCoverCompletionPercent}%</span>
              </div>

              <div className="h-2 bg-surface-alt rounded overflow-hidden mb-3">
                <div
                  className="h-full bg-brand-gold-dark transition-all"
                  style={{ width: `${musicCoverCompletionPercent}%` }}
                />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <span className="text-text-muted">已处理</span>
                  <p className="font-medium text-text-primary">
                    {musicCoverBackfillProgress.processed}
                  </p>
                </div>
                <div>
                  <span className="text-text-muted">成功</span>
                  <p className="font-medium theme-text-success">
                    {musicCoverBackfillProgress.succeeded}
                  </p>
                </div>
                <div>
                  <span className="text-text-muted">失败</span>
                  <p
                    className={clsx(
                      'font-medium',
                      musicCoverBackfillProgress.failed > 0
                        ? 'theme-text-error'
                        : 'text-text-primary'
                    )}
                  >
                    {musicCoverBackfillProgress.failed}
                  </p>
                </div>
                <div>
                  <span className="text-text-muted">剩余</span>
                  <p className="font-medium text-text-primary">
                    {musicCoverBackfillProgress.remaining}
                  </p>
                </div>
              </div>

              {musicCoverBackfillProgress.errors.length > 0 && (
                <div className="mt-3 space-y-1">
                  {musicCoverBackfillProgress.errors.map((item) => (
                    <p
                      key={`${item.type}-${item.coverId}`}
                      className="text-xs theme-text-error truncate"
                    >
                      {item.type === 'song' ? '歌曲' : '专辑'} {item.resourceId}：{item.message}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="bg-surface border border-border rounded p-5">
        <div className="flex items-center gap-2 mb-4">
          <Zap size={16} className="text-brand-gold" />
          <h3 className="text-sm font-semibold text-text-secondary">批量变体重建</h3>
        </div>
        <p className="text-xs text-text-muted mb-4">为历史图片补全或重新生成 WebP 变体</p>

        <div className="flex flex-wrap gap-2 mb-4">
          {scopeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setRebuildScope(opt.value)}
              className={clsx(
                'px-3 py-1.5 rounded text-xs font-medium transition-all',
                rebuildScope === opt.value
                  ? 'bg-brand-gold-dark text-white'
                  : 'bg-surface-alt text-text-secondary hover:bg-bg-tertiary hover:text-brand-gold'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <p className="text-xs text-text-muted mb-4">
          {scopeOptions.find((o) => o.value === rebuildScope)?.desc}
        </p>

        <button
          onClick={() => handleRebuildVariants(rebuildScope)}
          disabled={rebuilding}
          className="inline-flex items-center gap-2 px-4 py-2 bg-brand-gold-dark text-white rounded text-sm font-medium hover:bg-brand-gold transition-all disabled:opacity-50"
        >
          {rebuilding ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
          {rebuilding ? '正在处理...' : `开始重建`}
        </button>

        {rebuildResult && (
          <div className="mt-4 p-3 rounded theme-status-success">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle size={16} className="theme-text-success" />
              <p className="text-sm font-medium theme-text-success">重建任务已提交</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <span className="text-text-muted">扫描总数</span>
                <p className="font-medium text-text-primary">
                  {rebuildResult.summary?.totalScanned ?? 0}
                </p>
              </div>
              <div>
                <span className="text-text-muted">入队数量</span>
                <p className="font-medium text-text-primary">
                  {rebuildResult.summary?.queuedForRebuild ?? 0}
                </p>
              </div>
              <div>
                <span className="text-text-muted">跳过数量</span>
                <p className="font-medium text-text-primary">
                  {rebuildResult.summary?.skipped ?? 0}
                </p>
              </div>
              <div>
                <span className="text-text-muted">错误数量</span>
                <p
                  className={`font-medium ${(rebuildResult.summary?.errors ?? 0) > 0 ? 'theme-text-error' : 'text-text-primary'}`}
                >
                  {rebuildResult.summary?.errors ?? 0}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-surface border border-border rounded p-5">
        <div className="flex items-center gap-2 mb-4">
          <Trash2 size={16} className="text-text-muted" />
          <h3 className="text-sm font-semibold text-text-secondary">变体清理</h3>
        </div>
        <p className="text-xs text-text-muted mb-4">清理无效或多余的变体文件以释放磁盘空间</p>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleCleanupOrphaned}
            disabled={cleaning}
            className="inline-flex items-center gap-2 px-4 py-2 border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded text-sm transition-all disabled:opacity-50"
          >
            <Trash2 size={14} /> 清理孤儿文件
          </button>
          <button
            onClick={handleCleanupFailed}
            disabled={cleaning}
            className="inline-flex items-center gap-2 px-4 py-2 border border-border theme-status-error text-sm font-medium hover:opacity-90 transition-all disabled:opacity-50"
          >
            <XCircle size={14} /> 清理失败残留
          </button>
          <button
            onClick={handleCleanupAll}
            disabled={cleaning}
            className="inline-flex items-center gap-2 px-4 py-2 bg-brand-gold-dark text-white rounded text-sm font-medium hover:bg-brand-gold transition-all disabled:opacity-50"
          >
            <RotateCcw size={14} /> 全量清理
          </button>
        </div>

        {cleaning && (
          <div className="mt-4 flex items-center gap-2 text-sm text-text-muted">
            <Loader2 size={14} className="animate-spin" />
            <span>正在清理，请稍候...</span>
          </div>
        )}

        {cleanupResult && (
          <div className="mt-4 p-3 rounded theme-bg-warning-soft border theme-border-warning-soft">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle size={16} className="text-brand-gold" />
              <p className="text-sm font-medium text-text-primary">清理完成</p>
              <span className="px-2 py-0.5 theme-tag text-[10px] font-medium rounded">
                {cleanupResult.type}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-text-muted">释放空间</span>
                <p className="font-medium theme-text-success">
                  {formatBytes(cleanupResult.freedSpace)}
                </p>
              </div>
              <div>
                <span className="text-text-muted">删除文件</span>
                <p className="font-medium text-text-primary">{cleanupResult.deletedCount}</p>
              </div>
              <div>
                <span className="text-text-muted">错误数量</span>
                <p
                  className={`font-medium ${cleanupResult.errorsCount > 0 ? 'theme-text-error' : 'text-text-primary'}`}
                >
                  {cleanupResult.errorsCount}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminVariantManager
