import { describe, expect, it } from 'vitest'

import {
  injectHtmlBootstrapState,
  shouldBypassProductionStaticHtml,
} from '../../src/server/utils/htmlShell'

describe('server production html routing helpers', () => {
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
