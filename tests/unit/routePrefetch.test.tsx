import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 每例重置模块缓存，动态导入才能验证真实页面的冷加载与排队边界。
beforeEach(() => {
  vi.resetModules()
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  Object.defineProperty(navigator, 'connection', { configurable: true, value: undefined })
})
afterEach(() => {
  Reflect.deleteProperty(navigator, 'connection')
  Reflect.deleteProperty(navigator, 'onLine')
  Reflect.deleteProperty(document, 'hidden')
})
const access = { authenticated: true, admin: true }

describe('全站智能预加载', () => {
  it.each([
    { state: '离线', online: false, hidden: false, connection: undefined },
    { state: '后台', online: true, hidden: true, connection: undefined },
    { state: '省流量', online: true, hidden: false, connection: { saveData: true } },
    { state: '2g', online: true, hidden: false, connection: { effectiveType: '2g' } },
    { state: 'slow-2g', online: true, hidden: false, connection: { effectiveType: 'slow-2g' } },
  ])('$state 时保护资源，实际导航不受限制', async ({ online, hidden, connection }) => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: online })
    Object.defineProperty(document, 'hidden', { configurable: true, value: hidden })
    Object.defineProperty(navigator, 'connection', { configurable: true, value: connection })
    const { prefetchRoute, routeLoaders } = await import('../../src/lib/routePrefetch')
    await Promise.all([prefetchRoute('/more'), prefetchRoute('/forum/new', { access })])
    expect(routeLoaders.More.isStarted()).toBe(false)
    expect(routeLoaders.PostEditor.isStarted()).toBe(false)
    await Promise.all([routeLoaders.More(), routeLoaders.PostEditor()])
    expect(routeLoaders.More.getLoaded()).toBeDefined()
    expect(routeLoaders.PostEditor.getLoaded()).toBeDefined()
  })

  it('串行排队，明确意图替换低优先级任务，自动预算不会阻断导航', async () => {
    const { prefetchRoute, routeLoaders } = await import('../../src/lib/routePrefetch')
    const controller = new AbortController()
    const options = { priority: 'idle' as const, signal: controller.signal }
    const active = prefetchRoute('/more', options)
    const queued = ['/gallery', '/events', '/wiki', '/music'].map((path) =>
      prefetchRoute(path, options)
    )
    expect(routeLoaders.Gallery.isStarted()).toBe(false)
    const intent = prefetchRoute('/search')
    await Promise.all([active, intent, ...queued])
    expect(routeLoaders.Search.getLoaded()).toBeDefined()
    expect(routeLoaders.Gallery.isStarted()).toBe(false)
    expect(routeLoaders.Events.getLoaded()).toBeDefined()
    expect(routeLoaders.Wiki.isStarted()).toBe(false)
    expect(routeLoaders.Music.isStarted()).toBe(false)
    await routeLoaders.Wiki()
    expect(routeLoaders.Wiki.getLoaded()).toBeDefined()
  })

  it.each(['完成', '取消', '离线', '目标变化'])('共享排队任务：%s', async (state) => {
    const { prefetchRoute, routeLoaders } = await import('../../src/lib/routePrefetch')
    const controller = new AbortController()
    const active = prefetchRoute('/more')
    let relevant = true
    const options = {
      signal: controller.signal,
      priority: 'context' as const,
      access,
      isRelevant: () => relevant,
    }
    const first = prefetchRoute('/forum/new', options)
    const second = prefetchRoute('/forum/new', options)
    if (state === '取消') controller.abort()
    if (state === '离线')
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    if (state === '目标变化') relevant = false
    await Promise.all([active, first, second])
    expect(routeLoaders.More.getLoaded()).toBeDefined()
    expect(routeLoaders.PostEditor.isStarted()).toBe(state === '完成')
  })

  it.each([
    {
      state: '自动升级为意图',
      first: 'idle',
      next: 'intent',
      original: false,
      latest: true,
      automatic: true,
    },
    {
      state: '自动扫描不覆盖意图',
      first: 'intent',
      next: 'idle',
      original: true,
      latest: false,
      automatic: true,
    },
    {
      state: '同级刷新目标',
      first: 'intent',
      next: 'intent',
      original: false,
      latest: true,
      automatic: true,
    },
    {
      state: '失效意图让位于有效自动目标',
      first: 'intent',
      next: 'idle',
      original: false,
      latest: true,
      automatic: false,
    },
  ] as const)('重复请求：$state', async ({ first, next, original, latest, automatic }) => {
    const { prefetchRoute, routeLoaders } = await import('../../src/lib/routePrefetch')
    const controller = new AbortController()
    const { signal } = controller
    const active = prefetchRoute('/more', { signal, priority: 'idle' })
    let originalRelevant = true
    let latestRelevant = true
    const initial = prefetchRoute('/gallery', {
      signal,
      priority: first,
      isRelevant: () => originalRelevant,
    })
    originalRelevant = original
    const repeated = prefetchRoute('/gallery', {
      signal,
      priority: next,
      isRelevant: () => latestRelevant,
    })
    latestRelevant = latest
    await Promise.all([active, initial, repeated])
    expect(routeLoaders.Gallery.getLoaded()).toBeDefined()
    await prefetchRoute('/events', { signal, priority: 'idle' })
    expect(routeLoaders.Events.isStarted()).toBe(automatic)
  })

  it.each(['context', 'intent'] as const)('满队列为 %s 保留更高优先级模块', async (priority) => {
    const { prefetchRoute, routeLoaders } = await import('../../src/lib/routePrefetch')
    const active = prefetchRoute('/more')
    const queued = [
      prefetchRoute('/gallery', { priority: 'context' }),
      prefetchRoute('/events', { priority: 'idle' }),
      prefetchRoute('/wiki'),
      prefetchRoute('/music', { priority: 'idle' }),
    ]
    const replacement = prefetchRoute('/search', { priority })
    await Promise.all([active, replacement, ...queued])
    expect(routeLoaders.Gallery.getLoaded()).toBeDefined()
    expect(routeLoaders.Search.getLoaded()).toBeDefined()
    expect(routeLoaders.Events.isStarted()).toBe(false)
    expect(routeLoaders.Wiki.getLoaded()).toBeDefined()
    expect(routeLoaders.Music.getLoaded()).toBeDefined()
  })

  it('权限入口只为相应身份准备，普通详情保持可用', async () => {
    const { prefetchRoute, prefetchModule, routeLoaders } =
      await import('../../src/lib/routePrefetch')
    await Promise.all([
      prefetchRoute('/settings'),
      prefetchRoute('/wiki/new'),
      prefetchRoute('/admin'),
      prefetchModule('SongForm'),
    ])
    expect(routeLoaders.Settings.isStarted()).toBe(false)
    expect(routeLoaders.WikiEditor.isStarted()).toBe(false)
    expect(routeLoaders.AdminRoutes.isStarted()).toBe(false)
    expect(routeLoaders.SongForm.isStarted()).toBe(false)
    const member = { authenticated: true, admin: false }
    await Promise.all([
      prefetchRoute('/settings', { access: member }),
      prefetchRoute('/admin', { access: member }),
      prefetchRoute('/gallery/example'),
    ])
    expect(routeLoaders.Settings.getLoaded()).toBeDefined()
    expect(routeLoaders.GalleryDetail.getLoaded()).toBeDefined()
    expect(routeLoaders.AdminRoutes.isStarted()).toBe(false)
    await prefetchModule('SongForm', { access })
    expect(routeLoaders.SongForm.getLoaded()).toBeDefined()
  })

  it('一个调用方退出不会取消其他调用方仍需要的模块', async () => {
    const { prefetchRoute, routeLoaders } = await import('../../src/lib/routePrefetch')
    const active = prefetchRoute('/more')
    const controller = new AbortController()
    const cancelled = prefetchRoute('/events/example', { signal: controller.signal })
    const retained = prefetchRoute('/events/example')
    controller.abort()
    await Promise.all([active, cancelled, retained])
    expect(routeLoaders.EventDetail.getLoaded()).toBeDefined()
  })
})
