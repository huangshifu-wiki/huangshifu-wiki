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
    <footer className="mt-8 flex flex-col items-center gap-3 text-sm">
      <div ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />
      <p className="text-[0.8125rem] text-text-muted" aria-live="polite">
        已加载 {loaded} / {total} 条
      </p>
      {hasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loading}
          className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded border border-[rgba(138,109,47,0.25)] px-5 py-2 text-sm text-brand-gold transition-all hover:border-brand-gold hover:bg-brand-gold hover:text-white hover:shadow-[0_0_18px_rgba(138,109,47,0.15)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : null}
          {loading ? '加载中...' : '加载更多'}
        </button>
      ) : (
        <span className="text-[0.8125rem] text-text-muted/60">已经到底了</span>
      )}
    </footer>
  )
}
