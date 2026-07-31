import React, { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, Loader2, CheckCircle, XCircle, Music } from '@/src/components/icons'
import { apiGet, apiPost } from '../../lib/apiClient'
import { useDialog } from '../../components/Dialog'
import { Button } from '@/src/components/ui'
import { clsx } from 'clsx'

type BackfillType = 'all' | 'song' | 'album'

interface CoverThumbnailStats {
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

interface BackfillError {
  type: 'song' | 'album'
  coverId: string
  resourceId: string
  message: string
}

interface BackfillResponse {
  success: boolean
  data: {
    type: BackfillType
    batchSize: number
    processed: number
    succeeded: number
    failed: number
    remaining: number
    errors: BackfillError[]
  }
  error?: string
}

interface BackfillProgress {
  target: number
  processed: number
  succeeded: number
  failed: number
  remaining: number
  stopped: boolean
  errors: BackfillError[]
}

const NO_CACHE_OPTIONS = { staleTime: 0, swr: false }
const BATCH_SIZE = 50
const MAX_ERRORS = 5

const TYPE_OPTIONS: Array<{ value: BackfillType; label: string; desc: string }> = [
  { value: 'all', label: '全部', desc: '歌曲和专辑封面' },
  { value: 'song', label: '仅歌曲', desc: '只处理歌曲封面' },
  { value: 'album', label: '仅专辑', desc: '只处理专辑封面' },
]

const createProgress = (target: number): BackfillProgress => ({
  target,
  processed: 0,
  succeeded: 0,
  failed: 0,
  remaining: target,
  stopped: false,
  errors: [],
})

export const AdminMusicCoverThumbnails: React.FC = () => {
  const [stats, setStats] = useState<CoverThumbnailStats | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState<BackfillType>('all')
  const [backfilling, setBackfilling] = useState(false)
  const [progress, setProgress] = useState<BackfillProgress | null>(null)
  const stopRef = useRef(false)
  const dialog = useDialog()

  const selectedOption = TYPE_OPTIONS.find((option) => option.value === type) ?? TYPE_OPTIONS[0]
  const missingCount = stats ? stats[type === 'all' ? 'total' : type].missing : 0

  const completionPercent =
    progress && progress.target > 0
      ? Math.min(100, Math.round(((progress.succeeded + progress.failed) / progress.target) * 100))
      : 0

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true)
      const data = await apiGet<{ success: boolean; data: CoverThumbnailStats }>(
        '/api/admin/music-cover-thumbnails/stats',
        undefined,
        NO_CACHE_OPTIONS
      )
      setStats(data.data)
      setStatsError(null)
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : '获取统计失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  const handleBackfill = async () => {
    if (missingCount === 0) {
      setProgress(null)
      return
    }

    const confirmed = await dialog.confirm({
      title: '补齐音乐封面缩略图',
      message: `确定要补齐当前范围内的 ${missingCount} 张音乐封面缩略图吗？`,
      confirmText: '补齐',
      variant: 'warning',
    })
    if (!confirmed) return

    stopRef.current = false
    setBackfilling(true)
    const initialProgress = createProgress(missingCount)
    setProgress(initialProgress)

    let nextProgress = initialProgress

    try {
      while (!stopRef.current && nextProgress.remaining > 0) {
        const result = await apiPost<BackfillResponse>(
          '/api/admin/music-cover-thumbnails/backfill',
          {
            type,
            batchSize: BATCH_SIZE,
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
          stopped: stopRef.current,
          errors: [...result.data.errors, ...nextProgress.errors].slice(0, MAX_ERRORS),
        }
        setProgress(nextProgress)

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

      if (stopRef.current) {
        setProgress((prev) => (prev ? { ...prev, stopped: true } : prev))
      }
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : '补齐音乐封面缩略图失败')
      setProgress((prev) => (prev ? { ...prev, stopped: true } : prev))
    } finally {
      await fetchStats()
      setBackfilling(false)
    }
  }

  const handleStop = () => {
    stopRef.current = true
    setProgress((prev) => (prev ? { ...prev, stopped: true } : prev))
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Music size={24} className="text-brand-gold" />
          <h1 className="text-2xl font-bold text-text-primary tracking-[0.12em]">音乐封面缩略图</h1>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => fetchStats()}
          disabled={loading}
          leftIcon={
            loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />
          }
        >
          刷新
        </Button>
      </div>

      {statsError && (
        <div className="flex items-start gap-3 rounded p-3 theme-status-error">
          <XCircle size={18} className="theme-text-error mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm theme-text-error">{statsError}</p>
            <p className="mt-1 text-xs text-text-muted">
              统计接口不可用时无法补齐缩略图。若是全新部署，请先确保数据库迁移已执行（ npx prisma
              migrate deploy ），再重试。
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => fetchStats()}>
            重试
          </Button>
        </div>
      )}

      {stats && (
        <div className="rounded border border-border bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            <Music size={16} className="text-brand-gold" />
            <h3 className="text-sm font-semibold text-text-secondary">缺失统计</h3>
          </div>

          <div className="mb-4 grid grid-cols-3 gap-3">
            {[
              { label: '歌曲缺失', value: stats.song.missing, total: stats.song.total },
              { label: '专辑缺失', value: stats.album.missing, total: stats.album.total },
              { label: '总缺失', value: stats.total.missing, total: stats.total.total },
            ].map((item) => (
              <div key={item.label} className="rounded bg-surface-alt p-3">
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

          <div className="mb-4 flex flex-wrap gap-2">
            {TYPE_OPTIONS.map((option) => (
              <Button
                key={option.value}
                size="sm"
                soft
                variant={type === option.value ? 'primary' : 'secondary'}
                onClick={() => setType(option.value)}
                disabled={backfilling}
              >
                {option.label}
              </Button>
            ))}
          </div>

          <p className="mb-4 text-xs text-text-muted">{selectedOption.desc}</p>

          <div className="flex flex-wrap gap-3">
            <Button
              onClick={handleBackfill}
              disabled={backfilling || missingCount === 0}
              loading={backfilling}
              loadingText="正在补齐..."
              leftIcon={backfilling ? undefined : <RefreshCw size={14} />}
            >
              补齐缩略图
            </Button>
            {backfilling && (
              <Button variant="secondary" onClick={handleStop}>
                停止
              </Button>
            )}
          </div>

          {progress && (
            <div className="mt-4 rounded border border-theme-warning-soft bg-theme-bg-warning-soft p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {progress.remaining === 0 ? (
                    <CheckCircle size={16} className="theme-text-success" />
                  ) : progress.stopped ? (
                    <XCircle size={16} className="theme-text-warning" />
                  ) : (
                    <Loader2 size={16} className="animate-spin text-brand-gold" />
                  )}
                  <p className="text-sm font-medium text-text-primary">
                    {progress.remaining === 0 ? '补齐完成' : progress.stopped ? '已停止' : '补齐中'}
                  </p>
                </div>
                <span className="text-xs text-text-muted">{completionPercent}%</span>
              </div>

              <div className="mb-3 h-2 overflow-hidden rounded bg-surface-alt">
                <div
                  className="h-full bg-brand-gold-dark transition-all"
                  style={{ width: `${completionPercent}%` }}
                />
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <div>
                  <span className="text-text-muted">已处理</span>
                  <p className="font-medium text-text-primary">{progress.processed}</p>
                </div>
                <div>
                  <span className="text-text-muted">成功</span>
                  <p className="font-medium theme-text-success">{progress.succeeded}</p>
                </div>
                <div>
                  <span className="text-text-muted">失败</span>
                  <p
                    className={clsx(
                      'font-medium',
                      progress.failed > 0 ? 'theme-text-error' : 'text-text-primary'
                    )}
                  >
                    {progress.failed}
                  </p>
                </div>
                <div>
                  <span className="text-text-muted">剩余</span>
                  <p className="font-medium text-text-primary">{progress.remaining}</p>
                </div>
              </div>

              {progress.errors.length > 0 && (
                <div className="mt-3 space-y-1">
                  {progress.errors.map((item) => (
                    <p
                      key={`${item.type}-${item.coverId}`}
                      className="truncate text-xs theme-text-error"
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
    </div>
  )
}

export default AdminMusicCoverThumbnails
