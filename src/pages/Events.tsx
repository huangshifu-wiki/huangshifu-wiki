import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, MapPin, Ticket } from '@/src/components/icons'
import { clsx } from 'clsx'
import { SmartImage } from '../components/SmartImage'
import Pagination from '../components/Pagination'
import { PageSkeleton } from '../components/PageSkeleton'
import { useRoutedPagination } from '../hooks/useRoutedPagination'
import { apiGet } from '../lib/apiClient'
import { formatEventTicketPrices, formatEventTimeSlot, getEventCoverSrc } from '../lib/eventFormat'
import type { EventListResponse } from '../types/api'
import type { EventItem } from '../types/entities'

const DEFAULT_PAGE_SIZE = 12

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

const EventCard = ({ event }: { event: EventItem }) => {
  const firstSlot = event.timeSlots[0]
  const ticketPrices = formatEventTicketPrices(event.ticketPrices)

  return (
    <Link
      to={`/events/${event.slug}`}
      className="group block overflow-hidden rounded border border-border bg-surface transition-all hover:border-brand-gold"
    >
      <div className="aspect-[16/10] overflow-hidden bg-surface-alt">
        <EventCover
          event={event}
          className="h-full w-full transition-transform duration-500 group-hover:scale-[1.04]"
        />
      </div>
      <div className="space-y-3 p-4">
        <h2 className="truncate text-base font-semibold text-text-primary transition-colors group-hover:text-brand-gold">
          {event.title}
        </h2>
        <div className="space-y-2 text-xs text-text-muted">
          <p className="flex items-center gap-1.5">
            <Calendar size={13} className="text-brand-gold" />
            <span className="truncate">
              {firstSlot ? formatEventTimeSlot(firstSlot) : '时间待定'}
            </span>
          </p>
          <p className="flex items-center gap-1.5">
            <MapPin size={13} className="text-brand-gold" />
            <span className="truncate">{event.location || '地点待定'}</span>
          </p>
          <p className="flex items-center gap-1.5">
            <Ticket size={13} className="text-brand-gold" />
            <span className="truncate">{ticketPrices || '票价待定'}</span>
          </p>
        </div>
      </div>
    </Link>
  )
}

const Events = () => {
  const [events, setEvents] = useState<EventItem[]>([])
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const { page, handlePageChange } = useRoutedPagination({
    serverTotalPages: totalPages,
    defaultPageSize: DEFAULT_PAGE_SIZE,
    pageSizeParam: null,
    showPageSizeSelector: false,
  })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiGet<EventListResponse>('/api/events', { page, limit: DEFAULT_PAGE_SIZE })
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
  }, [page])

  if (loading) return <PageSkeleton />

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8">
      <div className="mb-7 flex items-end justify-between gap-4 border-b border-border">
        <h1 className="relative flex items-center gap-2 pb-2 text-[1.25rem] font-semibold tracking-[0.08em] text-brand-gold after:absolute after:bottom-0 after:left-0 after:h-[2px] after:w-full after:rounded-[1px] after:bg-brand-gold">
          <Calendar size={20} />
          活动
        </h1>
      </div>

      {events.length > 0 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
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
  )
}

export default Events
