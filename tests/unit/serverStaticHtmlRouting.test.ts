import { describe, expect, it } from 'vitest'
import express from 'express'
import request from 'supertest'

import {
  injectHtmlBootstrapState,
  SPA_FALLBACK_PATH,
  shouldBypassProductionStaticHtml,
} from '../../src/server/utils/htmlShell'

describe('server production html routing helpers', () => {
  it('registers an Express 5 SPA fallback that matches root and nested paths', async () => {
    const app = express()

    expect(() => {
      app.get(SPA_FALLBACK_PATH, (_req, res) => {
        res.type('html').send('<!doctype html><title>SPA</title>')
      })
    }).not.toThrow()

    await expect(request(app).get('/').expect(200)).resolves.toMatchObject({
      text: expect.stringContaining('<title>SPA</title>'),
    })
    await expect(request(app).get('/foo/bar').expect(200)).resolves.toMatchObject({
      text: expect.stringContaining('<title>SPA</title>'),
    })
  })

  it('bypasses production static middleware only for /index.html', () => {
    expect(shouldBypassProductionStaticHtml('/index.html')).toBe(true)
    expect(shouldBypassProductionStaticHtml('/')).toBe(false)
    expect(shouldBypassProductionStaticHtml('/assets/app.js')).toBe(false)
    expect(shouldBypassProductionStaticHtml('/nested/index.html')).toBe(false)
  })

  it('injects bootstrap auth uid and nonce into html shell', () => {
    const html =
      '<html><head></head><body><script>window.__BOOTSTRAP__="__HSF_BOOTSTRAP_AUTH_UID_VALUE__"</script></body></html>'

    const injected = injectHtmlBootstrapState(html, {
      authUid: 'user-1',
      nonce: 'nonce-123',
    })

    expect(injected).toContain('window.__BOOTSTRAP__="user-1"')
    expect(injected).toContain('<script nonce="nonce-123">')
  })
})
