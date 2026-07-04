import React, { useState } from 'react'
import {
  Bell,
  CheckCheck,
  ChevronLeft,
  MessageCircle,
  AtSign,
  ThumbsUp,
  ShieldCheck,
  Loader2,
} from '@/src/components/icons'
import { clsx } from 'clsx'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiGet, apiPost } from '../lib/apiClient'
import { getNotificationLink, getNotificationText } from '../lib/notifications'
import Pagination from '../components/Pagination'
import { useRoutedPagination } from '../hooks/useRoutedPagination'
import type { NotificationItem } from '../types/entities'

type NotificationType = NotificationItem['type']

type NotificationsResponse = {
  notifications: NotificationItem[]
  total: number
  unreadCount: number
  page: number
  limit: number
}

type NotificationFilter = 'all' | NotificationType | 'unread'

const PAGE_SIZE = 20

const FILTER_OPTIONS: Array<{ id: NotificationFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'unread', label: '未读' },
  { id: 'reply', label: '回复' },
  { id: 'like', label: '点赞' },
  { id: 'mention', label: '提及' },
  { id: 'review_result', label: '审核结果' },
]

function isNotificationFilter(value: string | null): value is NotificationFilter {
  return (
    value === 'all' ||
    value === 'unread' ||
    value === 'reply' ||
    value === 'like' ||
    value === 'mention' ||
    value === 'review_result'
  )
}

function getNotificationTypeLabel(type: NotificationType) {
  if (type === 'reply') return '回复'
  if (type === 'like') return '点赞'
  if (type === 'mention') return '提及'
  return '审核'
}

function NotificationTypeIcon({ type }: { type: NotificationType }) {
  if (type === 'reply') {
    return <MessageCircle size={14} className="text-brand-gold" />
  }
  if (type === 'like') {
    return <ThumbsUp size={14} className="text-brand-gold" />
  }
  if (type === 'mention') {
    return <AtSign size={14} className="text-brand-gold" />
  }
  return <ShieldCheck size={14} className="text-brand-gold" />
}

const Notifications = () => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const rawFilter = searchParams.get('filter')
  const filter: NotificationFilter = isNotificationFilter(rawFilter) ? rawFilter : 'all'
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [markingAllRead, setMarkingAllRead] = useState(false)
  const [data, setData] = useState<NotificationsResponse>({
    notifications: [],
    total: 0,
    unreadCount: 0,
    page: 1,
    limit: PAGE_SIZE,
  })
  const pagination = useRoutedPagination({
    totalCount: data.total,
    totalKnown: loaded,
    defaultPageSize: PAGE_SIZE,
    pageSizeParam: null,
    showPageSizeSelector: false,
  })

  const fetchData = React.useCallback(async () => {
    setLoading(true)
    try {
      const query: Record<string, string | number | boolean> = {
        page: pagination.page,
        limit: PAGE_SIZE,
      }
      if (filter === 'unread') {
        query.unread = true
      }
      if (
        filter === 'reply' ||
        filter === 'like' ||
        filter === 'mention' ||
        filter === 'review_result'
      ) {
        query.type = filter
      }

      const response = await apiGet<NotificationsResponse>('/api/notifications', query)

      setData({
        ...response,
        notifications: response.notifications,
      })
      setLoaded(true)
    } catch (error) {
      console.error('Fetch notifications error:', error)
    } finally {
      setLoading(false)
    }
  }, [filter, pagination.page])

  React.useEffect(() => {
    fetchData()
  }, [fetchData])

  React.useEffect(() => {
    if (rawFilter && !isNotificationFilter(rawFilter)) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('filter')
          return next
        },
        { replace: true }
      )
    }

    if (rawFilter === 'all') {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('filter')
          return next
        },
        { replace: true }
      )
    }
  }, [rawFilter, setSearchParams])

  const updateQuery = (nextFilter: NotificationFilter, nextPage = 1) => {
    const next = new URLSearchParams(searchParams)
    if (nextFilter === 'all') {
      next.delete('filter')
    } else {
      next.set('filter', nextFilter)
    }
    if (nextPage > 1) {
      next.set('page', String(nextPage))
    } else {
      next.delete('page')
    }
    setSearchParams(next)
  }

  const markNotificationRead = async (id: string) => {
    try {
      await apiPost('/api/notifications/' + id + '/read')
      setData((prev) => ({
        ...prev,
        unreadCount: Math.max(0, prev.unreadCount - 1),
        notifications: prev.notifications.map((item) =>
          item.id === id ? { ...item, isRead: true } : item
        ),
      }))
    } catch (error) {
      console.error('Mark notification read error:', error)
    }
  }

  const markAllNotificationsRead = async () => {
    setMarkingAllRead(true)
    try {
      await apiPost('/api/notifications/read-all')
      setData((prev) => ({
        ...prev,
        unreadCount: 0,
        notifications: prev.notifications.map((item) => ({
          ...item,
          isRead: true,
        })),
      }))
    } catch (error) {
      console.error('Mark all notifications read error:', error)
    } finally {
      setMarkingAllRead(false)
    }
  }

  return (
    <div
      className="min-h-[calc(100vh-60px)] bg-bg-primary"
      style={{
        fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
        lineHeight: 1.8,
      }}
    >
      <div className="max-w-[900px] mx-auto px-6 py-12">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-brand-gold transition-colors mb-6"
        >
          <ChevronLeft size={16} />
          返回首页
        </Link>

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2 tracking-[0.05em]">
              <Bell size={22} className="text-brand-gold" />
              通知中心
            </h1>
            <p className="text-sm text-text-muted mt-1">
              未读 {data.unreadCount} 条，共 {data.total} 条
            </p>
          </div>
          <button
            onClick={markAllNotificationsRead}
            disabled={markingAllRead || data.unreadCount === 0}
            className="inline-flex items-center gap-2 px-4 py-2 theme-button-primary text-sm rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CheckCheck size={16} />
            {markingAllRead ? '处理中...' : '全部标记已读'}
          </button>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1 border-b border-border mb-6 overflow-x-auto">
          {FILTER_OPTIONS.map((option) => (
            <button
              key={option.id}
              onClick={() => updateQuery(option.id, 1)}
              className={clsx(
                'px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap relative',
                filter === option.id
                  ? 'text-brand-gold'
                  : 'text-text-secondary hover:text-brand-gold'
              )}
            >
              {option.label}
              {filter === option.id && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--color-theme-accent)] rounded-[1px]" />
              )}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="bg-surface border border-border rounded overflow-hidden min-h-[360px]">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="animate-spin text-brand-gold" />
            </div>
          ) : data.notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-text-muted">
              <Bell size={36} className="mb-3 opacity-50" />
              <p>当前筛选下暂无通知</p>
            </div>
          ) : (
            <ul>
              {data.notifications.map((notif) => {
                const link = getNotificationLink(notif)
                return (
                  <li
                    key={notif.id}
                    className={clsx(
                      'px-6 py-4 border-b border-border last:border-b-0 transition-colors',
                      !notif.isRead && 'bg-brand-gold/10'
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <button
                        onClick={() => {
                          if (!notif.isRead) {
                            markNotificationRead(notif.id)
                          }
                          if (link) {
                            navigate(link)
                          }
                        }}
                        className="text-left flex-1"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <NotificationTypeIcon type={notif.type} />
                          <span className="text-[11px] px-2 py-0.5 rounded bg-surface-alt text-text-secondary">
                            {getNotificationTypeLabel(notif.type)}
                          </span>
                          {!notif.isRead && (
                            <span className="text-[11px] text-brand-gold font-medium">未读</span>
                          )}
                        </div>
                        <p
                          className={clsx(
                            'text-sm',
                            !notif.isRead ? 'font-medium text-text-primary' : 'text-text-secondary'
                          )}
                        >
                          {getNotificationText(notif)}
                        </p>
                        <p className="text-xs text-text-muted mt-1">
                          {new Date(notif.createdAt).toLocaleString('zh-CN')}
                        </p>
                      </button>

                      {!notif.isRead ? (
                        <button
                          onClick={() => markNotificationRead(notif.id)}
                          className="text-xs text-brand-gold hover:underline shrink-0"
                        >
                          标记已读
                        </button>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {pagination.totalPages > 1 && (
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            onPageChange={(newPage) => updateQuery(filter, newPage)}
            showPageSizeSelector={false}
          />
        )}
      </div>
    </div>
  )
}

export default Notifications
