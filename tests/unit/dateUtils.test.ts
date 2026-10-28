import { describe, expect, it } from 'vitest'
import {
  formatDateOnly,
  formatWeekday,
  toDateOnlyValue,
  toLocalDateInputValue,
} from '../../src/lib/dateUtils'

describe('dateUtils', () => {
  it('builds date input defaults from local date parts', () => {
    expect(toLocalDateInputValue(new Date(2026, 6, 8, 1, 5))).toBe('2026-07-08')
  })

  it('formats date-only strings without fabricating a time', () => {
    expect(formatDateOnly('2024-06-15')).toBe('2024-06-15')
    expect(formatDateOnly('2024-06-15', 'MM-dd')).toBe('06-15')
  })

  it('validates date-only strings before formatting', () => {
    expect(toDateOnlyValue('2024-02-29')).toBeInstanceOf(Date)
    expect(toDateOnlyValue('2024-02-31')).toBeNull()
    expect(formatDateOnly('2024-02-31', 'yyyy-MM-dd', 'N/A')).toBe('N/A')
  })

  it('formats Chinese weekdays and leaves unparsable values empty', () => {
    expect(formatWeekday('2024-06-15')).toBe('周六')
    expect(formatWeekday('2024-06-16T19:30')).toBe('周日')
    expect(formatWeekday('待定')).toBe('')
    expect(formatWeekday(null)).toBe('')
  })
})
