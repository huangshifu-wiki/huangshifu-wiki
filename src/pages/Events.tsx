import React, { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Calendar, MapPin } from '@/src/components/icons'
import { clsx } from 'clsx'
import { SmartImage } from '../components/SmartImage'
import { ViewModeSelector } from '../components/ViewModeSelector'
import { useUserPreferences } from '../context/UserPreferencesContext'
import Pagination from '../components/Pagination'
import { PageSkeleton } from '../components/PageSkeleton'
import { useRoutedPagination } from '../hooks/useRoutedPagination'
import { apiGet } from '../lib/apiClient'
import {
  formatEventListDate,
  formatEventTicketPriceRange,
  getEventCoverSrc,
  getEventListDayOffset,
} from '../lib/eventFormat'
import { VIEW_MODE_CONFIG } from '../lib/viewModes'
import type { EventListResponse } from '../types/api'
import type { EventItem } from '../types/entities'
import type { ViewMode } from '../types/userPreferences'

const DEFAULT_PAGE_SIZE = 12
type EventSortOrder = 'asc' | 'desc'
const EVENT_VIEW_MODES = ['large', 'list'] as const
const TAG_FILTER_BASE_CLASS =
  'relative pb-2 text-[1.125rem] tracking-[0.05em] transition-all cursor-pointer'

const getTagFilterClassName = (active: boolean) =>
  clsx(
    TAG_FILTER_BASE_CLASS,
    active
      ? 'font-semibold text-brand-gold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:rounded-[1px] after:bg-[var(--color-theme-accent)]'
      : 'text-text-muted hover:text-brand-gold'
  )

const EventCover = ({ event, className }: { event: EventItem; className?: string }) => {
  const src = getEventCoverSrc(event)
  if (src) {
    return <SmartImage src={src} alt={event.title} className={clsx('object-cover', className)} />
  }

  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center gap-2 bg-surface-alt text-text-muted',
        className
      )}
    >
      <Calendar size={24} className="text-brand-gold/60" />
      <span className="text-xs">暂无封面</span>
    </div>
  )
}

const EventCard = ({ event, viewMode }: { event: EventItem; viewMode: ViewMode }) => {
  const eventDate = formatEventListDate(event.timeSlots)
  const dayOffset = getEventListDayOffset(event.timeSlots)
  const isFutureOrToday = dayOffset !== null && dayOffset >= 0
  const ticketPriceRange = formatEventTicketPriceRange(event.ticketPrices)
  const isListMode = viewMode === 'list'

  return (
    <Link
      to={`/events/${event.slug}`}
      className={clsx(
        'group overflow-hidden rounded border border-border bg-surface transition-all hover:border-brand-gold',
        isListMode ? 'flex gap-4 p-3' : 'block'
      )}
    >
      <div
        className={clsx(
          'overflow-hidden bg-surface-alt',
          isListMode ? 'h-24 w-24 flex-shrink-0 rounded' : 'aspect-[16/10]'
        )}
      >
        <EventCover
          event={event}
          className="h-full w-full transition-transform duration-500 group-hover:scale-[1.04]"
        />
      </div>
      <div className={clsx('min-w-0', isListMode ? 'flex-1 space-y-2 py-0.5' : 'space-y-3 p-4')}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {dayOffset !== null && (
              <span
                className={clsx(
                  'shrink-0 text-xs font-semibold tabular-nums',
                  isFutureOrToday ? 'theme-text-success' : 'theme-text-error'
                )}
              >
                {isFutureOrToday ? `+${dayOffset}` : dayOffset}
              </span>
            )}
            <h2 className="truncate text-base font-semibold text-text-primary transition-colors group-hover:text-brand-gold">
              {event.title}
            </h2>
          </div>
          <span
            className={clsx(
              'shrink-0 text-right font-medium text-text-secondary tabular-nums',
              isListMode ? 'text-xs' : 'text-sm'
            )}
          >
            {ticketPriceRange || '票价待定'}
          </span>
        </div>
        <div className="space-y-2 text-xs text-text-muted">
          {event.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {event.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="rounded px-2 py-0.5 text-[10px] theme-tag">
                  {tag}
                </span>
              ))}
            </div>
          )}
          <p className="flex items-center gap-1.5">
            <Calendar size={13} className="text-brand-gold" />
            <span className="truncate">{eventDate || '时间待定'}</span>
          </p>
          <p className="flex items-center gap-1.5">
            <MapPin size={13} className="text-brand-gold" />
            <span className="truncate">{event.location || '地点待定'}</span>
          </p>
        </div>
      </div>
    </Link>
  )
}

const Events = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedTag = searchParams.get('tag') || ''
  const [sortOrder, setSortOrder] = useState<EventSortOrder>('desc')
  const [events, setEvents] = useState<EventItem[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const { getScopedViewMode, setScopedViewMode } = useUserPreferences()
  const storedViewMode = getScopedViewMode('events')
  const viewMode: ViewMode = storedViewMode === 'large' ? 'large' : 'list'
  const { page, handlePageChange } = useRoutedPagination({
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
          setEvents([])
          setTotalPages(1)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [page, selectedTag, sortOrder])

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

  if (loading) return <PageSkeleton />

  return (
    <div
      className="min-h-[calc(100vh-60px)] bg-bg-primary"
      style={{
        fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
        lineHeight: 1.8,
      }}
    >
      <div className="mx-auto max-w-[1100px] px-6 py-8 pb-32">
        <div className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h1 className="text-[1.75rem] font-bold tracking-[0.12em] text-text-primary">游记</h1>
          </div>
        </div>

        <div className="mb-5 flex items-end justify-between gap-4 border-b border-border">
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-5">
              <Link to={getTagUrl('')} className={getTagFilterClassName(!selectedTag)}>
                全部标签
              </Link>
              {tags.map((tag) => (
                <Link
                  key={tag}
                  to={getTagUrl(tag)}
                  className={getTagFilterClassName(selectedTag === tag)}
                >
                  {tag}
                </Link>
              ))}
            </div>
          ) : (
            <div />
          )}

          <div className="flex flex-wrap items-center justify-end gap-3 pb-2 text-[0.8125rem] text-text-muted">
            <ViewModeSelector
              value={viewMode}
              modes={EVENT_VIEW_MODES}
              onChange={(mode) => void setScopedViewMode('events', mode)}
              size="sm"
            />
            <div className="inline-flex rounded border border-border bg-surface p-0.5">
              {(['desc', 'asc'] as const).map((order) => (
                <button
                  key={order}
                  type="button"
                  onClick={() => handleSortOrderChange(order)}
                  className={clsx(
                    'rounded px-2.5 py-1.5 text-xs font-medium transition-all',
                    sortOrder === order
                      ? 'bg-[var(--color-theme-accent)] text-white'
                      : 'text-text-muted hover:text-text-secondary'
                  )}
                >
                  {order === 'desc' ? '时间倒序' : '时间正序'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {events.length > 0 ? (
          <>
            <div
              className={clsx(
                'grid',
                VIEW_MODE_CONFIG[viewMode].gridCols,
                VIEW_MODE_CONFIG[viewMode].gap
              )}
            >
              {events.map((event) => (
                <EventCard key={event.id} event={event} viewMode={viewMode} />
              ))}
            </div>
            {totalPages > 1 && (
              <Pagination page={page} totalPages={totalPages} onPageChange={handlePageChange} />
            )}
          </>
        ) : (
          <div className="border-y border-border py-16 text-center text-sm text-text-muted">
            暂无活动
          </div>
        )}
      </div>
    </div>
  )
}

export default Events
