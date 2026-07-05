import { describe, expect, it } from 'vitest'
import {
  formatEventListDate,
  formatEventTicketPriceRange,
  getEventListDayOffset,
} from '../../src/lib/eventFormat'

describe('eventFormat', () => {
  it('formats event list dates without time and marks multiple slots', () => {
    expect(
      formatEventListDate([
        { type: 'datetime', start: '2025-08-23T19:30', end: '2025-08-23T21:40' },
      ])
    ).toBe('2025-08-23')

    expect(
      formatEventListDate([
        { type: 'datetime', start: '2026-03-11T13:47' },
        { type: 'date', start: '2025-08-23' },
      ])
    ).toBe('2025-08-23 等')
  })

  it('calculates event list day offsets by local date', () => {
    const today = new Date(2025, 7, 23, 15, 30)

    expect(getEventListDayOffset([{ type: 'date', start: '2025-08-25' }], today)).toBe(2)
    expect(getEventListDayOffset([{ type: 'date', start: '2025-08-23' }], today)).toBe(0)
    expect(getEventListDayOffset([{ type: 'date', start: '2025-08-20' }], today)).toBe(-3)
  })

  it('formats structured ticket prices as a range', () => {
    expect(formatEventTicketPriceRange([{ description: '看台', price: 280 }])).toBe('¥280')

    expect(
      formatEventTicketPriceRange([
        { description: '内场', price: 680 },
        { description: '看台', price: 280 },
      ])
    ).toBe('¥280-680')
  })

  it('ignores legacy string ticket prices when formatting ranges', () => {
    expect(formatEventTicketPriceRange(['看台 280', { price: 680 }])).toBe('¥680')
    expect(formatEventTicketPriceRange(['看台 280'])).toBe('')
  })
})
