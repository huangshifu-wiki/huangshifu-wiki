// @vitest-environment jsdom
import React, { lazy, Suspense } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Link, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { AppRouter } from '../../src/App'
import { PageSkeleton } from '../../src/components/PageSkeleton'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('AppRouter route loading transition', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
  })

  it('commits a navigation immediately and shows the target skeleton while the route is suspended', async () => {
    const routeModule = deferred<{ default: React.ComponentType }>()
    const DeferredEventsPage = lazy(() => routeModule.promise)

    render(
      <AppRouter>
        <Suspense fallback={<PageSkeleton variant="events" />}>
          <Routes>
            <Route
              path="/"
              element={
                <div>
                  <div data-testid="old-page">旧页面</div>
                  <Link to="/events">进入游记</Link>
                </div>
              }
            />
            <Route path="/events" element={<DeferredEventsPage />} />
          </Routes>
        </Suspense>
      </AppRouter>
    )

    fireEvent.click(screen.getByRole('link', { name: '进入游记' }))

    expect(screen.getByRole('status', { name: '加载中' })).toBeInTheDocument()
    expect(screen.getByTestId('old-page')).not.toBeVisible()

    routeModule.resolve({ default: () => <div>游记目标内容</div> })

    expect(await screen.findByText('游记目标内容')).toBeInTheDocument()
  })
})
