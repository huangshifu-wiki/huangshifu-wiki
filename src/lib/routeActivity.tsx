import React, { createContext, useContext, useRef } from 'react'

export type RouteEntryContextValue = {
  active: boolean
  restored: boolean
  rootRef: React.RefObject<HTMLDivElement | null>
}
const defaultRoot = { current: null }
// 只传递页面可见性与 DOM 边界，供通用浮层和监听器使用。
export const RouteActivityContext = createContext<RouteEntryContextValue>({
  active: true,
  restored: false,
  rootRef: defaultRoot,
})
export const useRouteActive = () => useContext(RouteActivityContext).active
export const useRouteEntry = () => useContext(RouteActivityContext)

export function RouteActivity({
  active,
  children,
}: {
  active: boolean
  children: React.ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const value = React.useMemo(() => ({ active, restored: false, rootRef }), [active])
  return <RouteActivityContext.Provider value={value}>{children}</RouteActivityContext.Provider>
}
