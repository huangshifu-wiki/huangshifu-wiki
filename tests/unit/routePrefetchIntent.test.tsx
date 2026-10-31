import { fireEvent, waitFor } from '@testing-library/dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let stop: (() => void) | undefined
let root: HTMLElement
const idle = new Map<number, IdleRequestCallback>()
let idleId = 0
let intersect: IntersectionObserverCallback
beforeEach(() => {
  // 每例动态导入真实模块，以隔离预加载缓存；静态导入会共享已启动状态。
  vi.resetModules()
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
    idle.set(++idleId, callback)
    return idleId
  })
  vi.stubGlobal('cancelIdleCallback', (id: number) => idle.delete(id))
  // jsdom 不计算布局；手动交付平台交叉事件，不替换预加载器或页面模块。
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  root = document.createElement('main')
  document.body.append(root)
})
afterEach(() => {
  stop?.()
  stop = undefined
  root.remove()
  idle.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, 'hidden')
  Reflect.deleteProperty(navigator, 'onLine')
})
function flushIdle() {
  for (const callback of idle.values()) callback({ didTimeout: false, timeRemaining: () => 10 })
  idle.clear()
}

it('主体就绪自动准备编辑入口，可见卡片准备详情，无需鼠标意图', async () => {
  const { observeRoutePrefetch } = await import('../../src/lib/observeRoutePrefetch')
  const { routeLoaders } = await import('../../src/lib/routePrefetch')
  root.innerHTML = '<a href="/wiki/new">创建百科</a><a href="/gallery/example">图库详情</a>'
  stop = observeRoutePrefetch(root, { authenticated: true, admin: false })
  intersect(
    [{ target: root.lastElementChild!, isIntersecting: true } as IntersectionObserverEntry],
    {} as IntersectionObserver
  )
  flushIdle()
  await waitFor(
    () => {
      expect(routeLoaders.WikiEditor.getLoaded()).toBeDefined()
      expect(routeLoaders.GalleryDetail.getLoaded()).toBeDefined()
    },
    { timeout: 10000 }
  )
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it.each(['离线', '后台'])('%s 恢复后自动准备当前入口', async (state) => {
  const { observeRoutePrefetch } = await import('../../src/lib/observeRoutePrefetch')
  const { routeLoaders } = await import('../../src/lib/routePrefetch')
  root.innerHTML = '<a href="/forum/new">发表</a>'
  if (state === '离线')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
  else Object.defineProperty(document, 'hidden', { configurable: true, value: true })
  stop = observeRoutePrefetch(root, { authenticated: true, admin: false })
  flushIdle()
  expect(routeLoaders.PostEditor.isStarted()).toBe(false)
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  if (state === '离线') window.dispatchEvent(new Event('online'))
  else document.dispatchEvent(new Event('visibilitychange'))
  flushIdle()
  await waitFor(() => expect(routeLoaders.PostEditor.getLoaded()).toBeDefined())
})

it.each(['聚焦', '触屏', '悬停'])(
  '%s 准备全站链接，播放按钮不触发详情准备',
  async (interaction) => {
    const { observeRoutePrefetch } = await import('../../src/lib/observeRoutePrefetch')
    const { routeLoaders } = await import('../../src/lib/routePrefetch')
    root.innerHTML = '<a href="/more">更多<button>播放</button><span>文字</span></a>'
    stop = observeRoutePrefetch(root, { authenticated: false, admin: false })
    const button = root.querySelector('button')!
    fireEvent.focusIn(button)
    fireEvent.pointerDown(button, { pointerType: 'touch' })
    expect(routeLoaders.More.isStarted()).toBe(false)
    const link = root.querySelector('a')!
    if (interaction === '聚焦') fireEvent.focusIn(link)
    if (interaction === '触屏') fireEvent.pointerDown(link, { pointerType: 'touch' })
    if (interaction === '悬停') {
      vi.useFakeTimers()
      fireEvent.pointerOver(link, { pointerType: 'mouse' })
      fireEvent.pointerOut(link, { relatedTarget: button, pointerType: 'mouse' })
      fireEvent.pointerOver(button, { relatedTarget: link, pointerType: 'mouse' })
      vi.advanceTimersByTime(120)
      expect(routeLoaders.More.isStarted()).toBe(false)
      fireEvent.pointerOut(button, {
        relatedTarget: root.querySelector('span'),
        pointerType: 'mouse',
      })
      fireEvent.pointerOver(root.querySelector('span')!, {
        relatedTarget: button,
        pointerType: 'mouse',
      })
      vi.advanceTimersByTime(119)
      expect(routeLoaders.More.isStarted()).toBe(false)
      fireEvent.pointerOut(link, {
        relatedTarget: root.querySelector('span'),
        pointerType: 'mouse',
      })
      fireEvent.pointerOver(root.querySelector('span')!, {
        relatedTarget: link,
        pointerType: 'mouse',
      })
      vi.advanceTimersByTime(1)
      vi.useRealTimers()
    }
    await waitFor(() => expect(routeLoaders.More.getLoaded()).toBeDefined())
  }
)

it('退出页面会取消空闲及排队准备，动态新增入口也会被观察', async () => {
  const { observeRoutePrefetch } = await import('../../src/lib/observeRoutePrefetch')
  const { routeLoaders, prefetchRoute } = await import('../../src/lib/routePrefetch')
  stop = observeRoutePrefetch(root, { authenticated: true, admin: false })
  root.innerHTML = '<a href="/forum/new">发表</a>'
  await Promise.resolve()
  const active = prefetchRoute('/more')
  flushIdle()
  stop()
  stop = undefined
  await active
  expect(routeLoaders.PostEditor.isStarted()).toBe(false)
  expect(idle.size).toBe(0)
})

it.each(['inert', 'disabled', 'aria-disabled'])('解除 %s 后自动准备编辑入口', async (attribute) => {
  const { observeRoutePrefetch } = await import('../../src/lib/observeRoutePrefetch')
  const { routeLoaders } = await import('../../src/lib/routePrefetch')
  root.innerHTML = '<button data-prefetch-module="PostEditor">发表</button>'
  const button = root.firstElementChild!
  button.setAttribute(attribute, 'true')
  stop = observeRoutePrefetch(root, { authenticated: true, admin: false })
  flushIdle()
  expect(routeLoaders.PostEditor.isStarted()).toBe(false)
  button.removeAttribute(attribute)
  await Promise.resolve()
  flushIdle()
  await waitFor(() => expect(routeLoaders.PostEditor.getLoaded()).toBeDefined())
})

it('无交叉观察与 idle 支持时，同批移除再插入的链接仍响应滚动进入视口', async () => {
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.stubGlobal('requestIdleCallback', undefined)
  const { observeRoutePrefetch } = await import('../../src/lib/observeRoutePrefetch')
  const { routeLoaders } = await import('../../src/lib/routePrefetch')
  root.innerHTML = '<a href="/more">更多</a>'
  const link = root.firstElementChild!
  // jsdom 不计算布局；仅提供平台几何，加载真实页面模块。
  let top = window.innerHeight + 500
  link.getBoundingClientRect = () => new DOMRect(0, top, 100, 20)
  vi.useFakeTimers()
  stop = observeRoutePrefetch(root, { authenticated: false, admin: false })
  vi.advanceTimersByTime(0)
  expect(routeLoaders.More.isStarted()).toBe(false)
  root.replaceChildren(link)
  await Promise.resolve()
  top = 10
  fireEvent.scroll(root)
  vi.advanceTimersByTime(0)
  vi.useRealTimers()
  await waitFor(() => expect(routeLoaders.More.getLoaded()).toBeDefined())
})

it('匿名及普通用户不准备受限编辑入口，外站链接不参与准备', async () => {
  const { observeRoutePrefetch } = await import('../../src/lib/observeRoutePrefetch')
  const { routeLoaders } = await import('../../src/lib/routePrefetch')
  root.innerHTML =
    '<a href="/wiki/new">创建</a><button data-prefetch-module="SongForm">编辑</button><a href="https://example.com/more">外站</a>'
  stop = observeRoutePrefetch(root, { authenticated: false, admin: false })
  flushIdle()
  for (const node of root.children) fireEvent.focusIn(node)
  expect(routeLoaders.WikiEditor.isStarted()).toBe(false)
  expect(routeLoaders.SongForm.isStarted()).toBe(false)
  expect(routeLoaders.More.isStarted()).toBe(false)
})
