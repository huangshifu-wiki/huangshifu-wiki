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
      ticketPrices: [
        { description: '看台', price: 280 },
        { price: 0 },
        { description: '学生票', price: 99.5 },
      ],
      saleTimes: [{ time: '2025-08-01T12:00', note: '预售' }],
      lineup: ['黄诗扶'],
      externalLinks: [{ label: '购票', url: 'https://example.com/ticket' }],
      relatedLinks: [{ label: '官宣', url: 'https://example.com/news' }],
      coverAssetId: 'asset-1',
      posters: [{ assetId: 'asset-2' }],
    })

    expect(result.timeSlots).toHaveLength(2)
    expect(result.ticketPrices).toEqual([
      { description: '看台', price: 280 },
      { price: 0 },
      { description: '学生票', price: 99.5 },
    ])
    expect(result.saleTimes[0]).toEqual({ time: '2025-08-01T12:00', note: '预售' })
    expect(result.externalLinks[0]?.label).toBe('购票')
    expect(result.relatedLinks[0]?.label).toBe('官宣')
  })

  it('defaults related links to an empty array', () => {
    const result = eventWriteSchema.parse({ title: '默认链接活动' })

    expect(result.relatedLinks).toEqual([])
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

  it('rejects invalid related links', () => {
    expect(() =>
      eventWriteSchema.parse({
        title: '错误活动',
        relatedLinks: [{ label: '官宣', url: 'not-a-url' }],
      })
    ).toThrow(ZodError)
  })

  it('rejects invalid ticket prices', () => {
    expect(() =>
      eventWriteSchema.parse({
        title: '错误活动',
        ticketPrices: [{ description: '看台' }],
      })
    ).toThrow(ZodError)

    expect(() =>
      eventWriteSchema.parse({
        title: '错误活动',
        ticketPrices: [{ price: -1 }],
      })
    ).toThrow(ZodError)

    expect(() =>
      eventWriteSchema.parse({
        title: '错误活动',
        ticketPrices: [{ price: '280' }],
      })
    ).toThrow(ZodError)

    expect(() =>
      eventWriteSchema.parse({
        title: '错误活动',
        ticketPrices: ['看台 280'],
      })
    ).toThrow(ZodError)
  })

  it('normalizes ticket price descriptions and rejects extra fields', () => {
    expect(
      eventWriteSchema.parse({
        title: '票价活动',
        ticketPrices: [
          { description: '  看台  ', price: 280 },
          { description: '   ', price: 0 },
        ],
      }).ticketPrices
    ).toEqual([{ description: '看台', price: 280 }, { price: 0 }])

    expect(() =>
      eventWriteSchema.parse({
        title: '错误活动',
        ticketPrices: [{ description: '看台', price: 280, currency: 'CNY' }],
      })
    ).toThrow(ZodError)
  })
})
