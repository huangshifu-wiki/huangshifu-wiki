import React, { Suspense, useContext, useMemo, useRef } from 'react'
import { Routes, UNSAFE_LocationContext } from 'react-router-dom'
import { RetentionContext, RetentionRootsContext } from '../context/RouteRetentionContext'
import { RouteActivityContext } from '../lib/routeActivity'
import type { RetainedPage, RouteScope } from '../lib/routeRetention'
import { ErrorBoundary } from './ErrorBoundary'
import { PageSkeleton } from './PageSkeleton'
import { getRouteSkeletonVariant } from '../lib/routeSkeleton'
import { RouteContentCommitContext } from './RouteScrollBoundary'

function CommittedContent({ children }: { children: React.ReactNode }) {
  const committed = useContext(RouteContentCommitContext)
  const contentRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      if (node) committed()
    },
    [committed]
  )
  return (
    <div data-route-content ref={contentRef}>
      <Routes>{children}</Routes>
    </div>
  )
}

function PageSlot({
  page,
  active,
  children,
}: {
  page: RetainedPage
  active: boolean
  children: React.ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const roots = useContext(RetentionRootsContext)
  const activity = useMemo(
    () => ({ active, restored: page.restored, rootRef }),
    [active, page.restored]
  )
  const snapshot = useMemo(
    () => ({ location: page.location, navigationType: page.navigationType }),
    [page.location, page.navigationType]
  )
  const setRoot = React.useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node
      if (node) roots.set(page.id, node)
      else roots.delete(page.id)
    },
    [roots, page.id]
  )
  return (
    <div
      ref={setRoot}
      data-retained-page={page.id}
      data-route-active={active ? 'true' : 'false'}
      hidden={!active}
      inert={!active}
      aria-hidden={!active ? true : undefined}
    >
      <RouteActivityContext.Provider value={activity}>
        <UNSAFE_LocationContext.Provider value={snapshot}>
          <ErrorBoundary key={page.revision}>
            <Suspense
              fallback={<PageSkeleton variant={getRouteSkeletonVariant(page.location.pathname)} />}
            >
              <CommittedContent>{children}</CommittedContent>
            </Suspense>
          </ErrorBoundary>
        </UNSAFE_LocationContext.Provider>
      </RouteActivityContext.Provider>
    </div>
  )
}

export function RetainedRoutes({
  scope,
  children,
}: {
  scope: RouteScope
  children: React.ReactNode
}) {
  const state = useContext(RetentionContext)
  if (!state) throw new Error('RetainedRoutes 需要 RouteRetentionProvider')
  return state.pages
    .filter((page) => page.scope === scope)
    .map((page) => (
      <PageSlot key={page.id} page={page} active={page.id === state.activeId}>
        {children}
      </PageSlot>
    ))
}
