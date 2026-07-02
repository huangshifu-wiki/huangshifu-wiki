import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Book,
  Music,
  MessageSquare,
  Image as ImageIcon,
  Users,
  Layers,
  Megaphone,
  Lock,
  RefreshCw,
} from 'lucide-react'
import { apiGet } from '../../lib/apiClient'
import { useAuth } from '../../context/AuthContext'

const cards = [
  { key: 'wiki', label: '百科', path: '/admin/wiki', icon: Book },
  { key: 'music', label: '音乐', path: '/admin/music', icon: Music },
  { key: 'posts', label: '帖子', path: '/admin/posts', icon: MessageSquare },
  {
    key: 'galleries',
    label: '图集',
    path: '/admin/galleries',
    icon: ImageIcon,
  },
  { key: 'users', label: '用户', path: '/admin/users', icon: Users },
  { key: 'sections', label: '版块', path: '/admin/sections', icon: Layers },
  {
    key: 'announcements',
    label: '公告',
    path: '/admin/announcements',
    icon: Megaphone,
  },
  { key: 'locks', label: '编辑锁', path: '/admin/locks', icon: Lock },
]

type AdminDashboardListResponse = {
  data?: unknown[]
  locks?: unknown[]
  total?: number
}

export const AdminDashboard = () => {
  const { user } = useAuth()
  const [stats, setStats] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchStats = async (manual = false) => {
    if (manual) setRefreshing(true)
    else setLoading(true)
    try {
      const results: Record<string, number> = {}
      await Promise.all(
        cards.map(async (c) => {
          try {
            const data = await apiGet<AdminDashboardListResponse>(`/api/admin/${c.key}`)
            results[c.key] =
              typeof data.total === 'number' ? data.total : (data.data || data.locks || []).length
          } catch {
            results[c.key] = 0
          }
        })
      )
      setStats(results)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchStats()
  }, [])

  const total = Object.values(stats).reduce<number>((a: number, b: number) => a + b, 0)
  const isRegularAdmin = user?.role === 'admin'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary tracking-[0.12em]">仪表盘</h1>
          <p className="text-sm text-text-muted mt-1">总内容量：{total}</p>
        </div>
        <button
          onClick={() => fetchStats(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-4 py-2 border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded transition-all disabled:opacity-50"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> 刷新
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((c) => (
            <div key={c.key} className="bg-surface border border-border rounded p-5 animate-pulse">
              <div className="h-4 bg-bg-tertiary rounded w-16 mb-3" />
              <div className="h-8 bg-bg-tertiary rounded w-20" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((c) => {
            const Icon = c.icon
            return (
              <Link
                key={c.key}
                to={c.path}
                className="bg-surface border border-border rounded p-5 hover:border-brand-gold transition-all group"
              >
                <div className="flex items-center gap-2 mb-3">
                  <Icon
                    size={16}
                    className="text-text-muted group-hover:text-brand-gold transition-colors"
                  />
                  <span className="text-sm text-text-muted group-hover:text-brand-gold transition-colors">
                    {c.label}
                  </span>
                </div>
                <p className="text-2xl font-bold text-text-primary">{stats[c.key] ?? 0}</p>
              </Link>
            )
          })}
        </div>
      )}

      {isRegularAdmin && (
        <div className="flex items-start gap-3 rounded border border-border bg-surface p-4 text-sm text-text-secondary">
          <AlertTriangle size={18} className="theme-text-warning mt-0.5 shrink-0" />
          <p>数据库备份功能仅限超级管理员使用。普通管理员无法查看、创建、下载、恢复或删除备份。</p>
        </div>
      )}
    </div>
  )
}

export default AdminDashboard
