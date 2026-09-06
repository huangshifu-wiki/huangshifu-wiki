import React, { useCallback, useState } from 'react'
import { ChevronLeft, Megaphone } from '@/src/components/icons'
import { Link, useSearchParams } from 'react-router-dom'
import { apiGet } from '../lib/apiClient'
import { getErrorMessage } from '../lib/errorHandler'
import { useUserPreferences } from '../context/UserPreferencesContext'
import Pagination from '../components/Pagination'
import { IncrementalLoadFooter } from '../components/IncrementalLoadFooter'
import { useIncrementalListLoader } from '../hooks/useIncrementalListLoader'
import { useRoutedPagination } from '../hooks/useRoutedPagination'
import type { AnnouncementsResponse } from '../types/api'
import type { AnnouncementItem } from '../types/entities'
import { LoadErrorState, Spinner } from '@/src/components/ui'

const PAGE_SIZE = 20

const Announcements = () => {
  const { preferences } = useUserPreferences()
  const isIncrementalMode = preferences.listLoadMode === 'incremental'
  const [, setSearchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<unknown | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const [data, setData] = useState<AnnouncementsResponse>({
    announcements: [],
    total: 0,
    page: 1,
    limit: PAGE_SIZE,
    totalPages: 1,
    hasMore: false,
  })
  const pagination = useRoutedPagination({
    totalCount: data.total,
    totalKnown: loaded,
    defaultPageSize: PAGE_SIZE,
    pageSizeParam: null,
    showPageSizeSelector: false,
    enabled: !isIncrementalMode,
  })

  const fetchAnnouncementPage = useCallback(async (page: number) => {
    const response = await apiGet<AnnouncementsResponse>('/api/announcements/list', {
      page,
      limit: PAGE_SIZE,
    })
    return {
      items: response.announcements,
      total: response.total,
      response,
    }
  }, [])

  const incrementalList = useIncrementalListLoader({
    enabled: isIncrementalMode,
    pageSize: PAGE_SIZE,
    resetKey: 'announcements',
    fetchPage: async (page) => {
      const result = await fetchAnnouncementPage(page)
      setData((prev) => ({
        ...prev,
        total: result.response.total,
        page: result.response.page,
        limit: result.response.limit,
      }))
      setLoaded(true)
      return result
    },
    getItemKey: (announcement) => announcement.id,
    preserveItemsOnReset: true,
  })
  const visibleAnnouncements = isIncrementalMode ? incrementalList.items : data.announcements

  React.useEffect(() => {
    if (!isIncrementalMode) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('page')
        return next
      },
      { replace: true }
    )
  }, [isIncrementalMode, setSearchParams])

  const fetchData = React.useCallback(async () => {
    if (isIncrementalMode) return
    setLoading(true)
    setLoadError(null)
    try {
      const result = await fetchAnnouncementPage(pagination.page)
      setData(result.response)
      setLoaded(true)
    } catch (error) {
      console.error('Fetch announcements error:', error)
      setLoadError(error)
    } finally {
      setLoading(false)
    }
  }, [fetchAnnouncementPage, isIncrementalMode, pagination.page, retryNonce])

  const currentLoadError = isIncrementalMode ? incrementalList.initialError : loadError
  const isInitialLoading = isIncrementalMode
    ? incrementalList.isInitialLoading && visibleAnnouncements.length === 0
    : loading && visibleAnnouncements.length === 0
  const handleRetry = () => {
    if (isIncrementalMode) {
      incrementalList.retry()
      return
    }
    setRetryNonce((value) => value + 1)
  }

  React.useEffect(() => {
    fetchData()
  }, [fetchData])

  return (
    <div className="mobile-page-shell">
      <div className="mobile-page-container max-w-[900px]">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-brand-gold transition-colors mb-6"
        >
          <ChevronLeft size={16} />
          返回首页
        </Link>

        <div className="mobile-page-titlebar mb-6">
          <div>
            <h1 className="mobile-page-title flex items-center gap-2">
              <Megaphone size={22} className="text-brand-gold" />
              公告
            </h1>
            <p className="text-sm text-text-muted mt-1">
              共 {isIncrementalMode ? incrementalList.total : data.total} 条
            </p>
          </div>
        </div>

        <div
          className="bg-surface border border-border rounded overflow-hidden min-h-[360px]"
          aria-busy={
            (loading || incrementalList.isInitialLoading) && visibleAnnouncements.length > 0
          }
        >
          {currentLoadError && visibleAnnouncements.length > 0 ? (
            <LoadErrorState
              className="py-5"
              error={currentLoadError}
              description="当前公告可能不是最新内容。"
              onRetry={handleRetry}
            />
          ) : null}
          {currentLoadError && visibleAnnouncements.length === 0 ? (
            <LoadErrorState error={currentLoadError} onRetry={handleRetry} />
          ) : isInitialLoading ? (
            <div className="flex items-center justify-center py-20">
              <Spinner size="lg" label="公告加载中" />
            </div>
          ) : visibleAnnouncements.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-text-muted">
              <Megaphone size={36} className="mb-3 opacity-50" />
              <p>暂无公告</p>
            </div>
          ) : (
            <ul>
              {visibleAnnouncements.map((announcement: AnnouncementItem) => (
                <li key={announcement.id} className="border-b border-border px-4 py-4 sm:px-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-primary break-words">
                        {announcement.content}
                      </p>
                      <p className="text-xs text-text-muted mt-1">
                        {new Date(announcement.createdAt).toLocaleString('zh-CN')}
                      </p>
                    </div>
                    {announcement.link && (
                      <a
                        href={announcement.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-xs font-bold text-brand-gold hover:underline"
                      >
                        立即查看
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {isIncrementalMode ? (
          <IncrementalLoadFooter
            hasMore={incrementalList.hasMore}
            loading={incrementalList.loadingMore}
            total={incrementalList.total}
            pageSize={PAGE_SIZE}
            loaded={visibleAnnouncements.length}
            onLoadMore={incrementalList.loadMore}
            sentinelRef={incrementalList.sentinelRef}
            error={
              incrementalList.error && !incrementalList.initialError
                ? getErrorMessage(incrementalList.error, '加载失败，请重试')
                : undefined
            }
            onRetry={incrementalList.retry}
          />
        ) : pagination.hasMultiplePages ? (
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            onPageChange={pagination.handlePageChange}
            showPageSizeSelector={false}
          />
        ) : null}
      </div>
    </div>
  )
}

export default Announcements
