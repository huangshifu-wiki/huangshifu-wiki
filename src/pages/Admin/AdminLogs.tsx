import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FileText, Shield, RefreshCw } from '@/src/components/icons'
import { clsx } from 'clsx'
import { apiGet } from '../../lib/apiClient'
import { formatDateTime } from '../../lib/dateUtils'
import type { AdminDataItem } from '../../types/entities'
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/src/components/ui'

function getModerationActionLabel(action: string | undefined) {
  if (action === 'approve') return '通过'
  if (action === 'reject') return '驳回'
  if (action === 'submit') return '提交'
  if (action === 'rollback') return '回滚'
  if (action === 'delete') return '删除'
  return action || '-'
}

function getModerationActionClassName(action: string | undefined) {
  if (action === 'approve') return 'theme-status-success'
  if (action === 'reject' || action === 'delete') return 'theme-status-error'
  return 'bg-surface-alt text-text-muted'
}

export const AdminLogs = ({ type: propType }: { type?: 'moderation_logs' | 'ban_logs' }) => {
  const { type: paramType } = useParams<{ type: 'moderation_logs' | 'ban_logs' }>()
  const logType = propType || paramType || 'moderation_logs'
  const [data, setData] = useState<AdminDataItem[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = async () => {
    setLoading(true)
    try {
      const result = await apiGet<{ logs: AdminDataItem[] }>(`/api/admin/${logType}`)
      setData(result.logs || [])
    } catch (e) {
      console.error(e)
      setData([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [logType])

  const Icon = logType === 'ban_logs' ? Shield : FileText
  const title = logType === 'ban_logs' ? '封禁日志' : '操作日志'

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-primary tracking-[0.12em] flex items-center gap-2">
          <Icon size={24} className="text-brand-gold" /> {title}
        </h1>
        <Button
          type="button"
          variant="secondary"
          onClick={fetchData}
          leftIcon={<RefreshCw size={14} />}
        >
          刷新
        </Button>
      </div>

      <div className="bg-surface border border-border rounded overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-surface-alt">
                {['时间', '操作者', '目标', '操作类型', '备注'].map((col) => (
                  <TableHead key={col} className="px-5 py-3 text-[11px] uppercase tracking-wider">
                    {col}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                [1, 2, 3, 4, 5].map((i) => (
                  <TableRow key={i} className="animate-pulse">
                    <TableCell colSpan={5} className="px-5 py-4">
                      <div className="h-6 bg-surface-alt rounded" />
                    </TableCell>
                  </TableRow>
                ))
              ) : data.length > 0 ? (
                data.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="px-5 py-4 text-text-muted whitespace-nowrap">
                      {formatDateTime(item.createdAt, 'N/A')}
                    </TableCell>
                    <TableCell className="px-5 py-4 font-medium">
                      {item.operatorName || item.operatorUid}
                    </TableCell>
                    <TableCell className="px-5 py-4 text-text-secondary">
                      {logType === 'ban_logs' ? (
                        <span className="font-medium text-text-primary">
                          {item.targetName || item.targetUid}
                        </span>
                      ) : (
                        <div>
                          <span className="px-2 py-0.5 bg-surface-alt text-brand-gold text-[10px] font-medium rounded">
                            {item.targetType}
                          </span>
                          <span className="ml-2 text-text-muted font-mono text-xs">
                            {item.targetId}
                          </span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="px-5 py-4">
                      {logType === 'ban_logs' ? (
                        <span
                          className={clsx(
                            'px-2 py-0.5 rounded text-[10px] font-medium',
                            item.action === 'ban' ? 'theme-status-error' : 'theme-status-success'
                          )}
                        >
                          {item.action === 'ban' ? '封禁' : '解封'}
                        </span>
                      ) : (
                        <span
                          className={clsx(
                            'px-2 py-0.5 rounded text-[10px] font-medium',
                            getModerationActionClassName(item.action)
                          )}
                        >
                          {getModerationActionLabel(item.action)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate px-5 py-4 text-text-muted">
                      {item.note || '-'}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="px-5 py-16 text-center text-text-muted italic">
                    暂无数据
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

export default AdminLogs
