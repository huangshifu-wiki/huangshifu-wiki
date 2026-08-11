import React, { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from '@/src/components/icons'
import { useAuth } from '../../context/AuthContext'
import { clsx } from 'clsx'
import { apiGet } from '../../lib/apiClient'
import Pagination from '../../components/Pagination'
import { useRoutedPagination } from '../../hooks/useRoutedPagination'
import { formatDate } from '../../lib/dateUtils'
import type {
  WikiPullRequestItem,
  WikiPullRequestListResponse,
  WikiPullRequestStatus,
} from './types'
import { getPrStatusText } from './types'
import { Button, LoadErrorState, Skeleton, Spinner } from '@/src/components/ui'
import { SmartBackLink } from '../../components/SmartBackLink'

const WikiPullRequestList = () => {
  const { slug } = useParams()
  const { user, isAdmin } = useAuth()
  const [status, setStatus] = useState<WikiPullRequestStatus>('open')
  const [items, setItems] = useState<WikiPullRequestItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [prTotal, setPrTotal] = useState<number | undefined>()
  const pagination = useRoutedPagination({
    totalCount: prTotal,
    defaultPageSize: 50,
    pageSizeOptions: [20, 50, 100],
    pageParam: 'page',
    pageSizeParam: 'pageSize',
    showPageSizeSelector: true,
    enabled: Boolean(user),
  })
  const requestIdRef = useRef(0)
  const previousScopeRef = useRef(`${status}:${slug ?? ''}`)

  const fetchList = async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setLoadError(false)
    try {
      const data = await apiGet<WikiPullRequestListResponse>('/api/wiki/pull-requests/list', {
        status,
        page: pagination.page,
        limit: pagination.pageSize,
        ...(slug ? { pageSlug: slug } : {}),
      })
      if (requestId !== requestIdRef.current) return
      setItems(data.pullRequests || [])
      setPrTotal(data.total || 0)
    } catch (error) {
      if (requestId !== requestIdRef.current) return
      console.error('Fetch wiki PR list error:', error)
      setLoadError(true)
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    const scope = `${status}:${slug ?? ''}`
    if (previousScopeRef.current === scope) return
    previousScopeRef.current = scope
    pagination.setPage(1)
    setPrTotal(undefined)
  }, [status, slug])

  useEffect(() => {
    void fetchList()
  }, [pagination.page, pagination.pageSize, status, slug])

  if (!user) {
    return (
      <div className="mobile-page-shell antique-page">
        <div className="mobile-page-container text-center text-[var(--color-text-antique-muted)] italic">
          请先登录查看 PR 列表。
        </div>
      </div>
    )
  }

  return (
    <div className="mobile-page-shell">
      <div className="mobile-page-container space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SmartBackLink
            fallbackTo={slug ? `/wiki/${slug}/branches` : '/wiki'}
            fallbackLabel="返回"
            icon={<ArrowLeft size={18} />}
            className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-brand-gold transition-colors"
          />
          <div className="flex gap-2">
            {(['open', 'merged', 'rejected'] as const).map((item) => (
              <Button
                type="button"
                size="sm"
                variant={status === item ? 'primary' : 'secondary'}
                key={item}
                onClick={() => setStatus(item)}
                className="font-bold"
                aria-pressed={status === item}
              >
                {getPrStatusText(item)}
              </Button>
            ))}
          </div>
        </div>

        <div className="bg-surface rounded border border-border p-6 sm:p-8">
          <h1 className="text-[1.5rem] font-bold text-text-primary tracking-[0.12em] mb-4">
            PR 列表 {isAdmin ? '(管理员视角)' : '(我的 PR)'}
          </h1>
          {loading && items.length === 0 ? (
            <div className="space-y-3" role="status" aria-label="加载中">
              {[1, 2, 3].map((item) => (
                <Skeleton key={item} className="h-24 w-full" />
              ))}
            </div>
          ) : (
            <div aria-busy={loading}>
              {loading && (
                <div className="mb-3 flex justify-end">
                  <Spinner size="sm" label="PR 列表刷新中" />
                </div>
              )}
              {loadError && <LoadErrorState onRetry={() => void fetchList()} />}
              {loadError && items.length === 0 ? null : items.length ? (
                <div className="space-y-3">
                  {items.map((item) => (
                    <Link
                      key={item.id}
                      to={`/wiki/${item.pageSlug}/prs/${item.id}`}
                      className="block rounded border border-border p-4 transition-all hover:border-brand-gold hover:bg-surface-alt/20"
                    >
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
                        <p className="font-bold text-text-primary">{item.title}</p>
                        <span
                          className={clsx(
                            'rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider',
                            item.status === 'open'
                              ? 'theme-status-warning'
                              : item.status === 'merged'
                                ? 'theme-status-success'
                                : 'theme-status-error'
                          )}
                        >
                          {getPrStatusText(item.status)}
                        </span>
                      </div>
                      <p className="text-xs text-text-muted">
                        页面：{item.page?.title || item.pageSlug} · 发起人：
                        {item.createdByName}
                      </p>
                      <p className="mt-1 text-xs text-text-muted">
                        {formatDate(item.createdAt, 'yyyy-MM-dd HH:mm:ss')}
                      </p>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-text-muted italic">当前筛选下暂无 PR</p>
              )}
            </div>
          )}
        </div>
        {items.length > 0 && pagination.hasMultiplePages ? (
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
    </div>
  )
}

export default WikiPullRequestList
