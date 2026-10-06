import { useEffect, useState } from 'react'
import { apiGet } from '../lib/apiClient'
import type { TurnstilePublicConfig } from '../types/api'

const DISABLED_CONFIG: TurnstilePublicConfig = { enabled: false, siteKey: '' }

/** 公开人机验证配置；请求失败或数据缺失一律按未启用处理 */
export function useTurnstileConfig(): TurnstilePublicConfig {
  const [config, setConfig] = useState<TurnstilePublicConfig>(DISABLED_CONFIG)

  useEffect(() => {
    let cancelled = false

    apiGet<TurnstilePublicConfig>('/api/config/turnstile')
      .then((value) => {
        if (!cancelled && value.enabled && value.siteKey) {
          setConfig({ enabled: true, siteKey: value.siteKey })
        }
      })
      .catch(() => undefined) // 请求失败保持未启用状态

    return () => {
      cancelled = true
    }
  }, [])

  return config
}
