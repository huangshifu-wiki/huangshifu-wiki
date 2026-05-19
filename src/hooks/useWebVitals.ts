import { useEffect, useRef } from 'react'
import { initWebVitals } from '../utils/webVitals'
import type { WebVitalsMetrics, WebVitalsInitOptions } from '../utils/webVitals'

export type { WebVitalsMetrics }

export type WebVitalsOptions = WebVitalsInitOptions

export const useWebVitals = (options: WebVitalsOptions = {}): void => {
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    cleanupRef.current = initWebVitals(options)

    return () => {
      cleanupRef.current?.()
      cleanupRef.current = null
    }
  }, [options.logToConsole, options.reportToEndpoint, options.endpointUrl, options.sampleRate, options.onReport])
}

export default useWebVitals
