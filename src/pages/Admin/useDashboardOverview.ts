import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet } from '@/src/lib/apiClient'
import type { AdminDashboardOverview, AdminDashboardResponse } from '@/src/types/api'

const NO_CACHE_OPTIONS = { staleTime: 0, swr: false }
const POLL_INTERVAL_MS = 60_000

export function useDashboardOverview() {
  const [data, setData] = useState<AdminDashboardOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const fetchOverview = useCallback(async (showRefreshing: boolean) => {
    const requestId = ++requestIdRef.current
    if (showRefreshing) setRefreshing(true)
    try {
      const response = await apiGet<AdminDashboardResponse>(
        '/api/admin/dashboard',
        undefined,
        NO_CACHE_OPTIONS
      )
      if (requestIdRef.current !== requestId) return
      setData(response.data)
      setLoadError(null)
      setLastUpdated(new Date().toISOString())
    } catch (error) {
      if (requestIdRef.current !== requestId) return
      setLoadError(error)
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  const refresh = useCallback(() => {
    void fetchOverview(true)
  }, [fetchOverview])

  useEffect(() => {
    void fetchOverview(false)
    const timer = window.setInterval(() => {
      void fetchOverview(false)
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [fetchOverview])

  return { data, loading, refreshing, loadError, lastUpdated, refresh }
}
