import { describe, expect, it } from 'vitest'
import {
  addIsoDays,
  buildDailyBuckets,
  buildTrendRowsQuery,
  localDayStartUtcNaive,
  mergeTrendRowsIntoDates,
} from '../../src/server/utils/adminDashboardTrends'

describe('buildDailyBuckets', () => {
  it('生成连续递增的日期轴', () => {
    expect(buildDailyBuckets('2026-02-27', 4)).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ])
  })

  it('跨年滚动正确', () => {
    expect(buildDailyBuckets('2025-12-30', 3)).toEqual(['2025-12-30', '2025-12-31', '2026-01-01'])
  })

  it('生成指定天数的轴且首尾为起止日', () => {
    const buckets = buildDailyBuckets('2026-08-09', 30)
    expect(buckets).toHaveLength(30)
    expect(buckets[0]).toBe('2026-08-09')
    expect(buckets[29]).toBe('2026-09-07')
    const unique = new Set(buckets)
    expect(unique.size).toBe(30)
  })
})

describe('mergeTrendRowsIntoDates', () => {
  const dates = ['2026-03-01', '2026-03-02', '2026-03-03']

  it('缺失日补 0，行数据按日对齐', () => {
    const rows = [
      { day: '2026-03-01', count: 2 },
      { day: '2026-03-03', count: 5 },
    ]
    expect(mergeTrendRowsIntoDates(rows, dates)).toEqual([2, 0, 5])
  })

  it('乱序行也能正确归位', () => {
    const rows = [
      { day: '2026-03-03', count: 7 },
      { day: '2026-03-02', count: 3 },
      { day: '2026-03-01', count: 1 },
    ]
    expect(mergeTrendRowsIntoDates(rows, dates)).toEqual([1, 3, 7])
  })

  it('忽略日期轴之外的行', () => {
    const rows = [
      { day: '2026-02-28', count: 9 },
      { day: '2026-03-02', count: 4 },
    ]
    expect(mergeTrendRowsIntoDates(rows, dates)).toEqual([0, 4, 0])
  })
})

describe('addIsoDays', () => {
  it('支持负数与跨月/跨年', () => {
    expect(addIsoDays('2026-09-07', -29)).toBe('2026-08-09')
    expect(addIsoDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addIsoDays('2026-01-01', -1)).toBe('2025-12-31')
  })
})

describe('localDayStartUtcNaive', () => {
  it('把站点本地日 0 点换算为 UTC 墙上时间', () => {
    expect(localDayStartUtcNaive('2026-09-07')).toBe('2026-09-06 16:00:00')
    expect(localDayStartUtcNaive('2026-01-01')).toBe('2025-12-31 16:00:00')
  })
})

describe('buildTrendRowsQuery', () => {
  it('按站点时区截断并引用指定表', () => {
    const query = buildTrendRowsQuery('Post', '2026-08-09 16:00:00', '2026-09-08 16:00:00')
    expect(query.sql).toContain('"Post"')
    expect(query.sql).toContain("AT TIME ZONE 'UTC' AT TIME ZONE")
    expect(query.values).toContain('Asia/Shanghai')
    expect(query.sql).toContain('COUNT(*)::int')
  })
})
