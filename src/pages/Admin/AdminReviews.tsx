import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { clsx } from 'clsx'
import { formatDateTime } from '../../lib/dateUtils'
import {
  fetchReviewQueuePage,
  invalidateReviewQueueCaches,
  normalizeReviewFilter,
  REVIEW_FILTER_OPTIONS,
} from './reviewQueue'
import type { AdminReviewQueueMergedItem } from '../../types/api'
import Pagination from '../../components/Pagination'
import { useRoutedPagination } from '../../hooks/useRoutedPagination'
import { Button, LoadErrorState } from '@/src/components/ui'
import { PageSkeleton } from '@/src/components/PageSkeleton'

export const AdminReviews = () => {
  const [items, setItems] = useState<AdminReviewQueueMergedItem[]>([])
  const [total, setTotal] = useState<number | undefined>()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const filter = normalizeReviewFilter(searchParams.get('type'))
  const pagination = useRoutedPagination({
    totalCount: total,
    defaultPageSize: 20,
    pageSizeOptions: [20, 50, 100],
    pageParam: 'page',
    pageSizeParam: 'pageSize',
    showPageSizeSelector: true,
  })
  const loadRequestRef = useRef(0)
  const filterRef = useRef(filter)

  const fetchQueue = async () => {
    const requestId = loadRequestRef.current + 1
    loadRequestRef.current = requestId
    setLoading(true)
    setLoadError(null)
    try {
      const result = await fetchReviewQueuePage(filter, pagination.page, pagination.pageSize)
      if (requestId !== loadRequestRef.current) return
      setItems(result.items)
      setTotal(result.total)
      setLoadError(null)
    } catch (e) {
      console.error(e)
      if (requestId === loadRequestRef.current) setLoadError(e)
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    if (filterRef.current === filter) return
    filterRef.current = filter
    pagination.setPage(1)
    setTotal(undefined)
  }, [filter])

  useEffect(() => {
    void fetchQueue()
  }, [filter, pagination.page, pagination.pageSize])

  const handleRefreshQueue = () => {
    invalidateReviewQueueCaches()
    void fetchQueue()
  }

  const handleStartReview = () => {
    if (loading || items.length === 0) return
    navigate(`/admin/reviews/workbench?type=${filter}`)
  }

  if (loading && items.length === 0) {
    return <PageSkeleton variant="admin" />
  }
  if (loadError && items.length === 0) {
    return <LoadErrorState onRetry={() => void fetchQueue()} />
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-text-primary tracking-[0.12em]">审核队列</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={handleRefreshQueue}>
            刷新队列
          </Button>
          <Button
            type="button"
            onClick={handleStartReview}
            disabled={loading || items.length === 0}
          >
            开始审核
          </Button>
        </div>
      </div>
      {loadError && items.length > 0 && (
        <LoadErrorState
          className="py-5"
          description="审核队列可能不是最新内容。"
          onRetry={() => void fetchQueue()}
        />
      )}

      <div className="bg-surface border border-border rounded p-4 flex flex-wrap items-center gap-3">
        {REVIEW_FILTER_OPTIONS.map((item) => (
          <Button
            type="button"
            size="sm"
            variant={filter === item.id ? 'primary' : 'secondary'}
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
            aria-pressed={filter === item.id}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {items.length > 0 ? (
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
                          : item.reviewType === 'gallery'
                            ? 'theme-status-success'
                            : 'bg-bg-tertiary text-text-secondary'
                      )}
                    >
                      {item.reviewType === 'wiki'
                        ? '百科'
                        : item.reviewType === 'gallery'
                          ? '图集'
                          : '帖子'}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-medium rounded theme-status-warning">
                      待审核
                    </span>
                  </div>
                  <p className="font-semibold text-text-primary mb-1">
                    {item.title || item.slug || item.id}
                  </p>
                  <p className="text-xs text-text-muted line-clamp-2">
                    {String(
                      item.reviewType === 'gallery' ? item.description || '' : item.content || ''
                    )
                      .replace(/[#*`]/g, '')
                      .slice(0, 160) || '无内容摘要'}
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
      {pagination.hasMultiplePages ? (
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          onPageChange={pagination.handlePageChange}
          pageSize={pagination.pageSize}
          onPageSizeChange={pagination.handlePageSizeChange}
          pageSizeOptions={[20, 50, 100]}
          showPageSizeSelector
        />
      ) : null}
    </div>
  )
}

export default AdminReviews
