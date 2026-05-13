// L-26: SW 缓存版本管理
// 版本号规则: v{MAJOR}.{MINOR}
// - MAOR: 破坏性变更（缓存结构变更、路由重构）→ 当前 31
// - MINOR: 非破坏性更新（静态资源替换、样式微调）
// 升级版本时同步修改 CACHE_NAME，旧缓存会在 activate 事件中自动清理
const SW_CACHE_VERSION = { major: 31, minor: 0 };
const CACHE_NAME = `huangshifu-wiki-v${SW_CACHE_VERSION.major}`;
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  
  if (!url.protocol.startsWith('http')) {
    return;
  }
  
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch((error) => {
        console.error('[SW] API fetch failed:', error);
        return new Response(JSON.stringify({ error: 'Network error' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  if (url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname === '') {
    event.respondWith(fetch(event.request).catch(() => {
      return caches.match('/index.html');
    }));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return response;
      }).catch((error) => {
        console.error('[SW] Fetch failed:', error);
        return null;
      });

      return fetchPromise.then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          return networkResponse;
        }
        if (cachedResponse) {
          return cachedResponse;
        }
        if (networkResponse) {
          return networkResponse;
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
