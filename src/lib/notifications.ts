import type { NotificationItem } from '../types/entities'

interface ReviewNotificationPayload {
  approved?: boolean
  action?: 'deleted' | 'restored'
  targetType?: 'wiki' | 'post'
  targetId?: string
  title?: string
  note?: string | null
  status?: 'draft' | 'pending' | 'published' | 'rejected' | string | null
  linkable?: boolean
}

const RESTORED_WIKI_LINKABLE_STATUSES = new Set(['draft', 'pending', 'published'])

type ReplyTarget = { kind: 'post' | 'gallery'; id: string }

// reply/like 通知的目标：优先读显式 targetType，旧 payload 回退到 id 字段是否存在。
// 单一来源，供文案与链接共用，避免两处判定不一致。
function resolveReplyTarget(payload: NotificationItem['payload']): ReplyTarget | null {
  const galleryId = typeof payload.galleryId === 'string' ? payload.galleryId : null
  const postId = typeof payload.postId === 'string' ? payload.postId : null
  if (payload.targetType === 'gallery' || (!payload.targetType && galleryId)) {
    return galleryId ? { kind: 'gallery', id: galleryId } : null
  }
  return postId ? { kind: 'post', id: postId } : null
}

export function getNotificationText(notif: NotificationItem) {
  switch (notif.type) {
    case 'reply': {
      const target = resolveReplyTarget(notif.payload)
      const noun = target?.kind === 'gallery' ? '图集' : '帖子'
      return '回复了你的' + (notif.payload.parentId ? '评论' : noun)
    }
    case 'like':
      return '赞了你的帖子'
    case 'review_result': {
      const payload = notif.payload as ReviewNotificationPayload
      const target =
        payload.targetType === 'wiki' ? '百科' : payload.targetType === 'post' ? '帖子' : '内容'
      const title =
        typeof payload.title === 'string' && payload.title.trim() ? `《${payload.title}》` : ''
      const base =
        payload.action === 'deleted'
          ? `你的${target}已被删除`
          : payload.action === 'restored'
            ? `你的${target}已被恢复`
          : payload.approved === true
            ? `已通过你的${target}编辑审核`
            : `已驳回你的${target}编辑审核`

      if (payload.approved === true && payload.action !== 'deleted') {
        return `${base}${title ? `：${title}` : ''}`
      }

      const note = typeof payload.note === 'string' ? payload.note.trim() : ''
      return `${base}${title ? `：${title}` : ''}${note ? `（原因：${note}）` : ''}`
    }
    default:
      return '有新通知'
  }
}

export function getNotificationLink(notif: NotificationItem) {
  if (notif.type === 'reply' || notif.type === 'like') {
    const target = resolveReplyTarget(notif.payload)
    if (!target) return null
    return target.kind === 'gallery' ? `/gallery/${target.id}` : `/forum/${target.id}`
  }

  if (notif.type === 'review_result') {
    const payload = notif.payload as ReviewNotificationPayload

    if (payload.targetType === 'wiki' && typeof payload.targetId === 'string') {
      if (payload.action === 'restored') {
        if (typeof payload.linkable === 'boolean') {
          return payload.linkable ? `/wiki/${payload.targetId}` : null
        }

        if (!RESTORED_WIKI_LINKABLE_STATUSES.has(String(payload.status || ''))) {
          return null
        }
      }

      if (payload.action !== 'restored' && payload.approved !== true) {
        return null
      }

      return `/wiki/${payload.targetId}`
    }

    if (payload.targetType === 'post' && typeof payload.targetId === 'string') {
      if (payload.action === 'deleted') {
        return null
      }

      if (payload.action === 'restored' && typeof payload.linkable === 'boolean') {
        return payload.linkable ? `/forum/${payload.targetId}` : null
      }

      return `/forum/${payload.targetId}`
    }
  }

  return null
}
