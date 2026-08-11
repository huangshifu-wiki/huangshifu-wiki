import { useState, useCallback, useMemo } from 'react'

export interface UsePaginationOptions {
  totalCount?: number
  serverTotalPages?: number
  defaultPageSize?: number
  onPageChange?: (page: number) => void
  showPageSizeSelector?: boolean
}

export interface UsePaginationReturn {
  page: number
  pageSize: number
  totalPages: number
  hasMultiplePages: boolean
  handlePageChange: (newPage: number) => void
  handlePageSizeChange?: (newSize: number) => void
  setPage: (page: number) => void
  setPageSize: (size: number) => void
}

const DEFAULT_PAGE_SIZE = 20

export function usePagination(options: UsePaginationOptions = {}): UsePaginationReturn {
  const {
    totalCount,
    serverTotalPages,
    defaultPageSize = DEFAULT_PAGE_SIZE,
    onPageChange,
    showPageSizeSelector = true,
  } = options

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(defaultPageSize)

  const totalPages = useMemo(() => {
    if (serverTotalPages !== undefined) return serverTotalPages
    if (totalCount !== undefined) return Math.max(1, Math.ceil(totalCount / pageSize))
    return 1
  }, [serverTotalPages, totalCount, pageSize])
  const hasMultiplePages =
    (serverTotalPages !== undefined || totalCount !== undefined) && totalPages > 1

  const handlePageChange = useCallback(
    (newPage: number) => {
      setPage(newPage)
      if (onPageChange) {
        onPageChange(newPage)
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    },
    [onPageChange]
  )

  const handlePageSizeChange = showPageSizeSelector
    ? useCallback((newSize: number) => {
        setPageSize(newSize)
        setPage(1)
      }, [])
    : undefined

  return {
    page,
    pageSize,
    totalPages,
    hasMultiplePages,
    handlePageChange,
    handlePageSizeChange,
    setPage,
    setPageSize,
  }
}
