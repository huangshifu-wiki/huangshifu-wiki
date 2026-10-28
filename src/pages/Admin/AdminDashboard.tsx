import { lazy, Suspense } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  ClipboardCheck,
  Cloud,
  FileText,
  HardDrive,
  Images,
  Music,
  RefreshCw,
  Server,
  TrendingUp,
  Users,
} from '@/src/components/icons'
import { Badge, Button, LinkButton, LoadErrorState, Panel, Skeleton } from '@/src/components/ui'
import { AdminSection } from '@/src/components/admin/AdminSection'
import { StatCard } from '@/src/components/admin/StatCard'
import { clsx } from 'clsx'
import { formatDateTime } from '../../lib/dateUtils'
import { useDashboardOverview } from './useDashboardOverview'
import type {
  AdminDashboardCloudSyncStats,
  AdminDashboardDiskStatus,
  AdminDashboardSubsystem,
  AdminDashboardVariantStats,
} from '../../types/api'

const TrendChart = lazy(() => import('@/src/components/charts/TrendChart'))

const STAT_ITEMS = [
  { key: 'wiki', label: '百科页面', icon: BookOpen, to: '/admin/wiki' },
  { key: 'posts', label: '帖子', icon: FileText, to: '/admin/posts' },
  { key: 'galleries', label: '图库', icon: Images, to: '/admin/galleries' },
  { key: 'users', label: '用户', icon: Users, to: '/admin/users' },
  { key: 'music', label: '音乐', icon: Music, to: '/admin/music' },
] as const

const REVIEW_ITEMS = [
  { key: 'wiki', label: '百科' },
  { key: 'posts', label: '帖子' },
  { key: 'galleries', label: '图库' },
  { key: 'tickets', label: '门票' },
] as const

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-9 w-36" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: STAT_ITEMS.length }, (_, index) => (
          <Skeleton key={index} className="h-[86px]" />
        ))}
      </div>
      <Skeleton className="h-[364px]" />
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-[168px]" />
        ))}
      </div>
    </div>
  )
}

function SubsystemUnavailableCard({ error }: { error: string }) {
  return (
    <Panel className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <AlertTriangle size={16} className="text-[var(--color-warning)]" aria-hidden />
          状态未知
        </span>
        <Badge variant="danger">不可用</Badge>
      </div>
      <p className="text-sm text-text-secondary">{error}</p>
    </Panel>
  )
}

function DiskHealthCard({
  subsystem,
}: {
  subsystem: AdminDashboardSubsystem<AdminDashboardDiskStatus>
}) {
  // 项目未开启 strict，布尔判别窄化不可用，统一用 'error' in 判别子系统状态
  if ('error' in subsystem) return <SubsystemUnavailableCard error={subsystem.error} />
  const disk = subsystem.data
  const badgeVariant =
    disk.status === 'healthy' ? 'success' : disk.status === 'warning' ? 'warning' : 'danger'
  const badgeText = disk.status === 'healthy' ? '健康' : disk.status === 'warning' ? '警告' : '危险'
  const barColorClass =
    disk.status === 'healthy'
      ? 'bg-[var(--color-success)]'
      : disk.status === 'warning'
        ? 'bg-[var(--color-warning)]'
        : 'bg-[var(--color-error)]'

  return (
    <Panel className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <HardDrive size={16} className="text-text-muted" aria-hidden />
          磁盘
        </span>
        <Badge variant={badgeVariant}>{badgeText}</Badge>
      </div>
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-lg font-semibold tabular-nums text-text-primary">
            {disk.usagePercent}%
          </span>
          <span className="text-xs text-text-muted">
            剩余 {disk.freeSpaceGB} GB / 共 {disk.totalSpaceGB} GB
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-alt">
          <div
            className={clsx('h-full rounded-full', barColorClass)}
            style={{ width: `${Math.min(disk.usagePercent, 100)}%` }}
          />
        </div>
      </div>
      <LinkButton to="/admin/disk-monitor" variant="ghost" size="sm" className="self-start">
        查看详情
      </LinkButton>
    </Panel>
  )
}

function VariantsHealthCard({
  subsystem,
}: {
  subsystem: AdminDashboardSubsystem<AdminDashboardVariantStats>
}) {
  if ('error' in subsystem) return <SubsystemUnavailableCard error={subsystem.error} />
  const variants = subsystem.data

  return (
    <Panel className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Server size={16} className="text-text-muted" aria-hidden />
          变体生成
        </span>
        <Badge variant={variants.failedToday > 0 ? 'danger' : 'success'}>
          {variants.failedToday > 0 ? `今日失败 ${variants.failedToday}` : '运行正常'}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {(
          [
            ['队列中', variants.queueLength],
            ['处理中', variants.processingCount],
            ['今日完成', variants.completedToday],
            ['今日失败', variants.failedToday],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-text-secondary">{label}</span>
            <span
              className={clsx(
                'font-semibold tabular-nums',
                label === '今日失败' && value > 0
                  ? 'text-[var(--color-error)]'
                  : 'text-text-primary'
              )}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
      <LinkButton to="/admin/variant-manager" variant="ghost" size="sm" className="self-start">
        查看详情
      </LinkButton>
    </Panel>
  )
}

function CloudSyncHealthCard({
  subsystem,
}: {
  subsystem: AdminDashboardSubsystem<AdminDashboardCloudSyncStats>
}) {
  if ('error' in subsystem) return <SubsystemUnavailableCard error={subsystem.error} />
  const cloudSync = subsystem.data

  return (
    <Panel className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Cloud size={16} className="text-text-muted" aria-hidden />
          云同步
        </span>
        <Badge variant={cloudSync.available ? 'success' : 'neutral'}>
          {cloudSync.available ? '已连接' : '未配置'}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {(
          [
            ['队列中', cloudSync.queueLength],
            ['处理中', cloudSync.processingCount],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-text-secondary">{label}</span>
            <span className="font-semibold tabular-nums text-text-primary">{value}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-text-muted">外部图床同步任务由系统自动调度</p>
    </Panel>
  )
}

export const AdminDashboard = () => {
  const { data, loading, refreshing, loadError, lastUpdated, refresh } = useDashboardOverview()

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="font-[var(--book-title-font)] text-3xl font-normal tracking-[0.12em] text-text-primary">
          仪表盘
        </h1>
        <DashboardSkeleton />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <h1 className="font-[var(--book-title-font)] text-3xl font-normal tracking-[0.12em] text-text-primary">
          仪表盘
        </h1>
        <LoadErrorState
          title="仪表盘数据加载失败"
          description="请稍后重试，若持续失败请检查服务端状态。"
          error={loadError}
          retryLabel="重新加载"
          onRetry={refresh}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-[var(--book-title-font)] text-3xl font-normal tracking-[0.12em] text-text-primary">
          仪表盘
        </h1>
        <div className="flex items-center gap-3">
          {lastUpdated ? (
            <span className="text-xs text-text-muted">更新于 {formatDateTime(lastUpdated)}</span>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={refresh}
            loading={refreshing}
            leftIcon={<RefreshCw size={14} />}
          >
            刷新
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {STAT_ITEMS.map(({ key, label, icon, to }) => (
          <StatCard key={key} label={label} value={data.stats[key]} icon={icon} to={to} />
        ))}
      </div>

      <AdminSection id="trend" icon={<TrendingUp size={18} />} title="近 30 天新增趋势">
        <Panel className="p-4">
          <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
            <TrendChart dates={data.trends.dates} series={data.trends.series} />
          </Suspense>
        </Panel>
      </AdminSection>

      <AdminSection id="review" icon={<ClipboardCheck size={18} />} title="待审核队列">
        <Panel className="p-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {REVIEW_ITEMS.map(({ key, label }) => (
              <div key={key} className="flex flex-col gap-1">
                <span className="text-sm text-text-secondary">{label}</span>
                <span className="text-xl font-semibold tabular-nums text-text-primary">
                  {data.reviewQueue.counts[key].toLocaleString('zh-CN')}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              共 {data.reviewQueue.total.toLocaleString('zh-CN')} 条待处理
              {data.reviewQueue.total > 0 ? (
                <Badge variant="warning">需要处理</Badge>
              ) : (
                <Badge variant="success">已清空</Badge>
              )}
            </div>
            <LinkButton
              to="/admin/reviews"
              variant={data.reviewQueue.total > 0 ? 'primary' : 'secondary'}
              size="sm"
              rightIcon={<ArrowRight size={14} />}
            >
              去处理
            </LinkButton>
          </div>
        </Panel>
      </AdminSection>

      <AdminSection id="system" icon={<Server size={18} />} title="系统健康">
        <div className="grid gap-4 lg:grid-cols-3">
          <DiskHealthCard subsystem={data.system.disk} />
          <VariantsHealthCard subsystem={data.system.variants} />
          <CloudSyncHealthCard subsystem={data.system.cloudSync} />
        </div>
      </AdminSection>
    </div>
  )
}

export default AdminDashboard
