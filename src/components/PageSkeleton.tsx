import React from 'react'

interface PageSkeletonProps {
  variant?:
    | 'default'
    | 'wiki'
    | 'gallery'
    | 'music'
    | 'forum'
    | 'events'
    | 'notifications'
    | 'search'
    | 'admin'
}

const SkeletonLine = ({ className }: { className: string }) => (
  <div className={`book-skeleton rounded ${className}`} aria-hidden="true" />
)

const SkeletonCircle = ({ size }: { size: string }) => (
  <div className={`${size} book-skeleton rounded-full`} aria-hidden="true" />
)
const SkeletonShell = ({
  children,
  className = 'mobile-page-shell',
}: {
  children: React.ReactNode
  className?: string
}) => (
  <div className={className} role="status" aria-label="加载中">
    {children}
  </div>
)

export const PageSkeleton: React.FC<PageSkeletonProps> = ({ variant = 'default' }) => {
  if (variant === 'wiki') {
    return (
      <SkeletonShell>
        <div className="max-w-[1100px] mx-auto px-6 py-8">
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
      </SkeletonShell>
    )
  }

  if (variant === 'gallery') {
    return (
      <SkeletonShell>
        <div className="max-w-[1100px] mx-auto px-6 py-8">
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
      </SkeletonShell>
    )
  }

  if (variant === 'music') {
    return (
      <SkeletonShell className="gufeng-music-page mobile-page-shell">
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
      </SkeletonShell>
    )
  }

  if (variant === 'forum') {
    return (
      <SkeletonShell>
        <div className="max-w-[1100px] mx-auto px-6 py-8">
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
      </SkeletonShell>
    )
  }

  if (variant === 'events') {
    return (
      <SkeletonShell>
        <div className="mobile-page-container">
          <SkeletonLine className="mb-3 h-10 w-32" />
          <SkeletonLine className="mb-5 h-9 w-full" />
          <div className="flex flex-col gap-0.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-4 border-b border-border py-4">
                <SkeletonLine className="h-16 w-24 shrink-0 rounded" />
                <div className="min-w-0 flex-1 space-y-2">
                  <SkeletonLine className="h-4 w-2/3" />
                  <SkeletonLine className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </SkeletonShell>
    )
  }

  if (variant === 'notifications') {
    return (
      <SkeletonShell>
        <div className="mobile-page-container">
          <SkeletonLine className="mb-6 h-10 w-32" />
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-start gap-3 border-b border-border py-4">
                <SkeletonCircle size="h-9 w-9 shrink-0" />
                <div className="min-w-0 flex-1 space-y-2">
                  <SkeletonLine className="h-4 w-3/4" />
                  <SkeletonLine className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </SkeletonShell>
    )
  }

  if (variant === 'search') {
    return (
      <SkeletonShell>
        <div className="mobile-page-container">
          <SkeletonLine className="mb-5 h-10 w-32" />
          <SkeletonLine className="mb-6 h-11 w-full" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <SkeletonLine key={i} className="h-24 w-full rounded border border-border" />
            ))}
          </div>
        </div>
      </SkeletonShell>
    )
  }

  if (variant === 'admin') {
    return (
      <SkeletonShell>
        <div className="mobile-page-container space-y-5">
          <div className="flex items-center justify-between gap-4">
            <SkeletonLine className="h-9 w-48" />
            <SkeletonLine className="h-9 w-24" />
          </div>
          <SkeletonLine className="h-11 w-full" />
          <div className="rounded border border-border p-5">
            <SkeletonLine className="mb-4 h-5 w-32" />
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <SkeletonLine key={i} className="h-10 w-full" />
              ))}
            </div>
          </div>
        </div>
      </SkeletonShell>
    )
  }

  return (
    <SkeletonShell className="mobile-page-shell flex items-center justify-center">
      <div className="text-center">
        <div className="loading-spinner mb-4" aria-hidden="true" />
        <p className="text-sm text-text-muted">加载中...</p>
      </div>
    </SkeletonShell>
  )
}
