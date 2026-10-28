import { useEffect, useRef } from 'react'
import { loadTurnstile, type TurnstileApi } from '../lib/turnstile'

interface TurnstileWidgetProps {
  siteKey: string
  onToken: (token: string | null) => void
  onLoadError?: () => void
  /** 数值递增时重置挂件，强制重新获取 token（token 单次有效） */
  resetSignal?: number
  className?: string
}

/** Cloudflare Turnstile 挂件：显式渲染，向父组件抛出 token 或 null（过期/出错） */
export const TurnstileWidget = ({
  siteKey,
  onToken,
  onLoadError,
  resetSignal = 0,
  className,
}: TurnstileWidgetProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<TurnstileApi | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  const lastResetSignalRef = useRef(resetSignal)
  const onTokenRef = useRef(onToken)
  const onLoadErrorRef = useRef(onLoadError)

  useEffect(() => {
    onTokenRef.current = onToken
    onLoadErrorRef.current = onLoadError
  })

  useEffect(() => {
    let cancelled = false

    loadTurnstile()
      .then((api) => {
        if (cancelled || !containerRef.current) return
        apiRef.current = api
        widgetIdRef.current = api.render(containerRef.current, {
          sitekey: siteKey,
          language: 'zh-cn',
          theme: 'auto',
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        })
      })
      .catch((error: unknown) => {
        console.error('Turnstile load failed:', error)
        if (!cancelled) {
          onLoadErrorRef.current?.()
        }
      })

    return () => {
      cancelled = true
      const api = apiRef.current
      const widgetId = widgetIdRef.current
      if (api && widgetId) {
        api.remove(widgetId)
      }
      apiRef.current = null
      widgetIdRef.current = null
    }
  }, [siteKey])

  useEffect(() => {
    if (resetSignal === lastResetSignalRef.current) return
    lastResetSignalRef.current = resetSignal
    const api = apiRef.current
    const widgetId = widgetIdRef.current
    if (api && widgetId) {
      api.reset(widgetId)
    }
  }, [resetSignal])

  return <div ref={containerRef} className={className} />
}
