import { formatDate } from './dateUtils'
import type { EventTimeSlot } from '../types/entities'

export const EVENT_IMAGE_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,image/bmp'
export const EVENT_ALLOWED_IMAGE_TYPES = EVENT_IMAGE_ACCEPT.split(',')

export function formatEventDateValue(value: string, type: EventTimeSlot['type']) {
  if (!value) return ''
  if (type === 'date') return value
  return formatDate(value, 'yyyy-MM-dd HH:mm')
}

export function formatEventTimeSlot(slot: EventTimeSlot) {
  const start = formatEventDateValue(slot.start, slot.type)
  const end = slot.end ? formatEventDateValue(slot.end, slot.type) : ''
  return end && end !== start ? `${start} - ${end}` : start
}

export const getEventCoverSrc = (
  event: {
    coverUrl?: string | null
    coverThumbnailUrl?: string | null
  },
  preferOriginal = false
) =>
  preferOriginal
    ? event.coverUrl || event.coverThumbnailUrl || ''
    : event.coverThumbnailUrl || event.coverUrl || ''
