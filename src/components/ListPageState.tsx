import React from 'react'

import { LoadErrorState } from './ui'
import { PageSkeleton, type PageSkeletonVariant } from './PageSkeleton'

export interface ListPageLoadingBoundaryProps {
  variant: Extract<PageSkeletonVariant, 'wiki' | 'gallery' | 'music' | 'forum' | 'events'>
  isInitialLoading: boolean
  children: React.ReactNode
}

export const ListPageLoadingBoundary = ({
  variant,
  isInitialLoading,
  children,
}: ListPageLoadingBoundaryProps): React.ReactElement => {
  if (isInitialLoading) {
    return <PageSkeleton variant={variant} />
  }

  return <>{children}</>
}

export interface ListPageContentStateProps {
  hasItems: boolean
  error: unknown | null
  onRetry: () => void
  staleDescription?: React.ReactNode
  empty: React.ReactNode
  children: React.ReactNode
}

export const ListPageContentState = ({
  hasItems,
  error,
  onRetry,
  staleDescription,
  empty,
  children,
}: ListPageContentStateProps): React.ReactElement => {
  if (!hasItems && error) {
    return <LoadErrorState onRetry={onRetry} />
  }

  if (hasItems && error) {
    return (
      <>
        <LoadErrorState
          className="py-5"
          description={staleDescription ?? '当前内容可能不是最新内容。'}
          onRetry={onRetry}
        />
        {children}
      </>
    )
  }

  return hasItems ? <>{children}</> : <>{empty}</>
}
