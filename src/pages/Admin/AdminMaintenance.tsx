import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle, RefreshCw, Search, Trash2 } from '@/src/components/icons'
import { Button, Field, Input, Select } from '@/src/components/ui'
import { apiGet, apiPost } from '../../lib/apiClient'
import { useDialog } from '../../components/Dialog'
import { useAuth } from '../../context/AuthContext'
import { SectionHeading } from '../../components/admin/AdminSection'
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

const operations: Operation[] = ['reconcile', 'bind-legacy', 'localize', 'repair-thumbnails']

const operationLabels: Record<Operation, string> = {
  reconcile: '规范化媒体关系',
  'bind-legacy': '绑定历史媒体',
  localize: '本地化远程图片',
  'repair-thumbnails': '修复缺失缩略图',
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

export const AdminMaintenance = () => {
  const { profile } = useAuth()
  const dialog = useDialog()
  const [mode, setMode] = useState<MediaMaintenanceMode>('dry-run')
  const [maintenanceType, setMaintenanceType] = useState<MediaMaintenanceType>('all')
  const [batchSize, setBatchSize] = useState('100')
  const [orphanAge, setOrphanAge] = useState('1')
  const [includeVariants, setIncludeVariants] = useState(false)
  const [cursor, setCursor] = useState<Record<string, string | null>>({})
  const [results, setResults] = useState<Record<string, MediaMaintenanceBatchResult>>({})
  const [activeOperation, setActiveOperation] = useState<Operation | null>(null)
  const [scanResult, setScanResult] = useState<MediaMaintenanceScanResult | null>(null)
  const [orphanPreview, setOrphanPreview] = useState<MediaMaintenanceOrphanPreview | null>(null)
  const [orphanResult, setOrphanResult] = useState<MediaMaintenanceOrphanDelete | null>(null)
  const [orphanCursor, setOrphanCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [orphanLoading, setOrphanLoading] = useState(false)

  useEffect(() => {
    setOrphanCursor(null)
    setOrphanPreview(null)
    setOrphanResult(null)
  }, [includeVariants, orphanAge])

  const value = Number(batchSize)
  const parsedBatchSize = Number.isInteger(value) && value >= 1 && value <= 100 ? value : 100

  const runOperation = useCallback(
    async (operation: Operation) => {
      if (activeOperation || scanning || orphanLoading) return
      if (mode === 'apply') {
        const confirmed = await dialog.confirm({
          title: operationLabels[operation],
          message: '该操作会修改媒体数据。确认继续吗？',
          confirmText: '执行',
          variant: 'warning',
        })
        if (!confirmed) return
      }
      setActiveOperation(operation)
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
      } catch (requestError) {
        setError(getErrorMessage(requestError, `${operationLabels[operation]}失败`))
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
    ]
  )

  const runScan = useCallback(async () => {
    if (scanning || activeOperation || orphanLoading) return
    setScanning(true)
    setError(null)
    try {
      const response = await apiGet<ApiSuccessResponse<MediaMaintenanceScanResult>>(
        '/api/admin/media-maintenance/scan',
        { mode: 'strict', limit: parsedBatchSize },
        { staleTime: 0, swr: false }
      )
      if (!response.success) throw new Error('媒体扫描失败')
      setScanResult(response.data)
    } catch (requestError) {
      setError(getErrorMessage(requestError, '媒体扫描失败'))
    } finally {
      setScanning(false)
    }
  }, [activeOperation, orphanLoading, parsedBatchSize, scanning])

  const previewOrphans = useCallback(async () => {
    if (orphanLoading || activeOperation || scanning) return
    setOrphanLoading(true)
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
      setOrphanCursor(response.data.hasMore ? response.data.nextCursor : null)
      setOrphanResult(null)
    } catch (requestError) {
      setError(getErrorMessage(requestError, '孤儿文件预览失败'))
    } finally {
      setOrphanLoading(false)
    }
  }, [
    activeOperation,
    includeVariants,
    orphanLoading,
    orphanAge,
    orphanCursor,
    parsedBatchSize,
    scanning,
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
    const confirmed = await dialog.confirm({
      title: '删除孤儿文件',
      message: `将删除 ${orphanPreview.storageKeys.length} 个${orphanPreview.includeVariants ? '（含变体）' : ''}预览中的文件。删除前会重新检查引用。确认继续吗？`,
      confirmText: '删除文件',
      variant: 'danger',
    })
    if (!confirmed) return
    setOrphanLoading(true)
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
    } catch (requestError) {
      setError(getErrorMessage(requestError, '孤儿文件删除失败'))
    } finally {
      setOrphanLoading(false)
    }
  }, [activeOperation, dialog, orphanLoading, orphanPreview, profile?.role, scanning])

  const renderBatchResult = (result: MediaMaintenanceBatchResult | undefined) => {
    if (!result) return null
    return (
      <div className="mt-4 space-y-3 rounded border border-border bg-surface-alt p-4 text-sm">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <span>扫描：{result.scanned}</span>
          <span>处理：{result.processed}</span>
          <span>跳过：{result.skipped}</span>
          <span>失败：{result.failed}</span>
          {result.conflicts !== undefined && <span>并发冲突：{result.conflicts}</span>}
          <span>{result.hasMore ? '可继续' : '已完成'}</span>
        </div>
        {result.queued !== undefined && (
          <div className="grid grid-cols-1 gap-2 text-text-muted md:grid-cols-3">
            <span>已入队：{result.queued}</span>
            <span>已存在任务：{result.alreadyQueued}</span>
            <span>源文件缺失：{result.skippedMissingSource}</span>
          </div>
        )}
        {result.details.length > 0 && (
          <ul className="max-h-48 space-y-1 overflow-auto text-xs text-text-muted">
            {result.details.map((detail) => (
              <li key={`${detail.id}-${detail.status}`}>
                <strong>{detail.status}</strong>　{detail.id}
                {detail.reason ? `：${detail.reason}` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <SectionHeading title="媒体维护" />
        <p className="mt-2 text-sm text-text-muted">
          在受保护的后台执行媒体扫描、历史绑定、本地化、缩略图修复和孤儿文件处理。
        </p>
      </div>
      <section className="space-y-4 rounded border border-border bg-surface p-5">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="执行模式" controlId="maintenance-mode" className="min-w-40">
            <Select
              id="maintenance-mode"
              value={mode}
              onChange={(event) => {
                if (isMaintenanceMode(event.target.value)) setMode(event.target.value)
              }}
            >
              <option value="dry-run">Dry-run（预览）</option>
              <option value="apply">Apply（执行）</option>
            </Select>
          </Field>
          <Field
            label="批次大小"
            description="最多 100 条"
            controlId="maintenance-batch-size"
            className="w-32"
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
            onClick={runScan}
            disabled={scanning || activeOperation !== null || orphanLoading}
          >
            <Search className="mr-2 h-4 w-4" />
            {scanning ? '扫描中…' : '扫描概览'}
          </Button>
        </div>
        {scanResult && (
          <div className="grid grid-cols-2 gap-3 rounded border border-border bg-surface-alt p-4 text-sm md:grid-cols-5">
            <span>缺失缩略图：{scanResult.counts.missingThumbnails}</span>
            <span>未绑定 claim：{scanResult.counts.unboundMediaAssets}</span>
            <span>URL-only：{scanResult.counts.legacyUrlOnlyRecords}</span>
            <span>远程候选：{scanResult.counts.remoteCandidates}</span>
            <span>孤儿文件：{scanResult.counts.orphanFiles}</span>
            <span>孤儿字节：{scanResult.counts.orphanBytes}</span>
            <span>共享 ImageMap：{scanResult.counts.sharedImageMaps}</span>
            <span>活跃会话：{scanResult.counts.activeUploadSessions}</span>
            <span>缺失原图：{scanResult.counts.missingLocalFiles}</span>
            <span>退休媒体：{scanResult.counts.retiredMedia}</span>
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {operations.map((operation) => (
          <div key={operation} className="rounded border border-border bg-surface p-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-medium text-text-primary">{operationLabels[operation]}</h2>
                <p className="mt-1 text-xs text-text-muted">
                  {cursor[getCursorKey(operation, mode, maintenanceType)]
                    ? `当前游标：${cursor[getCursorKey(operation, mode, maintenanceType)]}`
                    : '从首条记录开始'}
                </p>
              </div>
              <RefreshCw className="h-5 w-5 text-text-muted" aria-hidden="true" />
            </div>
            {operation === 'localize' && (
              <Field label="资源类型" controlId="maintenance-type" className="mb-3 max-w-40">
                <Select
                  id="maintenance-type"
                  value={maintenanceType}
                  onChange={(event) => {
                    if (isMaintenanceType(event.target.value))
                      setMaintenanceType(event.target.value)
                  }}
                >
                  <option value="all">全部</option>
                  <option value="gallery">图库</option>
                  <option value="song">歌曲</option>
                  <option value="album">专辑</option>
                </Select>
              </Field>
            )}
            <Button
              variant={mode === 'apply' ? 'warning' : 'secondary'}
              onClick={() => runOperation(operation)}
              disabled={activeOperation !== null || scanning || orphanLoading}
            >
              {activeOperation === operation
                ? '处理中…'
                : mode === 'apply'
                  ? '确认执行'
                  : results[getCursorKey(operation, mode, maintenanceType)]?.hasMore
                    ? '继续下一批'
                    : results[getCursorKey(operation, mode, maintenanceType)]
                      ? '再次运行'
                      : '预览批次'}
            </Button>
            {renderBatchResult(results[getCursorKey(operation, mode, maintenanceType)])}
          </div>
        ))}
      </section>

      <section className="space-y-4 rounded border border-border bg-surface p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-medium text-text-primary">孤儿文件</h2>
            <p className="mt-1 text-sm text-text-muted">
              先预览，再由超级管理员执行二次引用检查后的删除。
            </p>
          </div>
          <AlertTriangle className="h-5 w-5 text-[var(--color-warning)]" aria-hidden="true" />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="最小文件年龄（小时）" controlId="orphan-age" className="w-48">
            <Input
              id="orphan-age"
              type="number"
              min={0}
              max={8760}
              value={orphanAge}
              onChange={(event) => setOrphanAge(event.target.value)}
            />
          </Field>
          <Field
            label="扫描变体目录"
            controlId="orphan-variants"
            className="flex items-center gap-2"
          >
            <Input
              id="orphan-variants"
              type="checkbox"
              checked={includeVariants}
              onChange={(event) => setIncludeVariants(event.target.checked)}
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            onClick={previewOrphans}
            disabled={orphanLoading || activeOperation !== null || scanning}
          >
            <Search className="mr-2 h-4 w-4" />
            {orphanLoading ? '处理中…' : orphanCursor ? '预览下一批' : '预览孤儿文件'}
          </Button>
          {profile?.role === 'super_admin' && (
            <Button
              variant="danger"
              onClick={deleteOrphans}
              disabled={
                orphanLoading ||
                activeOperation !== null ||
                scanning ||
                !orphanPreview ||
                orphanPreview.storageKeys.length === 0
              }
            >
              <Trash2 className="mr-2 h-4 w-4" />
              删除预览文件
            </Button>
          )}
        </div>
        {orphanPreview && (
          <div className="space-y-3 rounded border border-border bg-surface-alt p-4 text-sm">
            <p>
              预览文件：{orphanPreview.storageKeys.length} 个，共 {orphanPreview.totalBytes} bytes
              {orphanPreview.includeVariants ? '（包含变体）' : '（不包含变体）'}
            </p>
            <ul className="max-h-48 space-y-1 overflow-auto text-xs text-text-muted">
              {orphanPreview.entries.map((entry) => (
                <li key={entry.storageKey}>
                  {entry.storageKey} · {entry.sizeBytes} bytes ·{' '}
                  {((Date.now() - entry.mtimeMs) / 3_600_000).toFixed(1)} 小时 ·{' '}
                  {entry.sha256.slice(0, 12)}…
                </li>
              ))}
            </ul>
          </div>
        )}
        {orphanResult && renderBatchResult(orphanResult)}
      </section>

      {error && (
        <div
          className="flex items-center gap-2 rounded border border-[var(--color-error)] p-4 text-sm text-[var(--color-error)]"
          role="alert"
        >
          <CheckCircle className="h-4 w-4" aria-hidden="true" />
          {error}
        </div>
      )}
    </div>
  )
}

export default AdminMaintenance
