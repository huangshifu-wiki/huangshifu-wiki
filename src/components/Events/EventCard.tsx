import React from 'react'
import { Link } from 'react-router-dom'
import { Calendar, MapPin } from '@/src/components/icons'
import { clsx } from 'clsx'
import {
  formatEventListDate,
  formatEventTicketPriceRange,
  getEventListDayOffset,
} from '../../lib/eventFormat'
import type { EventItem } from '../../types/entities'
import type { ViewMode } from '../../types/userPreferences'
import { EventCover } from './EventCover'

interface EventCardProps {
  event: EventItem
  viewMode: ViewMode
}

const EventDateOffset = ({
  dayOffset,
  compact = false,
}: {
  dayOffset: number | null
  compact?: boolean
}) => {
  if (dayOffset === null) return null

  const isFutureOrToday = dayOffset >= 0

  return (
    <span
      className={clsx(
        'shrink-0 font-semibold tabular-nums',
        compact ? 'text-[0.6875rem]' : 'text-xs',
        isFutureOrToday ? 'theme-text-success' : 'theme-text-error'
      )}
    >
      {isFutureOrToday ? `+${dayOffset}` : dayOffset}
    </span>
  )
}

const EventMeta = ({ event, compact = false }: { event: EventItem; compact?: boolean }) => {
  const eventDate = formatEventListDate(event.timeSlots)

  return (
    <div
      className={clsx(
        'min-w-0 space-y-1.5 text-text-muted',
        compact ? 'text-[0.72rem]' : 'text-[0.78rem]'
      )}
    >
      <p className="flex min-w-0 items-center gap-1.5">
        <Calendar size={compact ? 11 : 13} className="shrink-0 text-brand-gold" />
        <span className="truncate">{eventDate || '时间待定'}</span>
      </p>
      <p className="flex min-w-0 items-center gap-1.5">
        <MapPin size={compact ? 11 : 13} className="shrink-0 text-brand-gold" />
        <span className="truncate">{event.location || '地点待定'}</span>
      </p>
    </div>
  )
}

const EventTags = ({ tags, compact = false }: { tags: string[]; compact?: boolean }) =>
  tags.length ? (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {tags.slice(0, 3).map((tag) => (
        <span
          key={tag}
          className={clsx(
            'max-w-full truncate rounded-sm theme-tag',
            compact ? 'px-1.5 py-0.5 text-[0.625rem]' : 'px-2 py-0.5 text-[0.6875rem]'
          )}
        >
          {tag}
        </span>
      ))}
    </div>
  ) : null

const EventCard = React.memo(function EventCard({ event, viewMode }: EventCardProps) {
  const dayOffset = getEventListDayOffset(event.timeSlots)
  const ticketPriceRange = formatEventTicketPriceRange(event.ticketPrices)
  const eventUrl = `/events/${event.slug}`
  const isList = viewMode === 'list'

  if (isList) {
    return (
      <Link
        to={eventUrl}
        className={clsx(
          'group flex min-w-0 items-center gap-3.5 rounded px-3 py-3',
          'transition-all duration-300 hover:bg-[color-mix(in_srgb,var(--color-surface-alt)_50%,transparent)]'
        )}
      >
        <div className="relative h-[76px] w-[108px] shrink-0 overflow-hidden rounded bg-surface-alt shadow-[0_4px_20px_rgba(42,37,32,0.06)]">
          <EventCover
            event={event}
            imageClassName="transition-transform duration-500 group-hover:scale-[1.06]"
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex min-w-0 items-center gap-2">
            <EventDateOffset dayOffset={dayOffset} compact />
            <h2 className="truncate text-[0.975rem] font-semibold tracking-[0.04em] text-text-primary transition-colors group-hover:text-brand-gold">
              {event.title}
            </h2>
            <span className="ml-auto shrink-0 text-[0.75rem] font-medium tabular-nums text-text-muted">
              {ticketPriceRange || '票价待定'}
            </span>
          </div>
          <EventTags tags={event.tags} compact />
          <div className="mt-2">
            <EventMeta event={event} compact />
          </div>
        </div>
      </Link>
    )
  }

  return (
    <Link
      to={eventUrl}
      className={clsx(
        'group block min-w-0 overflow-hidden rounded-lg',
        'border border-[var(--book-ink-line)]/50 bg-[var(--book-panel-bg)]',
        'transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_36px_rgba(72,53,25,0.1)]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary'
      )}
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-surface-alt">
        <EventCover
          event={event}
          imageClassName="transition-transform duration-500 group-hover:scale-[1.06]"
        />
      </div>

      <div className="space-y-3 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <EventDateOffset dayOffset={dayOffset} />
          <h2 className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold tracking-[0.02em] text-text-primary transition-colors group-hover:text-brand-gold">
            {event.title}
          </h2>
        </div>
        <div className="flex items-center justify-between gap-3 text-[0.78rem]">
          <EventTags tags={event.tags} compact />
          <span className="shrink-0 font-medium tabular-nums text-text-muted">
            {ticketPriceRange || '票价待定'}
          </span>
        </div>
        <EventMeta event={event} />
      </div>
    </Link>
  )
})

export { EventCard }
export type { EventCardProps }
