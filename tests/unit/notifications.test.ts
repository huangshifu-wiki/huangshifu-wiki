import { describe, expect, it } from 'vitest'
import { getNotificationLink, getNotificationText } from '../../src/lib/notifications'
import type { NotificationItem } from '../../src/types/entities'

function makeNotification(
  type: NotificationItem['type'],
  payload: Record<string, unknown>
): NotificationItem {
  return {
    id: 'n1',
    type,
    payload,
    isRead: false,
    createdAt: '2026-06-01T00:00:00.000Z',
  }
}

describe('getNotificationLink', () => {
  it('routes a gallery reply (targetType=gallery) to the gallery detail page', () => {
    expect(
      getNotificationLink(makeNotification('reply', { targetType: 'gallery', galleryId: 'g1' }))
    ).toBe('/gallery/g1')
  })

  it('routes a post reply/like (targetType=post) to the forum detail page', () => {
    expect(
      getNotificationLink(makeNotification('reply', { targetType: 'post', postId: 'p1' }))
    ).toBe('/forum/p1')
    expect(getNotificationLink(makeNotification('like', { postId: 'p1' }))).toBe('/forum/p1')
  })

  it('falls back to id-key presence for legacy payloads without targetType', () => {
    expect(getNotificationLink(makeNotification('reply', { galleryId: 'g1' }))).toBe('/gallery/g1')
    expect(getNotificationLink(makeNotification('reply', { postId: 'p1' }))).toBe('/forum/p1')
    // gallery wins when both ids are present and no explicit targetType
    expect(getNotificationLink(makeNotification('reply', { galleryId: 'g1', postId: 'p1' }))).toBe(
      '/gallery/g1'
    )
  })

  it('returns null when neither galleryId nor postId is present', () => {
    expect(getNotificationLink(makeNotification('reply', {}))).toBeNull()
  })

  it('routes review_result notifications by target type', () => {
    expect(
      getNotificationLink(
        makeNotification('review_result', { targetType: 'wiki', targetId: 'w1', approved: true })
      )
    ).toBe('/wiki/w1')
    expect(
      getNotificationLink(
        makeNotification('review_result', { targetType: 'wiki', targetId: 'w1', approved: false })
      )
    ).toBeNull()
    expect(
      getNotificationLink(makeNotification('review_result', { targetType: 'post', targetId: 'p1' }))
    ).toBe('/forum/p1')
    expect(
      getNotificationLink(
        makeNotification('review_result', {
          targetType: 'post',
          targetId: 'p1',
          action: 'deleted',
        })
      )
    ).toBeNull()
    expect(
      getNotificationLink(
        makeNotification('review_result', {
          targetType: 'post',
          targetId: 'p1',
          action: 'restored',
          linkable: false,
        })
      )
    ).toBeNull()
    expect(
      getNotificationLink(
        makeNotification('review_result', {
          targetType: 'post',
          targetId: 'p1',
          action: 'restored',
          linkable: true,
        })
      )
    ).toBe('/forum/p1')
    expect(
      getNotificationLink(
        makeNotification('review_result', {
          targetType: 'wiki',
          targetId: 'w1',
          action: 'restored',
          status: 'published',
        })
      )
    ).toBe('/wiki/w1')
    expect(
      getNotificationLink(
        makeNotification('review_result', {
          targetType: 'wiki',
          targetId: 'w1',
          action: 'restored',
          status: 'rejected',
        })
      )
    ).toBeNull()
    expect(
      getNotificationLink(
        makeNotification('review_result', {
          targetType: 'wiki',
          targetId: 'w1',
          action: 'restored',
          status: 'rejected',
          linkable: true,
        })
      )
    ).toBe('/wiki/w1')
  })
})

describe('getNotificationText', () => {
  it('labels a top-level gallery comment as 图集', () => {
    expect(
      getNotificationText(
        makeNotification('reply', { targetType: 'gallery', galleryId: 'g1', parentId: null })
      )
    ).toBe('回复了你的图集')
  })

  it('labels a top-level post comment as 帖子', () => {
    expect(
      getNotificationText(
        makeNotification('reply', { targetType: 'post', postId: 'p1', parentId: null })
      )
    ).toBe('回复了你的帖子')
  })

  it('labels a reply to a comment as 评论 regardless of target', () => {
    expect(
      getNotificationText(
        makeNotification('reply', { targetType: 'gallery', galleryId: 'g1', parentId: 'c1' })
      )
    ).toBe('回复了你的评论')
    expect(
      getNotificationText(
        makeNotification('reply', { targetType: 'post', postId: 'p1', parentId: 'c1' })
      )
    ).toBe('回复了你的评论')
  })

  it('falls back to id-key presence for legacy payloads without targetType', () => {
    expect(getNotificationText(makeNotification('reply', { galleryId: 'g1' }))).toBe(
      '回复了你的图集'
    )
    expect(getNotificationText(makeNotification('reply', { postId: 'p1' }))).toBe('回复了你的帖子')
  })

  it('renders reply actor and content preview when available', () => {
    expect(
      getNotificationText(
        makeNotification('reply', {
          targetType: 'post',
          postId: 'p1',
          parentId: 'c1',
          actorName: '黄诗扶',
          preview: '这是一条回复内容',
        })
      )
    ).toBe('黄诗扶 回复了你的评论：这是一条回复内容')

    expect(
      getNotificationText(
        makeNotification('reply', {
          targetType: 'gallery',
          galleryId: 'g1',
          parentId: null,
          actorName: '黄诗扶',
          preview: '图集评论内容',
        })
      )
    ).toBe('黄诗扶 回复了你的图集：图集评论内容')
  })

  it('renders like and review_result text', () => {
    expect(getNotificationText(makeNotification('like', { postId: 'p1' }))).toBe('赞了你的帖子')
    expect(getNotificationText(makeNotification('like', { postId: 'p1', actorName: '黄诗扶' }))).toBe(
      '黄诗扶 赞了你的帖子'
    )
    expect(
      getNotificationText(
        makeNotification('review_result', { targetType: 'wiki', approved: true, title: '测试条目' })
      )
    ).toContain('已通过你的百科编辑审核')
  })

  it('renders wiki deletion review_result text with optional reason', () => {
    expect(
      getNotificationText(
        makeNotification('review_result', {
          targetType: 'wiki',
          action: 'deleted',
          title: '测试条目',
          note: '重复内容',
        })
      )
    ).toBe('你的百科已被删除：《测试条目》（原因：重复内容）')

    expect(
      getNotificationText(
        makeNotification('review_result', {
          targetType: 'wiki',
          action: 'deleted',
          title: '测试条目',
        })
      )
    ).toBe('你的百科已被删除：《测试条目》')
  })

  it('renders post deletion review_result text with optional reason', () => {
    expect(
      getNotificationText(
        makeNotification('review_result', {
          targetType: 'post',
          action: 'deleted',
          title: '测试帖子',
          note: '违规内容',
        })
      )
    ).toBe('你的帖子已被删除：《测试帖子》（原因：违规内容）')
  })

  it('renders restored review_result text', () => {
    expect(
      getNotificationText(
        makeNotification('review_result', {
          targetType: 'wiki',
          action: 'restored',
          title: '测试条目',
        })
      )
    ).toBe('你的百科已被恢复：《测试条目》')

    expect(
      getNotificationText(
        makeNotification('review_result', {
          targetType: 'post',
          action: 'restored',
          title: '测试帖子',
        })
      )
    ).toBe('你的帖子已被恢复：《测试帖子》')
  })
})
