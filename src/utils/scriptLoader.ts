/**
 * 第三方脚本加载管理器
 * 用于延迟加载非关键第三方脚本，避免阻塞首屏渲染
 */

export interface ScriptConfig {
  src: string
  async?: boolean
  defer?: boolean
  module?: boolean
  crossOrigin?: 'anonymous' | 'use-credentials'
  integrity?: string
  id?: string
  /**
   * 加载时机策略
   * - 'immediate': 立即加载（仅用于关键脚本）
   * - 'idle': 使用 requestIdleCallback 延迟加载（推荐用于分析脚本）
   * - 'interaction': 用户首次交互后加载
   * - 'visible': 页面可见后加载
   */
  loadStrategy?: 'immediate' | 'idle' | 'interaction' | 'visible'
  /**
   * 延迟时间（毫秒），在 loadStrategy 为 'idle' 时作为保底超时
   */
  delay?: number
  /**
   * 加载超时时间（毫秒）
   */
  timeout?: number
}

/**
 * 已加载脚本的缓存
 */
const loadedScripts = new Set<string>()

/**
 * 检查脚本是否已加载
 */
export function isScriptLoaded(src: string): boolean {
  return loadedScripts.has(src) || document.querySelector(`script[src="${src}"]`) !== null
}

/**
 * 加载单个脚本
 */
export function loadScript(config: ScriptConfig): Promise<HTMLScriptElement> {
  const {
    src,
    async = true,
    defer = true,
    module = false,
    crossOrigin,
    integrity,
    id,
    timeout = 10000,
  } = config

  // 避免重复加载
  if (isScriptLoaded(src)) {
    const existingScript = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement
    return Promise.resolve(existingScript)
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = async
    script.defer = defer

    if (module) {
      script.type = 'module'
    }

    if (crossOrigin) {
      script.crossOrigin = crossOrigin
    }

    if (integrity) {
      script.integrity = integrity
    }

    if (id) {
      script.id = id
    }

    // 超时处理
    const timeoutId = setTimeout(() => {
      reject(new Error(`Script load timeout: ${src}`))
    }, timeout)

    script.onload = () => {
      clearTimeout(timeoutId)
      loadedScripts.add(src)
      resolve(script)
    }

    script.onerror = () => {
      clearTimeout(timeoutId)
      reject(new Error(`Failed to load script: ${src}`))
    }

    document.head.appendChild(script)
  })
}

/**
 * 使用 requestIdleCallback 延迟加载脚本
 * 如果浏览器不支持 requestIdleCallback，则使用 setTimeout 降级
 */
export function loadScriptWhenIdle(config: ScriptConfig): Promise<HTMLScriptElement> {
  return new Promise((resolve, reject) => {
    const load = () => {
      loadScript(config).then(resolve).catch(reject)
    }

    // 保底延迟时间
    const delay = config.delay || 2000

    // 如果 requestIdleCallback 可用，使用它
    if ('requestIdleCallback' in window) {
      const idleCallbackId = requestIdleCallback(
        () => {
          load()
        },
        { timeout: delay }
      )

      // 同时设置保底超时
      setTimeout(() => {
        cancelIdleCallback(idleCallbackId)
        load()
      }, delay)
    } else {
      // 降级方案：使用 setTimeout
      setTimeout(load, delay)
    }
  })
}

/**
 * 用户首次交互后加载脚本
 */
export function loadScriptOnInteraction(config: ScriptConfig): Promise<HTMLScriptElement> {
  return new Promise((resolve, reject) => {
    const events = ['click', 'touchstart', 'keydown', 'scroll', 'mousemove']
    let loaded = false

    const handler = () => {
      if (loaded) return
      loaded = true

      // 移除所有事件监听
      events.forEach((event) => {
        window.removeEventListener(event, handler, { capture: true } as EventListenerOptions)
      })

      loadScript(config).then(resolve).catch(reject)
    }

    // 监听用户交互事件
    events.forEach((event) => {
      window.addEventListener(event, handler, {
        capture: true,
        passive: true,
      } as EventListenerOptions)
    })

    // 保底：5秒后自动加载
    setTimeout(handler, 5000)
  })
}

/**
 * 页面可见后加载脚本
 */
export function loadScriptOnVisible(config: ScriptConfig): Promise<HTMLScriptElement> {
  return new Promise((resolve, reject) => {
    if (document.visibilityState === 'visible') {
      loadScript(config).then(resolve).catch(reject)
      return
    }

    const handler = () => {
      if (document.visibilityState === 'visible') {
        document.removeEventListener('visibilitychange', handler)
        loadScript(config).then(resolve).catch(reject)
      }
    }

    document.addEventListener('visibilitychange', handler)

    // 保底：5秒后自动加载
    setTimeout(() => {
      document.removeEventListener('visibilitychange', handler)
      loadScript(config).then(resolve).catch(reject)
    }, 5000)
  })
}

/**
 * 根据策略加载脚本
 */
export function loadScriptWithStrategy(config: ScriptConfig): Promise<HTMLScriptElement> {
  const strategy = config.loadStrategy || 'idle'

  switch (strategy) {
    case 'immediate':
      return loadScript(config)
    case 'interaction':
      return loadScriptOnInteraction(config)
    case 'visible':
      return loadScriptOnVisible(config)
    case 'idle':
    default:
      return loadScriptWhenIdle(config)
  }
}

/**
 * 批量加载脚本（按顺序）
 */
export async function loadScriptsSequentially(
  configs: ScriptConfig[]
): Promise<HTMLScriptElement[]> {
  const results: HTMLScriptElement[] = []

  for (const config of configs) {
    try {
      const script = await loadScriptWithStrategy(config)
      results.push(script)
    } catch (error) {
      console.warn(`Failed to load script: ${config.src}`, error)
      // 继续加载下一个脚本
    }
  }

  return results
}

/**
 * 批量加载脚本（并行）
 */
export function loadScriptsInParallel(configs: ScriptConfig[]): Promise<HTMLScriptElement[]> {
  return Promise.all(
    configs.map((config) =>
      loadScriptWithStrategy(config).catch((error) => {
        console.warn(`Failed to load script: ${config.src}`, error)
        return null
      })
    )
  ).then((results) => results.filter((script): script is HTMLScriptElement => script !== null))
}

/**
 * 预连接到第三方域名（DNS 预解析和预连接）
 */
export function preconnectToDomains(domains: string[]): void {
  domains.forEach((domain) => {
    // DNS 预解析
    const dnsLink = document.createElement('link')
    dnsLink.rel = 'dns-prefetch'
    dnsLink.href = domain
    document.head.appendChild(dnsLink)

    // 预连接
    const preconnectLink = document.createElement('link')
    preconnectLink.rel = 'preconnect'
    preconnectLink.href = domain
    preconnectLink.crossOrigin = 'anonymous'
    document.head.appendChild(preconnectLink)
  })
}

/**
 * 预加载关键资源
 */
export function preloadResource(
  href: string,
  as: string,
  type?: string,
  crossOrigin?: string
): void {
  const link = document.createElement('link')
  link.rel = 'preload'
  link.href = href
  link.as = as

  if (type) {
    link.type = type
  }

  if (crossOrigin) {
    link.crossOrigin = crossOrigin
  }

  document.head.appendChild(link)
}

/**
 * 常用的第三方分析脚本配置
 */
export const commonThirdPartyScripts = {
  /**
   * 字节跳动分析 (Volces)
   */
  volcesAnalytics: (config: { appId: string }): ScriptConfig => ({
    src: `https://gator.volces.com/sdk.js?appId=${config.appId}`,
    async: true,
    defer: true,
    loadStrategy: 'idle',
    delay: 3000,
  }),

  /**
   * ChatGLM 分析
   */
  chatglmAnalytics: (): ScriptConfig => ({
    src: 'https://analysis.chatglm.cn/sdk.js',
    async: true,
    defer: true,
    loadStrategy: 'idle',
    delay: 4000,
  }),
}

/**
 * 初始化第三方脚本加载（在应用启动后调用）
 * 用于延迟加载非关键第三方脚本
 */
export function initThirdPartyScripts(): void {
  // 预连接到可能需要的第三方域名
  preconnectToDomains([
    'https://gator.volces.com',
    'https://analysis.chatglm.cn',
    'https://webapi.amap.com',
  ])

  // 延迟加载非关键脚本
  // 注意：这里只是示例，实际项目中根据需要使用
  // 使用类型断言避免 ImportMetaEnv 类型问题
  const isProd =
    (import.meta as unknown as { env: { PROD?: boolean; MODE?: string } }).env?.PROD ??
    (import.meta as unknown as { env: { MODE?: string } }).env?.MODE === 'production'

  if (isProd) {
    // 生产环境下延迟加载分析脚本
    // 实际使用时取消注释并配置
    // loadScriptWithStrategy(commonThirdPartyScripts.volcesAnalytics({ appId: 'YOUR_APP_ID' }));
    // loadScriptWithStrategy(commonThirdPartyScripts.chatglmAnalytics());
  }
}

export default {
  loadScript,
  loadScriptWhenIdle,
  loadScriptOnInteraction,
  loadScriptOnVisible,
  loadScriptWithStrategy,
  loadScriptsSequentially,
  loadScriptsInParallel,
  preconnectToDomains,
  preloadResource,
  isScriptLoaded,
  initThirdPartyScripts,
  commonThirdPartyScripts,
}
