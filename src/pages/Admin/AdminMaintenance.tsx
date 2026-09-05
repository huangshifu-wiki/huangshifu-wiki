import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  CheckCircle,
  Database,
  Images,
  Layers,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from '@/src/components/icons'
import type { LucideIcon } from '@/src/components/icons'
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  LoadErrorState,
  Panel,
  SegmentedControl,
  Select,
  Skeleton,
  Switch,
} from '@/src/components/ui'
import { apiGet, apiPost } from '../../lib/apiClient'
import { useDialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../context/AuthContext'
import { AdminSection, SectionHeading } from '../../components/admin/AdminSection'
import { getErrorMessage } from '../../lib/errorHandler'

import type {
  ApiSuccessResponse,
  MediaMaintenanceBatchResult,
  MediaMaintenanceMode,
  MediaMaintenanceOperation,
  MediaMaintenanceOrphanDelete,
  MediaMaintenanceOrphanPreview,
  MediaMaintenanceScanResult,
  MediaMaintenanceType,
} from '../../types/api'

type Operation = Exclude<MediaMaintenanceOperation, 'scan' | 'orphans/preview' | 'orphans/delete'>
type BadgeVariant = 'neutral' | 'primary' | 'danger' | 'warning' | 'success'

type OperationInfo = {
  title: string
  icon: LucideIcon
  purpose: string
  willDo: string
  willNotDo: string
}

const operations: Operation[] = ['reconcile', 'bind-legacy', 'localize', 'repair-thumbnails']

const operationInfo: Record<Operation, OperationInfo> = {
  reconcile: {
    title: '规范化媒体关系',
    icon: Layers,
    purpose: '把已有上传资源与按文件内容识别的规范图片重新对应，并安全收敛旧 URL 引用。',
    willDo:
      '检查本地文件、MD5、MediaAsset 和 ImageMap 关系；执行模式可能更新关系和旧引用，并补入缺失缩略图队列。',
    willNotDo: '不会按文件名或相似外观合并图片；无法读取或冲突的记录只会报告。',
  },
  'bind-legacy': {
    title: '绑定历史媒体',
    icon: Database,
    purpose: '为旧图库、活动、歌曲封面和专辑封面补齐缺失的媒体关系。',
    willDo: '优先使用已有规范关系和可验证的本地文件；成功绑定后按目标去重地补入缩略图任务。',
    willNotDo: '不会把不明确归属的资源强行分配给任意用户，也不会把外部 URL 当作本站文件。',
  },
  localize: {
    title: '本地化远程图片',
    icon: Images,
    purpose: '将仍指向外部地址的图片下载到本站媒体系统。',
    willDo: '下载并校验图片，创建或复用规范图片和逻辑绑定，更新原业务引用，并为新资源生成缩略图。',
    willNotDo: '预览模式不会下载；下载失败只影响当前记录，不会写入虚假的 URL。',
  },
  'repair-thumbnails': {
    title: '修复缺失缩略图',
    icon: RefreshCw,
    purpose: '只为没有 thumbnail 的规范图片补入生成队列。',
    willDo:
      '包括 completed + thumbnailUrl 为空的历史异常；会从规范原图或已绑定资源寻找本地源文件。',
    willNotDo: '不会覆盖已有缩略图；找不到原图会跳过并显示原因；同一规范图片不会重复生成。',
  },
}

const maintenanceTypeLabels: Record<MediaMaintenanceType, string> = {
  all: '全部类型',
  gallery: '图库图片',
  song: '歌曲封面',
  album: '专辑封面',
}

const maintenanceModeLabels: Record<MediaMaintenanceMode, string> = {
  'dry-run': '仅预览',
  apply: '执行',
}

const isMaintenanceMode = (value: string): value is MediaMaintenanceMode =>
  value === 'dry-run' || value === 'apply'
const isMaintenanceType = (value: string): value is MediaMaintenanceType =>
  value === 'all' || value === 'gallery' || value === 'song' || value === 'album'

const getCursorKey = (
  operation: Operation,
  mode: MediaMaintenanceMode,
  type: MediaMaintenanceType
) => `${operation}:${mode}:${operation === 'localize' ? type : 'all'}`

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** unitIndex
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

const getResultStatusLabel = (status: string) => {
  if (status === 'processed') return '已处理'
  if (status === 'skipped') return '已跳过'
  if (status === 'failed') return '失败'
  return '未分类'
}

const getResultStatusVariant = (status: string): BadgeVariant => {
  if (status === 'processed') return 'success'
  if (status === 'skipped') return 'warning'
  if (status === 'failed') return 'danger'
  return 'neutral'
}

const getDetailTypeLabel = (type?: MediaMaintenanceType) =>
  type ? maintenanceTypeLabels[type] : '媒体记录'

const StatCard = ({
  label,
  value,
  description,
  variant = 'neutral',
  badgeLabel,
}: {
  label: string
  value: ReactNode
  description: string
  variant?: BadgeVariant
  badgeLabel: string
}) => (
  <div className="min-w-0 rounded bg-surface-alt p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[11px] text-text-muted">{label}</span>
      <Badge variant={variant}>{badgeLabel}</Badge>
    </div>
    <p className="mt-2 text-xl font-bold text-text-primary">{value}</p>
    <p className="mt-1 break-words text-xs leading-relaxed text-text-muted">{description}</p>
  </div>
)

const ResultMetric = ({
  label,
  value,
  variant = 'neutral',
}: {
  label: string
  value: ReactNode
  variant?: BadgeVariant
}) => (
  <div className="rounded bg-surface p-3">
    <p className="text-[11px] text-text-muted">{label}</p>
    <p
      className={`mt-1 text-lg font-semibold ${
        variant === 'danger'
          ? 'theme-text-error'
          : variant === 'warning'
            ? 'theme-text-warning'
            : variant === 'success'
              ? 'theme-text-success'
              : 'text-text-primary'
      }`}
    >
      {value}
    </p>
  </div>
)

export const AdminMaintenance = () => {
  const { profile } = useAuth()
  const dialog = useDialog()
  const { show } = useToast()
  const [mode, setMode] = useState<MediaMaintenanceMode>('dry-run')
  const [maintenanceType, setMaintenanceType] = useState<MediaMaintenanceType>('all')
  const [batchSize, setBatchSize] = useState('100')
  const [orphanAge, setOrphanAge] = useState('1')
  const [includeVariants, setIncludeVariants] = useState(false)
  const [cursor, setCursor] = useState<Record<string, string | null>>({})
  const [results, setResults] = useState<Record<string, MediaMaintenanceBatchResult>>({})
  const [activeOperation, setActiveOperation] = useState<Operation | null>(null)
  const [scanResult, setScanResult] = useState<MediaMaintenanceScanResult | null>(null)
  const [lastScannedAt, setLastScannedAt] = useState<string | null>(null)
  const [orphanPreview, setOrphanPreview] = useState<MediaMaintenanceOrphanPreview | null>(null)
  const [orphanPreviews, setOrphanPreviews] = useState<MediaMaintenanceOrphanPreview[]>([])
  const [orphanResult, setOrphanResult] = useState<MediaMaintenanceOrphanDelete | null>(null)
  const [orphanCursor, setOrphanCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [orphanLoading, setOrphanLoading] = useState(false)
  const [orphanAction, setOrphanAction] = useState<'preview' | 'delete' | null>(null)

  useEffect(() => {
    setOrphanCursor(null)
    setOrphanPreview(null)
    setOrphanPreviews([])
    setOrphanResult(null)
  }, [includeVariants, orphanAge])

  const value = Number(batchSize)
  const parsedBatchSize = Number.isInteger(value) && value >= 1 && value <= 100 ? value : 100

  const runOperation = useCallback(
    async (operation: Operation) => {
      if (activeOperation || scanning || orphanLoading) return
      const info = operationInfo[operation]
      setActiveOperation(operation)
      if (mode === 'apply') {
        const confirmed = await dialog.confirm({
          title: info.title,
          message: `${info.purpose}\n\n${info.willDo}\n\n这是执行模式，会修改媒体数据。确认继续吗？`,
          confirmText: '执行这一批',
          variant: 'warning',
        })
        if (!confirmed) {
          setActiveOperation(null)
          return
        }
      }
      setError(null)
      try {
        const response = await apiPost<ApiSuccessResponse<MediaMaintenanceBatchResult>>(
          `/api/admin/media-maintenance/${operation}`,
          {
            mode,
            batchSize: parsedBatchSize,
            type: operation === 'localize' ? maintenanceType : 'all',
            cursor: cursor[getCursorKey(operation, mode, maintenanceType)] || undefined,
          }
        )
        if (!response.success) throw new Error('维护操作失败')
        const requestKey = getCursorKey(operation, mode, maintenanceType)
        setResults((previous) => ({ ...previous, [requestKey]: response.data }))
        setCursor((previous) => ({
          ...previous,
          [requestKey]: response.data.hasMore ? response.data.nextCursor : null,
        }))
        show(
          `${maintenanceModeLabels[mode]}完成：处理 ${response.data.processed} 条，跳过 ${response.data.skipped} 条，失败 ${response.data.failed} 条${
            response.data.queued !== undefined
              ? `；已入队 ${response.data.queued} 条，缺少原图 ${response.data.skippedMissingSource ?? 0} 条`
              : ''
          }`,
          { variant: response.data.failed > 0 ? 'warning' : 'success' }
        )
      } catch (requestError) {
        setError(getErrorMessage(requestError, `${info.title}失败`))
      } finally {
        setActiveOperation(null)
      }
    },
    [
      activeOperation,
      cursor,
      dialog,
      maintenanceType,
      mode,
      orphanLoading,
      parsedBatchSize,
      scanning,
      show,
    ]
  )

  const runScan = useCallback(async () => {
    if (scanning || activeOperation || orphanLoading) return
    setScanning(true)
    setError(null)
    setScanError(null)
    try {
      const response = await apiGet<ApiSuccessResponse<MediaMaintenanceScanResult>>(
        '/api/admin/media-maintenance/scan',
        { mode: 'strict', limit: parsedBatchSize },
        { staleTime: 0, swr: false }
      )
      if (!response.success) throw new Error('媒体扫描失败')
      setScanResult(response.data)
      setLastScannedAt(new Date().toISOString())
      show('媒体扫描完成，以下数量是本次扫描快照', { variant: 'success' })
    } catch (requestError) {
      setScanError(getErrorMessage(requestError, '媒体扫描失败'))
    } finally {
      setScanning(false)
    }
  }, [activeOperation, orphanLoading, parsedBatchSize, scanning, show])

  const previewOrphans = useCallback(async () => {
    if (orphanLoading || activeOperation || scanning) return
    setOrphanLoading(true)
    setOrphanAction('preview')
    setError(null)
    try {
      const response = await apiPost<ApiSuccessResponse<MediaMaintenanceOrphanPreview>>(
        '/api/admin/media-maintenance/orphans/preview',
        {
          cursor: orphanCursor || undefined,
          batchSize: parsedBatchSize,
          olderThanHours: Number(orphanAge) >= 0 ? Number(orphanAge) : 1,
          includeVariants,
        }
      )
      if (!response.success) throw new Error('孤儿文件预览失败')
      setOrphanPreview(response.data)
      setOrphanPreviews((previous) =>
        orphanCursor ? [...previous, response.data] : [response.data]
      )
      setOrphanCursor(response.data.hasMore ? response.data.nextCursor : null)
      setOrphanResult(null)
      show(
        `预览完成：发现 ${response.data.storageKeys.length} 个候选文件，共 ${formatBytes(response.data.totalBytes)}`,
        { variant: 'success' }
      )
    } catch (requestError) {
      setError(getErrorMessage(requestError, '孤儿文件预览失败'))
    } finally {
      setOrphanAction(null)
      setOrphanLoading(false)
    }
  }, [
    activeOperation,
    includeVariants,
    orphanAge,
    orphanCursor,
    orphanLoading,
    parsedBatchSize,
    scanning,
    show,
  ])

  const deleteOrphans = useCallback(async () => {
    if (
      !orphanPreview ||
      orphanLoading ||
      activeOperation ||
      scanning ||
      profile?.role !== 'super_admin'
    )
      return
    setOrphanLoading(true)
    setOrphanAction('delete')
    const confirmed = await dialog.confirm({
      title: '删除本次预览文件',
      message: `将删除当前批次预览中的 ${orphanPreview.storageKeys.length} 个${orphanPreview.includeVariants ? '（含变体）' : ''}文件。服务端会再次检查引用、年龄、路径、大小、修改时间和指纹；预览后的新增引用会被跳过。确认继续吗？`,
      confirmText: '删除文件',
      variant: 'danger',
    })
    if (!confirmed) {
      setOrphanAction(null)
      setOrphanLoading(false)
      return
    }
    setError(null)
    try {
      const response = await apiPost<ApiSuccessResponse<MediaMaintenanceOrphanDelete>>(
        '/api/admin/media-maintenance/orphans/delete',
        {
          previewToken: orphanPreview.previewToken,
          storageKeys: orphanPreview.storageKeys,
        }
      )
      if (!response.success) throw new Error('孤儿文件删除失败')
      setOrphanResult(response.data)
      setOrphanPreview(null)
      show(
        `删除检查完成：删除 ${response.data.processed} 个，跳过 ${response.data.skipped} 个，失败 ${response.data.failed} 个`,
        { variant: response.data.failed > 0 ? 'warning' : 'success' }
      )
    } catch (requestError) {
      setError(getErrorMessage(requestError, '孤儿文件删除失败'))
    } finally {
      setOrphanAction(null)
      setOrphanLoading(false)
    }
  }, [activeOperation, dialog, orphanLoading, orphanPreview, profile?.role, scanning, show])

  const renderBatchResult = (result: MediaMaintenanceBatchResult | undefined) => {
    if (!result) return null
    const isOrphanDelete = result.operation === 'orphans/delete'
    const statusVariant: BadgeVariant =
      result.failed > 0 ? 'danger' : result.hasMore ? 'primary' : 'success'
    return (
      <div
        className="mt-4 space-y-4 rounded border border-border bg-surface-alt p-4"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={result.mode === 'apply' ? 'warning' : 'neutral'}>
              {result.mode === 'apply' ? '执行' : '仅预览'}
            </Badge>
            <Badge variant={statusVariant}>{result.hasMore ? '还有下一批' : '本批已完成'}</Badge>
            <span className="text-xs text-text-muted">
              范围：{maintenanceTypeLabels[result.type]}
            </span>
          </div>
          <span className="text-xs text-text-muted">本批扫描：{result.scanned} 条记录</span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <ResultMetric
            label={isOrphanDelete ? '已删除' : '已处理'}
            value={result.processed}
            variant="success"
          />
          <ResultMetric label="已跳过" value={result.skipped} variant="warning" />
          <ResultMetric
            label="失败"
            value={result.failed}
            variant={result.failed > 0 ? 'danger' : 'neutral'}
          />
          {result.conflicts !== undefined && (
            <ResultMetric label="并发冲突" value={result.conflicts} variant="warning" />
          )}
          {!isOrphanDelete && <ResultMetric label="扫描记录" value={result.scanned} />}
          {isOrphanDelete && (
            <ResultMetric
              label="删除空间"
              value={formatBytes((result as MediaMaintenanceOrphanDelete).deletedBytes)}
            />
          )}
        </div>
        {!isOrphanDelete && result.queued !== undefined && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <ResultMetric label="已入队" value={result.queued} variant="primary" />
            <ResultMetric label="已有任务" value={result.alreadyQueued ?? 0} variant="neutral" />
            <ResultMetric
              label="缺少原图"
              value={result.skippedMissingSource ?? 0}
              variant="warning"
            />
          </div>
        )}
        <details className="rounded border border-border bg-surface p-3">
          <summary className="cursor-pointer text-sm font-medium text-text-primary">
            查看本批明细（{result.details.length} 条）
          </summary>
          {result.details.length === 0 ? (
            <p className="mt-3 text-xs text-text-muted">本批没有需要逐条说明的记录。</p>
          ) : (
            <ul className="mt-3 max-h-56 space-y-2 overflow-auto text-xs text-text-secondary">
              {result.details.map((detail, index) => (
                <li
                  key={`${detail.id}-${detail.status}-${index}`}
                  className="min-w-0 border-t border-border pt-2 first:border-0 first:pt-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={getResultStatusVariant(detail.status)}>
                      {getResultStatusLabel(detail.status)}
                    </Badge>
                    <span className="text-text-muted">{getDetailTypeLabel(detail.type)}</span>
                    <code className="break-all text-[11px] text-text-primary">{detail.id}</code>
                  </div>
                  {detail.reason && (
                    <p className="mt-1 break-all text-text-muted">原因：{detail.reason}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </details>
        <p className="text-xs text-text-muted">
          {result.hasMore
            ? '还有下一批，点击对应操作卡片的“继续下一批”。游标按操作、模式和类型分别保存。'
            : '本操作已完成，可重新从第一批开始。'}
        </p>
      </div>
    )
  }

  const scanCounts = scanResult?.counts
  const needsAttention = scanCounts
    ? scanCounts.missingThumbnails +
      scanCounts.unboundMediaAssets +
      scanCounts.legacyUrlOnlyRecords +
      scanCounts.remoteCandidates +
      scanCounts.orphanFiles +
      (scanCounts.orphanBytes > 0 ? 1 : 0) +
      scanCounts.missingLocalFiles +
      scanCounts.retiredMedia
    : 0
  const scanGroups = scanCounts
    ? [
        {
          title: '需要修复',
          hint: '这些数量提示关系、缩略图或本地原图可能需要处理；执行前仍会重新校验。',
          items: [
            {
              label: '缺失缩略图',
              value: scanCounts.missingThumbnails,
              description: '没有可用缩略图的规范图片；包含历史 completed 但 URL 为空的记录。',
              variant: 'warning' as BadgeVariant,
              badgeLabel: scanCounts.missingThumbnails === 0 ? '正常' : '需关注',
            },
            {
              label: '未绑定上传资源',
              value: scanCounts.unboundMediaAssets,
              description: '有逻辑使用权但尚未关联规范图片。',
              variant: 'warning' as BadgeVariant,
              badgeLabel: scanCounts.unboundMediaAssets === 0 ? '正常' : '需关注',
            },
          ],
        },
        {
          title: '需要收敛',
          hint: '这些数量代表旧格式或外部地址；本地化或绑定前请先查看操作说明。',
          items: [
            {
              label: '历史 URL-only 记录',
              value: scanCounts.legacyUrlOnlyRecords,
              description: '只有 URL、没有结构化媒体关系的历史业务记录。',
              variant: 'warning' as BadgeVariant,
              badgeLabel: scanCounts.legacyUrlOnlyRecords === 0 ? '正常' : '需关注',
            },
            {
              label: '远程图片候选',
              value: scanCounts.remoteCandidates,
              description: '仍指向外部图床或网站的业务图片。',
              variant: 'warning' as BadgeVariant,
              badgeLabel: scanCounts.remoteCandidates === 0 ? '正常' : '需关注',
            },
          ],
        },
        {
          title: '需要谨慎',
          hint: '这些是清理、引用或生命周期信号；数量为扫描快照，不代表可以立即删除。',
          items: [
            {
              label: '疑似孤儿文件',
              value: scanCounts.orphanFiles,
              description: '上传目录中暂时没有业务引用的本地文件。删除前必须单独预览。',
              variant: 'danger' as BadgeVariant,
              badgeLabel: scanCounts.orphanFiles === 0 ? '正常' : '危险操作',
            },
            {
              label: '占用空间',
              value: formatBytes(scanCounts.orphanBytes),
              description: '疑似孤儿文件占用的本地空间。',
              variant: (scanCounts.orphanBytes > 0 ? 'warning' : 'neutral') as BadgeVariant,
              badgeLabel: scanCounts.orphanBytes === 0 ? '正常' : '需复核',
            },
            {
              label: '共享规范图片',
              value: scanCounts.sharedImageMaps,
              description: '被多个业务引用共享的同一份物理图片。',
              variant: 'primary' as BadgeVariant,
              badgeLabel: '共享',
            },
            {
              label: '活跃上传会话',
              value: scanCounts.activeUploadSessions,
              description: '仍在有效期内的上传会话，清理时应避开。',
              variant: 'neutral' as BadgeVariant,
              badgeLabel: '会话',
            },
            {
              label: '本地原图缺失',
              value: scanCounts.missingLocalFiles,
              description: '数据库有媒体记录，但预期的本地原图无法读取。',
              variant: 'danger' as BadgeVariant,
              badgeLabel: scanCounts.missingLocalFiles === 0 ? '正常' : '需处理',
            },
            {
              label: '等待回收媒体',
              value: scanCounts.retiredMedia,
              description: '已标记退役、等待后续生命周期处理的媒体。',
              variant: 'warning' as BadgeVariant,
              badgeLabel: scanCounts.retiredMedia === 0 ? '正常' : '待回收',
            },
          ],
        },
      ]
    : []

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <Images size={24} className="shrink-0 text-brand-gold" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-[0.12em] text-text-primary">媒体维护</h1>
            <p className="mt-1 text-sm text-text-muted">
              检查并修复图片关系、缩略图和无引用文件。（这块除了GPT估计tm只有零个人懂现在）
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          leftIcon={<RefreshCw size={16} />}
          loading={scanning}
          loadingText="扫描中…"
          onClick={() => void runScan()}
          disabled={activeOperation !== null || orphanLoading}
        >
          刷新扫描
        </Button>
      </div>
      {error && (
        <Panel className="theme-status-error" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 shrink-0 theme-text-error"
              size={18}
              aria-hidden="true"
            />
            <div>
              <p className="font-medium theme-text-error">操作未完成</p>
              <p className="mt-1 break-all text-sm theme-text-error">{error}</p>
            </div>
          </div>
        </Panel>
      )}

      <Panel className="space-y-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 shrink-0 text-brand-gold" size={20} aria-hidden="true" />
          <div>
            <h2 className="text-base font-semibold text-text-primary">使用前请了解</h2>
            <p className="mt-1 text-sm leading-relaxed text-text-muted">
              媒体维护会同时查看数据库关系和上传目录。先阅读流程，再从“仅预览”开始；执行模式和孤儿文件删除都需要确认。
            </p>
          </div>
        </div>
        <ol className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {[
            ['1', '扫描概览', '只读取数据库和上传目录，显示待处理数量，不修改任何数据。'],
            ['2', '先预览，再执行', '四个媒体操作默认仅预览；预览不会下载、写库、入队或删除文件。'],
            [
              '3',
              '按批次继续',
              '每批最多 100 条；继续下一批只从上一批游标之后继续，不必一次处理全库。',
            ],
            [
              '4',
              '危险操作单独确认',
              '孤儿文件删除只对超级管理员开放，删除前服务端会重新检查引用、年龄和指纹。',
            ],
          ].map(([number, title, description]) => (
            <li key={number} className="rounded bg-surface-alt p-3">
              <div className="flex items-center gap-2">
                <Badge variant="primary">{number}</Badge>
                <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-text-muted">{description}</p>
            </li>
          ))}
        </ol>
        <div className="rounded border border-border bg-surface-alt p-4">
          <h3 className="text-sm font-semibold text-text-primary">数据模型速览</h3>
          <dl className="mt-3 grid gap-3 text-xs leading-relaxed text-text-muted md:grid-cols-3">
            <div>
              <dt className="font-medium text-text-primary">规范图片（ImageMap）</dt>
              <dd className="mt-1">
                按完整文件内容 MD5 识别的同一份物理图片；多个业务引用可以共享它。
              </dd>
            </div>
            <div>
              <dt className="font-medium text-text-primary">使用权（MediaAsset）</dt>
              <dd className="mt-1">
                某个用户或维护操作对规范图片的逻辑绑定，不代表又复制了一份物理文件。
              </dd>
            </div>
            <div>
              <dt className="font-medium text-text-primary">缩略图</dt>
              <dd className="mt-1">
                由后台变体队列异步生成的 WebP 预览；已入队不等于已经生成完成，需要重新扫描确认。
              </dd>
            </div>
          </dl>
        </div>
        <details className="rounded border border-border bg-surface-alt p-4">
          <summary className="cursor-pointer text-sm font-medium text-text-primary">
            术语与状态说明
          </summary>
          <dl className="mt-3 grid gap-x-5 gap-y-3 text-xs leading-relaxed text-text-muted md:grid-cols-2">
            <div>
              <dt className="font-medium text-text-primary">仅预览（dry-run）</dt>
              <dd className="mt-1">只查找候选并返回报告；不会下载、写数据库、入队或删除。</dd>
            </div>
            <div>
              <dt className="font-medium text-text-primary">执行（apply）</dt>
              <dd className="mt-1">按当前批次真正写入；应用前页面必须确认。</dd>
            </div>
            <div>
              <dt className="font-medium text-text-primary">缺失缩略图</dt>
              <dd className="mt-1">
                thumbnailUrl 为空，包含“状态显示已完成但 URL 为空”的历史异常。
              </dd>
            </div>
            <div>
              <dt className="font-medium text-text-primary">历史记录</dt>
              <dd className="mt-1">
                旧数据缺少规范 ImageMap/MediaAsset 关系，不表示文件重复或一定损坏。
              </dd>
            </div>
            <div>
              <dt className="font-medium text-text-primary">远程图片</dt>
              <dd className="mt-1">
                业务记录仍指向外部 HTTP(S) 地址，需要本地化才会纳入本站媒体生命周期。
              </dd>
            </div>
            <div>
              <dt className="font-medium text-text-primary">孤儿文件</dt>
              <dd className="mt-1">
                上传目录中当前没有业务引用的物理文件；必须先预览，不能把“未引用”理解为“可以立即删除”。
              </dd>
            </div>
            <div>
              <dt className="font-medium text-text-primary">处理中/已入队</dt>
              <dd className="mt-1">当前队列正在处理或已经有同目标任务，重复点击不会重复生成。</dd>
            </div>
          </dl>
        </details>
      </Panel>

      <AdminSection
        title="扫描概览"
        icon={<Search size={18} aria-hidden="true" />}
        className="space-y-4"
      >
        <Panel className="space-y-5">
          <SectionHeading
            title="扫描状态"
            right={
              <span className="text-xs text-text-muted">
                最近扫描：{lastScannedAt ? new Date(lastScannedAt).toLocaleString() : '尚未扫描'}
              </span>
            }
          />
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
            <Field
              label="维护模式"
              description={
                mode === 'dry-run'
                  ? '仅预览：只查找并报告，不下载、写库、入队或删除。'
                  : '执行：会按当前批次修改媒体数据，提交前会再次确认。'
              }
              controlId="maintenance-mode"
            >
              <SegmentedControl
                id="maintenance-mode"
                value={mode}
                options={[
                  { value: 'dry-run', label: '仅预览' },
                  { value: 'apply', label: '执行' },
                ]}
                onValueChange={(value) => {
                  if (isMaintenanceMode(value)) setMode(value)
                }}
                aria-label="维护模式"
              />
            </Field>
            <Field
              label="每批处理数量"
              description="1–100；数量越大单次等待越久，建议先用 50 或 100。"
              controlId="maintenance-batch-size"
            >
              <Input
                id="maintenance-batch-size"
                type="number"
                min={1}
                max={100}
                value={batchSize}
                onChange={(event) => setBatchSize(event.target.value)}
              />
            </Field>
            <Button
              variant="secondary"
              leftIcon={<Search size={16} />}
              loading={scanning}
              loadingText="扫描中…"
              onClick={() => void runScan()}
              disabled={activeOperation !== null || orphanLoading}
            >
              重新扫描
            </Button>
          </div>
          {scanError ? (
            <LoadErrorState
              className="rounded border border-border bg-surface-alt py-8"
              title="扫描失败"
              error={scanError}
              retryLabel="重试扫描"
              onRetry={() => void runScan()}
            />
          ) : scanResult ? (
            <>
              {needsAttention === 0 ? (
                <EmptyState
                  className="rounded border border-[var(--color-success)]/30 bg-[var(--color-success)]/5 py-8"
                  icon={<CheckCircle className="theme-text-success" size={28} aria-hidden="true" />}
                  title="未发现需要处理的媒体问题"
                  description="本次扫描没有发现缺失缩略图、历史关系、远程图片或疑似孤儿文件。数量仍是扫描快照，后续执行前会重新校验。"
                />
              ) : (
                <div className="space-y-5">
                  {scanGroups.map((group) => (
                    <div key={group.title} className="space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold text-text-primary">{group.title}</h3>
                        <p className="mt-1 text-xs text-text-muted">{group.hint}</p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {group.items.map((item) => (
                          <StatCard key={item.label} {...item} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {scanResult.details.length > 0 && (
                <details className="rounded border border-border bg-surface-alt p-4">
                  <summary className="cursor-pointer text-sm font-medium text-text-primary">
                    查看扫描明细（{scanResult.details.length} 条）
                  </summary>
                  <ul className="mt-3 max-h-56 space-y-2 overflow-auto text-xs text-text-secondary">
                    {scanResult.details.map((detail, index) => (
                      <li
                        key={`${detail.id}-${detail.status}-${index}`}
                        className="border-t border-border pt-2 first:border-0 first:pt-0"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={getResultStatusVariant(detail.status)}>
                            {getResultStatusLabel(detail.status)}
                          </Badge>
                          <span className="text-text-muted">{getDetailTypeLabel(detail.type)}</span>
                          <code className="break-all text-[11px] text-text-primary">
                            {detail.id}
                          </code>
                        </div>
                        {detail.reason && (
                          <p className="mt-1 break-all text-text-muted">原因：{detail.reason}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          ) : scanning ? (
            <div className="grid gap-3 rounded border border-border bg-surface-alt p-4 sm:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : (
            <EmptyState
              className="rounded border border-border bg-surface-alt py-8"
              icon={<Search size={28} aria-hidden="true" />}
              title="尚未执行扫描"
              description="点击“重新扫描”读取当前媒体关系和上传目录；扫描本身不会修改数据。"
            />
          )}
        </Panel>
      </AdminSection>

      <Panel className="space-y-4">
        <SectionHeading
          title="维护操作"
          right={
            <Badge variant={mode === 'apply' ? 'warning' : 'neutral'}>
              当前模式：{maintenanceModeLabels[mode]}
            </Badge>
          }
        />
        <p className="text-sm text-text-muted">
          四项操作共用当前模式和批次大小；每个操作的游标、结果和本地化类型彼此独立。
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {operations.map((operation) => {
            const info = operationInfo[operation]
            const OperationIcon = info.icon
            const requestKey = getCursorKey(operation, mode, maintenanceType)
            const result = results[requestKey]
            const isActive = activeOperation === operation
            const hasNextBatch = result?.hasMore === true
            const actionLabel = hasNextBatch
              ? '继续下一批'
              : result
                ? mode === 'apply'
                  ? '再次执行这一批'
                  : '再次预览这一批'
                : mode === 'apply'
                  ? '执行这一批'
                  : '预览这一批'
            return (
              <Panel key={operation} className="flex min-w-0 flex-col gap-4">
                <div className="flex items-start gap-3">
                  <OperationIcon
                    className="mt-0.5 shrink-0 text-brand-gold"
                    size={20}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-text-primary">{info.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-text-muted">{info.purpose}</p>
                  </div>
                </div>
                <div className="grid gap-3 rounded border border-border bg-surface-alt p-3 text-xs leading-relaxed">
                  <div>
                    <p className="font-medium text-text-primary">会做</p>
                    <p className="mt-1 text-text-muted">{info.willDo}</p>
                  </div>
                  <div>
                    <p className="font-medium text-text-primary">不会做</p>
                    <p className="mt-1 text-text-muted">{info.willNotDo}</p>
                  </div>
                </div>
                {operation === 'localize' && (
                  <Field
                    label="处理范围"
                    description="仅本地化远程图片时生效；切换类型不会复用其他类型的游标或结果。"
                    controlId="maintenance-type-localize"
                  >
                    <Select
                      id="maintenance-type-localize"
                      value={maintenanceType}
                      onChange={(event) => {
                        if (isMaintenanceType(event.target.value))
                          setMaintenanceType(event.target.value)
                      }}
                    >
                      <option value="all">全部类型</option>
                      <option value="gallery">图库图片</option>
                      <option value="song">歌曲封面</option>
                      <option value="album">专辑封面</option>
                    </Select>
                  </Field>
                )}
                <div className="mt-auto flex flex-wrap items-center gap-3">
                  <Button
                    variant={mode === 'apply' ? 'warning' : 'secondary'}
                    leftIcon={<OperationIcon size={16} />}
                    loading={isActive}
                    loadingText={mode === 'apply' ? '执行中…' : '预览中…'}
                    onClick={() => void runOperation(operation)}
                    disabled={activeOperation !== null || scanning || orphanLoading}
                  >
                    {actionLabel}
                  </Button>
                  <span className="text-xs text-text-muted">
                    {result
                      ? hasNextBatch
                        ? '结果已保存，还有下一批'
                        : '当前条件已处理完，可重新开始'
                      : '将从第一批开始'}
                  </span>
                </div>
                {renderBatchResult(result)}
              </Panel>
            )
          })}
        </div>
      </Panel>

      <AdminSection
        title="孤儿文件清理"
        icon={<AlertTriangle size={18} aria-hidden="true" />}
        className="space-y-4"
      >
        <Panel className="space-y-5">
          <SectionHeading title="两阶段安全流程" />
          <div
            className="rounded border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-4"
            role="note"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle
                className="mt-0.5 shrink-0 theme-text-warning"
                size={18}
                aria-hidden="true"
              />
              <div className="space-y-1 text-sm leading-relaxed theme-text-warning">
                <p className="font-medium">预览不会删除文件。</p>
                <p>
                  删除只接受本次预览中的文件；服务端删除前会重新检查引用、年龄、路径、文件大小、修改时间和
                  SHA-256。
                </p>
                <p>预览后文件一旦被业务重新引用，系统会跳过；外部图床 URL 不会在这里删除。</p>
              </div>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Field
              label="只查看至少存在多少小时的文件"
              description="默认 1 小时；设置为 0 会包含刚产生的文件，仅适合排查，不建议直接删除。"
              controlId="orphan-age"
            >
              <Input
                id="orphan-age"
                type="number"
                min={0}
                max={8760}
                value={orphanAge}
                onChange={(event) => setOrphanAge(event.target.value)}
                disabled={orphanLoading || activeOperation !== null || scanning}
              />
            </Field>
            <div className="space-y-2">
              <Switch
                id="orphan-variants"
                label="同时检查变体目录"
                checked={includeVariants}
                onCheckedChange={setIncludeVariants}
                disabled={orphanLoading || activeOperation !== null || scanning}
              />
              <p className="text-xs leading-relaxed text-text-muted">
                变体是由原图生成的 WebP 文件，只有确认没有引用时才会列入。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              leftIcon={<Search size={16} />}
              loading={orphanAction === 'preview'}
              loadingText="预览中…"
              onClick={() => void previewOrphans()}
              disabled={orphanLoading || activeOperation !== null || scanning}
            >
              {orphanCursor ? '预览下一批' : '开始预览'}
            </Button>
            <Button
              variant="danger"
              leftIcon={<Trash2 size={16} />}
              loading={orphanAction === 'delete'}
              loadingText="删除检查中…"
              onClick={() => void deleteOrphans()}
              disabled={
                profile?.role !== 'super_admin' ||
                orphanLoading ||
                activeOperation !== null ||
                scanning ||
                !orphanPreview ||
                orphanPreview.storageKeys.length === 0
              }
            >
              删除本次预览文件
            </Button>
            {profile?.role !== 'super_admin' ? (
              <span className="text-xs text-text-muted">
                只有超级管理员可以删除文件；普通管理员仍可预览。
              </span>
            ) : orphanPreview ? (
              <span className="text-xs text-text-muted">
                删除按钮只提交当前批次的预览凭证和文件。
              </span>
            ) : (
              <span className="text-xs text-text-muted">请先完成预览，再确认当前批次。</span>
            )}
          </div>
          {orphanPreviews.length > 0 ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">预览结果</h3>
                <p className="mt-1 text-xs text-text-muted">
                  storage key 是服务器内部相对路径，不是可直接访问的
                  URL。多批结果会追加展示，但删除始终只允许当前批次。
                </p>
              </div>
              {orphanPreviews.map((batch, batchIndex) => {
                const isCurrentBatch = orphanPreview?.previewToken === batch.previewToken
                return (
                  <div
                    key={batch.previewToken}
                    className="rounded border border-border bg-surface-alt p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-medium text-text-primary">
                          第 {batchIndex + 1} 批预览
                        </h3>
                        <Badge variant={isCurrentBatch ? 'warning' : 'neutral'}>
                          {isCurrentBatch ? '当前批：仅可删除这一批' : '历史批次：不可删除'}
                        </Badge>
                      </div>
                      <span className="text-xs text-text-muted">
                        {batch.includeVariants ? '包含变体' : '不包含变体'} ·{' '}
                        {batch.hasMore ? '还有下一批' : '已到末尾'}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                      <ResultMetric label="本批文件" value={batch.storageKeys.length} />
                      <ResultMetric label="本批空间" value={formatBytes(batch.totalBytes)} />
                      <ResultMetric label="扫描文件" value={batch.scanned} />
                      <ResultMetric label="已跳过" value={batch.skipped} variant="warning" />
                    </div>
                    {batch.entries.length === 0 ? (
                      <EmptyState
                        className="py-6"
                        title="本批没有疑似孤儿文件"
                        description="当前年龄和变体范围内没有可供删除的候选。"
                      />
                    ) : (
                      <ul className="mt-4 max-h-64 space-y-2 overflow-auto text-xs text-text-secondary">
                        {batch.entries.map((entry) => {
                          const ageHours = Math.max(0, (Date.now() - entry.mtimeMs) / 3_600_000)
                          return (
                            <li
                              key={`${batch.previewToken}-${entry.storageKey}`}
                              className="min-w-0 rounded border border-border bg-surface p-3"
                            >
                              <code className="block break-all text-[11px] text-text-primary">
                                {entry.storageKey}
                              </code>
                              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-text-muted">
                                <span>大小：{formatBytes(entry.sizeBytes)}</span>
                                <span>文件年龄：{ageHours.toFixed(1)} 小时</span>
                                <span>
                                  指纹：
                                  <code className="break-all">{entry.sha256.slice(0, 12)}…</code>
                                </span>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <EmptyState
              className="rounded border border-border bg-surface-alt py-8"
              icon={<Search size={28} aria-hidden="true" />}
              title="尚未预览孤儿文件"
              description="预览会按文件年龄和是否包含变体查找候选，不会下载、写库或删除。"
            />
          )}
          {orphanResult && renderBatchResult(orphanResult)}
        </Panel>
      </AdminSection>
    </div>
  )
}

export default AdminMaintenance
