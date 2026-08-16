export interface IncrementalListLoadSource {
  isInitialLoading: boolean
  error: unknown | null
  initialError: unknown | null
  retry: () => void | Promise<void>
}

export interface ListLoadStateSource<T> {
  items: readonly T[]
  loading: boolean
  error: unknown | null
  retry: () => void
  incremental: IncrementalListLoadSource | null
}

export interface ListLoadState<T> {
  items: readonly T[]
  isInitialLoading: boolean
  isRefreshing: boolean
  error: unknown | null
  loadMoreError: unknown | null
  retry: () => void
}

export function getListLoadState<T>({
  items,
  loading,
  error,
  retry,
  incremental,
}: ListLoadStateSource<T>): ListLoadState<T> {
  const isLoading = incremental?.isInitialLoading ?? loading
  const listError = incremental ? incremental.initialError : error

  return {
    items,
    isInitialLoading: isLoading && items.length === 0,
    isRefreshing: isLoading && items.length > 0,
    error: listError,
    loadMoreError: incremental?.initialError === null ? incremental.error : null,
    retry: incremental?.retry ?? retry,
  }
}
