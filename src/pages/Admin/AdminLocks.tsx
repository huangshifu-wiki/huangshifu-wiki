import React, { useEffect, useState } from 'react'
import { Lock, RefreshCw, Trash2 } from '@/src/components/icons'
import { apiDelete, apiGet } from '../../lib/apiClient'
import { formatDateTime } from '../../lib/dateUtils'
import { useDialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import type { EditLockItem } from '../../types/entities'

export const AdminLocks = () => {
  const [data, setData] = useState<EditLockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchReleasing, setBatchReleasing] = useState(false)
  const dialog = useDialog()
  const { show } = useToast()

  const fetchData = async () => {
    setLoading(true)
    try {
      const result = await apiGet<{ locks: EditLockItem[] }>('/api/admin/locks')
      const locks = result.locks || []
      setData(locks)
      setSelectedIds((prev) => {
        const existingIds = new Set(locks.map((lock) => lock.id))
        return new Set([...prev].filter((lockId) => existingIds.has(lockId)))
      })
    } catch (e) {
      console.error(e)
      setData([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const releaseLock = async (lock: EditLockItem) => {
    const confirmed = await dialog.confirm({
      title: '释放编辑锁',
      message: '确定要强制释放这个编辑锁吗？',
      confirmText: '释放',
      variant: 'warning',
    })
    if (!confirmed) return
    try {
      await apiDelete(`/api/admin/locks/${lock.id}`)
      setData((prev) => prev.filter((item) => item.id !== lock.id))
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(lock.id)
        return next
      })
      show('已释放', { variant: 'success' })
    } catch (e) {
      show('释放失败', { variant: 'error' })
    }
  }

  const toggleSelected = (lockId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(lockId)) {
        next.delete(lockId)
      } else {
        next.add(lockId)
      }
      return next
    })
  }

  const toggleAll = () => {
    setSelectedIds((prev) =>
      prev.size === data.length ? new Set() : new Set(data.map((item) => item.id))
    )
  }

  const releaseSelectedLocks = async () => {
    if (!selectedIds.size || batchReleasing) return
    const lockIds = [...selectedIds]
    const confirmed = await dialog.confirm({
      title: '批量释放编辑锁',
      message: `确定要释放选中的 ${lockIds.length} 个编辑锁吗？`,
      confirmText: '批量释放',
      variant: 'warning',
    })
    if (!confirmed) return

    try {
      setBatchReleasing(true)
      await apiDelete('/api/admin/locks', { lockIds })
      setData((prev) => prev.filter((item) => !lockIds.includes(item.id)))
      setSelectedIds(new Set())
      show('已批量释放', { variant: 'success' })
    } catch (e) {
      show('批量释放失败', { variant: 'error' })
    } finally {
      setBatchReleasing(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-primary tracking-[0.12em]">编辑锁</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={releaseSelectedLocks}
            disabled={!selectedIds.size || batchReleasing}
            className="inline-flex items-center gap-1.5 rounded theme-button-danger px-4 py-2 text-sm transition-all disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={14} />{' '}
            {batchReleasing ? '释放中...' : `释放选中 ${selectedIds.size || ''}`}
          </button>
          <button
            onClick={fetchData}
            className="px-4 py-2 border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded text-sm transition-all"
          >
            <RefreshCw size={14} className="inline mr-1" /> 刷新
          </button>
        </div>
      </div>

      <div className="bg-surface border border-border rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-alt border-b border-border">
                <th className="px-5 py-3 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                  <input
                    type="checkbox"
                    checked={data.length > 0 && selectedIds.size === data.length}
                    onChange={toggleAll}
                    className="accent-brand-gold"
                    aria-label="选择全部编辑锁"
                  />
                </th>
                {['资源', '锁定者', '到期时间', '操作'].map((col) => (
                  <th
                    key={col}
                    className="px-5 py-3 text-[11px] font-semibold text-text-muted uppercase tracking-wider"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                [1, 2, 3].map((i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={5} className="px-5 py-4">
                      <div className="h-6 bg-surface-alt rounded" />
                    </td>
                  </tr>
                ))
              ) : data.length > 0 ? (
                data.map((item) => (
                  <tr key={item.id} className="hover:bg-surface-alt transition-colors group">
                    <td className="px-5 py-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={() => toggleSelected(item.id)}
                        className="accent-brand-gold"
                        aria-label={`选择 ${item.collection} / ${item.recordId}`}
                      />
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-sm font-medium text-text-primary">
                        {item.collection} / {item.recordId}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-sm text-text-secondary">
                      {item.username} ({item.userId?.slice(0, 8) ?? '未知'})
                    </td>
                    <td className="px-5 py-4 text-xs text-text-muted">
                      {formatDateTime(item.expiresAt, 'N/A')}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        onClick={() => releaseLock(item)}
                        className="p-1.5 theme-icon-button-warning hover:bg-surface-alt rounded transition-all opacity-0 group-hover:opacity-100"
                        title="强制释放"
                      >
                        <Lock size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-5 py-16 text-center text-text-muted italic">
                    暂无编辑锁
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default AdminLocks
