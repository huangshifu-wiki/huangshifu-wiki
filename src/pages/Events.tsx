import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { clsx } from 'clsx'
import { EventCard } from '../components/Events/EventCard'
import { EventFilters, type EventSortOrder } from '../components/Events/EventFilters'
import { useUserPreferences } from '../context/UserPreferencesContext'
import Pagination from '../components/Pagination'
import { ListPageContentState, ListPageLoadingBoundary } from '../components/ListPageState'
import { Spinner } from '@/src/components/ui'
import { useRoutedPagination } from '../hooks/useRoutedPagination'
import { useTagFilter } from '../hooks/useTagFilter'
import { useTagSuggestions } from '../hooks/useTagSuggestions'
import { TagFilterPanel } from '../components/TagFilterPanel'
import { MobileTagFilters } from '../components/MobileTagFilters'
import { apiGet } from '../lib/apiClient'
import { VIEW_MODE_CONFIG } from '../lib/viewModes'
import type { EventListResponse } from '../types/api'
import type { EventItem } from '../types/entities'
import { getListLoadState } from '../lib/listLoadState'
import type { ViewMode } from '../types/userPreferences'

const DEFAULT_PAGE_SIZE = 12

const Events = () => {
  const [, setSearchParams] = useSearchParams()
  const tagFilter = useTagFilter({ tagParam: 'tag', modeParam: 'tagMode', pageParams: ['page'] })
  const { filter } = tagFilter
  const [sortOrder, setSortOrder] = useState<EventSortOrder>('desc')
  const [events, setEvents] = useState<EventItem[]>([])
  const tags = useTagSuggestions('event')
  const [totalPagesState, setTotalPages] = useState<{ scope: string; total: number }>()
  const scope = JSON.stringify([filter])
  const totalPages = totalPagesState?.scope === scope ? totalPagesState.total : undefined
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const { getScopedViewMode, setScopedViewMode } = useUserPreferences()
  const storedViewMode = getScopedViewMode('events')
  const viewMode: ViewMode = storedViewMode === 'large' ? 'large' : 'list'
  const {
    page,
    totalPages: resolvedTotalPages,
    handlePageChange,
    hasMultiplePages,
  } = useRoutedPagination({
    serverTotalPages: totalPages,
    defaultPageSize: DEFAULT_PAGE_SIZE,
    pageSizeParam: null,
    showPageSizeSelector: false,
  })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    apiGet<EventListResponse>('/api/events', {
      page,
      limit: DEFAULT_PAGE_SIZE,
      sortOrder,
      tag: filter.tags,
      tagMode: filter.mode,
    })
      .then((data) => {
        if (cancelled) return
        setEvents(data.events || [])
        setTotalPages({ scope, total: data.totalPages || 1 })
      })
      .catch((error) => {
        if (cancelled) return
        console.error('Fetch events failed:', error)
        setLoadError(error)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [page, retryNonce, filter, sortOrder, scope])

  const handleSortOrderChange = (value: EventSortOrder) => {
    if (value === sortOrder) return
    setSortOrder(value)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('page')
        return next
      },
      { replace: true }
    )
  }

  const tagPanelProps = {
    tags,
    value: filter,
    onToggleTag: tagFilter.toggleTag,
    onModeChange: tagFilter.setMode,
    onClear: tagFilter.clear,
  }
  const eventsState = getListLoadState({
    items: events,
    loading,
    error: loadError,
    retry: () => setRetryNonce((value) => value + 1),
    incremental: null,
  })

  return (
    <ListPageLoadingBoundary variant="events" isInitialLoading={eventsState.isInitialLoading}>
      <div className="gufeng-events-page mobile-page-shell">
        <div className="mobile-page-container" aria-busy={eventsState.isRefreshing || undefined}>
          <header className="mobile-page-header grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 md:block">
            <div className="mobile-page-titlebar">
              <div className="min-w-0">
                <h1 className="mobile-page-title">游记</h1>
                <div className="mt-3 flex">
                  <div className="h-px w-16 bg-gradient-to-r from-brand-gold/40 to-transparent" />
                </div>
              </div>
              {eventsState.isRefreshing && <Spinner size="sm" label="游记刷新中" />}
            </div>
            <MobileTagFilters scopeKey="events" {...tagPanelProps} />
          </header>

          <div className="mobile-detail-grid">
            <div className="min-w-0">
              <EventFilters
                sortOrder={sortOrder}
                viewMode={viewMode}
                onSortOrderChange={handleSortOrderChange}
                onViewModeChange={(mode) => void setScopedViewMode('events', mode)}
              />

              <ListPageContentState
                hasItems={eventsState.items.length > 0}
                error={eventsState.error}
                onRetry={eventsState.retry}
                staleDescription="当前数据可能不是最新内容。"
                empty={
                  <div className="border-y border-[var(--book-ink-line)] py-20 text-center">
                    <p className="text-[0.9375rem] tracking-[0.08em] text-text-muted">暂无活动</p>
                  </div>
                }
              >
                <>
                  <div
                    className={clsx(
                      viewMode === 'list'
                        ? 'flex flex-col gap-0.5'
                        : clsx(
                            'mobile-grid grid',
                            viewMode === 'large' && 'events-large-grid',
                            VIEW_MODE_CONFIG[viewMode].gridCols,
                            VIEW_MODE_CONFIG[viewMode].gap
                          )
                    )}
                  >
                    {events.map((event) => (
                      <EventCard key={event.id} event={event} viewMode={viewMode} />
                    ))}
                  </div>
                  {hasMultiplePages && (
                    <Pagination
                      page={page}
                      totalPages={resolvedTotalPages}
                      onPageChange={handlePageChange}
                    />
                  )}
                </>
              </ListPageContentState>
            </div>
            <aside className="mobile-detail-aside hidden md:block">
              <TagFilterPanel {...tagPanelProps} />
            </aside>
          </div>
        </div>
      </div>
    </ListPageLoadingBoundary>
  )
}

export default Events
