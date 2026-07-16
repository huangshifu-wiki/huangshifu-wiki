import { load } from '@amap/amap-jsapi-loader'

const AMAP_VERSION = '2.0'
const key = import.meta.env.VITE_AMAP_JS_API_KEY?.trim()
const securityJsCode = import.meta.env.VITE_AMAP_SECURITY_JS_CODE?.trim()

let loadPromise: Promise<typeof AMap> | null = null

export function loadAmapJsApi(): Promise<typeof AMap> {
  if (window.AMap?.Map) return Promise.resolve(window.AMap)
  if (loadPromise) return loadPromise

  if (!key || !securityJsCode) {
    return Promise.reject(new Error('高德地图 JS API Key 或安全密钥未配置'))
  }

  window._AMapSecurityConfig = { securityJsCode }
  loadPromise = (load({ key, version: AMAP_VERSION }) as Promise<typeof AMap>).catch(
    (error: unknown) => {
      loadPromise = null
      throw new Error('高德地图加载失败，请检查地图配置和域名白名单', { cause: error })
    }
  )

  return loadPromise
}
