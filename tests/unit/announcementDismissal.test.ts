// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { dismissAnnouncement, isAnnouncementDismissed } from '../../src/lib/announcementDismissal'

describe('announcementDismissal', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('未记录过时不算已忽略', () => {
    expect(isAnnouncementDismissed('a1', '2026-01-01T00:00:00.000Z')).toBe(false)
  })

  it('记录后判定已忽略', () => {
    dismissAnnouncement('a1', '2026-01-01T00:00:00.000Z')
    expect(isAnnouncementDismissed('a1', '2026-01-01T00:00:00.000Z')).toBe(true)
  })

  it('公告被编辑（updatedAt 更新）后重新显示', () => {
    dismissAnnouncement('a1', '2026-01-01T00:00:00.000Z')
    expect(isAnnouncementDismissed('a1', '2026-01-02T00:00:00.000Z')).toBe(false)
    // 已记录时间更新到编辑之后，重新隐藏
    dismissAnnouncement('a1', '2026-01-02T00:00:00.000Z')
    expect(isAnnouncementDismissed('a1', '2026-01-02T00:00:00.000Z')).toBe(true)
  })

  it('不同公告互不影响', () => {
    dismissAnnouncement('a1', '2026-01-01T00:00:00.000Z')
    expect(isAnnouncementDismissed('a2', '2026-01-01T00:00:00.000Z')).toBe(false)
  })

  it('超过 50 条时裁剪最早的记录', () => {
    for (let i = 0; i < 55; i += 1) {
      dismissAnnouncement(`a${i}`, '2026-01-01T00:00:00.000Z')
    }

    const raw = window.localStorage.getItem('hsf:announcements:dismissed')
    expect(raw).not.toBeNull()
    const map = JSON.parse(raw!) as Record<string, string>
    expect(Object.keys(map)).toHaveLength(50)
    expect(map.a0).toBeUndefined()
    expect(map.a54).toBeDefined()
  })

  it('存储内容损坏时按未忽略处理且不抛错', () => {
    window.localStorage.setItem('hsf:announcements:dismissed', 'not-json')
    expect(isAnnouncementDismissed('a1', '2026-01-01T00:00:00.000Z')).toBe(false)
    expect(() => dismissAnnouncement('a1', '2026-01-01T00:00:00.000Z')).not.toThrow()
    expect(isAnnouncementDismissed('a1', '2026-01-01T00:00:00.000Z')).toBe(true)
  })
})
