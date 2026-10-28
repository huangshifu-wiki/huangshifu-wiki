import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const origin = process.env.STARTUP_BASE_URL || 'http://127.0.0.1:3003'
let browser, context, page
before(async () => {
  browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE_PATH,
    args: ['--no-sandbox'],
  })
})
after(async () => {
  await browser?.close()
})
beforeEach(async () => {
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    serviceWorkers: 'block',
  })
  page = await context.newPage()
})
afterEach(async () => {
  await context.close()
})

describe('生产首屏', () => {
  it('无公告时不请求登录或公告动画专用代码，点击登录后能关闭并重新打开', async () => {
    const requests = []
    page.on('request', (request) => requests.push(request.url()))
    await page.goto(origin, { waitUntil: 'networkidle' })
    await page.locator('#home-title').waitFor()
    assert.deepEqual(
      requests.filter((url) => /AuthModal|AuthForm|AnnouncementBanner|vendor-motion/.test(url)),
      []
    )
    await page.getByRole('button', { name: '打开菜单' }).click()
    await page
      .locator('#site-mobile-menu')
      .getByRole('button', { name: '登录', exact: true })
      .click()
    await page.getByRole('dialog').waitFor()
    assert.equal(
      await page.getByRole('dialog').getByRole('textbox', { name: /邮箱/ }).isVisible(),
      true
    )
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: '打开菜单' }).click()
    await page
      .locator('#site-mobile-menu')
      .getByRole('button', { name: '登录', exact: true })
      .click()
    await page.getByRole('dialog').waitFor()
  })

  it('登录 Chunk 下载失败时显示现有错误边界及返回首页入口', async () => {
    await page.route('**/assets/*AuthModal*.js', (route) => route.abort())
    await page.goto(origin, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '打开菜单' }).click()
    await page
      .locator('#site-mobile-menu')
      .getByRole('button', { name: '登录', exact: true })
      .click()
    const alert = page.getByRole('alert').filter({ hasText: '页面出错了' })
    await alert.waitFor()
    await alert.getByRole('link', { name: '返回首页' }).click()
    await page.locator('#home-title').waitFor()
    assert.equal(await page.getByRole('navigation', { name: '主导航' }).isVisible(), true)
  })

  it('首页请求仍未完成时，在 React 提交后退出启动占位', async () => {
    const gate = Promise.withResolvers()
    await page.route('**/api/**', async (route) => {
      await gate.promise
      await route.continue()
    })
    await page.addInitScript(() => {
      new MutationObserver(() => {
        if (document.querySelector('#boot-splash.boot-splash--hide')) {
          window.__rootAtSplashExit = document.querySelector('#root')?.hasChildNodes()
        }
      }).observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      })
    })
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded' })
      await page.locator('#home-title').waitFor()
      await page.locator('#boot-splash').waitFor({ state: 'detached' })
      assert.equal(await page.evaluate(() => window.__rootAtSplashExit), true)
      assert.equal(await page.getByRole('navigation', { name: '主导航' }).isVisible(), true)
    } finally {
      gate.resolve()
      await page.waitForLoadState('networkidle')
    }
  })

  it('入口 JavaScript 失败时启动占位仍在八秒超时后退出', async () => {
    await page.route('**/assets/*.js', (route) => route.abort())
    await page.goto(origin, { waitUntil: 'domcontentloaded' })
    await page.locator('#boot-splash').waitFor({ state: 'detached', timeout: 10000 })
    assert.equal(await page.locator('#root').innerHTML(), '')
  })
})
