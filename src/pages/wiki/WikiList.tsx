import React, { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Book, Plus } from '@/src/components/icons'
import { useAuth } from '../../context/AuthContext'
import { useUserPreferences } from '../../context/UserPreferencesContext'
import { ViewModeSelector } from '../../components/ViewModeSelector'
import { VIEW_MODE_CONFIG } from '../../lib/viewModes'
import { clsx } from 'clsx'
import { useToast } from '../../components/Toast'
import { copyToClipboard, toAbsoluteInternalUrl } from '../../lib/copyLink'
import { apiGet } from '../../lib/apiClient'
import WikiCard from '../../components/wiki/WikiCard'
import Pagination from '../../components/Pagination'
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
  const { user, isBanned } = useAuth()
  const { show } = useToast()
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
  })
  const visiblePages = isIncrementalMode ? incrementalList.items : pages
  const visibleTotal = isIncrementalMode ? incrementalList.total : total || 0
  const isInitialLoading = isIncrementalMode ? incrementalList.loadingInitial : loading

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
      try {
        const data = await fetchWikiPage(pagination.page)
        if (cancelled) return
        setPages(data.items)
        setTotal(data.total)
      } catch (e) {
        if (cancelled) return
        console.error('Error fetching wiki pages:', e)
      }
      if (!cancelled) setLoading(false)
    }
    fetchPages()
    return () => {
      cancelled = true
    }
  }, [fetchWikiPage, isIncrementalMode, pagination.page])

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

  const handleCopyWikiLink = async (event: React.MouseEvent<HTMLButtonElement>, slug: string) => {
    event.preventDefault()
    event.stopPropagation()
    const copied = await copyToClipboard(toAbsoluteInternalUrl(`/wiki/${slug}`))
    if (copied) {
      show('百科内链已复制')
      return
    }
    show('复制链接失败，请稍后重试', { variant: 'error' })
  }

  return (
    <div className="mobile-page-shell antique-page">
      <div className="mobile-page-container">
        <div className="mobile-page-titlebar mb-6">
          <h1 className="mobile-page-title">百科</h1>
          <div className="mobile-action-row">
            {user && !isBanned && (
              <Link
                to={'/wiki/new'}
                className="px-5 py-2 theme-button-primary text-sm rounded transition-all flex items-center gap-2"
              >
                <Plus size={15} /> 创建页面
              </Link>
            )}
          </div>
        </div>

        <div className="mobile-filterbar">
          <div className="mobile-filter-tabs">
            {['all', ...categories.map((item) => item.id)].map((cat) => (
              <Link
                key={cat}
                to={getCategoryUrl(cat)}
                className={clsx(
                  'text-[1.125rem] pb-2 relative tracking-[0.05em] transition-all cursor-pointer',
                  category === cat
                    ? "text-brand-gold font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[var(--color-theme-accent)] after:rounded-[1px]"
                    : 'text-text-muted hover:text-brand-gold'
                )}
              >
                {cat === 'all' ? '全部' : getCategoryLabel(cat)}
              </Link>
            ))}
          </div>

          <div className="mobile-filter-actions">
            <ViewModeSelector
              value={viewMode}
              onChange={(mode) => void setScopedViewMode('wiki', mode)}
              size="sm"
            />
            <span className="text-text-muted">{visibleTotal} 个页面</span>
          </div>
        </div>

        {isInitialLoading ? (
          <div
            className={clsx(
              'mobile-grid grid',
              VIEW_MODE_CONFIG[viewMode].gridCols,
              VIEW_MODE_CONFIG[viewMode].gap
            )}
          >
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className={clsx(
                  viewMode === 'list' ? 'h-24' : VIEW_MODE_CONFIG[viewMode].cardHeight,
                  'bg-surface rounded animate-pulse border border-border'
                )}
              ></div>
            ))}
          </div>
        ) : visiblePages.length > 0 ? (
          <>
            <div
              className={clsx(
                'mobile-grid grid',
                VIEW_MODE_CONFIG[viewMode].gridCols,
                VIEW_MODE_CONFIG[viewMode].gap
              )}
            >
              {visiblePages.map((page) => (
                <WikiCard
                  key={page.id}
                  page={page}
                  viewMode={viewMode}
                  cardHeight={VIEW_MODE_CONFIG[viewMode].cardHeight}
                  categoryLabel={getCategoryLabel(page.category)}
                  onCopyLink={handleCopyWikiLink}
                />
              ))}
            </div>
            {isIncrementalMode ? (
              <IncrementalLoadFooter
                hasMore={incrementalList.hasMore}
                loading={incrementalList.loadingMore}
                total={visibleTotal}
                loaded={visiblePages.length}
                onLoadMore={incrementalList.loadMore}
                sentinelRef={incrementalList.sentinelRef}
              />
            ) : import.meta.env.DEV || pagination.totalPages > 1 ? (
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
          <div className="bg-surface p-20 rounded border border-border text-center">
            <Book size={48} className="mx-auto text-border-light mb-6" />
            <p className="text-text-muted italic">暂无相关百科页面</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default WikiList
