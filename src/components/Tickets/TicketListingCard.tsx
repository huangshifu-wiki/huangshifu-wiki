import { Clock, MapPin, Ticket as TicketIcon, User as UserIcon } from '@/src/components/icons'
import { Link } from 'react-router-dom'
import { clsx } from 'clsx'
import { formatDateTime } from '../../lib/dateUtils'
import type { TicketListingSummary } from '../../types/entities'

export interface TicketListingCardProps {
  listing: TicketListingSummary
  className?: string
}

export const TicketListingCard = ({ listing, className }: TicketListingCardProps) => {
  const isOffer = listing.type === 'offer'

  return (
    <article
      className={clsx(
        'group min-w-0 rounded border border-[var(--book-ink-line)]/60 bg-[var(--book-panel-bg)] p-4 transition-all duration-300',
        'hover:border-brand-gold/70 hover:shadow-lg',
        className
      )}
    >
      <Link to={`/tickets/${listing.slug}`} data-press-feedback="state" className="block min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span
            className={clsx(
              'inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-[0.625rem] font-semibold tracking-[0.08em]',
              isOffer ? 'theme-status-success' : 'theme-status-warning'
            )}
          >
            <TicketIcon size={11} /> {isOffer ? '出票' : '收票'}
          </span>
          <span className="flex items-center gap-1 text-[0.7rem] text-text-muted">
            <Clock size={11} /> {formatDateTime(listing.updatedAt, 'yyyy-MM-dd HH:mm')}
          </span>
        </div>

        <h2 className="mb-3 line-clamp-2 min-h-[2.75rem] text-[1.05rem] font-semibold leading-snug tracking-[0.03em] text-text-primary transition-colors group-hover:text-brand-gold">
          {listing.eventName || listing.customEventName || '未命名活动'}
        </h2>

        <div className="space-y-2 text-sm text-text-secondary">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>数量：{listing.quantity}</span>
            <span>票档：{listing.ticketTier}</span>
          </div>
          <p className="flex min-w-0 items-center gap-1 truncate text-xs text-text-muted">
            <MapPin size={12} className="shrink-0" />
            <span className="truncate">座位：{listing.seat || '未填写'}</span>
          </p>
        </div>

        <div className="mt-4 flex min-w-0 items-center gap-2 border-t border-[var(--book-ink-line)]/60 pt-3 text-xs text-text-muted">
          <UserIcon size={12} className="shrink-0" />
          <span className="truncate">{listing.authorName || '匿名'}</span>
        </div>
      </Link>
    </article>
  )
}
