import { Calendar } from '@/src/components/icons'
import { clsx } from 'clsx'
import { getEventCoverSrc } from '../../lib/eventFormat'
import type { EventItem } from '../../types/entities'
import { SmartImage } from '../SmartImage'

interface EventCoverProps {
  event: EventItem
  className?: string
  imageClassName?: string
}

const EventCover = ({ event, className, imageClassName }: EventCoverProps) => {
  const src = getEventCoverSrc(event)

  if (src) {
    return (
      <SmartImage
        src={src}
        alt={event.title}
        className={clsx('h-full w-full object-cover', imageClassName)}
      />
    )
  }

  return (
    <div
      className={clsx(
        'flex h-full w-full flex-col items-center justify-center gap-2 bg-surface-alt text-text-muted',
        className
      )}
    >
      <Calendar size={24} className="text-brand-gold/60" />
      <span className="text-xs tracking-[0.06em]">暂无封面</span>
    </div>
  )
}

export { EventCover }
export type { EventCoverProps }
