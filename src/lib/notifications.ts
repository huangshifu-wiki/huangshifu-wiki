import type { NotificationItem } from '../types/entities'

interface ReviewNotificationPayload {
  approved?: boolean
  action?: 'deleted' | 'restored'
  targetType?: 'wiki' | 'post' | 'gallery'
  targetId?: string
  targetSlug?: string
  title?: string
  note?: string | null
  status?: 'draft' | 'pending' | 'published' | 'rejected' | string | null
  linkable?: boolean
}

const RESTORED_WIKI_LINKABLE_STATUSES = new Set(['draft', 'pending', 'published'])

type ReplyTarget = { kind: 'post' | 'gallery'; id: string; slug?: string }

function getPayloadText(payload: NotificationItem['payload'], key: string) {
  const value = payload[key]
  return typeof value === 'string' ? value.trim() : ''
}

// reply/like 通知的目标：优先读显式 targetType，旧 payload 回退到 id 字段是否存在。
// 单一来源，供文案与链接共用，避免两处判定不一致。
function resolveReplyTarget(payload: NotificationItem['payload']): ReplyTarget | null {
  const galleryId = typeof payload.galleryId === 'string' ? payload.galleryId : null
  const gallerySlug = typeof payload.gallerySlug === 'string' ? payload.gallerySlug : undefined
  const postId = typeof payload.postId === 'string' ? payload.postId : null
  const postSlug = typeof payload.postSlug === 'string' ? payload.postSlug : undefined
  if (payload.targetType === 'gallery' || (!payload.targetType && galleryId)) {
    return galleryId ? { kind: 'gallery', id: galleryId, slug: gallerySlug } : null
  }
  return postId ? { kind: 'post', id: postId, slug: postSlug } : null
}

export function getNotificationText(notif: NotificationItem) {
  switch (notif.type) {
    case 'reply': {
      const target = resolveReplyTarget(notif.payload)
      const noun = target?.kind === 'gallery' ? '图集' : '帖子'
      const targetText = notif.payload.parentId ? '评论' : noun
      const actorName = getPayloadText(notif.payload, 'actorName')
      const preview = getPayloadText(notif.payload, 'preview')
      const base = `${actorName ? `${actorName} ` : ''}回复了你的${targetText}`
      return preview ? `${base}：${preview}` : base
    }
    case 'like': {
      const actorName = getPayloadText(notif.payload, 'actorName')
      return `${actorName ? `${actorName} ` : ''}赞了你的帖子`
    }
    case 'mention': {
      const target = resolveReplyTarget(notif.payload)
      const noun = target?.kind === 'gallery' ? '图集' : '帖子'
      const targetText = notif.payload.commentId ? '评论' : noun
      const actorName = getPayloadText(notif.payload, 'actorName')
      const preview = getPayloadText(notif.payload, 'preview')
      const base = `${actorName ? `${actorName} ` : ''}提到了你`
      return preview ? `${base}（${targetText}）：${preview}` : `${base}（${targetText}）`
    }
    case 'review_result': {
      const payload = notif.payload as ReviewNotificationPayload
      const target =
        payload.targetType === 'wiki'
          ? '百科'
          : payload.targetType === 'post'
            ? '帖子'
            : payload.targetType === 'gallery'
              ? '图集'
              : '内容'
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
  if (notif.type === 'reply' || notif.type === 'like' || notif.type === 'mention') {
    const target = resolveReplyTarget(notif.payload)
    if (!target) return null
    const publicId = target.slug || target.id
    const base = target.kind === 'gallery' ? `/gallery/${publicId}` : `/forum/${publicId}`
    const commentId = getPayloadText(notif.payload, 'commentId')
    return commentId ? `${base}#comment-${commentId}` : base
  }

  if (notif.type === 'review_result') {
    const payload = notif.payload as ReviewNotificationPayload

    if (payload.targetType === 'wiki' && typeof payload.targetId === 'string') {
      if (payload.action === 'restored') {
        if (typeof payload.linkable === 'boolean') {
          return payload.linkable ? `/wiki/${payload.targetSlug || payload.targetId}` : null
        }

        if (!RESTORED_WIKI_LINKABLE_STATUSES.has(String(payload.status || ''))) {
          return null
        }
      }

      if (payload.action !== 'restored' && payload.approved !== true) {
        return null
      }

      return `/wiki/${payload.targetSlug || payload.targetId}`
    }

    if (payload.targetType === 'post' && typeof payload.targetId === 'string') {
      if (payload.action === 'deleted') {
        return null
      }

      if (payload.action === 'restored' && typeof payload.linkable === 'boolean') {
        return payload.linkable ? `/forum/${payload.targetSlug || payload.targetId}` : null
      }

      return `/forum/${payload.targetSlug || payload.targetId}`
    }

    if (payload.targetType === 'gallery' && typeof payload.targetId === 'string') {
      if (payload.action === 'deleted') {
        return null
      }

      return `/gallery/${payload.targetSlug || payload.targetId}`
    }
  }

  return null
}
