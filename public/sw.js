// 保留原地址，让已安装的 Worker 更新后清理缓存并退出。
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim()
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((name) => name.startsWith('huangshifu-wiki-v'))
          .map((name) => caches.delete(name))
      )
      await self.registration.unregister()
    })()
  )
})
