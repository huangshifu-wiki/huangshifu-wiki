import React, { Component, createContext, useContext } from 'react'
import { RetentionContext, RetentionRootsContext } from '../context/RouteRetentionContext'
import type { RetentionState, RouteEntry, RouteScroll } from '../lib/routeRetention'

export const RouteContentCommitContext = createContext<() => void>(() => {})
const ENTER_SELECTORS =
  '.mobile-page-container, .gufeng-fade-in, .gufeng-song-item, .mobile-grid > *, .space-y-3 > *, .space-y-4 > *, .home-hero-content, .home-hero-title, .home-hero-subtitle, .home-hero-actions'
const activeAdmin = () =>
  document.querySelector<HTMLElement>(
    '[data-route-shell="admin"][data-route-active="true"] [data-admin-scroll-container]'
  )

function persist(key: string, scroll: RouteScroll) {
  try {
    const index: string[] = JSON.parse(sessionStorage.getItem('routeScroll:index') ?? '[]')
    const next = [...index.filter((item) => item !== key), key]
    for (const expired of next.splice(0, Math.max(0, next.length - 10)))
      sessionStorage.removeItem(`routeScroll:${expired}`)
    sessionStorage.setItem(`routeScroll:${key}`, JSON.stringify(scroll))
    sessionStorage.setItem('routeScroll:index', JSON.stringify(next))
  } catch {
    /* 存储不可用时仍保留内存坐标。 */
  }
}
function readScroll(key: string): RouteScroll | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(`routeScroll:${key}`) ?? 'null')
    if (value && ['x', 'y', 'left', 'top'].every((field) => Number.isFinite(value[field])))
      return value
  } catch {
    /* 刷新恢复为可选能力。 */
  }
}
type BoundaryProps = {
  state: RetentionState
  roots: Map<number, HTMLDivElement>
  children: React.ReactNode
}
class ScrollBoundary extends Component<BoundaryProps> {
  private cancelRestore: (() => void) | undefined
  private originalRestoration: ScrollRestoration | undefined
  private coldRestore: (() => void) | undefined
  private entry(props = this.props): RouteEntry | undefined {
    return props.state.pages
      .find((page) => page.id === props.state.activeId)
      ?.entries.get(props.state.key)
  }
  private capture = (props = this.props) => {
    const entry = this.entry(props)
    if (!entry) return
    const root = props.roots.get(props.state.activeId)
    const admin = activeAdmin()
    entry.scroll = {
      x: window.scrollX,
      y: window.scrollY,
      left: admin?.scrollLeft ?? 0,
      top: admin?.scrollTop ?? 0,
    }
    if (document.activeElement instanceof HTMLElement && root?.contains(document.activeElement))
      entry.focus = document.activeElement
    root
      ?.querySelectorAll(ENTER_SELECTORS)
      .forEach((node) => node.setAttribute('data-route-entered', ''))
    persist(props.state.key, entry.scroll)
  }
  componentDidMount() {
    this.originalRestoration = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    window.addEventListener('pagehide', this.onPageHide)
    this.restore()
  }
  componentWillUnmount() {
    this.cancelRestore?.()
    window.removeEventListener('pagehide', this.onPageHide)
    if (this.originalRestoration !== undefined)
      window.history.scrollRestoration = this.originalRestoration
  }
  private onPageHide = () => this.capture()
  getSnapshotBeforeUpdate(previous: BoundaryProps) {
    if (previous.state.key !== this.props.state.key) this.capture(previous)
    return null
  }
  componentDidUpdate(previous: BoundaryProps) {
    if (previous.state.key === this.props.state.key) return
    this.cancelRestore?.()
    const current = this.props.state.pages.find((page) => page.id === this.props.state.activeId)!
    const oldPage = previous.state.pages.find((page) => page.id === previous.state.activeId)
    const revised = oldPage?.id === current.id && oldPage.revision !== current.revision
    if (revised) this.entry()!.scroll = oldPage.entries.get(previous.state.key)?.scroll
    if (!revised && previous.state.activeId === current.id && current.navigationType !== 'POP')
      return
    this.restore(revised)
  }
  private restore(cold = false) {
    const { state, roots } = this.props
    const page = state.pages.find((candidate) => candidate.id === state.activeId)!
    const entry = this.entry()!
    const saved =
      entry.scroll ?? (page.navigationType === 'POP' ? readScroll(state.key) : undefined)
    const target = saved ?? { x: 0, y: 0, left: 0, top: 0 }
    const apply = () => {
      const admin = activeAdmin()
      if (admin) {
        admin.scrollLeft = target.left
        admin.scrollTop = target.top
      }
      window.scrollTo({
        left: page.scope === 'admin' ? 0 : target.x,
        top: page.scope === 'admin' ? 0 : target.y,
        behavior: 'instant',
      })
    }
    const focus = entry.focus
    const root = roots.get(page.id)
    if (focus?.isConnected && root?.contains(focus)) focus.focus({ preventScroll: true })
    if ((!cold && page.restored) || !saved) {
      apply()
      return
    }
    // 冷加载只在内容足够高时恢复；热返回不等待布局或定时器。
    const stop = () => {
      observer?.disconnect()
      window.clearTimeout(timer)
      window.removeEventListener('wheel', stop)
      window.removeEventListener('touchstart', stop)
      window.removeEventListener('keydown', onKey)
      this.coldRestore = undefined
      this.cancelRestore = undefined
    }
    const onKey = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key))
        stop()
    }
    const attempt = () => {
      const content = document.querySelector<HTMLElement>(
        `[data-retained-page="${page.id}"] [data-route-content]`
      )
      if (!content) return
      const container = activeAdmin() ?? document.documentElement
      observer?.observe(content)
      observer?.observe(container)
      const top = page.scope === 'admin' ? target.top : target.y
      if (!observer || container.scrollHeight - container.clientHeight >= top) {
        apply()
        stop()
      }
    }
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(attempt)
    const timer = window.setTimeout(stop, 1500)
    this.cancelRestore = stop
    this.coldRestore = attempt
    window.addEventListener('wheel', stop, { passive: true })
    window.addEventListener('touchstart', stop, { passive: true })
    window.addEventListener('keydown', onKey)
    if (root) observer?.observe(root)
    observer?.observe(activeAdmin() ?? document.documentElement)
    attempt()
  }
  private contentCommitted = () => this.coldRestore?.()
  render() {
    return (
      <RouteContentCommitContext.Provider value={this.contentCommitted}>
        {this.props.children}
      </RouteContentCommitContext.Provider>
    )
  }
}
export function RouteScrollBoundary({ children }: { children: React.ReactNode }) {
  const state = useContext(RetentionContext)!
  const roots = useContext(RetentionRootsContext)
  return (
    <ScrollBoundary state={state} roots={roots}>
      {children}
    </ScrollBoundary>
  )
}
