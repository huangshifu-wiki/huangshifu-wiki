import React, { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Calendar,
  ExternalLink,
  MapPin,
  Tag,
  Ticket,
  Users,
} from '@/src/components/icons'
import { SmartImage } from '../components/SmartImage'
import { Lightbox } from '../components/Lightbox'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { PageSkeleton } from '../components/PageSkeleton'
import { apiGet } from '../lib/apiClient'
import { formatDateTime } from '../lib/dateUtils'
import { formatEventTicketPrices, formatEventTimeSlot, getEventCoverSrc } from '../lib/eventFormat'
import type { EventDetailResponse } from '../types/api'
import type { EventItem } from '../types/entities'

type EventPosterImage = {
  id: string
  url: string
  originalUrl?: string | null
  name?: string | null
}

const EventLinkPanel = ({
  title,
  emptyText,
  links,
}: {
  title: string
  emptyText: string
  links: EventItem['externalLinks']
}) => (
  <div className="border-y border-[var(--book-ink-line)] py-5">
    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
      <ExternalLink size={16} className="text-brand-gold" />
      {title}
    </h2>
    {links.length ? (
      <div className="space-y-2">
        {links.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-sm text-brand-gold hover:underline"
          >
            {link.label}
          </a>
        ))}
      </div>
    ) : (
      <p className="text-sm text-text-muted">{emptyText}</p>
    )}
  </div>
)

const EventDetail = () => {
  const { slug } = useParams()
  const [event, setEvent] = useState<EventItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    setLoading(true)
    apiGet<EventDetailResponse>(`/api/events/${slug}`)
      .then((data) => {
        if (!cancelled) setEvent(data.event)
      })
      .catch((error) => {
        console.error('Fetch event detail failed:', error)
        if (!cancelled) setEvent(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [slug])

  const posterImages = useMemo<EventPosterImage[]>(() => {
    if (!event) return []

    const coverUrl = getEventCoverSrc(event, true)
    const coverImage = coverUrl
      ? [
          {
            id: `${event.id}-cover`,
            url: getEventCoverSrc(event),
            originalUrl: coverUrl,
            name: `${event.title} 封面`,
          },
        ]
      : []

    return [
      ...coverImage,
      ...event.posters.map((poster) => ({
        id: poster.id,
        url: poster.url,
        originalUrl: poster.originalUrl || poster.url,
        name: poster.name,
      })),
    ]
  }, [event])

  if (loading) return <PageSkeleton />

  if (!event) {
    return (
      <div className="mobile-page-shell">
        <div className="mobile-page-container text-center">
          <p className="mb-4 text-text-muted">活动不存在或已删除</p>
          <Link to="/events" className="text-sm text-brand-gold hover:underline">
            返回活动列表
          </Link>
        </div>
      </div>
    )
  }

  const coverSrc = getEventCoverSrc(event, true)
  const ticketPrices = formatEventTicketPrices(event.ticketPrices)

  return (
    <div className="mobile-page-shell">
      <div className="mobile-page-container max-w-[1000px]">
        <Link
          to="/events"
          className="mb-6 inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-brand-gold"
        >
          <ArrowLeft size={16} />
          返回活动
        </Link>

        <article className="space-y-8">
          <header className="flex flex-col gap-6 border-b border-[var(--book-ink-line)] pb-6 sm:flex-row sm:items-start">
            <div className="flex w-full shrink-0 items-start justify-center overflow-hidden sm:w-auto sm:justify-start">
              {coverSrc ? (
                <img
                  src={coverSrc}
                  alt={event.title}
                  className="block h-auto max-h-56 w-auto max-w-56 object-contain sm:max-h-72 sm:max-w-72"
                  loading="eager"
                  fetchPriority="high"
                />
              ) : (
                <div className="flex h-56 w-56 flex-col items-center justify-center gap-2 bg-surface-alt text-text-muted sm:h-72 sm:w-72">
                  <Calendar size={32} className="text-brand-gold/60" />
                  <span className="text-sm">暂无封面</span>
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-5">
              <h1 className="mobile-page-title">{event.title}</h1>
              <div className="space-y-3 text-sm text-text-secondary">
                <div className="flex gap-2">
                  <Calendar size={16} className="mt-0.5 shrink-0 text-brand-gold" />
                  <div className="space-y-1">
                    {event.timeSlots.length ? (
                      event.timeSlots.map((slot, index) => (
                        <p key={`${slot.start}-${index}`}>{formatEventTimeSlot(slot)}</p>
                      ))
                    ) : (
                      <p>时间待定</p>
                    )}
                  </div>
                </div>
                <p className="flex items-center gap-2">
                  <MapPin size={16} className="text-brand-gold" />
                  {event.location || '地点待定'}
                </p>
                {event.tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag size={16} className="text-brand-gold" />
                    {event.tags.map((tag) => (
                      <Link
                        key={tag}
                        to={`/events?tag=${encodeURIComponent(tag)}`}
                        className="rounded-sm px-2 py-0.5 text-xs theme-tag"
                      >
                        {tag}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </header>

          {event.content ? (
            <section className="prose prose-lg max-w-none font-body leading-relaxed text-text-primary">
              <MarkdownRenderer content={event.content} />
            </section>
          ) : null}

          <section className="grid gap-4 md:grid-cols-2">
            <div className="border-y border-[var(--book-ink-line)] py-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
                <Ticket size={16} className="text-brand-gold" />
                票价
              </h2>
              {ticketPrices ? (
                <p className="text-sm text-text-secondary">{ticketPrices}</p>
              ) : (
                <p className="text-sm text-text-muted">暂无票价信息</p>
              )}
            </div>

            <div className="border-y border-[var(--book-ink-line)] py-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
                <Calendar size={16} className="text-brand-gold" />
                起售时间
              </h2>
              {event.saleTimes.length ? (
                <ul className="space-y-2 text-sm text-text-secondary">
                  {event.saleTimes.map((saleTime, index) => (
                    <li key={`${saleTime.time}-${index}`}>
                      {formatDateTime(saleTime.time)}
                      {saleTime.note ? ` · ${saleTime.note}` : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-text-muted">暂无起售信息</p>
              )}
            </div>

            <div className="border-y border-[var(--book-ink-line)] py-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
                <Users size={16} className="text-brand-gold" />
                阵容
              </h2>
              {event.lineup.length ? (
                <div className="flex flex-wrap gap-2">
                  {event.lineup.map((item, index) => (
                    <span
                      key={`${item}-${index}`}
                      className="rounded-sm bg-surface-alt px-2 py-1 text-xs text-brand-gold"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-muted">暂无阵容信息</p>
              )}
            </div>

            <EventLinkPanel title="外部链接" emptyText="暂无外部链接" links={event.externalLinks} />
            {event.relatedLinks.length ? (
              <EventLinkPanel
                title="其他相关链接"
                emptyText="暂无其他相关链接"
                links={event.relatedLinks}
              />
            ) : null}
          </section>

          {posterImages.length ? (
            <section>
              <h2 className="mb-4 text-base font-semibold text-text-primary">海报</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {posterImages.map((poster, index) => (
                  <button
                    key={poster.id}
                    type="button"
                    onClick={() => {
                      setLightboxIndex(index)
                      setLightboxOpen(true)
                    }}
                    className="aspect-[3/4] overflow-hidden bg-surface-alt"
                  >
                    <SmartImage
                      src={poster.url}
                      alt={poster.name}
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </article>

        <Lightbox
          images={posterImages}
          initialIndex={lightboxIndex}
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
        />
      </div>
    </div>
  )
}

export default EventDetail
