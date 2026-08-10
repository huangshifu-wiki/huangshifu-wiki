import type { ReactNode, RefObject } from 'react'
import { Button } from '@/src/components/ui'

interface IncrementalLoadFooterProps {
  hasMore: boolean
  loading: boolean
  total: number
  loaded: number
  onLoadMore: () => void
  sentinelRef: RefObject<HTMLDivElement | null>
  error?: ReactNode
  onRetry?: () => void
}

export function IncrementalLoadFooter({
  hasMore,
  loading,
  total,
  loaded,
  onLoadMore,
  sentinelRef,
  error,
  onRetry,
}: IncrementalLoadFooterProps) {
  return (
    <footer className="mt-8 flex flex-col items-center gap-3 text-sm">
      <div ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />
      <p className="text-[0.8125rem] text-text-muted" aria-live="polite">
        已加载 {loaded} / {total} 条
      </p>
      {error ? (
        <div className="flex flex-col items-center gap-2" role="alert">
          <span className="text-[0.8125rem] text-error">加载失败，请重试</span>
          {onRetry && (
            <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
              重新加载
            </Button>
          )}
        </div>
      ) : hasMore ? (
        <Button
          type="button"
          variant="secondary"
          onClick={onLoadMore}
          loading={loading}
          loadingText="加载中..."
        >
          加载更多
        </Button>
      ) : (
        <span className="text-[0.8125rem] text-text-muted/60">已经到底了</span>
      )}
    </footer>
  )
}
