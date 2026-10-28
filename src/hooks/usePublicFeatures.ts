import { useEffect, useState } from 'react'
import { apiGet } from '../lib/apiClient'

export interface PublicFeatureConfig {
  semanticSearch: boolean
  registrationEnabled: boolean
  searchHotKeywordsEnabled: boolean
}

const DEFAULT_FEATURES: PublicFeatureConfig = {
  semanticSearch: true,
  registrationEnabled: true,
  searchHotKeywordsEnabled: true,
}

export function usePublicFeatures() {
  const [features, setFeatures] = useState<PublicFeatureConfig>(DEFAULT_FEATURES)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    apiGet<PublicFeatureConfig>('/api/config/features')
      .then((config) => {
        if (!cancelled) {
          setFeatures(config)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFeatures(DEFAULT_FEATURES)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  return { features, loading }
}
