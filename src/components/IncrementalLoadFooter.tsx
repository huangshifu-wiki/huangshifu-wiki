import { Loader2 } from '@/src/components/icons'
import type { RefObject } from 'react'

interface IncrementalLoadFooterProps {
  hasMore: boolean
  loading: boolean
  total: number
  loaded: number
  onLoadMore: () => void
  sentinelRef: RefObject<HTMLDivElement | null>
}

export function IncrementalLoadFooter({
  hasMore,
  loading,
  total,
  loaded,
  onLoadMore,
  sentinelRef,
}: IncrementalLoadFooterProps) {
  return (
    <footer className="mt-8 flex flex-col items-center gap-3 text-sm text-text-muted">
      <div ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />
      <p aria-live="polite">
        已加载 {loaded} / {total} 条
      </p>
      {hasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loading}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded border border-border px-5 py-2 text-sm text-text-secondary transition-all hover:border-brand-gold hover:text-brand-gold disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : null}
          {loading ? '加载中...' : '加载更多'}
        </button>
      ) : (
        <span>已经到底了</span>
      )}
    </footer>
  )
}
