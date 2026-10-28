// 版本升级后等待旧页面退出，再激活新 Worker 并清理本站旧缓存。
const SW_CACHE_VERSION = { major: 32, minor: 0 }
const CACHE_PREFIX = 'huangshifu-wiki-v'
const CACHE_NAME = `${CACHE_PREFIX}${SW_CACHE_VERSION.major}.${SW_CACHE_VERSION.minor}`
const OFFLINE_SHELL = '/index.html'
const HASHED_ASSET =
  /^\/assets\/(?:[^/]+\/)*[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|avif|ico)$/i
const STATIC_FILE = /\.(?:js|css|json|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|avif|ico)$/i
const pendingAssets = new Map()

function assetRequestKey(request) {
  return JSON.stringify([
    request.url,
    request.mode,
    request.destination,
    request.credentials,
    request.cache,
    request.redirect,
    request.referrer,
    request.referrerPolicy,
    request.integrity,
    [...request.headers],
  ])
}

function fetchHashedAsset(request, cache) {
  const key = assetRequestKey(request)
  let pending = pendingAssets.get(key)
  if (!pending) {
    pending = fetch(request).then((response) => ({
      response,
      write: canCache(response) ? cache.put(request, response.clone()) : Promise.resolve(),
    }))
    pendingAssets.set(key, pending)
    pending
      .then(({ write }) => write)
      .then(
        () => pendingAssets.delete(key),
        () => pendingAssets.delete(key)
      )
  }
  return pending
}

function canCache(response) {
  return (
    response.status === 200 &&
    response.type === 'basic' &&
    !/\b(?:private|no-store)\b/i.test(response.headers.get('Cache-Control') || '') &&
    !/text\/html/i.test(response.headers.get('Content-Type') || '')
  )
}

async function cacheOfflineShell(response) {
  if (response.status !== 200 || !/text\/html/i.test(response.headers.get('Content-Type') || ''))
    return
  // SPA 壳只包含这一项服务端认证启动数据，离线副本统一按游客启动。
  const html = (await response.text()).replace(
    /(window\.__HSF_BOOTSTRAP_AUTH_UID__\s*=\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|null)/g,
    '$1null'
  )
  const headers = new Headers(response.headers)
  headers.delete('Content-Length')
  headers.delete('Content-Encoding')
  const cache = await caches.open(CACHE_NAME)
  await cache.put(OFFLINE_SHELL, new Response(html, { headers }))
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    fetch(OFFLINE_SHELL, { credentials: 'omit', cache: 'reload' }).then(cacheOfflineShell)
  )
  // 不抢占仍在使用旧 Chunk 的页面；等待浏览器完成正常的 Worker 版本交接。
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || !/^https?:$/.test(url.protocol)) return

  // API、显式认证请求及非静态业务路径不进入静态缓存。
  if (url.pathname.startsWith('/api/') || request.headers.has('Authorization')) return

  if (request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(
      fetch(new Request(request, { cache: 'no-cache' }))
        .then((response) => {
          // 只更新标准首页壳，不缓存受保护路由或其他 HTML 页面。
          if (url.pathname === '/' || url.pathname === OFFLINE_SHELL) {
            event.waitUntil(cacheOfflineShell(response.clone()))
          }
          return response
        })
        .catch(
          async () =>
            (await caches.match(OFFLINE_SHELL, { cacheName: CACHE_NAME })) ||
            new Response('Offline', { status: 503 })
        )
    )
    return
  }

  if (!STATIC_FILE.test(url.pathname)) return

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      const cached = await cache.match(request)
      const hashed = HASHED_ASSET.test(url.pathname)
      if (hashed && cached) return cached

      try {
        if (hashed) {
          const { response, write } = await fetchHashedAsset(request, cache)
          event.waitUntil(write)
          return !response.ok && cached ? cached : response.clone()
        }
        const response = await fetch(request)
        if (canCache(response)) {
          event.waitUntil(cache.put(request, response.clone()))
        }
        return !response.ok && cached ? cached : response
      } catch {
        return cached || new Response('Offline', { status: 503 })
      }
    })()
  )
})
