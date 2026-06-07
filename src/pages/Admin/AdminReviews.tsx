import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { clsx } from 'clsx'
import { formatDateTime } from '../../lib/dateUtils'
import {
  fetchReviewQueue,
  invalidateReviewQueueCaches,
  normalizeReviewFilter,
  REVIEW_FILTER_OPTIONS,
} from './reviewQueue'
import type { AdminReviewQueueMergedItem } from '../../types/api'

export const AdminReviews = () => {
  const [items, setItems] = useState<AdminReviewQueueMergedItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const filter = normalizeReviewFilter(searchParams.get('type'))
  const loadRequestRef = useRef(0)

  const fetchQueue = async () => {
    const requestId = loadRequestRef.current + 1
    loadRequestRef.current = requestId
    setLoading(true)
    try {
      const nextItems = await fetchReviewQueue(filter)
      if (requestId !== loadRequestRef.current) return
      setItems(nextItems)
    } catch (e) {
      console.error(e)
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    void fetchQueue()
  }, [filter])

  const handleRefreshQueue = () => {
    invalidateReviewQueueCaches()
    void fetchQueue()
  }

  const handleStartReview = () => {
    if (loading || items.length === 0) return
    navigate(`/admin/reviews/workbench?type=${filter}`)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-text-primary tracking-[0.12em]">审核队列</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleRefreshQueue}
            className="px-4 py-2 border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded text-sm transition-all"
          >
            刷新队列
          </button>
          <button
            onClick={handleStartReview}
            disabled={loading || items.length === 0}
            className="px-4 py-2 rounded text-sm theme-button-primary transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            开始审核
          </button>
        </div>
      </div>

      <div className="bg-surface border border-border rounded p-4 flex flex-wrap items-center gap-3">
        {REVIEW_FILTER_OPTIONS.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev)
                if (item.id === 'all') {
                  next.delete('type')
                } else {
                  next.set('type', item.id)
                }
                return next
              })
            }}
            className={clsx(
              'px-4 py-2 rounded text-xs font-medium transition-all',
              filter === item.id
                ? 'bg-brand-gold-dark text-white'
                : 'bg-surface-alt text-text-secondary hover:bg-bg-tertiary'
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 bg-surface border border-border rounded animate-pulse" />
          ))}
        </div>
      ) : items.length > 0 ? (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={`${item.reviewType}-${item.reviewId}`}
              className="bg-surface border border-border rounded p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={clsx(
                        'px-2 py-0.5 text-[10px] font-medium rounded',
                        item.reviewType === 'wiki'
                          ? 'bg-surface-alt text-brand-gold'
                          : 'bg-bg-tertiary text-text-secondary'
                      )}
                    >
                      {item.reviewType === 'wiki' ? '百科' : '帖子'}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-medium rounded theme-status-warning">
                      待审核
                    </span>
                  </div>
                  <p className="font-semibold text-text-primary mb-1">
                    {item.title || item.slug || item.id}
                  </p>
                  <p className="text-xs text-text-muted line-clamp-2">
                    {(String(item.content || '')).replace(/[#*`]/g, '').slice(0, 160) ||
                      '无内容摘要'}
                  </p>
                  <p className="text-[10px] text-text-muted mt-2">
                    更新时间：{formatDateTime(item.updatedAt, 'N/A')}
                  </p>
                  {Array.isArray(item.sensitiveWords) && item.sensitiveWords.length > 0 && (
                    <div className="mt-2 p-2 theme-status-error rounded">
                      <span className="text-[10px] font-medium theme-text-error">
                        检测到敏感词:{' '}
                      </span>
                      {item.sensitiveWords.map((w) => (
                        <span key={w} className="text-[10px] theme-text-error mr-1">
                          #{w}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-surface border border-border rounded py-16 text-center text-text-muted italic">
          当前没有待审核内容
        </div>
      )}
    </div>
  )
}

export default AdminReviews
