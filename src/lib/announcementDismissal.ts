const ANNOUNCEMENT_DISMISSED_KEY = 'hsf:announcements:dismissed'

// 最多记录条数，避免 localStorage 无限增长
const MAX_DISMISSED_ENTRIES = 50

function readDismissedMap(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(ANNOUNCEMENT_DISMISSED_KEY)
    if (!raw) {
      return {}
    }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return parsed as Record<string, string>
  } catch {
    return {}
  }
}

function writeDismissedMap(map: Record<string, string>): void {
  try {
    window.localStorage.setItem(ANNOUNCEMENT_DISMISSED_KEY, JSON.stringify(map))
  } catch {
    // 隐私模式等写入失败时静默降级
  }
}

// 已记录的 updatedAt >= 当前 updatedAt 才算已忽略，公告被编辑后会重新显示
export function isAnnouncementDismissed(id: string, updatedAt: string): boolean {
  const dismissedAt = readDismissedMap()[id]
  return Boolean(dismissedAt) && dismissedAt >= updatedAt
}

export function dismissAnnouncement(id: string, updatedAt: string): void {
  const map = readDismissedMap()
  delete map[id]
  map[id] = updatedAt

  const keys = Object.keys(map)
  if (keys.length > MAX_DISMISSED_ENTRIES) {
    for (const key of keys.slice(0, keys.length - MAX_DISMISSED_ENTRIES)) {
      delete map[key]
    }
  }

  writeDismissedMap(map)
}
