import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Database,
  Download,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
  XCircle,
} from '@/src/components/icons'
import { format } from 'date-fns'
import { clsx } from 'clsx'
import { apiDownload, apiGet, apiPost, apiUpload } from '../../lib/apiClient'
import {
  DANGER_BUTTON_CLASSES,
  INFO_BUTTON_CLASSES,
  SECONDARY_BUTTON_CLASSES,
  SUCCESS_BUTTON_CLASSES,
} from '../../lib/buttonClasses'
import { useToast } from '../../components/Toast'
import { useFloatingPresence } from '../../hooks/useFloatingPresence'
import { CONTENT_LIMITS } from '../../lib/contentLimits'
import type {
  AdminBackup,
  AdminBackupCreateResponse,
  AdminBackupNoteResponse,
  AdminBackupRestoreResponse,
  AdminBackupsResponse,
  RestoreMediaReport,
} from '../../types/api'

type DialogType = 'create' | 'restore' | 'restore-existing' | 'delete' | 'note' | null

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const formatMediaReference = (reference: { source: string; id?: string; field: string }) =>
  `${reference.source}.${reference.field}${reference.id ? ` #${reference.id}` : ''}`

const AdminBackups = () => {
  const [backups, setBackups] = useState<AdminBackup[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogType>(null)
  const [createNote, setCreateNote] = useState('')
  const [editNote, setEditNote] = useState('')
  const [legacyPassword, setLegacyPassword] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [noteTarget, setNoteTarget] = useState<string | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null)
  const [lastMediaReport, setLastMediaReport] = useState<RestoreMediaReport | null>(null)
  const [lastMediaReportError, setLastMediaReportError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastDialogRef = useRef<Exclude<DialogType, null> | null>(null)
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const { show } = useToast()
  const dialogPresence = useFloatingPresence(Boolean(dialog))

  if (dialog) {
    lastDialogRef.current = dialog
  }

  const visibleDialog = dialog ?? lastDialogRef.current

  const fetchBackups = useCallback(
    async (showSpinner = true) => {
      if (showSpinner) setLoading(true)
      try {
        const response = await apiGet<AdminBackupsResponse>('/api/admin/backup/list', undefined, {
          staleTime: 0,
          swr: false,
        })
        setBackups(response.backups || [])
      } catch (error) {
        console.error('Fetch backups failed:', error)
        show('获取备份列表失败', { variant: 'error' })
      } finally {
        if (showSpinner) setLoading(false)
      }
    },
    [show]
  )

  useEffect(() => {
    fetchBackups()
  }, [fetchBackups])

  const closeDialog = () => {
    setDialog(null)
    setCreateNote('')
    setEditNote('')
    setLegacyPassword('')
    setDeleteTarget(null)
    setNoteTarget(null)
    setRestoreTarget(null)
    setRestoreFile(null)
  }

  const handleRestoreSuccess = (response: AdminBackupRestoreResponse) => {
    setLastMediaReport(response.mediaReport || null)
    setLastMediaReportError(response.mediaReportError || '')
    const report = response.mediaReport
    if (report) {
      show(
        `数据库恢复成功，图片清单已生成：缺失 ${report.missingFiles}，孤儿 ${report.orphanFiles}`
      )
      return
    }
    if (response.mediaReportError) {
      show(`数据库恢复成功，但${response.mediaReportError}`, { variant: 'error' })
      return
    }
    show('数据库恢复成功')
  }

  const handleCreate = async () => {
    setActionLoading('create')
    try {
      const body = createNote.trim() ? { note: createNote } : undefined
      const response = body
        ? await apiPost<AdminBackupCreateResponse>('/api/admin/backup/create', body)
        : await apiPost<AdminBackupCreateResponse>('/api/admin/backup/create')
      show('备份创建成功')
      closeDialog()
      setBackups((current) => [
        response.backup,
        ...current.filter((item) => item.filename !== response.backup.filename),
      ])
      await fetchBackups(false)
    } catch (error) {
      show(error instanceof Error ? error.message : '创建备份失败', { variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  const handleUpdateNote = async () => {
    if (!noteTarget) return
    setActionLoading('note')
    try {
      const response = await apiPost<AdminBackupNoteResponse>(
        `/api/admin/backup/${encodeURIComponent(noteTarget)}/note`,
        { note: editNote }
      )
      show(response.note ? '备份备注已更新' : '备份备注已清空')
      setBackups((current) =>
        current.map((item) =>
          item.filename === noteTarget ? { ...item, note: response.note } : item
        )
      )
      closeDialog()
    } catch (error) {
      show(error instanceof Error ? error.message : '更新备注失败', { variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  const downloadFile = async (
    url: string,
    filename: string,
    options: { loadingKey: string; successMessage: string; errorMessage: string }
  ) => {
    if (actionLoading) return
    setActionLoading(options.loadingKey)
    try {
      const response = await apiDownload(url, { method: 'POST' })
      if (!response.ok)
        throw new Error((await response.json().catch(() => ({}))).error || options.errorMessage)
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(objectUrl)
      show(options.successMessage, { variant: 'success' })
    } catch (error) {
      show(error instanceof Error ? error.message : options.errorMessage, { variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  const handleDownload = async (filename: string) => {
    await downloadFile(`/api/admin/backup/${encodeURIComponent(filename)}/download`, filename, {
      loadingKey: 'download',
      successMessage: '下载完成',
      errorMessage: '下载失败',
    })
  }

  const handleRestore = async () => {
    if (!restoreFile) {
      show('请选择备份文件', { variant: 'error' })
      return
    }
    setActionLoading('restore')
    try {
      const formData = new FormData()
      formData.append('file', restoreFile)
      formData.append('confirm', 'true')
      if (legacyPassword !== '') {
        formData.append('legacyPassword', legacyPassword)
      }
      const response = await apiUpload<AdminBackupRestoreResponse>(
        '/api/admin/backup/restore',
        formData
      )
      handleRestoreSuccess(response)
      closeDialog()
      await fetchBackups(false)
    } catch (error) {
      show(error instanceof Error ? error.message : '恢复失败', { variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setActionLoading('delete')
    try {
      await apiPost(`/api/admin/backup/${encodeURIComponent(deleteTarget)}/delete`)
      show('备份已删除')
      setBackups((current) => current.filter((item) => item.filename !== deleteTarget))
      closeDialog()
      await fetchBackups(false)
    } catch (error) {
      show(error instanceof Error ? error.message : '删除失败', { variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  const handleRestoreExisting = async () => {
    if (!restoreTarget) return
    setActionLoading('restore-existing')
    try {
      const response = await apiPost<AdminBackupRestoreResponse>(
        `/api/admin/backup/${encodeURIComponent(restoreTarget)}/restore`,
        { confirm: true, ...(legacyPassword !== '' ? { legacyPassword } : {}) }
      )
      handleRestoreSuccess(response)
      closeDialog()
      await fetchBackups(false)
    } catch (error) {
      show(error instanceof Error ? error.message : '恢复失败', { variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  const openRestoreExistingDialog = (filename: string) => {
    setRestoreTarget(filename)
    setLegacyPassword('')
    setDialog('restore-existing')
  }

  const openDeleteDialog = (filename: string) => {
    setDeleteTarget(filename)
    setDialog('delete')
  }

  const openNoteDialog = (backup: AdminBackup) => {
    setNoteTarget(backup.filename)
    setEditNote(backup.note || '')
    setDialog('note')
  }

  const handleDownloadMediaReport = async (filename: string) => {
    await downloadFile(
      `/api/admin/backup/media-reports/${encodeURIComponent(filename)}/download`,
      filename,
      {
        loadingKey: 'media-report-download',
        successMessage: '图片清单下载完成',
        errorMessage: '下载图片清单失败',
      }
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={32} className="animate-spin text-text-muted" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-text-primary tracking-[0.12em]">数据库备份</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchBackups()}
            className="px-4 py-2 border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded text-sm transition-all inline-flex items-center gap-1.5"
          >
            <RefreshCw size={14} /> 刷新
          </button>
          <button
            onClick={() => setDialog('restore')}
            className="px-4 py-2 border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded text-sm transition-all inline-flex items-center gap-1.5"
          >
            <Upload size={14} /> 上传恢复
          </button>
          <button
            onClick={() => setDialog('create')}
            className="px-4 py-2 bg-brand-gold-dark text-white rounded text-sm font-medium hover:bg-brand-gold transition-all inline-flex items-center gap-1.5"
          >
            <Database size={14} /> 创建备份
          </button>
        </div>
      </div>

      {(lastMediaReport || lastMediaReportError) && (
        <div className="bg-surface border border-border rounded p-4 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-text-primary">最近恢复图片清单</p>
              {lastMediaReport ? (
                <p className="text-sm text-text-secondary mt-1">
                  缺失 {lastMediaReport.missingFiles} 个，孤儿 {lastMediaReport.orphanFiles} 个，
                  已扫描 {lastMediaReport.scannedFiles} 个本地文件。
                </p>
              ) : (
                <p className="text-sm theme-text-error mt-1">{lastMediaReportError}</p>
              )}
            </div>
            {lastMediaReport && (
              <button
                onClick={() => handleDownloadMediaReport(lastMediaReport.filename)}
                disabled={actionLoading !== null}
                className="px-4 py-2 border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded text-sm transition-all inline-flex items-center gap-1.5 disabled:opacity-50 shrink-0"
              >
                <Download size={14} /> 下载完整清单
              </button>
            )}
          </div>

          {lastMediaReport && lastMediaReport.missingFilePreview?.length ? (
            <div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  缺失文件
                </p>
                {lastMediaReport.missingFiles > lastMediaReport.missingFilePreview.length && (
                  <p className="text-xs text-text-muted">
                    仅显示前 {lastMediaReport.missingFilePreview.length} 个，完整内容请下载清单
                  </p>
                )}
              </div>
              <div className="mt-2 max-h-80 overflow-y-auto border border-border rounded divide-y divide-border">
                {lastMediaReport.missingFilePreview.map((file) => (
                  <div key={file.storageKey} className="p-3 bg-surface-alt/40">
                    <p className="text-sm font-medium text-text-primary break-all">
                      {file.storageKey}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {file.references.map((reference, index) => (
                        <span
                          key={`${file.storageKey}-${reference.source}-${reference.field}-${reference.id || index}`}
                          className="px-2 py-1 text-xs rounded bg-surface border border-border text-text-secondary break-all"
                        >
                          {formatMediaReference(reference)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {lastMediaReport && lastMediaReport.orphanFilePreview?.length ? (
            <div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  孤儿文件预览
                </p>
                <p className="text-xs text-text-muted">
                  占用约 {formatBytes(lastMediaReport.orphanSizeBytes)}
                </p>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {lastMediaReport.orphanFilePreview.slice(0, 6).map((file) => (
                  <div
                    key={file.storageKey}
                    className="border border-border rounded bg-surface-alt/40 p-2"
                  >
                    <p className="text-xs text-text-primary break-all">{file.storageKey}</p>
                    <p className="text-[11px] text-text-muted mt-1">
                      {formatBytes(file.sizeBytes)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="bg-surface border border-border rounded overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-alt border-b border-border">
              <th className="px-5 py-3 text-left text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                文件名
              </th>
              <th className="px-5 py-3 text-left text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                备注
              </th>
              <th className="px-5 py-3 text-left text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                创建时间
              </th>
              <th className="px-5 py-3 text-left text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                大小
              </th>
              <th className="px-5 py-3 text-left text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {backups.length > 0 ? (
              backups.map((backup) => (
                <tr key={backup.filename} className="hover:bg-surface-alt transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <Database size={16} className="text-text-muted shrink-0" />
                      <span className="text-sm font-medium text-text-primary">
                        {backup.filename}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm text-text-secondary max-w-[280px]">
                    {backup.note ? (
                      <span className="line-clamp-2 whitespace-pre-wrap break-words">
                        {backup.note}
                      </span>
                    ) : (
                      <span className="text-text-muted italic">无备注</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-sm text-text-secondary">
                    {format(new Date(backup.createdAt), 'yyyy-MM-dd HH:mm:ss')}
                  </td>
                  <td className="px-5 py-4 text-sm text-text-secondary">{backup.sizeFormatted}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-start gap-2">
                      <button
                        onClick={() => openNoteDialog(backup)}
                        className={INFO_BUTTON_CLASSES}
                      >
                        <Pencil size={14} />
                        备注
                      </button>
                      <button
                        onClick={() => handleDownload(backup.filename)}
                        className={SECONDARY_BUTTON_CLASSES}
                      >
                        <Download size={14} />
                        下载
                      </button>
                      <button
                        onClick={() => openRestoreExistingDialog(backup.filename)}
                        className={SUCCESS_BUTTON_CLASSES}
                      >
                        <RotateCcw size={14} />
                        恢复
                      </button>
                      <button
                        onClick={() => openDeleteDialog(backup.filename)}
                        className={DANGER_BUTTON_CLASSES}
                      >
                        <Trash2 size={14} />
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-5 py-16 text-center text-text-muted italic">
                  暂无备份记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {dialogPresence.mounted && visibleDialog && (
        <div
          className="floating-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          data-state={dialogPresence.state}
          aria-hidden={!dialog}
          onClick={closeDialog}
        >
          <div
            className="floating-panel bg-surface border border-border rounded w-full max-w-md mx-4 p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-text-primary">
                {visibleDialog === 'create' && '创建备份'}
                {visibleDialog === 'restore' && '上传备份恢复'}
                {visibleDialog === 'restore-existing' && '从站内备份恢复'}
                {visibleDialog === 'delete' && '删除备份'}
                {visibleDialog === 'note' && '编辑备注'}
              </h3>
              <button
                onClick={closeDialog}
                className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-alt"
              >
                <XCircle size={20} />
              </button>
            </div>

            {(visibleDialog === 'restore' ||
              visibleDialog === 'restore-existing' ||
              visibleDialog === 'delete') && (
              <div className="flex items-start gap-3 p-3 rounded theme-status-warning">
                <AlertTriangle size={18} className="theme-text-warning shrink-0 mt-0.5" />
                <p className="text-sm">
                  {visibleDialog === 'restore' || visibleDialog === 'restore-existing'
                    ? '恢复操作将覆盖当前数据库中的所有数据，此操作不可逆，请谨慎操作。'
                    : '删除后无法恢复，请确认操作。'}
                </p>
              </div>
            )}

            {visibleDialog === 'create' && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  备份备注（可选）
                </label>
                <textarea
                  aria-label="备份备注（可选）"
                  value={createNote}
                  onChange={(e) => setCreateNote(e.target.value)}
                  maxLength={CONTENT_LIMITS.admin.backupNote}
                  rows={4}
                  className="w-full px-4 py-2.5 rounded border border-border text-sm focus:outline-none focus:border-brand-gold resize-y"
                />
                <p className="mt-1.5 text-xs text-text-muted text-right">
                  {createNote.length}/{CONTENT_LIMITS.admin.backupNote}
                </p>
              </div>
            )}

            {visibleDialog === 'note' && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  备份备注
                </label>
                <textarea
                  aria-label="备份备注"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  maxLength={CONTENT_LIMITS.admin.backupNote}
                  rows={5}
                  className="w-full px-4 py-2.5 rounded border border-border text-sm focus:outline-none focus:border-brand-gold resize-y"
                />
                <p className="mt-1.5 text-xs text-text-muted text-right">
                  {editNote.length}/{CONTENT_LIMITS.admin.backupNote}
                </p>
              </div>
            )}

            {visibleDialog === 'restore' && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  选择备份文件
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip"
                  onChange={(e) => setRestoreFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-text-secondary file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-surface-alt file:text-text-primary hover:file:bg-bg-tertiary"
                />
                {restoreFile && (
                  <p className="mt-1.5 text-xs text-text-muted">
                    已选择: {restoreFile.name} ({(restoreFile.size / (1024 * 1024)).toFixed(1)} MB)
                  </p>
                )}
              </div>
            )}

            {visibleDialog === 'restore-existing' && (
              <div className="p-3 rounded bg-surface-alt border border-border mb-4">
                <p className="text-sm font-medium text-text-primary break-all">{restoreTarget}</p>
              </div>
            )}

            {(visibleDialog === 'restore' || visibleDialog === 'restore-existing') && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  旧备份解密密码（可选）
                </label>
                <input
                  type="password"
                  value={legacyPassword}
                  onChange={(e) => setLegacyPassword(e.target.value)}
                  placeholder="仅旧加密备份需要"
                  className="w-full px-4 py-2.5 rounded border border-border text-sm focus:outline-none focus:border-brand-gold"
                  onKeyDown={(e) => {
                    if (actionLoading) return
                    if (e.key === 'Enter') {
                      if (visibleDialog === 'restore-existing') {
                        handleRestoreExisting()
                      } else {
                        handleRestore()
                      }
                    }
                  }}
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={closeDialog}
                className="px-4 py-2 rounded border border-border text-sm text-text-secondary hover:bg-surface-alt transition-all"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (visibleDialog === 'create') handleCreate()
                  else if (visibleDialog === 'restore') handleRestore()
                  else if (visibleDialog === 'restore-existing') handleRestoreExisting()
                  else if (visibleDialog === 'delete') handleDelete()
                  else if (visibleDialog === 'note') handleUpdateNote()
                }}
                disabled={actionLoading !== null}
                className={clsx(
                  'px-4 py-2 rounded text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2',
                  visibleDialog === 'delete' ||
                    visibleDialog === 'restore' ||
                    visibleDialog === 'restore-existing'
                    ? 'theme-button-danger'
                    : 'theme-button-primary'
                )}
              >
                {actionLoading && <Loader2 size={14} className="animate-spin" />}
                {visibleDialog === 'create' && '创建备份'}
                {visibleDialog === 'restore' && '恢复数据库'}
                {visibleDialog === 'restore-existing' && '恢复数据库'}
                {visibleDialog === 'delete' && '确认删除'}
                {visibleDialog === 'note' && '保存备注'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminBackups
