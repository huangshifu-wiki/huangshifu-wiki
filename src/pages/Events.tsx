import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { clsx } from 'clsx'
import { EventCard } from '../components/Events/EventCard'
import { EventFilters, type EventSortOrder } from '../components/Events/EventFilters'
import { useUserPreferences } from '../context/UserPreferencesContext'
import Pagination from '../components/Pagination'
import { LoadErrorState, Spinner } from '@/src/components/ui'
import { PageSkeleton } from '../components/PageSkeleton'
import { useRoutedPagination } from '../hooks/useRoutedPagination'
import { apiGet } from '../lib/apiClient'
import { VIEW_MODE_CONFIG } from '../lib/viewModes'
import type { EventListResponse } from '../types/api'
import type { EventItem } from '../types/entities'
import type { ViewMode } from '../types/userPreferences'

const DEFAULT_PAGE_SIZE = 12

const Events = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedTag = searchParams.get('tag') || ''
  const [sortOrder, setSortOrder] = useState<EventSortOrder>('desc')
  const [events, setEvents] = useState<EventItem[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [totalPages, setTotalPages] = useState<number>()
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
    apiGet<{ tags: string[] }>('/api/events/tags')
      .then((data) => {
        if (!cancelled) setTags(data.tags || [])
      })
      .catch((error) => {
        console.error('Fetch event tags failed:', error)
        if (!cancelled) setTags([])
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    apiGet<EventListResponse>('/api/events', {
      page,
      limit: DEFAULT_PAGE_SIZE,
      sortOrder,
      ...(selectedTag ? { tag: selectedTag } : {}),
    })
      .then((data) => {
        if (cancelled) return
        setEvents(data.events || [])
        setTotalPages(data.totalPages || 1)
      })
      .catch((error) => {
        console.error('Fetch events failed:', error)
        if (!cancelled) {
          setLoadError(error)
          setTotalPages((currentTotalPages) => currentTotalPages || 1)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [page, retryNonce, selectedTag, sortOrder])

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

  const getTagUrl = (tag: string) => {
    const next = new URLSearchParams(searchParams)
    next.delete('page')
    if (tag) {
      next.set('tag', tag)
    } else {
      next.delete('tag')
    }
    const query = next.toString()
    return query ? `/events?${query}` : '/events'
  }
  const isRefreshing = loading && events.length > 0

  if (loading && events.length === 0) return <PageSkeleton variant="events" />

  return (
    <div className="gufeng-events-page mobile-page-shell">
      <div className="mobile-page-container" aria-busy={isRefreshing || undefined}>
        <header className="mobile-page-header">
          <div className="mobile-page-titlebar">
            <div className="min-w-0">
              <h1 className="mobile-page-title">游记</h1>
              <div className="mt-3 flex">
                <div className="h-px w-16 bg-gradient-to-r from-brand-gold/40 to-transparent" />
              </div>
            </div>
            {isRefreshing && <Spinner size="sm" label="游记刷新中" />}
          </div>
        </header>

        <EventFilters
          tags={tags}
          selectedTag={selectedTag}
          sortOrder={sortOrder}
          viewMode={viewMode}
          getTagUrl={getTagUrl}
          onSortOrderChange={handleSortOrderChange}
          onViewModeChange={(mode) => void setScopedViewMode('events', mode)}
        />

        {loadError && events.length > 0 && (
          <LoadErrorState
            className="py-5"
            description="当前数据可能不是最新内容。"
            onRetry={() => setRetryNonce((value) => value + 1)}
          />
        )}
        {loadError && events.length === 0 ? (
          <LoadErrorState onRetry={() => setRetryNonce((value) => value + 1)} />
        ) : events.length > 0 ? (
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
        ) : (
          <div className="border-y border-[var(--book-ink-line)] py-20 text-center">
            <p className="text-[0.9375rem] tracking-[0.08em] text-text-muted">暂无活动</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default Events
