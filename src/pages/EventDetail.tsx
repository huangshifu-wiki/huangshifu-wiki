import React, { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Calendar, ExternalLink, MapPin, Tag } from '@/src/components/icons'
import { SmartImage } from '../components/SmartImage'
import { Lightbox } from '../components/Lightbox'
import MarkdownRenderer from '../components/MarkdownRenderer'
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

const COVER_FILTER = 'brightness(0.97) saturate(0.92)'

const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-[0.1em] text-text-primary">
    <span className="inline-block h-4 w-[3px] rounded-[1px] bg-brand-gold opacity-60" />
    {children}
  </h2>
)

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
    <div className="mb-3">
      <SectionHeading>{title}</SectionHeading>
    </div>
    {links.length ? (
      <div className="flex flex-col">
        {links.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 border-b border-[var(--book-ink-line)] py-2.5 text-sm text-text-secondary transition-all hover:pl-1 hover:text-brand-gold last:border-0"
          >
            <ExternalLink size={15} className="shrink-0 text-text-muted" />
            {link.label}
          </a>
        ))}
      </div>
    ) : (
      <p className="py-2 text-sm italic tracking-[0.06em] text-text-muted">{emptyText}</p>
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

  if (loading) {
    return (
      <div className="mobile-page-shell antique-detail">
        <div className="mobile-page-container">
          <div className="mb-6 h-4 w-24 animate-pulse rounded bg-surface-alt" />
          <div className="mb-8 flex flex-col gap-5 border-b border-[var(--book-ink-line)] pb-8 sm:flex-row">
            <div className="h-56 w-40 shrink-0 animate-pulse rounded-lg bg-surface-alt sm:h-72 sm:w-52" />
            <div className="flex-1 space-y-3 py-2">
              <div className="h-9 w-2/3 animate-pulse rounded bg-surface-alt" />
              <div className="h-5 w-1/2 animate-pulse rounded bg-surface-alt" />
              <div className="h-5 w-1/3 animate-pulse rounded bg-surface-alt" />
              <div className="mt-4 flex gap-2.5">
                <div className="h-8 w-20 animate-pulse rounded bg-surface-alt" />
                <div className="h-8 w-24 animate-pulse rounded bg-surface-alt" />
              </div>
            </div>
          </div>
          <div className="space-y-3">
            {[1, 2, 3, 4].map((item) => (
              <div
                key={item}
                className="h-5 animate-pulse rounded bg-surface-alt"
                style={{ width: `${90 - item * 12}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="mobile-page-shell antique-detail">
        <div className="mobile-page-container">
          <Link
            to="/events"
            className="inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-brand-gold"
          >
            <ArrowLeft size={16} /> 返回活动
          </Link>
          <div className="mt-8 border-y border-[var(--book-ink-line)] py-16 text-center text-[0.9375rem] tracking-[0.08em] text-text-muted">
            活动不存在或已删除
          </div>
        </div>
      </div>
    )
  }

  const coverSrc = getEventCoverSrc(event, true)
  const ticketPrices = formatEventTicketPrices(event.ticketPrices)

  return (
    <div className="mobile-page-shell antique-detail text-[var(--color-text-antique)]">
      <div className="mobile-page-container max-w-[1000px]">
        <Link
          to="/events"
          className="mb-6 inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-brand-gold"
        >
          <ArrowLeft size={16} />
          返回活动
        </Link>

        <article className="space-y-10">
          <header className="flex flex-col gap-6 border-b border-[var(--book-ink-line)] pb-8 sm:flex-row sm:items-start">
            <div className="flex w-full shrink-0 items-start justify-center overflow-hidden sm:w-auto sm:justify-start">
              {coverSrc ? (
                <button
                  type="button"
                  onClick={() => {
                    setLightboxIndex(0)
                    setLightboxOpen(true)
                  }}
                  className="block max-h-56 max-w-56 overflow-hidden rounded-lg shadow-[0_12px_48px_rgba(42,37,32,0.08)] transition-shadow duration-300 hover:shadow-[0_16px_56px_rgba(42,37,32,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary sm:max-h-72 sm:max-w-72"
                  aria-label={`查看 ${event.title} 封面`}
                >
                  <img
                    src={coverSrc}
                    alt={event.title}
                    className="block h-auto max-h-56 w-auto max-w-56 object-contain sm:max-h-72 sm:max-w-72"
                    style={{ filter: COVER_FILTER }}
                    loading="eager"
                    fetchPriority="high"
                  />
                </button>
              ) : (
                <div className="flex h-56 w-56 flex-col items-center justify-center gap-2 rounded-lg border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] text-text-muted sm:h-72 sm:w-72">
                  <Calendar size={32} className="text-brand-gold/60" />
                  <span className="text-sm">暂无封面</span>
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 py-1">
              <h1 className="mobile-page-title mb-3">{event.title}</h1>
              <div className="space-y-3 text-[0.9375rem] text-text-secondary">
                <div className="flex gap-2">
                  <Calendar size={16} className="mt-1 shrink-0 text-brand-gold" />
                  <div className="space-y-1 leading-relaxed">
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
            <section>
              <div className="mb-4">
                <SectionHeading>游记</SectionHeading>
              </div>
              <div className="prose prose-lg max-w-none font-body leading-relaxed text-text-primary">
                <MarkdownRenderer content={event.content} />
              </div>
            </section>
          ) : null}

          <section className="grid gap-x-6 gap-y-0 md:grid-cols-2">
            <div className="border-y border-[var(--book-ink-line)] py-5">
              <div className="mb-3">
                <SectionHeading>票价</SectionHeading>
              </div>
              {ticketPrices ? (
                <p className="text-sm leading-relaxed text-text-secondary">{ticketPrices}</p>
              ) : (
                <p className="text-sm italic tracking-[0.06em] text-text-muted">暂无票价信息</p>
              )}
            </div>

            <div className="border-y border-[var(--book-ink-line)] py-5">
              <div className="mb-3">
                <SectionHeading>起售时间</SectionHeading>
              </div>
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
                <p className="text-sm italic tracking-[0.06em] text-text-muted">暂无起售信息</p>
              )}
            </div>

            <div className="border-y border-[var(--book-ink-line)] py-5">
              <div className="mb-3">
                <SectionHeading>阵容</SectionHeading>
              </div>
              {event.lineup.length ? (
                <div className="flex flex-wrap gap-2">
                  {event.lineup.map((item, index) => (
                    <span
                      key={`${item}-${index}`}
                      className="rounded-sm px-2 py-1 text-xs theme-tag"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm italic tracking-[0.06em] text-text-muted">暂无阵容信息</p>
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
              <div className="mb-4">
                <SectionHeading>海报</SectionHeading>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {posterImages.map((poster, index) => (
                  <button
                    key={poster.id}
                    type="button"
                    onClick={() => {
                      setLightboxIndex(index)
                      setLightboxOpen(true)
                    }}
                    className="group aspect-[3/4] overflow-hidden rounded border border-[var(--book-ink-line)]/60 bg-[var(--book-panel-bg)] shadow-[0_10px_30px_rgba(42,37,32,0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
                  >
                    <SmartImage
                      src={poster.url}
                      alt={poster.name}
                      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                      style={{ filter: COVER_FILTER }}
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
