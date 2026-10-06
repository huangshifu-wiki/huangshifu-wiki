import { useCallback, useState } from 'react'
import { useTurnstileConfig } from './useTurnstileConfig'

/**
 * Turnstile 校验链路状态：token 单次有效，提交流程结束（成功或失败）后必须 reset 换发。
 * 脚本加载失败时 blocked 保持 false，交由服务端故障放行兜底。
 */
export function useTurnstileChallenge() {
  const config = useTurnstileConfig()
  const [token, setToken] = useState<string | null>(null)
  const [resetSignal, setResetSignal] = useState(0)
  const [loadFailed, setLoadFailed] = useState(false)

  const reset = useCallback(() => {
    setToken(null)
    setResetSignal((signal) => signal + 1)
  }, [])

  return {
    enabled: config.enabled,
    siteKey: config.siteKey,
    token,
    resetSignal,
    blocked: config.enabled && !loadFailed && !token,
    markLoadFailed: () => setLoadFailed(true),
    setToken,
    reset,
  }
}
