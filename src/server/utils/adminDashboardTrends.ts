import { Prisma } from '@prisma/client'

// 站点时区：趋势按本地自然日分桶。
// localDayStartUtcNaive 内的 +08:00 固定偏移与本时区配套，调整时需同步修改。
export const DASHBOARD_TZ = 'Asia/Shanghai'

export const DASHBOARD_TREND_DAYS = 30

export type AdminDashboardTrendRow = { day: string; count: number }
export type AdminDashboardTrendSeriesKey = 'posts' | 'galleries' | 'wiki' | 'users'

// Prisma 将 DateTime 存为无时区的 timestamp(3)（UTC 墙上时间），
// 直接 date_trunc 会把东八区 0-8 点的记录算进前一天，需先转站点时区再按日截断。
// 表名由调用方以白名单常量传入，Prisma.raw 拼接安全。
export function buildTrendRowsQuery(table: string, startNaiveUtc: string, endNaiveUtc: string) {
  return Prisma.sql`
    SELECT to_char(
             date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${DASHBOARD_TZ}),
             'YYYY-MM-DD'
           ) AS day,
           COUNT(*)::int AS count
    FROM ${Prisma.raw(`"${table}"`)}
    WHERE "deletedAt" IS NULL
      AND "createdAt" >= ${startNaiveUtc}::timestamp
      AND "createdAt" < ${endNaiveUtc}::timestamp
    GROUP BY 1
  `
}

// 以 UTC 日历日做纯日期推算，避免依赖运行环境的本地时区
export function buildDailyBuckets(rangeStart: string, days: number): string[] {
  const [year, month, day] = rangeStart.split('-').map(Number)
  const cursor = new Date(Date.UTC(year, month - 1, day))
  const buckets: string[] = []
  for (let index = 0; index < days; index += 1) {
    buckets.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return buckets
}

// 把 SQL 按日聚合行对齐到连续日期轴：缺失日补 0，轴外日期忽略
export function mergeTrendRowsIntoDates(rows: AdminDashboardTrendRow[], dates: string[]): number[] {
  const countsByDay = new Map(rows.map((row) => [row.day, row.count]))
  return dates.map((date) => countsByDay.get(date) ?? 0)
}

export function addIsoDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function todayInZone(zone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date())
}

// 站点本地日 0 点对应的 UTC 墙上时间（Naive timestamp 字符串），
// 用于与 timestamp(3) 列直接比较，保持范围查询可走索引
export function localDayStartUtcNaive(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00+08:00`).toISOString().slice(0, 19).replace('T', ' ')
}
