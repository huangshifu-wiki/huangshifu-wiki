import { after, before, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

let browser, server, origin
let retiring = false
const source = await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8')

before(async () => {
  browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE_PATH,
    args: ['--no-sandbox'],
  })
  server = createServer((req, res) => {
    if (req.url === '/sw.js') {
      res.setHeader('Content-Type', 'application/javascript')
      res.setHeader('Cache-Control', 'no-store')
      res.end(
        retiring
          ? source
          : `self.addEventListener('fetch', (event) => {
              if (new URL(event.request.url).pathname === '/resource') {
                event.respondWith(Promise.resolve(new Response('old-worker')))
              }
            })`
      )
    } else if (req.url === '/resource') {
      res.end('network-response')
    } else {
      res.setHeader('Content-Type', 'text/html')
      res.end('<html><head><title>在线页面</title></head><body></body></html>')
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

it('旧 Worker 更新后注销、清理本站缓存，后续访问直接走网络', async () => {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.goto(origin)
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      for (const name of ['huangshifu-wiki-v32.1', 'huangshifu-wiki-v31.0', 'other-app']) {
        const cache = await caches.open(name)
        await cache.put('/sentinel', new Response('keep'))
      }
    })
    await page.reload()
    assert.equal(await page.evaluate(async () => (await fetch('/resource')).text()), 'old-worker')

    retiring = true
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      await registration.update()
    })
    await page.waitForFunction(async () => !(await navigator.serviceWorker.getRegistration()))
    assert.deepEqual(await page.evaluate(() => caches.keys()), ['other-app'])
    assert.equal(
      await page.evaluate(async () => (await fetch('/resource')).text()),
      'network-response'
    )
    await page.reload()
    assert.equal(await page.evaluate(() => navigator.serviceWorker.controller === null), true)
    assert.equal(await page.title(), '在线页面')
  } finally {
    await context.close()
  }
})
