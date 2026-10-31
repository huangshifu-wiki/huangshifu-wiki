import { moduleLoader } from './moduleLoader'

export const routeLoaders = {
  Home: moduleLoader(() => import('../pages/Home')),
  Music: moduleLoader(() => import('../pages/Music')),
  MusicDetail: moduleLoader(() => import('../pages/MusicDetail')),
  AlbumDetail: moduleLoader(() => import('../pages/AlbumDetail')),
  Forum: moduleLoader(() => import('../pages/Forum')),
  Gallery: moduleLoader(() => import('../pages/Gallery')),
  GalleryDetail: moduleLoader(() => import('../pages/GalleryDetail')),
  Events: moduleLoader(() => import('../pages/Events')),
  EventDetail: moduleLoader(() => import('../pages/EventDetail')),
  Wiki: moduleLoader(() => import('../pages/wiki')),
  Search: moduleLoader(() => import('../pages/Search')),
  More: moduleLoader(() => import('../pages/More')),
  Tickets: moduleLoader(() => import('../pages/Tickets')),
  UserProfile: moduleLoader(() => import('../pages/UserProfile')),
  Settings: moduleLoader(() => import('../pages/Settings')),
  Announcements: moduleLoader(() => import('../pages/Announcements')),
  Login: moduleLoader(() => import('../pages/Login')),
  ForgotPassword: moduleLoader(() => import('../pages/ForgotPassword')),
  ResetPassword: moduleLoader(() => import('../pages/ResetPassword')),
  VerifyEmail: moduleLoader(() => import('../pages/VerifyEmail')),
  Setup: moduleLoader(() => import('../pages/Setup')),
  NotFound: moduleLoader(() => import('../pages/NotFound')),
  AdminRoutes: moduleLoader(() => import('../pages/Admin/AdminRoutes')),
  PostEditor: moduleLoader(() => import('../pages/forum/PostEditor')),
  WikiEditor: moduleLoader(() => import('../components/wiki/WikiEditor')),
  GalleryEditor: moduleLoader(() => import('../pages/GalleryEdit')),
  TicketEditor: moduleLoader(async () => {
    const module = await import('../pages/Tickets')
    return { default: module.TicketEditorPage }
  }),
  AdminEventEditor: moduleLoader(() => import('../pages/Admin/AdminEventEdit')),
  SongForm: moduleLoader(async () => {
    const module = await import('../components/SongFormModal')
    return { default: module.SongFormModal }
  }),
  AlbumForm: moduleLoader(async () => {
    const module = await import('../components/AlbumFormModal')
    return { default: module.AlbumFormModal }
  }),
  AlbumTrackEditor: moduleLoader(() => import('../components/AlbumTrackEditor')),
  AuthModal: moduleLoader(async () => {
    const module = await import('../components/Navbar/AuthModal')
    return { default: module.AuthModal }
  }),
  AnnouncementBanner: moduleLoader(() => import('../components/AnnouncementBanner')),
  TrendChart: moduleLoader(() => import('../components/charts/TrendChart')),
}

export type ModuleName = keyof typeof routeLoaders
export type PrefetchPriority = 'intent' | 'context' | 'idle'
export type PrefetchAccess = { authenticated: boolean; admin: boolean }
export type PrefetchOptions = {
  priority?: PrefetchPriority
  signal?: AbortSignal
  access?: PrefetchAccess
  isRelevant?: () => boolean
}
const anonymous: PrefetchAccess = { authenticated: false, admin: false }
const priorityRank = { idle: 0, context: 1, intent: 2 }
const requiredAccess: Partial<Record<ModuleName, keyof PrefetchAccess>> = {
  Settings: 'authenticated',
  PostEditor: 'authenticated',
  WikiEditor: 'authenticated',
  GalleryEditor: 'authenticated',
  TicketEditor: 'authenticated',
  AdminRoutes: 'admin',
  AdminEventEditor: 'admin',
  SongForm: 'admin',
  AlbumForm: 'admin',
  AlbumTrackEditor: 'admin',
  TrendChart: 'admin',
}

export function canPrefetchModule(name: ModuleName, access = anonymous) {
  const required = requiredAccess[name]
  return !required || access[required]
}

export function getRouteModule(pathname: string): ModuleName | undefined {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/$/, '') || '/'
  if (/^\/wiki\/(?:new|[^/]+\/edit)$/.test(path)) return 'WikiEditor'
  if (/^\/forum\/(?:new|[^/]+\/edit)$/.test(path)) return 'PostEditor'
  if (/^\/gallery\/(?:new|[^/]+\/edit)$/.test(path)) return 'GalleryEditor'
  if (/^\/tickets\/(?:new|[^/]+\/edit)$/.test(path)) return 'TicketEditor'
  if (path === '/admin/events/new') return 'AdminEventEditor'
  if (path === '/music/links' || /^\/admin(?:\/|$)/.test(path)) return 'AdminRoutes'
  if (/^\/music\/[^/]+$/.test(path)) return 'MusicDetail'
  if (/^\/album\/[^/]+$/.test(path)) return 'AlbumDetail'
  if (/^\/gallery\/[^/]+$/.test(path)) return 'GalleryDetail'
  if (/^\/events\/[^/]+$/.test(path)) return 'EventDetail'
  if (/^\/forum(?:\/|$)/.test(path)) return 'Forum'
  if (/^\/wiki(?:\/|$)/.test(path)) return 'Wiki'
  if (/^\/tickets(?:\/|$)/.test(path)) return 'Tickets'
  if (/^\/users\//.test(path)) return 'UserProfile'
  if (/^\/settings(?:\/|$)/.test(path)) return 'Settings'
  if (path.startsWith('/forgot-')) return 'ForgotPassword'
  switch (path) {
    case '/':
      return 'Home'
    case '/music':
      return 'Music'
    case '/gallery':
      return 'Gallery'
    case '/events':
      return 'Events'
    case '/search':
      return 'Search'
    case '/more':
      return 'More'
    case '/announcements':
      return 'Announcements'
    case '/login':
      return 'Login'
    case '/verify-email':
      return 'VerifyEmail'
  }
}

function networkAllowsPrefetch() {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return false
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string }
    }
  ).connection
  return (
    navigator.onLine !== false &&
    !document.hidden &&
    !connection?.saveData &&
    connection?.effectiveType !== '2g' &&
    connection?.effectiveType !== 'slow-2g'
  )
}

type Request = {
  priority: PrefetchPriority
  signal?: AbortSignal
  finish: () => void
  promise: Promise<void>
  isRelevant?: () => boolean
}
type Pending = { name: ModuleName; requests: Set<Request> }
const pending: Pending[] = []
const automaticStarts = new WeakMap<AbortSignal, number>()
let running = false
const QUEUE_LIMIT = 4
const AUTOMATIC_LIMIT = 2

function queuePriority(entry: Pending) {
  let rank = -1
  for (const request of entry.requests) rank = Math.max(rank, priorityRank[request.priority])
  return rank
}

function drain() {
  if (running) return
  while (pending.length) {
    pending.sort((a, b) => queuePriority(b) - queuePriority(a))
    const entry = pending.shift()!
    for (const request of entry.requests) {
      if (
        request.signal?.aborted ||
        request.isRelevant?.() === false ||
        !networkAllowsPrefetch() ||
        (request.priority !== 'intent' &&
          request.signal &&
          (automaticStarts.get(request.signal) ?? 0) >= AUTOMATIC_LIMIT)
      )
        request.finish()
    }
    if (!entry.requests.size) continue
    if (!routeLoaders[entry.name].isStarted()) {
      for (const request of entry.requests) {
        if (request.priority !== 'intent' && request.signal)
          automaticStarts.set(request.signal, (automaticStarts.get(request.signal) ?? 0) + 1)
      }
    }
    running = true
    void routeLoaders[entry.name]()
      .then(
        () => undefined,
        () => undefined
      )
      .finally(() => {
        running = false
        for (const request of entry.requests) request.finish()
        drain()
      })
    return
  }
}

export function prefetchModule(name: ModuleName, options: PrefetchOptions = {}): Promise<void> {
  const { priority = 'intent', signal, access = anonymous, isRelevant } = options
  if (signal?.aborted || isRelevant?.() === false || !canPrefetchModule(name, access))
    return Promise.resolve()
  if (routeLoaders[name].isStarted())
    return routeLoaders[name]().then(
      () => undefined,
      () => undefined
    )
  if (!networkAllowsPrefetch()) return Promise.resolve()
  let entry = pending.find((task) => task.name === name)
  if (!entry) {
    if (pending.length >= QUEUE_LIMIT) {
      pending.sort((a, b) => queuePriority(a) - queuePriority(b))
      if (queuePriority(pending[0]) >= priorityRank[priority]) return Promise.resolve()
      for (const request of pending.shift()!.requests) request.finish()
    }
    entry = { name, requests: new Set() }
    pending.push(entry)
  }
  const existing = [...entry.requests].find((request) => request.signal === signal)
  if (existing) {
    if (
      priorityRank[priority] >= priorityRank[existing.priority] ||
      existing.isRelevant?.() === false
    ) {
      existing.priority = priority
      existing.isRelevant = isRelevant
    }
    return existing.promise
  }
  // 取消排队请求时释放订阅；已经开始的动态导入由浏览器完成。
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  const request: Request = {
    priority,
    signal,
    promise,
    isRelevant,
    finish() {
      signal?.removeEventListener('abort', request.finish)
      entry.requests.delete(request)
      if (!entry.requests.size) {
        const index = pending.indexOf(entry)
        if (index >= 0) pending.splice(index, 1)
      }
      resolve()
    },
  }
  entry.requests.add(request)
  signal?.addEventListener('abort', request.finish, { once: true })
  drain()
  return promise
}

export function prefetchRoute(pathname: string, options?: PrefetchOptions): Promise<void> {
  const name = getRouteModule(pathname)
  return name ? prefetchModule(name, options) : Promise.resolve()
}
