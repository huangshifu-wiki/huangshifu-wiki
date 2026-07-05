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

const getEventSlotDateValue = (slot: EventTimeSlot) => {
  const date = slot.start?.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ''
}

const getSortedEventSlotDates = (timeSlots: readonly EventTimeSlot[]) =>
  timeSlots.map(getEventSlotDateValue).filter(Boolean).sort()

export function formatEventListDate(timeSlots: readonly EventTimeSlot[]) {
  const dates = getSortedEventSlotDates(timeSlots)
  if (!dates.length) return ''
  return dates.length > 1 ? `${dates[0]} 等` : dates[0]
}

const toLocalDateStart = (dateValue: string) => {
  const [year, month, day] = dateValue.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function getEventListDayOffset(timeSlots: readonly EventTimeSlot[], today = new Date()) {
  const [date] = getSortedEventSlotDates(timeSlots)
  if (!date) return null

  const eventDate = toLocalDateStart(date)
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((eventDate.getTime() - todayStart.getTime()) / 86400000)
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

export function formatEventTicketPriceRange(ticketPrices: readonly unknown[]) {
  let minPrice: number | null = null
  let maxPrice: number | null = null

  for (const ticketPrice of ticketPrices) {
    if (!isEventTicketPrice(ticketPrice)) continue
    minPrice = minPrice === null ? ticketPrice.price : Math.min(minPrice, ticketPrice.price)
    maxPrice = maxPrice === null ? ticketPrice.price : Math.max(maxPrice, ticketPrice.price)
  }

  if (minPrice === null || maxPrice === null) return ''
  return minPrice === maxPrice ? `¥${minPrice}` : `¥${minPrice}-${maxPrice}`
}
