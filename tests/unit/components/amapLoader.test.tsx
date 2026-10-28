import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loadMock } = vi.hoisted(() => ({ loadMock: vi.fn() }))

vi.mock('@amap/amap-jsapi-loader', () => ({ load: loadMock }))

describe('amapLoader', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('VITE_AMAP_JS_API_KEY', 'browser-key')
    vi.stubEnv('VITE_AMAP_SECURITY_JS_CODE', 'security-code')
    delete window.AMap
    delete window._AMapSecurityConfig
  })

  it('在调用官方 Loader 前设置安全密钥并复用加载 Promise', async () => {
    const amap = { Map: vi.fn() }
    loadMock.mockImplementation(async () => {
      expect(window._AMapSecurityConfig).toEqual({ securityJsCode: 'security-code' })
      return amap
    })
    const { loadAmapJsApi } = await import('../../../src/lib/amapLoader')

    const first = loadAmapJsApi()
    const second = loadAmapJsApi()

    await expect(first).resolves.toBe(amap)
    await expect(second).resolves.toBe(amap)
    expect(loadMock).toHaveBeenCalledOnce()
    expect(loadMock).toHaveBeenCalledWith({ key: 'browser-key', version: '2.0' })
  })

  it('配置不完整时不加载脚本并返回可识别错误', async () => {
    vi.stubEnv('VITE_AMAP_SECURITY_JS_CODE', '')
    const { loadAmapJsApi } = await import('../../../src/lib/amapLoader')

    await expect(loadAmapJsApi()).rejects.toThrow('高德地图 JS API Key 或安全密钥未配置')
    expect(loadMock).not.toHaveBeenCalled()
  })
})
