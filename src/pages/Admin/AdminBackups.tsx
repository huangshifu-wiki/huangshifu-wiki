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
} from 'lucide-react'
import { format } from 'date-fns'
import { clsx } from 'clsx'
import { apiGet, apiPost, apiUpload, getXsrfToken } from '../../lib/apiClient'
import { useToast } from '../../components/Toast'
import { useFloatingPresence } from '../../hooks/useFloatingPresence'
import { CONTENT_LIMITS } from '../../lib/contentLimits'

type BackupFile = {
  filename: string
  size: number
  sizeFormatted: string
  createdAt: string
  note: string
}

type BackupCreateResponse = { backup: BackupFile }
type BackupListResponse = { backups: BackupFile[] }
type BackupNoteResponse = { success: boolean; note: string }
type DialogType = 'create' | 'restore' | 'restore-existing' | 'delete' | 'note' | null

const AdminBackups = () => {
  const [backups, setBackups] = useState<BackupFile[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogType>(null)
  const [createNote, setCreateNote] = useState('')
  const [editNote, setEditNote] = useState('')
  const [legacyPassword, setLegacyPassword] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [noteTarget, setNoteTarget] = useState<string | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null)
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
        const response = await apiGet<BackupListResponse>('/api/admin/backup/list', undefined, {
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

  const handleCreate = async () => {
    setActionLoading('create')
    try {
      const body = createNote.trim() ? { note: createNote } : undefined
      const response = body
        ? await apiPost<BackupCreateResponse>('/api/admin/backup/create', body)
        : await apiPost<BackupCreateResponse>('/api/admin/backup/create')
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
      const response = await apiPost<BackupNoteResponse>(
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

  const handleDownload = async (filename: string) => {
    if (actionLoading) {
      return
    }
    setActionLoading('download')
    try {
      const xsrfToken = getXsrfToken()
      const response = await fetch(`/api/admin/backup/${encodeURIComponent(filename)}/download`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(xsrfToken ? { 'X-XSRF-TOKEN': xsrfToken } : {}),
        },
      })
      if (!response.ok)
        throw new Error((await response.json().catch(() => ({}))).error || '下载失败')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      show('下载完成', { variant: 'success' })
    } catch (error) {
      show(error instanceof Error ? error.message : '下载失败', { variant: 'error' })
    } finally {
      setActionLoading(null)
    }
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
      await apiUpload<{ success: boolean }>('/api/admin/backup/restore', formData)
      show('数据库恢复成功')
      closeDialog()
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
      await apiPost<{ success: boolean }>(
        `/api/admin/backup/${encodeURIComponent(restoreTarget)}/restore`,
        { confirm: true, ...(legacyPassword !== '' ? { legacyPassword } : {}) }
      )
      show('数据库恢复成功')
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

  const openNoteDialog = (backup: BackupFile) => {
    setNoteTarget(backup.filename)
    setEditNote(backup.note || '')
    setDialog('note')
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
              <th className="px-5 py-3 text-right text-[11px] font-semibold text-text-muted uppercase tracking-wider">
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
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openNoteDialog(backup)}
                        className="p-2 text-text-secondary hover:text-brand-gold hover:bg-surface-alt rounded transition-all"
                        title="编辑备注"
                      >
                        <Pencil size={18} />
                      </button>
                      <button
                        onClick={() => handleDownload(backup.filename)}
                        className="p-2 text-brand-gold hover:bg-surface-alt rounded transition-all"
                        title="下载"
                      >
                        <Download size={18} />
                      </button>
                      <button
                        onClick={() => openRestoreExistingDialog(backup.filename)}
                        className="p-2 text-text-secondary hover:text-red-500 hover:bg-surface-alt rounded transition-all"
                        title="恢复"
                      >
                        <RotateCcw size={18} />
                      </button>
                      <button
                        onClick={() => openDeleteDialog(backup.filename)}
                        className="p-2 theme-icon-button-danger hover:bg-surface-alt rounded transition-all"
                        title="删除"
                      >
                        <Trash2 size={18} />
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
