import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

let browser, context, page, server, origin
let revision, htmlVersion, blocked, assets, statuses, requestCounts, onRequest
const source = await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8')
const assetPath = '/assets/app-Ab12cD_9.js'

before(async () => {
  browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE_PATH,
    args: ['--no-sandbox'],
  })
  server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname
    requestCounts.set(path, (requestCounts.get(path) || 0) + 1)
    onRequest?.(path)
    if (blocked.has(path)) await blocked.get(path)
    if (path === '/sw.js') {
      res.setHeader('Content-Type', 'application/javascript')
      res.setHeader('Cache-Control', 'no-store')
      res.end(source.replace(/minor: \d+/, `minor: ${revision}`))
    } else if (path === '/' || path === '/index.html' || path === '/settings') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(
        `<html><head><title>${htmlVersion}</title></head><body><script>window.__HSF_BOOTSTRAP_AUTH_UID__ = "private-user-id"</script><h1>${htmlVersion}</h1></body></html>`
      )
    } else {
      res.statusCode = statuses.get(path) || 200
      res.setHeader(
        'Content-Type',
        path.endsWith('.js') ? 'application/javascript' : 'application/json'
      )
      res.setHeader('Cache-Control', path === '/private.json' ? 'private, no-store' : 'no-cache')
      res.end(assets.get(path) || 'network-response')
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  origin = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  await browser?.close()
  server?.closeAllConnections()
  if (server) await promisify(server.close.bind(server))()
})
beforeEach(async () => {
  revision = 0
  htmlVersion = '首页版本一'
  blocked = new Map()
  assets = new Map([[assetPath, 'cached-chunk']])
  statuses = new Map()
  requestCounts = new Map()
  onRequest = null
  context = await browser.newContext()
  page = await context.newPage()
  await page.goto(origin)
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
  })
  await page.reload()
  assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true)
})
afterEach(async () => {
  await context.close()
})

async function body(path) {
  return page.evaluate(async (path) => (await fetch(path)).text(), path)
}

describe('静态资源缓存', () => {
  it('哈希资源缓存命中时不等待网络', async () => {
    assert.equal(await body(assetPath), 'cached-chunk')
    // 等待真实 Cache Storage 写入完成，再阻塞后续网络。
    await page.waitForFunction(async (path) => Boolean(await caches.match(path)), assetPath)
    const gate = Promise.withResolvers()
    blocked.set(assetPath, gate.promise)
    const deadline = Promise.withResolvers()
    const timer = setTimeout(() => deadline.reject(new Error('缓存命中仍在等待网络')), 1000)
    try {
      assert.equal(await Promise.race([body(assetPath), deadline.promise]), 'cached-chunk')
    } finally {
      clearTimeout(timer)
      gate.resolve()
    }
  })

  it('相同哈希资源并发首次请求共用网络，失败后可以重试', async () => {
    const gate = Promise.withResolvers()
    const received = Promise.withResolvers()
    blocked.set(assetPath, gate.promise)
    statuses.set(assetPath, 503)
    onRequest = (path) => {
      if (path === assetPath) received.resolve()
    }
    const requests = page.evaluate(
      (path) => Promise.all(Array.from({ length: 3 }, () => fetch(path).then((res) => res.status))),
      assetPath
    )
    try {
      await received.promise
      await new Promise((resolve) => setTimeout(resolve, 200))
      assert.equal(requestCounts.get(assetPath), 1)
    } finally {
      blocked.delete(assetPath)
      gate.resolve()
    }
    assert.deepEqual(await requests, [503, 503, 503])
    statuses.delete(assetPath)
    assert.equal(await body(assetPath), 'cached-chunk')
    assert.equal(requestCounts.get(assetPath), 2)
  })

  it('上传、无哈希资源走网络优先；API 和私有响应不写入缓存', async () => {
    for (const path of [
      '/uploads/photo.jpg',
      '/plain.js',
      '/assets/unhashed.js',
      '/api/auth/me',
      '/private.json',
    ]) {
      assets.set(path, 'first-response')
      assert.equal(await body(path), 'first-response')
      assets.set(path, 'updated-response')
      assert.equal(await body(path), 'updated-response')
    }
    const privateCached = await page.evaluate(async () =>
      Promise.all(
        ['/api/auth/me', '/private.json'].map(async (path) => Boolean(await caches.match(path)))
      )
    )
    assert.deepEqual(privateCached, [false, false])
  })

  it('在线获取新 HTML，离线 SPA 导航只使用无认证数据的首页壳', async () => {
    htmlVersion = '首页版本二'
    await page.reload()
    assert.equal(await page.title(), htmlVersion)
    await page.waitForFunction(async () =>
      (await (await caches.match('/index.html'))?.text())?.includes('首页版本二')
    )
    await context.setOffline(true)
    await page.goto(`${origin}/settings`)
    assert.equal(await page.title(), htmlVersion)
    assert.equal(await page.evaluate(() => window.__HSF_BOOTSTRAP_AUTH_UID__), null)
  })

  it('新 Worker 等待旧页面退出，旧 Chunk 在交接前可继续使用', async () => {
    assert.equal(await body(assetPath), 'cached-chunk')
    await page.waitForFunction(async (path) => Boolean(await caches.match(path)), assetPath)
    await page.evaluate(async () => {
      const cache = await caches.open('unrelated-application')
      await cache.put('/sentinel', new Response('keep'))
    })
    revision = 1
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      await registration.update()
    })
    await page.waitForFunction(async () =>
      Boolean((await navigator.serviceWorker.getRegistration()).waiting)
    )
    assets.set(assetPath, 'new-network-chunk')
    assert.equal(await body(assetPath), 'cached-chunk')
    await page.close()
    page = await context.newPage()
    await page.goto(origin)
    assert.equal(await body(assetPath), 'new-network-chunk')
    assert.equal(await page.evaluate(async () => (await caches.match('/sentinel'))?.text()), 'keep')
  })
})
