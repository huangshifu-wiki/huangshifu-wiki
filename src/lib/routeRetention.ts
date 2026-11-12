import type { Location, NavigationType } from 'react-router-dom'

export type RouteScope = 'public' | 'admin'
export type RouteScroll = { x: number; y: number; left: number; top: number }
export type RouteEntry = { location: Location; scroll?: RouteScroll; focus?: HTMLElement }
export type RetainedPage = {
  id: number
  scope: RouteScope
  location: Location
  navigationType: NavigationType
  entries: Map<string, RouteEntry>
  lastUsed: number
  revision: number
  restored: boolean
  temporary: boolean
}
export type RetentionState = {
  pages: RetainedPage[]
  activeId: number
  key: string
  observedKey: string
  history: string[]
  index: number
  clock: number
  savedKeys: Set<string>
}

export const routeScope = (pathname: string): RouteScope =>
  pathname === '/admin' || pathname.startsWith('/admin/') ? 'admin' : 'public'

export const isTemporaryRoute = (pathname: string) =>
  /^\/(setup|login|forgot-password|reset-password|verify-email|__ui)(\/|$)/.test(pathname)

export function retainLocation(
  previous: RetentionState | null,
  location: Location,
  navigationType: NavigationType,
  historyKey = location.key
): RetentionState {
  if (previous?.observedKey === historyKey) return previous
  const clock = (previous?.clock ?? 0) + 1
  const temporary = isTemporaryRoute(location.pathname)
  let pages = previous?.pages.filter((page) => !page.temporary) ?? []
  let history = previous?.history.slice() ?? []
  let index = previous?.index ?? -1
  const current = previous?.pages.find((page) => page.id === previous.activeId)
  let page = pages.find((candidate) => candidate.entries.has(location.key))
  if (
    !page &&
    current &&
    !current.temporary &&
    !temporary &&
    current.location.pathname === location.pathname &&
    navigationType !== 'POP'
  ) {
    page = current
  }
  if (navigationType === 'PUSH') {
    const discarded = new Set(history.splice(index + 1))
    pages = pages
      .map((candidate) => ({
        ...candidate,
        entries: new Map([...candidate.entries].filter(([key]) => !discarded.has(key))),
      }))
      .filter((candidate) => candidate.entries.size > 0 || candidate.id === page?.id)
    history.push(historyKey)
    index = history.length - 1
  } else if (navigationType === 'REPLACE' && index >= 0) {
    const oldKey = history[index]
    history[index] = historyKey
    pages = pages.map((candidate) => {
      const entries = new Map(candidate.entries)
      entries.delete(oldKey)
      return { ...candidate, entries }
    })
  } else {
    index = history.indexOf(historyKey)
    if (index < 0) {
      history.push(historyKey)
      index = history.length - 1
    }
  }
  if (previous?.key === location.key) {
    return { ...previous, pages, history, index, observedKey: historyKey }
  }
  const savedKeys = new Set(previous?.savedKeys)
  const saved =
    Boolean((location.state as { editorSaved?: boolean } | null)?.editorSaved) &&
    !savedKeys.has(location.key)
  if (saved) savedKeys.add(location.key)
  // 同路径保存保留槽和背景坐标，仅重建目标内容。
  const entries = new Map(
    pages.find((candidate) => candidate.id === page?.id)?.entries ?? page?.entries
  )
  const oldEntry = current?.entries.get(previous?.key ?? '')
  entries.set(
    location.key,
    entries.get(location.key) ?? {
      location,
      scroll: saved && current?.id === page?.id ? oldEntry?.scroll : undefined,
    }
  )
  const nextPage: RetainedPage = {
    id: page?.id ?? clock,
    scope: routeScope(location.pathname),
    location,
    navigationType,
    entries,
    lastUsed: clock,
    revision: (page?.revision ?? 0) + (saved ? 1 : 0),
    restored: Boolean(page),
    temporary,
  }
  pages = pages.filter((candidate) => candidate.id !== nextPage.id && candidate.entries.size > 0)
  pages.push(nextPage)
  if (pages.filter((candidate) => !candidate.temporary).length > 10) {
    const victim = pages.reduce<RetainedPage | undefined>(
      (oldest, candidate) =>
        candidate.id !== nextPage.id && (!oldest || candidate.lastUsed < oldest.lastUsed)
          ? candidate
          : oldest,
      undefined
    )
    pages = pages.filter((candidate) => candidate !== victim)
  }
  return {
    pages,
    activeId: nextPage.id,
    key: location.key,
    observedKey: historyKey,
    history,
    index,
    clock,
    savedKeys,
  }
}
