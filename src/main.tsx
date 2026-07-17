import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { DialogProvider } from './components/Dialog'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastProvider } from './components/Toast'
import { randomId } from './lib/randomId'
import { initThirdPartyScripts } from './utils/scriptLoader'
import { initWebVitals } from './utils/webVitals'
import { initPressFeedback } from './utils/pressFeedback'
import { applyResolvedTheme, readBootstrapThemeMode, resolveThemeMode } from './lib/theme'
import './index.css'

declare global {
  interface Window {
    hideStaticFallback?: () => void
    __HSF_BOOTSTRAP_AUTH_UID__?: string | null
  }
}

if (globalThis.crypto && typeof globalThis.crypto.randomUUID !== 'function') {
  globalThis.crypto.randomUUID = randomId as Crypto['randomUUID']
}

applyResolvedTheme(resolveThemeMode(readBootstrapThemeMode()))
initPressFeedback()

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => {
      console.warn('[SW] Service worker registration failed:', String(e))
    })
  })
}

// 初始化 Web Vitals 性能监控
// 在开发环境自动输出到控制台，生产环境可选择性配置上报
initWebVitals({
  logToConsole: import.meta.env.DEV,
  reportToEndpoint: false, // 设置为 true 并配置 endpointUrl 可启用数据上报
  // endpointUrl: '/api/analytics/web-vitals',
  // sampleRate: 0.5, // 采样率 50%
})

// 初始化第三方脚本延迟加载
// 使用 requestIdleCallback 确保不阻塞首屏渲染
if (typeof window !== 'undefined') {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(
      () => {
        initThirdPartyScripts()
      },
      { timeout: 3000 }
    )
  } else {
    // 降级方案：延迟 3 秒后初始化
    setTimeout(initThirdPartyScripts, 3000)
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <DialogProvider>
          <App />
        </DialogProvider>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>
)

if (typeof window.hideStaticFallback === 'function') {
  window.hideStaticFallback()
}
