import { useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { UsePaginationReturn } from './usePagination'

interface UseRoutedPaginationOptions {
  totalCount?: number
  serverTotalPages?: number
  totalKnown?: boolean
  defaultPageSize?: number
  pageParam?: string
  pageSizeParam?: string | null
  pageSizeOptions?: number[]
  showPageSizeSelector?: boolean
  enabled?: boolean
}

const DEFAULT_PAGE_SIZE = 20

function parsePositiveInt(value: string | null, fallback: number) {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return parsed
}

function parsePageSize(value: string | null, fallback: number, options?: number[]) {
  const parsed = parsePositiveInt(value, fallback)
  if (options && !options.includes(parsed)) return fallback
  return parsed
}

function normalizePageSize(value: number, fallback: number, options?: number[]) {
  if (!Number.isInteger(value) || value < 1) return fallback
  if (options && !options.includes(value)) return fallback
  return value
}

function sameSearchParams(left: URLSearchParams, right: URLSearchParams) {
  return left.toString() === right.toString()
}

function normalizeSearchParams(
  params: URLSearchParams,
  options: {
    pageParam: string
    pageSizeParam: string | null
    defaultPageSize: number
    pageSizeOptions?: number[]
  }
) {
  const { pageParam, pageSizeParam, defaultPageSize, pageSizeOptions } = options
  const next = new URLSearchParams(params)
  const normalizedPage = parsePositiveInt(params.get(pageParam), 1)
  const normalizedPageSize =
    pageSizeParam === null
      ? defaultPageSize
      : parsePageSize(params.get(pageSizeParam), defaultPageSize, pageSizeOptions)

  if (normalizedPage > 1) {
    next.set(pageParam, String(normalizedPage))
  } else {
    next.delete(pageParam)
  }

  if (pageSizeParam !== null) {
    if (normalizedPageSize !== defaultPageSize) {
      next.set(pageSizeParam, String(normalizedPageSize))
    } else {
      next.delete(pageSizeParam)
    }
  }

  return next
}

export function useRoutedPagination(options: UseRoutedPaginationOptions = {}): UsePaginationReturn {
  const {
    totalCount,
    serverTotalPages,
    totalKnown,
    defaultPageSize = DEFAULT_PAGE_SIZE,
    pageParam = 'page',
    pageSizeParam = 'pageSize',
    pageSizeOptions,
    showPageSizeSelector = true,
    enabled = true,
  } = options
  const [searchParams, setSearchParams] = useSearchParams()

  const page = parsePositiveInt(searchParams.get(pageParam), 1)
  const pageSize =
    pageSizeParam === null
      ? defaultPageSize
      : parsePageSize(searchParams.get(pageSizeParam), defaultPageSize, pageSizeOptions)

  const totalPages = useMemo(() => {
    if (serverTotalPages !== undefined) return Math.max(1, serverTotalPages)
    if (totalCount !== undefined) return Math.max(1, Math.ceil(totalCount / pageSize))
    return 1
  }, [serverTotalPages, totalCount, pageSize])
  const hasKnownTotal = totalKnown ?? (serverTotalPages !== undefined || totalCount !== undefined)

  const updatePaginationParams = useCallback(
    (nextPage: number, nextPageSize = pageSize, replace = false) => {
      if (!enabled) return
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          const normalizedPage = Number.isFinite(nextPage) ? Math.max(1, Math.trunc(nextPage)) : 1
          const normalizedPageSize = normalizePageSize(
            nextPageSize,
            defaultPageSize,
            pageSizeOptions
          )

          if (normalizedPage > 1) {
            next.set(pageParam, String(normalizedPage))
          } else {
            next.delete(pageParam)
          }

          if (pageSizeParam === null) {
            return sameSearchParams(next, prev) ? prev : next
          }

          if (normalizedPageSize !== defaultPageSize) {
            next.set(pageSizeParam, String(normalizedPageSize))
          } else {
            next.delete(pageSizeParam)
          }

          return sameSearchParams(next, prev) ? prev : next
        },
        { replace }
      )
    },
    [defaultPageSize, enabled, pageParam, pageSize, pageSizeOptions, pageSizeParam, setSearchParams]
  )

  useEffect(() => {
    if (!enabled) return
    const normalized = normalizeSearchParams(searchParams, {
      pageParam,
      pageSizeParam,
      defaultPageSize,
      pageSizeOptions,
    })
    if (sameSearchParams(normalized, searchParams)) return

    setSearchParams(
      (prev) => {
        const next = normalizeSearchParams(prev, {
          pageParam,
          pageSizeParam,
          defaultPageSize,
          pageSizeOptions,
        })
        return sameSearchParams(next, prev) ? prev : next
      },
      { replace: true }
    )
  }, [
    defaultPageSize,
    enabled,
    pageParam,
    pageSizeOptions,
    pageSizeParam,
    searchParams,
    setSearchParams,
  ])

  useEffect(() => {
    if (!enabled || !hasKnownTotal) return
    if (page > totalPages) {
      updatePaginationParams(totalPages, pageSize, true)
    }
  }, [enabled, hasKnownTotal, page, pageSize, totalPages, updatePaginationParams])

  const handlePageChange = useCallback(
    (newPage: number) => {
      updatePaginationParams(newPage)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [updatePaginationParams]
  )

  const handlePageSizeChange = showPageSizeSelector
    ? (newSize: number) => {
        updatePaginationParams(1, newSize)
      }
    : undefined

  return {
    page,
    pageSize,
    totalPages,
    handlePageChange,
    handlePageSizeChange,
    setPage: (newPage: number) => updatePaginationParams(newPage, pageSize),
    setPageSize: (newSize: number) => updatePaginationParams(1, newSize),
  }
}
