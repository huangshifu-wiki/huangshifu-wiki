import { formatDate } from './dateUtils'
import type { EventTicketPrice, EventTimeSlot } from '../types/entities'

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

export function formatEventTicketPrice(ticketPrice: EventTicketPrice) {
  const description = ticketPrice.description?.trim()
  return description ? `${description} ¥${ticketPrice.price}` : `¥${ticketPrice.price}`
}

export function isEventTicketPrice(value: unknown): value is EventTicketPrice {
  if (!value || typeof value !== 'object' || !('price' in value)) return false
  const record = value as { price?: unknown; description?: unknown }
  const price = record.price
  if (record.description !== undefined && typeof record.description !== 'string') return false
  return typeof price === 'number' && Number.isFinite(price) && price >= 0
}

export function formatEventTicketPrices(ticketPrices: readonly unknown[]) {
  const formatted: string[] = []
  for (const ticketPrice of ticketPrices) {
    if (isEventTicketPrice(ticketPrice)) formatted.push(formatEventTicketPrice(ticketPrice))
  }
  return formatted.join(' / ')
}
