import React, { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Book, Plus } from '@/src/components/icons'
import { useAuth } from '../../context/AuthContext'
import { useUserPreferences } from '../../context/UserPreferencesContext'
import { VIEW_MODE_CONFIG } from '../../lib/viewModes'
import { clsx } from 'clsx'
import { apiGet } from '../../lib/apiClient'
import WikiCard from '../../components/wiki/WikiCard'
import { WikiFilters } from '../../components/wiki/WikiFilters'
import Pagination from '../../components/Pagination'
import { LoadErrorState, Spinner } from '@/src/components/ui'
import { PageSkeleton } from '../../components/PageSkeleton'
import { IncrementalLoadFooter } from '../../components/IncrementalLoadFooter'
import type { WikiItem } from './types'
import { DEFAULT_PAGE_SIZE } from './types'
import { useIncrementalListLoader } from '../../hooks/useIncrementalListLoader'
import { useRoutedPagination } from '../../hooks/useRoutedPagination'
import { useWikiCategories } from '../../hooks/useWikiCategories'

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

const WikiList = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const category = searchParams.get('category') || 'all'
  const tag = searchParams.get('tag')
  const [pages, setPages] = useState<WikiItem[]>([])
  const [total, setTotal] = useState<number>()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const { user, isBanned } = useAuth()
  const { preferences, getScopedViewMode, setScopedViewMode } = useUserPreferences()
  const viewMode = getScopedViewMode('wiki')
  const isIncrementalMode = preferences.listLoadMode === 'incremental'
  const { categories, getCategoryLabel } = useWikiCategories()

  const pagination = useRoutedPagination({
    totalCount: total,
    defaultPageSize: DEFAULT_PAGE_SIZE,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    enabled: !isIncrementalMode,
  })
  const pageSize = isIncrementalMode ? DEFAULT_PAGE_SIZE : pagination.pageSize
  const fetchWikiPage = useCallback(
    async (page: number, signal?: AbortSignal) => {
      const data = await apiGet<{ pages: WikiItem[]; total: number }>(
        '/api/wiki',
        {
          category: category !== 'all' ? category : undefined,
          tag: tag || undefined,
          page,
          pageSize,
        },
        undefined,
        signal
      )

      return {
        items: data.pages || [],
        total: data.total || 0,
      }
    },
    [category, pageSize, tag]
  )
  const incrementalList = useIncrementalListLoader({
    enabled: isIncrementalMode,
    pageSize,
    resetKey: `${category}:${tag || ''}`,
    fetchPage: fetchWikiPage,
    getItemKey: (page) => page.id,
    preserveItemsOnReset: true,
  })
  const visiblePages = isIncrementalMode ? incrementalList.items : pages
  const visibleTotal = isIncrementalMode ? incrementalList.total : total || 0
  const isInitialLoading = isIncrementalMode
    ? incrementalList.isInitialLoading && visiblePages.length === 0
    : loading && visiblePages.length === 0

  useEffect(() => {
    if (!isIncrementalMode) return
    setSearchParams(
      (prev) => {
        if (!prev.has('page') && !prev.has('pageSize')) return prev
        const next = new URLSearchParams(prev)
        next.delete('page')
        next.delete('pageSize')
        return next
      },
      { replace: true }
    )
  }, [isIncrementalMode, setSearchParams])

  useEffect(() => {
    if (isIncrementalMode) return
    let cancelled = false
    const fetchPages = async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const data = await fetchWikiPage(pagination.page)
        if (cancelled) return
        setPages(data.items)
        setTotal(data.total)
      } catch (error) {
        if (cancelled) return
        console.error('Error fetching wiki pages:', error)
        setLoadError(error)
      }
      if (!cancelled) setLoading(false)
    }
    fetchPages()
    return () => {
      cancelled = true
    }
  }, [fetchWikiPage, isIncrementalMode, pagination.page, retryNonce])

  const currentLoadError = isIncrementalMode ? incrementalList.initialError : loadError
  const handleRetry = () => {
    if (isIncrementalMode) {
      incrementalList.retry()
      return
    }
    setRetryNonce((value) => value + 1)
  }
  const isRefreshing = isIncrementalMode
    ? incrementalList.isInitialLoading && visiblePages.length > 0
    : loading && visiblePages.length > 0

  const getCategoryUrl = (nextCategory: string) => {
    const params = new URLSearchParams(searchParams)
    params.delete('page')
    if (nextCategory === 'all') {
      params.delete('category')
    } else {
      params.set('category', nextCategory)
    }
    const query = params.toString()
    return query ? `/wiki?${query}` : '/wiki'
  }

  if (isInitialLoading && visiblePages.length === 0) {
    return <PageSkeleton variant="wiki" />
  }

  return (
    <div className="gufeng-wiki-page mobile-page-shell">
      <div className="mobile-page-container" aria-busy={isRefreshing || undefined}>
        <header className="mobile-page-header">
          <div className="mobile-page-titlebar">
            <div className="min-w-0">
              <h1 className="mobile-page-title">百科</h1>
              <div className="mt-3 flex">
                <div className="h-px w-16 bg-gradient-to-r from-brand-gold/40 to-transparent" />
              </div>
            </div>
            <div className="mobile-action-row">
              {isRefreshing && <Spinner size="sm" label="百科刷新中" />}
              {user && !isBanned && (
                <Link
                  to="/wiki/new"
                  data-pressable
                  className="flex items-center gap-2 rounded px-5 py-2 text-sm theme-button-primary transition-all"
                >
                  <Plus size={15} aria-hidden="true" /> 创建页面
                </Link>
              )}
            </div>
          </div>
        </header>

        <WikiFilters
          categories={categories}
          activeCategory={category}
          total={visibleTotal}
          viewMode={viewMode}
          getCategoryUrl={getCategoryUrl}
          getCategoryLabel={getCategoryLabel}
          onViewModeChange={(mode) => void setScopedViewMode('wiki', mode)}
        />
        {currentLoadError && visiblePages.length > 0 && (
          <LoadErrorState
            className="py-5"
            description="当前内容可能不是最新内容。"
            onRetry={handleRetry}
          />
        )}
        {currentLoadError && visiblePages.length === 0 ? (
          <LoadErrorState onRetry={handleRetry} />
        ) : visiblePages.length > 0 ? (
          <>
            <div
              className={clsx(
                viewMode === 'list'
                  ? 'flex flex-col gap-0.5'
                  : clsx(
                      'mobile-grid grid',
                      'items-start',
                      viewMode === 'large' && 'wiki-large-grid',
                      VIEW_MODE_CONFIG[viewMode].gridCols,
                      VIEW_MODE_CONFIG[viewMode].gap
                    )
              )}
            >
              {visiblePages.map((page) => (
                <WikiCard
                  key={page.id}
                  page={page}
                  viewMode={viewMode}
                  categoryLabel={getCategoryLabel(page.category)}
                />
              ))}
            </div>
            {isIncrementalMode ? (
              <IncrementalLoadFooter
                hasMore={incrementalList.hasMore}
                loading={incrementalList.loadingMore}
                total={visibleTotal}
                pageSize={pageSize}
                loaded={visiblePages.length}
                onLoadMore={incrementalList.loadMore}
                sentinelRef={incrementalList.sentinelRef}
                error={
                  incrementalList.error && !incrementalList.initialError ? '加载失败' : undefined
                }
                onRetry={incrementalList.retry}
              />
            ) : pagination.hasMultiplePages ? (
              <Pagination
                page={pagination.page}
                totalPages={pagination.totalPages}
                onPageChange={pagination.handlePageChange}
                pageSize={pagination.pageSize}
                onPageSizeChange={pagination.handlePageSizeChange}
                pageSizeOptions={PAGE_SIZE_OPTIONS}
                showPageSizeSelector
              />
            ) : null}
          </>
        ) : (
          <div className="border-y border-[var(--book-ink-line)] py-20 text-center">
            <Book size={48} className="mx-auto mb-6 text-border" />
            <p className="text-[0.9375rem] tracking-[0.08em] text-text-muted">暂无相关百科页面</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default WikiList
