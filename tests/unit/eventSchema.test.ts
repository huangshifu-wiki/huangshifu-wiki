import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { eventWriteSchema } from '../../src/server/schemas/event.schema'

describe('eventWriteSchema', () => {
  it('accepts date and datetime time slots with lightweight structured lists', () => {
    const result = eventWriteSchema.parse({
      title: '春日活动',
      slug: 'spring-event',
      location: '上海',
      content: '**内容**',
      timeSlots: [
        { type: 'datetime', start: '2025-08-23T19:30', end: '2025-08-23T21:40' },
        { type: 'date', start: '2026-03-11', end: '2026-03-12' },
      ],
      ticketPrices: ['看台 280'],
      saleTimes: [{ time: '2025-08-01T12:00', note: '预售' }],
      lineup: ['黄诗扶'],
      externalLinks: [{ label: '购票', url: 'https://example.com/ticket' }],
      coverAssetId: 'asset-1',
      posters: [{ assetId: 'asset-2' }],
    })

    expect(result.timeSlots).toHaveLength(2)
    expect(result.saleTimes[0]).toEqual({ time: '2025-08-01T12:00', note: '预售' })
    expect(result.externalLinks[0]?.label).toBe('购票')
  })

  it('rejects mismatched date type values', () => {
    expect(() =>
      eventWriteSchema.parse({
        title: '错误活动',
        timeSlots: [{ type: 'date', start: '2025-08-23T19:30' }],
      })
    ).toThrow(ZodError)
  })

  it('rejects invalid external links', () => {
    expect(() =>
      eventWriteSchema.parse({
        title: '错误活动',
        externalLinks: [{ label: '购票', url: 'not-a-url' }],
      })
    ).toThrow(ZodError)
  })
})
