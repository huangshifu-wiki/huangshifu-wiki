import {
  canPrefetchModule,
  getRouteModule,
  prefetchModule,
  routeLoaders,
  type ModuleName,
  type PrefetchAccess,
  type PrefetchPriority,
} from './routePrefetch'

const selector = 'a[href], [data-prefetch-module]'
const unavailable = '[hidden], [inert], [aria-busy="true"], :disabled, [aria-disabled="true"]'

// 观察真实入口，只准备代码与 CSS，不挂载目标组件或读取业务数据。
export function observeRoutePrefetch(root: HTMLElement, access: PrefetchAccess) {
  const controller = new AbortController()
  const { signal } = controller
  const visible = new Set<Element>()
  const primary = new Set<Element>()
  const automaticCandidates = [
    [primary, 'context'],
    [visible, 'idle'],
  ] as const
  const fallbackLinks = new Set<Element>()
  const observed = new WeakSet<Element>()
  let cancelIdle: (() => void) | undefined
  let hover: number | undefined

  const moduleFor = (element: Element): ModuleName | undefined => {
    const explicit = element.getAttribute('data-prefetch-module')
    if (explicit && Object.hasOwn(routeLoaders, explicit)) return explicit as ModuleName
    if (
      !(element instanceof HTMLAnchorElement) ||
      element.download ||
      (element.target && element.target !== '_self') ||
      element.origin !== location.origin ||
      element.getAttribute('href')?.startsWith('#')
    )
      return
    return getRouteModule(element.pathname)
  }
  const prepare = (element: Element, priority: PrefetchPriority) => {
    if (!element.isConnected || element.closest(unavailable)) return
    const name = moduleFor(element)
    if (!name || !canPrefetchModule(name, access)) return
    const isRelevant = () => {
      if (priority === 'intent') return element.isConnected && moduleFor(element) === name
      for (const [candidates] of automaticCandidates)
        for (const candidate of candidates)
          if (
            candidate.isConnected &&
            moduleFor(candidate) === name &&
            !candidate.closest(unavailable)
          )
            return true
      return false
    }
    void prefetchModule(name, { priority, signal, access, isRelevant })
  }
  const run = () => {
    cancelIdle = undefined
    if (document.hidden) return
    if (typeof IntersectionObserver === 'undefined') {
      visible.clear()
      for (const element of fallbackLinks) {
        const rect = element.getBoundingClientRect()
        if (rect.width && rect.height && rect.bottom >= 0 && rect.top < innerHeight + 200)
          visible.add(element)
      }
    }
    const modules = new Set<ModuleName>()
    for (const [elements, priority] of automaticCandidates) {
      for (const element of elements) {
        if (!element.isConnected) {
          elements.delete(element)
          continue
        }
        if (element.closest(unavailable)) continue
        const name = moduleFor(element)
        if (!name || modules.has(name) || routeLoaders[name].isStarted()) continue
        modules.add(name)
        prepare(element, priority)
      }
    }
  }
  const schedule = () => {
    if (signal.aborted || cancelIdle || document.hidden) return
    if (window.requestIdleCallback) {
      const id = window.requestIdleCallback(run, { timeout: 1000 })
      cancelIdle = () => window.cancelIdleCallback(id)
    } else {
      const id = window.setTimeout(run, 0)
      cancelIdle = () => window.clearTimeout(id)
    }
  }
  const intersection =
    typeof IntersectionObserver === 'undefined'
      ? undefined
      : new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) visible.add(entry.target)
              else visible.delete(entry.target)
            }
            schedule()
          },
          { rootMargin: '200px' }
        )
  const track = (element: Element) => {
    if (observed.has(element)) return
    const inContent = element.closest('main, [role="main"]')
    if (!inContent && !element.hasAttribute('data-prefetch-module')) return
    observed.add(element)
    const name = moduleFor(element)
    if (!name || !canPrefetchModule(name, access)) return
    if (inContent && (element.hasAttribute('data-prefetch-module') || name.endsWith('Editor')))
      primary.add(element)
    else if (intersection) intersection.observe(element)
    else fallbackLinks.add(element)
  }
  const scan = (node: Element) => {
    if (!root.contains(node)) return
    if (node.matches(selector)) track(node)
    for (const element of node.querySelectorAll(selector)) track(element)
    schedule()
  }
  const forget = (element: Element) => {
    observed.delete(element)
    primary.delete(element)
    visible.delete(element)
    fallbackLinks.delete(element)
    intersection?.unobserve(element)
  }
  const mutations = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.removedNodes)
        if (node instanceof Element) {
          forget(node)
          for (const element of node.querySelectorAll(selector)) forget(element)
        }
      if (record.type === 'attributes') {
        if (record.attributeName === 'href' || record.attributeName === 'data-prefetch-module') {
          const element = record.target as Element
          forget(element)
          if (root.contains(element) && element.matches(selector)) track(element)
        }
        schedule()
      } else {
        for (const node of record.addedNodes) if (node instanceof Element) scan(node)
      }
    }
  })
  const targetFor = (event: Event) => {
    if (!(event.target instanceof Element)) return
    const button = event.target.closest('button')
    if (button && !button.hasAttribute('data-prefetch-module')) return
    return event.target.closest(selector) ?? undefined
  }
  const clearHover = () => {
    window.clearTimeout(hover)
    hover = undefined
  }
  const onPointerOver = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    const target = targetFor(event)
    if (
      hover !== undefined &&
      target &&
      event.relatedTarget instanceof Node &&
      target.contains(event.relatedTarget)
    )
      return
    clearHover()
    const name = target && moduleFor(target)
    if (target && name)
      hover = window.setTimeout(() => {
        if (moduleFor(target) === name) prepare(target, 'intent')
      }, 120)
  }
  const onPointerOut = (event: PointerEvent) => {
    const target = targetFor(event)
    if (target && event.relatedTarget instanceof Node && target.contains(event.relatedTarget))
      return
    clearHover()
  }
  const onFocus = (event: FocusEvent) => {
    clearHover()
    const target = targetFor(event)
    if (target) prepare(target, 'intent')
  }
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') return
    clearHover()
    const target = targetFor(event)
    if (target) prepare(target, 'intent')
  }
  scan(root)
  mutations.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      'href',
      'data-prefetch-module',
      'aria-busy',
      'hidden',
      'inert',
      'disabled',
      'aria-disabled',
    ],
  })
  root.addEventListener('pointerover', onPointerOver)
  root.addEventListener('pointerout', onPointerOut)
  root.addEventListener('focusin', onFocus)
  root.addEventListener('pointerdown', onPointerDown)
  if (!intersection) {
    root.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
  }
  document.addEventListener('visibilitychange', schedule)
  window.addEventListener('online', schedule)
  return () => {
    controller.abort()
    cancelIdle?.()
    clearHover()
    intersection?.disconnect()
    mutations.disconnect()
    root.removeEventListener('pointerover', onPointerOver)
    root.removeEventListener('pointerout', onPointerOut)
    root.removeEventListener('focusin', onFocus)
    root.removeEventListener('pointerdown', onPointerDown)
    document.removeEventListener('visibilitychange', schedule)
    window.removeEventListener('online', schedule)
    root.removeEventListener('scroll', schedule, true)
    window.removeEventListener('resize', schedule)
  }
}
