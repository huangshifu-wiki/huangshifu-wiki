import { cloudSyncService } from '../services/cloudSyncService'
import { diskMonitor } from '../services/diskMonitor.service'
import { variantGenerator } from '../services/variantGenerator'
import { prisma } from './config'
import {
  DASHBOARD_TREND_DAYS,
  DASHBOARD_TZ,
  addIsoDays,
  buildDailyBuckets,
  buildTrendRowsQuery,
  localDayStartUtcNaive,
  mergeTrendRowsIntoDates,
  todayInZone,
} from './adminDashboardTrends'
import type { AdminDashboardTrendRow, AdminDashboardTrendSeriesKey } from './adminDashboardTrends'
import type {
  AdminDashboardCloudSyncStats,
  AdminDashboardDiskStatus,
  AdminDashboardOverview,
  AdminDashboardReviewQueue,
  AdminDashboardStats,
  AdminDashboardSubsystem,
  AdminDashboardTrends,
  AdminDashboardVariantStats,
} from '../../types/api'

const TREND_SOURCES = [
  { key: 'posts', table: 'Post' },
  { key: 'galleries', table: 'Gallery' },
  { key: 'wiki', table: 'WikiPage' },
  { key: 'users', table: 'User' },
] as const satisfies readonly { key: AdminDashboardTrendSeriesKey; table: string }[]

async function fetchContentStats(): Promise<AdminDashboardStats> {
  const [wiki, posts, galleries, users, music] = await Promise.all([
    prisma.wikiPage.count({ where: { deletedAt: null } }),
    prisma.post.count({ where: { deletedAt: null } }),
    prisma.gallery.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.musicTrack.count({ where: { deletedAt: null } }),
  ])
  return { wiki, posts, galleries, users, music }
}

async function fetchReviewQueue(): Promise<AdminDashboardReviewQueue> {
  const where = { status: 'pending' as const, deletedAt: null }
  const [wiki, posts, galleries, tickets] = await Promise.all([
    prisma.wikiPage.count({ where }),
    prisma.post.count({ where }),
    prisma.gallery.count({ where }),
    prisma.ticketListing.count({ where }),
  ])
  return {
    status: 'pending',
    counts: { wiki, posts, galleries, tickets },
    total: wiki + posts + galleries + tickets,
  }
}

function toErrorText(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback
}

// 读后台监控的缓存状态即可满足总览精度，避免每次轮询都触发全量目录扫描
async function fetchDiskStatus(): Promise<AdminDashboardDiskStatus> {
  const status = diskMonitor.getStatus() ?? (await diskMonitor.checkDiskSpace())
  return { ...status, lastChecked: status.lastChecked.toISOString() }
}

async function fetchSystemHealth(): Promise<AdminDashboardOverview['system']> {
  const [diskResult, variantsResult, cloudSyncResult] = await Promise.allSettled([
    fetchDiskStatus(),
    Promise.resolve(variantGenerator.getQueueStats()),
    Promise.resolve(cloudSyncService.getQueueStats()),
  ])

  const disk: AdminDashboardSubsystem<AdminDashboardDiskStatus> =
    diskResult.status === 'fulfilled'
      ? { data: diskResult.value }
      : { error: toErrorText(diskResult.reason, '磁盘状态查询失败') }

  const variants: AdminDashboardSubsystem<AdminDashboardVariantStats> =
    variantsResult.status === 'fulfilled'
      ? { data: variantsResult.value }
      : { error: toErrorText(variantsResult.reason, '变体队列状态查询失败') }

  const cloudSync: AdminDashboardSubsystem<AdminDashboardCloudSyncStats> =
    cloudSyncResult.status === 'fulfilled'
      ? {
          data: {
            ...cloudSyncResult.value,
            available: cloudSyncService.isLskyProAvailable(),
          },
        }
      : { error: toErrorText(cloudSyncResult.reason, '云同步状态查询失败') }

  return { disk, variants, cloudSync }
}

async function fetchTrendRows(
  startNaiveUtc: string,
  endNaiveUtc: string
): Promise<Record<AdminDashboardTrendSeriesKey, AdminDashboardTrendRow[]>> {
  const entries = await Promise.all(
    TREND_SOURCES.map(async ({ key, table }) => {
      const rows = await prisma.$queryRaw<AdminDashboardTrendRow[]>(
        buildTrendRowsQuery(table, startNaiveUtc, endNaiveUtc)
      )
      return [key, rows] as const
    })
  )
  return Object.fromEntries(entries) as Record<
    AdminDashboardTrendSeriesKey,
    AdminDashboardTrendRow[]
  >
}

async function fetchTrends(): Promise<AdminDashboardTrends> {
  const rangeEnd = todayInZone(DASHBOARD_TZ)
  const rangeStart = addIsoDays(rangeEnd, -(DASHBOARD_TREND_DAYS - 1))
  const dates = buildDailyBuckets(rangeStart, DASHBOARD_TREND_DAYS)
  const startNaiveUtc = localDayStartUtcNaive(rangeStart)
  const endNaiveUtc = localDayStartUtcNaive(addIsoDays(rangeEnd, 1))

  const rowsBySeries = await fetchTrendRows(startNaiveUtc, endNaiveUtc)

  const series = {
    posts: mergeTrendRowsIntoDates(rowsBySeries.posts, dates),
    galleries: mergeTrendRowsIntoDates(rowsBySeries.galleries, dates),
    wiki: mergeTrendRowsIntoDates(rowsBySeries.wiki, dates),
    users: mergeTrendRowsIntoDates(rowsBySeries.users, dates),
  }

  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

  return {
    days: DASHBOARD_TREND_DAYS,
    granularity: 'day',
    rangeStart,
    rangeEnd,
    dates,
    series,
    totals: {
      posts: sum(series.posts),
      galleries: sum(series.galleries),
      wiki: sum(series.wiki),
      users: sum(series.users),
    },
  }
}

export async function getDashboardOverview(): Promise<AdminDashboardOverview> {
  const [stats, reviewQueue, system, trends] = await Promise.all([
    fetchContentStats(),
    fetchReviewQueue(),
    fetchSystemHealth(),
    fetchTrends(),
  ])
  return { stats, reviewQueue, system, trends }
}
