import { useState, useEffect, useCallback } from 'react'

export interface NetworkStatus {
  isOnline: boolean
  lastChangedAt: Date | null
}

export const useNetworkStatus = (): NetworkStatus & {
  goOnline: () => void
  goOffline: () => void
} => {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const [lastChangedAt, setLastChangedAt] = useState<Date | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleOnline = () => {
      setIsOnline(true)
      setLastChangedAt(new Date())
    }

    const handleOffline = () => {
      setIsOnline(false)
      setLastChangedAt(new Date())
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const goOnline = useCallback(() => {
    setIsOnline(true)
    setLastChangedAt(new Date())
  }, [])

  const goOffline = useCallback(() => {
    setIsOnline(false)
    setLastChangedAt(new Date())
  }, [])

  return { isOnline, lastChangedAt, goOnline, goOffline }
}
