import { Calendar } from '@/src/components/icons'
import { clsx } from 'clsx'
import { getEventCoverSrc } from '../../lib/eventFormat'
import type { EventItem } from '../../types/entities'
import { SmartImage } from '../SmartImage'
import { CoverPlaceholder } from '../CoverPlaceholder'

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

  return <CoverPlaceholder icon={<Calendar size={24} />} label="无封面" className={className} />
}

export { EventCover }
export type { EventCoverProps }
