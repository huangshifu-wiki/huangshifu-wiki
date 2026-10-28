import { chromium } from 'playwright'
import { readFile, writeFile } from 'node:fs/promises'
import { transformWithEsbuild } from 'vite'
import { createServer } from 'node:net'
import { once } from 'node:events'

const url = process.argv[2] || 'http://127.0.0.1:3003/'
const output = process.argv[3] || '/tmp/huangshifu-startup.json'
const conditions = {
  viewport: { width: 390, height: 844 },
  latency: 150,
  downloadMbps: 1.6,
  uploadKbps: 750,
  cpuRate: 4,
  runs: 5,
}
// 复用站内采集器；最终 LCP 另由持续观察器记录，避免将启动占位的首个 LCP 当成最终值。
const source = await readFile(new URL('../src/utils/webVitals.ts', import.meta.url), 'utf8')
const vitals = await transformWithEsbuild(source, 'webVitals.ts', {
  format: 'iife',
  globalName: 'StartupWebVitals',
  define: { 'import.meta.env.DEV': 'false' },
})
const portServer = createServer()
portServer.listen(0, '127.0.0.1')
await once(portServer, 'listening')
const debuggingPort = portServer.address().port
portServer.close()
await once(portServer, 'close')
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE_PATH,
  args: ['--no-sandbox', `--remote-debugging-port=${debuggingPort}`],
})
const networkConditions = {
  offline: false,
  latency: conditions.latency,
  downloadThroughput: (conditions.downloadMbps * 1024 * 1024) / 8,
  uploadThroughput: (conditions.uploadKbps * 1024) / 8,
  connectionType: 'cellular4g',
}
let socket
const samples = []
try {
  // Worker 中的 fetch 有独立 CDP Target，必须使用相同限速，不能只限制页面请求。
  const { webSocketDebuggerUrl } = await (
    await fetch(`http://127.0.0.1:${debuggingPort}/json/version`)
  ).json()
  socket = new WebSocket(webSocketDebuggerUrl)
  await once(socket, 'open')
  const pendingCommands = new Map()
  const workerErrors = []
  const networkRequests = new Map()
  const wireTransfers = []
  let nextCommandId = 0

  function recordNetworkEvent(sessionId, method, params) {
    const key = `${sessionId}:${params.requestId}`
    if (method === 'Network.requestWillBeSent') {
      networkRequests.set(key, { url: params.request.url })
    } else if (method === 'Network.responseReceived') {
      const request = networkRequests.get(key)
      if (request)
        request.cached = params.response.fromDiskCache || params.response.fromServiceWorker
    } else if (method === 'Network.loadingFinished') {
      const request = networkRequests.get(key)
      if (
        request &&
        !request.cached &&
        new URL(request.url).pathname.endsWith('.js') &&
        params.encodedDataLength > 0
      ) {
        wireTransfers.push({ url: request.url, bytes: params.encodedDataLength })
      }
      networkRequests.delete(key)
    } else if (method === 'Network.loadingFailed') {
      networkRequests.delete(key)
    }
  }

  function sendCommand(method, params = {}, sessionId) {
    const id = ++nextCommandId
    const result = Promise.withResolvers()
    pendingCommands.set(id, result)
    socket.send(JSON.stringify({ id, method, params, sessionId }))
    return result.promise
  }

  socket.addEventListener('message', async ({ data }) => {
    const message = JSON.parse(data)
    if (message.id) {
      const command = pendingCommands.get(message.id)
      pendingCommands.delete(message.id)
      if (message.error) command.reject(new Error(message.error.message))
      else command.resolve(message.result)
    } else if (message.method === 'Target.attachedToTarget') {
      const sessionId = message.params.sessionId
      try {
        await sendCommand('Network.enable', {}, sessionId)
        await sendCommand('Network.emulateNetworkConditions', networkConditions, sessionId)
      } catch (error) {
        workerErrors.push(error.message)
      } finally {
        try {
          await sendCommand('Runtime.runIfWaitingForDebugger', {}, sessionId)
        } catch (error) {
          workerErrors.push(error.message)
        }
      }
    } else if (message.method?.startsWith('Network.')) {
      recordNetworkEvent(message.sessionId, message.method, message.params)
    }
  })
  await sendCommand('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true,
    filter: [{ type: 'service_worker', exclude: false }],
  })

  for (let run = 1; run <= conditions.runs; run++) {
    const context = await browser.newContext({
      viewport: conditions.viewport,
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    })
    await context.addInitScript({
      content: `${vitals.code}\nwindow.__startupVitals = {}; window.addEventListener('load', () => StartupWebVitals.initWebVitals({ logToConsole: false, onReport: metrics => Object.assign(window.__startupVitals, metrics) }));`,
    })
    await context.addInitScript(() => {
      window.__startup = { lcp: 0, hero: 0, lcpElement: null }
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__startup.lcp = entry.startTime
          window.__startup.lcpElement = entry.element?.id || entry.element?.className || null
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true })
      new MutationObserver(() => {
        if (document.querySelector('#home-title') && !window.__startup.hero)
          window.__startup.hero = performance.now()
      }).observe(document, { childList: true, subtree: true })
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const cdp = await context.newCDPSession(page)
    for (const event of [
      'requestWillBeSent',
      'responseReceived',
      'loadingFinished',
      'loadingFailed',
    ]) {
      cdp.on(`Network.${event}`, (params) => recordNetworkEvent('page', `Network.${event}`, params))
    }
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', networkConditions)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: conditions.cpuRate })
    for (const visit of ['cold', 'warm']) {
      errors.length = 0
      wireTransfers.length = 0
      networkRequests.clear()
      await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 })
      await page.locator('#home-title').waitFor({ timeout: 60000 })
      // 观察完整首屏入场动画；不以 React 提交时间代替最终绘制时间。
      await page.waitForTimeout(1500)
      await page.evaluate(() => navigator.serviceWorker.ready)
      await page.waitForTimeout(1000)
      const result = await page.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation')[0]
        const resources = performance.getEntriesByType('resource')
        const scripts = resources.filter((resource) =>
          new URL(resource.name).pathname.endsWith('.js')
        )
        return {
          ...window.__startupVitals,
          ...window.__startup,
          ttfb: navigation.responseStart - navigation.startTime,
          fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
          html: navigation.responseEnd - navigation.startTime,
          jsCount: scripts.length,
          scripts: scripts.map((script) => ({
            path: new URL(script.name).pathname,
            duration: script.duration,
            transferredBytes: script.transferSize,
            encodedBytes: script.encodedBodySize,
          })),
          apis: resources
            .filter((resource) => new URL(resource.name).pathname.startsWith('/api/'))
            .map((resource) => ({
              path: new URL(resource.name).pathname,
              duration: resource.duration,
            })),
          controlled: Boolean(navigator.serviceWorker.controller),
        }
      })
      result.jsBytes = wireTransfers.reduce((total, transfer) => total + transfer.bytes, 0)
      result.jsTransfers = [...wireTransfers]
      if (errors.length || workerErrors.length)
        throw new Error([...errors, ...workerErrors].join('\n'))
      samples.push({ run, visit, ...result })
      console.log(
        `第 ${run} 次 ${visit}：`,
        JSON.stringify({ ...result, scripts: undefined, apis: undefined })
      )
      await writeFile(
        output,
        JSON.stringify({ url, conditions, browserVersion: browser.version(), samples }, null, 2)
      )
    }
    await context.close()
  }
} finally {
  socket?.close()
  await browser.close()
}

const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
const medians = Object.fromEntries(
  ['cold', 'warm'].map((visit) => [
    visit,
    Object.fromEntries(
      ['ttfb', 'fcp', 'lcp', 'hero', 'html', 'jsBytes', 'jsCount'].map((key) => [
        key,
        median(samples.filter((sample) => sample.visit === visit).map((sample) => sample[key])),
      ])
    ),
  ])
)
await writeFile(
  output,
  JSON.stringify({ url, conditions, browserVersion: browser.version(), medians, samples }, null, 2)
)
console.log('中位数：', JSON.stringify(medians, null, 2))
