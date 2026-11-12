import React, { createContext, useRef, useState } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { getContentBackgroundLocation } from '../lib/contentEditorRoutes'
import { retainLocation, type RetentionState } from '../lib/routeRetention'

export const RetentionContext = createContext<RetentionState | null>(null)
export const RetentionRootsContext = createContext<Map<number, HTMLDivElement>>(new Map())

export function RouteRetentionProvider({
  children,
  scopeKey,
}: {
  children: React.ReactNode
  scopeKey: string
}) {
  const actualLocation = useLocation()
  const location = getContentBackgroundLocation(actualLocation)
  const navigationType = useNavigationType()
  const [stored, setStored] = useState(() => ({
    scopeKey,
    state: retainLocation(null, location, navigationType, actualLocation.key),
  }))
  // 保留单例外壳，用递增实例编号隔离身份变化前后的页面。
  const previous =
    stored.scopeKey === scopeKey
      ? stored.state
      : {
          ...stored.state,
          pages: [],
          history: [],
          key: '',
          observedKey: '',
          index: -1,
          savedKeys: new Set<string>(),
        }
  const state = retainLocation(previous, location, navigationType, actualLocation.key)
  if (state !== stored.state || scopeKey !== stored.scopeKey) setStored({ scopeKey, state })
  const roots = useRef(new Map<number, HTMLDivElement>())
  return (
    <RetentionContext.Provider value={state}>
      <RetentionRootsContext.Provider value={roots.current}>
        {children}
      </RetentionRootsContext.Provider>
    </RetentionContext.Provider>
  )
}
