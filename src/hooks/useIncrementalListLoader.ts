import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface IncrementalPageResult<T> {
  items: T[]
  total: number
  hasMore?: boolean
}

interface UseIncrementalListLoaderOptions<T> {
  enabled: boolean
  pageSize: number
  resetKey: string
  fetchPage: (page: number, signal: AbortSignal) => Promise<IncrementalPageResult<T>>
  getItemKey: (item: T) => string
  /** 筛选/标签/排序切换（resetKey 变化）时保留旧列表直到新数据落地，避免整块闪烁；默认 false 保持原行为 */
  preserveItemsOnReset?: boolean
}

type LoadMode = 'initial' | 'more'

interface LastRequest {
  page: number
  mode: LoadMode
}

export function useIncrementalListLoader<T>({
  enabled,
  pageSize,
  resetKey,
  fetchPage,
  getItemKey,
  preserveItemsOnReset = false,
}: UseIncrementalListLoaderOptions<T>) {
  const [items, setItems] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loadingInitial, setLoadingInitial] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [autoLoadEnabled, setAutoLoadEnabled] = useState(true)
  const [error, setError] = useState<unknown | null>(null)
  const [initialError, setInitialError] = useState<unknown | null>(null)
  const requestIdRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const fetchPageRef = useRef(fetchPage)
  const getItemKeyRef = useRef(getItemKey)
  const completedInitialKeyRef = useRef<string | null>(null)
  const failedRequestRef = useRef<LastRequest | null>(null)
  const loadKey = `${resetKey}:${pageSize}`

  useEffect(() => {
    fetchPageRef.current = fetchPage
  }, [fetchPage])

  useEffect(() => {
    getItemKeyRef.current = getItemKey
  }, [getItemKey])

  const appendUniqueItems = useCallback((currentItems: T[], nextItems: T[]) => {
    const seen = new Set(currentItems.map(getItemKeyRef.current))
    const uniqueItems = nextItems.filter((item) => {
      const key = getItemKeyRef.current(item)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    return [...currentItems, ...uniqueItems]
  }, [])

  const loadPage = useCallback(
    async (nextPage: number, mode: LoadMode) => {
      if (!enabled) return

      const requestId = ++requestIdRef.current
      const abortController = new AbortController()
      abortControllerRef.current?.abort()
      abortControllerRef.current = abortController
      failedRequestRef.current = null
      setError(null)
      if (mode === 'initial') setInitialError(null)
      if (mode === 'initial') {
        setLoadingInitial(true)
      } else {
        setLoadingMore(true)
      }

      try {
        const result = await fetchPageRef.current(nextPage, abortController.signal)
        if (requestId !== requestIdRef.current) return

        setTotal(result.total)
        setPage(nextPage)
        if (mode === 'initial') {
          setItems(result.items)
          setHasMore(result.hasMore ?? result.items.length < result.total)
          return
        }

        setItems((currentItems) => {
          const nextItems = appendUniqueItems(currentItems, result.items)
          setHasMore(result.hasMore ?? nextItems.length < result.total)
          return nextItems
        })
      } catch (loadError) {
        if (requestId !== requestIdRef.current) return
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return
        failedRequestRef.current = { page: nextPage, mode }
        setError(loadError)
        if (mode === 'initial') setInitialError(loadError)
        setAutoLoadEnabled(false)
      } finally {
        if (requestId === requestIdRef.current) {
          if (mode === 'initial') {
            completedInitialKeyRef.current = loadKey
            setLoadingInitial(false)
          } else {
            setLoadingMore(false)
          }
          abortControllerRef.current = null
        }
      }
    },
    [appendUniqueItems, enabled, loadKey]
  )

  useEffect(() => {
    if (!enabled) {
      completedInitialKeyRef.current = null
      return
    }

    if (!preserveItemsOnReset) {
      setItems([])
      setTotal(0)
    }
    completedInitialKeyRef.current = null
    setPage(0)
    setHasMore(false)
    setAutoLoadEnabled(true)
    setError(null)
    setInitialError(null)
    void loadPage(1, 'initial')

    return () => {
      requestIdRef.current += 1
      abortControllerRef.current?.abort()
    }
  }, [enabled, loadKey, loadPage, preserveItemsOnReset])

  const loadMore = useCallback(() => {
    if (loadingInitial || loadingMore || !hasMore) return
    void loadPage(page + 1, 'more')
  }, [hasMore, loadPage, loadingInitial, loadingMore, page])
  const retry = useCallback(async () => {
    const failedRequest = failedRequestRef.current
    if (!failedRequest) return
    await loadPage(failedRequest.page, failedRequest.mode)
  }, [loadPage])

  useEffect(() => {
    if (!enabled || !autoLoadEnabled || !hasMore || loadingInitial || loadingMore) return
    if (typeof IntersectionObserver === 'undefined') return

    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMore()
        }
      },
      { rootMargin: '240px 0px' }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [autoLoadEnabled, enabled, hasMore, loadMore, loadingInitial, loadingMore])

  const isInitialLoading = enabled && completedInitialKeyRef.current !== loadKey

  return useMemo(
    () => ({
      items,
      setItems,
      total,
      setTotal,
      page,
      loadingInitial,
      loadingMore,
      isInitialLoading,
      hasMore,
      error,
      initialError,
      retry,
      sentinelRef,
      loadMore,
    }),
    [
      error,
      hasMore,
      initialError,
      isInitialLoading,
      items,
      loadMore,
      loadingInitial,
      loadingMore,
      page,
      retry,
      total,
    ]
  )
}
