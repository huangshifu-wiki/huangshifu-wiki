import React, { useEffect, useState } from 'react'
import { Lock, RefreshCw, Trash2 } from '@/src/components/icons'
import { apiDelete, apiGet } from '../../lib/apiClient'
import { formatDateTime } from '../../lib/dateUtils'
import { useDialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import type { EditLockItem } from '../../types/entities'
import {
  Button,
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/src/components/ui'

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
          <Button
            type="button"
            variant="danger"
            onClick={releaseSelectedLocks}
            disabled={!selectedIds.size}
            loading={batchReleasing}
            loadingText="释放中..."
            leftIcon={<Trash2 size={14} />}
          >
            释放选中 {selectedIds.size || ''}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={fetchData}
            leftIcon={<RefreshCw size={14} />}
          >
            刷新
          </Button>
        </div>
      </div>

      <div className="bg-surface border border-border rounded overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-surface-alt">
                <TableHead className="px-5 py-3 text-[11px] uppercase tracking-wider">
                  <Checkbox
                    checked={data.length > 0 && selectedIds.size === data.length}
                    onCheckedChange={toggleAll}
                    aria-label="选择全部编辑锁"
                  />
                </TableHead>
                {['资源', '锁定者', '到期时间', '操作'].map((col) => (
                  <TableHead key={col} className="px-5 py-3 text-[11px] uppercase tracking-wider">
                    {col}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                [1, 2, 3].map((i) => (
                  <TableRow key={i} className="animate-pulse">
                    <TableCell colSpan={5} className="px-5 py-4">
                      <div className="h-6 bg-surface-alt rounded" />
                    </TableCell>
                  </TableRow>
                ))
              ) : data.length > 0 ? (
                data.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="px-5 py-4">
                      <Checkbox
                        checked={selectedIds.has(item.id)}
                        onCheckedChange={() => toggleSelected(item.id)}
                        aria-label={`选择 ${item.collection} / ${item.recordId}`}
                      />
                    </TableCell>
                    <TableCell className="px-5 py-4">
                      <p className="text-sm font-medium text-text-primary">
                        {item.collection} / {item.recordId}
                      </p>
                    </TableCell>
                    <TableCell className="px-5 py-4 text-text-secondary">
                      {item.username} ({item.userId?.slice(0, 8) ?? '未知'})
                    </TableCell>
                    <TableCell className="px-5 py-4 text-xs text-text-muted">
                      {formatDateTime(item.expiresAt, 'N/A')}
                    </TableCell>
                    <TableCell className="px-5 py-4 text-left">
                      <Button
                        type="button"
                        variant="warning"
                        size="sm"
                        onClick={() => releaseLock(item)}
                        leftIcon={<Lock size={14} />}
                      >
                        强制释放
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="px-5 py-16 text-center text-text-muted italic">
                    暂无编辑锁
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}

export default AdminLocks
