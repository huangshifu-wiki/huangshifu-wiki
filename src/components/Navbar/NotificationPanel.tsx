import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Bell } from '@/src/components/icons'
import { clsx } from 'clsx'
import { useAuth } from '../../context/AuthContext'
import { DropdownPanel } from '../DropdownPanel'
import { useDismissableLayer } from '../../hooks/useClickOutside'
import { apiGet, apiPost } from '../../lib/apiClient'
import { getNotificationLink, getNotificationText } from '../../lib/notifications'
import type { NotificationsResponse } from '../../types/api'
import type { NotificationItem } from '../../types/entities'
import { Button, IconButton } from '@/src/components/ui'

interface NotificationPanelProps {
  onNavigate: (link: string) => void
}

const NotificationItem = React.memo(
  ({
    notif,
    isRead: isItemRead,
    onClick,
  }: {
    notif: NotificationItem
    isRead: boolean
    onClick: () => void
  }) => {
    const text = useMemo(() => getNotificationText(notif), [notif])

    return (
      <Button
        type="button"
        variant="ghost"
        onClick={onClick}
        className={clsx(
          'w-full flex-col items-stretch justify-start rounded-none border-x-0 border-t-0 px-4 py-3 text-left hover:bg-surface-alt',
          !isItemRead && 'bg-brand-gold/5'
        )}
      >
        <p
          className={clsx(
            'text-sm',
            !isItemRead ? 'font-medium text-text-primary' : 'text-text-secondary'
          )}
        >
          {text}
        </p>
        <p className="text-xs text-text-muted mt-0.5">
          {new Date(notif.createdAt).toLocaleString('zh-CN')}
        </p>
      </Button>
    )
  }
)

NotificationItem.displayName = 'NotificationItem'

export const NotificationPanel = React.memo(({ onNavigate }: NotificationPanelProps) => {
  const { user } = useAuth()
  const [notifPanelOpen, setNotifPanelOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [notifLoading, setNotifLoading] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const fetchNotifications = useCallback(async () => {
    if (!user) return
    try {
      setNotifLoading(true)
      const data = await apiGet<NotificationsResponse>('/api/notifications', {
        limit: 10,
      })
      setNotifications(data.notifications || [])
      setUnreadCount(data.unreadCount || 0)
    } catch (error) {
      console.error('Fetch notifications error:', error)
    } finally {
      setNotifLoading(false)
    }
  }, [user?.uid])

  React.useEffect(() => {
    if (user) {
      fetchNotifications()
      const interval = setInterval(fetchNotifications, 60000)
      return () => clearInterval(interval)
    }
  }, [user, fetchNotifications])

  const markNotificationRead = useCallback(async (id: string) => {
    try {
      await apiPost('/api/notifications/' + id + '/read')
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)))
      setUnreadCount((prev) => Math.max(0, prev - 1))
    } catch (error) {
      console.error('Mark notification read error:', error)
    }
  }, [])

  const markAllNotificationsRead = useCallback(async () => {
    try {
      await apiPost('/api/notifications/read-all')
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
      setUnreadCount(0)
    } catch (error) {
      console.error('Mark all notifications read error:', error)
    }
  }, [])

  const handleItemClick = useCallback(
    (notif: NotificationItem) => {
      if (!notif.isRead) {
        markNotificationRead(notif.id)
      }

      const link = getNotificationLink(notif)
      setNotifPanelOpen(false)

      if (link) {
        onNavigate(link)
      }
    },
    [markNotificationRead, onNavigate]
  )

  useDismissableLayer(panelRef, () => setNotifPanelOpen(false), notifPanelOpen)

  if (!user) return null

  return (
    <div ref={panelRef} className="relative">
      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setNotifPanelOpen(!notifPanelOpen)}
        className="relative text-text-muted hover:text-brand-gold transition-colors"
        aria-label={`通知${unreadCount > 0 ? `，有${unreadCount}条未读` : ''}`}
        aria-expanded={notifPanelOpen}
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center bg-[var(--color-error)] text-white text-[10px] font-bold rounded px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </IconButton>
      <DropdownPanel
        open={notifPanelOpen}
        className="absolute right-0 top-full mt-2 w-80 bg-surface rounded border border-border z-50 overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="font-bold text-text-primary">通知</span>
          {unreadCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={markAllNotificationsRead}
              className="h-auto min-h-0 p-0 text-xs text-brand-gold hover:bg-transparent hover:underline"
            >
              全部已读
            </Button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifLoading ? (
            <div className="py-8 text-center text-sm text-text-muted">加载中...</div>
          ) : notifications.length === 0 ? (
            <div className="py-8 text-center text-sm text-text-muted">暂无通知</div>
          ) : (
            notifications.map((notif) => (
              <NotificationItem
                key={notif.id}
                notif={notif}
                isRead={notif.isRead}
                onClick={() => handleItemClick(notif)}
              />
            ))
          )}
        </div>
      </DropdownPanel>
    </div>
  )
})

NotificationPanel.displayName = 'NotificationPanel'
