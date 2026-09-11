import { formatDate, formatWeekday, toDateValue } from './dateUtils'
import type { EventTicketPrice, EventTimeSlot } from '../types/entities'

export const EVENT_IMAGE_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,image/bmp'
export const EVENT_ALLOWED_IMAGE_TYPES = EVENT_IMAGE_ACCEPT.split(',')

type SlotParts = { dateText: string; timeText: string }

// 拆出场次时间值实际展示的日期与时间；解析失败时整段兜底文本落在 dateText 上
const getSlotParts = (value: string, type: EventTimeSlot['type']): SlotParts => {
  if (!value || type === 'date') return { dateText: value, timeText: '' }
  if (!toDateValue(value)) return { dateText: formatDate(value, 'yyyy-MM-dd HH:mm'), timeText: '' }
  return { dateText: formatDate(value, 'yyyy-MM-dd'), timeText: formatDate(value, 'HH:mm') }
}

// 全角括号自带分隔，没有星期时才补回日期与时间之间的空格
const renderSlotParts = ({ dateText, timeText }: SlotParts, weekday: string) =>
  `${dateText}${weekday ? `（${weekday}）` : timeText ? ' ' : ''}${timeText}`

export function formatEventTimeSlot(slot: EventTimeSlot) {
  const start = getSlotParts(slot.start, slot.type)
  const end = slot.end ? getSlotParts(slot.end, slot.type) : null
  const startText = renderSlotParts(start, formatWeekday(start.dateText))
  if (!end || (end.dateText === start.dateText && end.timeText === start.timeText)) {
    return startText
  }
  // 同一天只标一次星期，跨日区间两端都标
  const sameDay = end.dateText === start.dateText
  return `${startText} - ${renderSlotParts(end, sameDay ? '' : formatWeekday(end.dateText))}`
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
