import React from 'react'

interface PageSkeletonProps {
  variant?: 'default' | 'wiki' | 'gallery' | 'music' | 'forum'
}

const SkeletonLine = ({ className = '' }: { className?: string }) => (
  <div className={`book-skeleton rounded ${className}`} aria-hidden="true" />
)

const SkeletonCircle = ({ size = 'w-16 h-16' }: { size?: string }) => (
  <div className={`${size} book-skeleton rounded-full`} aria-hidden="true" />
)

export const PageSkeleton: React.FC<PageSkeletonProps> = ({ variant = 'default' }) => {
  if (variant === 'wiki') {
    return (
      <div className="max-w-[1100px] mx-auto px-6 py-8" aria-label="加载中" role="status">
        <SkeletonLine className="h-10 w-48 mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="theme-panel rounded p-6 h-[280px]">
              <SkeletonLine className="h-5 w-24 mb-3" />
              <SkeletonLine className="h-4 w-full mb-2" />
              <SkeletonLine className="h-4 w-3/4 mb-4" />
              <div className="flex justify-between mt-auto">
                <SkeletonLine className="h-3 w-20" />
                <SkeletonLine className="h-3 w-12" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (variant === 'gallery') {
    return (
      <div className="max-w-[1100px] mx-auto px-6 py-8" aria-label="加载中" role="status">
        <div className="flex items-center justify-between mb-7">
          <SkeletonLine className="h-9 w-40" />
          <SkeletonLine className="h-9 w-28" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="theme-panel rounded overflow-hidden">
              <div className="aspect-square book-skeleton" />
              <div className="p-3">
                <SkeletonLine className="h-4 w-3/4 mb-2" />
                <SkeletonLine className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (variant === 'music') {
    return (
      <div className="gufeng-music-page mobile-page-shell" aria-label="加载中" role="status">
        <div className="mobile-page-container">
          <SkeletonLine className="mb-3 h-10 w-48" />
          <div className="mb-6 h-px w-16 bg-surface-alt" />
          <div className="mb-5 flex gap-4 border-b border-border pb-3">
            <SkeletonLine className="h-6 w-12" />
            <SkeletonLine className="h-6 w-12" />
          </div>
          <div className="flex flex-col gap-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3.5 rounded px-3 py-2.5">
                <SkeletonLine className="h-[52px] w-[52px] shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <SkeletonLine className="h-4 w-2/5" />
                  <SkeletonLine className="h-3 w-1/3" />
                </div>
                <SkeletonLine className="h-[34px] w-[34px] shrink-0 !rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (variant === 'forum') {
    return (
      <div className="max-w-[1100px] mx-auto px-6 py-8" aria-label="加载中" role="status">
        <SkeletonLine className="h-10 w-56 mb-6" />
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="theme-panel rounded p-5">
              <div className="flex items-start gap-4">
                <SkeletonCircle size="w-10 h-10" />
                <div className="flex-1 space-y-2">
                  <SkeletonLine className="h-5 w-2/3" />
                  <SkeletonLine className="h-4 w-full" />
                  <SkeletonLine className="h-4 w-4/5" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Default skeleton
  return (
    <div
      className="max-w-[1100px] mx-auto px-6 py-8 flex items-center justify-center min-h-[400px]"
      aria-label="加载中"
      role="status"
    >
      <div className="text-center">
        <div
          className="inline-block w-12 h-12 border-4 border-border border-t-[var(--color-theme-accent)] rounded-full animate-spin mb-4"
          aria-hidden="true"
        />
        <p className="text-sm text-text-muted">加载中...</p>
      </div>
    </div>
  )
}
