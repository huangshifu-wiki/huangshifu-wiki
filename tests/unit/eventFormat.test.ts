import { describe, expect, it } from 'vitest'
import { formatEventTimeSlot } from '../../src/lib/eventFormat'
import type { EventTimeSlot } from '../../src/types/entities'

const buildSlot = (type: EventTimeSlot['type'], start: string, end?: string): EventTimeSlot => ({
  type,
  start,
  ...(end ? { end } : {}),
})

describe('formatEventTimeSlot', () => {
  it('仅日期类型在日期后追加星期', () => {
    expect(formatEventTimeSlot(buildSlot('date', '2024-06-15'))).toBe('2024-06-15（周六）')
  })

  it('仅日期类型两端为同一天时不重复展示', () => {
    expect(formatEventTimeSlot(buildSlot('date', '2024-06-15', '2024-06-15'))).toBe(
      '2024-06-15（周六）'
    )
  })

  it('仅日期类型跨日区间两端都标星期', () => {
    expect(formatEventTimeSlot(buildSlot('date', '2024-06-15', '2024-06-16'))).toBe(
      '2024-06-15（周六） - 2024-06-16（周日）'
    )
  })

  it('日期时间类型同日区间只在开始端标星期', () => {
    expect(formatEventTimeSlot(buildSlot('datetime', '2024-06-15T19:30', '2024-06-15T21:30'))).toBe(
      '2024-06-15（周六）19:30 - 2024-06-15 21:30'
    )
  })

  it('日期时间类型跨日区间两端都标星期', () => {
    expect(formatEventTimeSlot(buildSlot('datetime', '2024-06-15T19:30', '2024-06-16T01:00'))).toBe(
      '2024-06-15（周六）19:30 - 2024-06-16（周日）01:00'
    )
  })

  it('无法解析的时间保持原有输出且不追加星期', () => {
    expect(formatEventTimeSlot(buildSlot('datetime', '待定'))).toBe('刚刚')
    expect(formatEventTimeSlot(buildSlot('date', '待定'))).toBe('待定')
    expect(formatEventTimeSlot(buildSlot('datetime', ''))).toBe('')
  })
})
