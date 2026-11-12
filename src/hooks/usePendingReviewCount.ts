import { useEffect, useRef, useState } from 'react'
import { apiGet } from '../lib/apiClient'
import type { AdminReviewQueueCountResponse } from '../types/api'
import { useRouteActive } from '../lib/routeActivity'

export const PENDING_REVIEW_COUNT_PATH = '/api/admin/review-queue/count'

const pendingReviewCountListeners = new Set<() => void>()

export function notifyPendingReviewCountChanged() {
  pendingReviewCountListeners.forEach((listener) => listener())
}

export function usePendingReviewCount(enabled: boolean) {
  const active = useRouteActive()
  const requestedTick = useRef<number | null>(null)
  const requestIdRef = useRef(0)
  const [count, setCount] = useState(0)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    if (!enabled) return

    const listener = () => setRefreshTick((tick) => tick + 1)
    pendingReviewCountListeners.add(listener)

    return () => {
      pendingReviewCountListeners.delete(listener)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) {
      setCount(0)
      requestedTick.current = null
      requestIdRef.current += 1
      return
    }

    if (!active || requestedTick.current === refreshTick) return
    requestedTick.current = refreshTick
    const requestId = ++requestIdRef.current

    const fetchCount = async () => {
      try {
        const data = await apiGet<AdminReviewQueueCountResponse>(
          PENDING_REVIEW_COUNT_PATH,
          { status: 'pending' },
          { staleTime: 15000, swr: true }
        )

        if (requestId === requestIdRef.current) setCount(data.total)
      } catch (error) {
        console.error('Fetch pending review count failed:', error)
        if (requestId === requestIdRef.current) setCount(0)
      }
    }

    void fetchCount()
  }, [active, enabled, refreshTick])

  return count
}
