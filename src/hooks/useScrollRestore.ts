import { useCallback, useLayoutEffect, useRef } from 'react'
import { useRouteActive } from '../lib/routeActivity'

/**
 * 静默刷新时的滚动位置保持：
 * 发起刷新前调用返回的 saveScroll() 记录后台滚动容器位置，
 * 下一次 React commit（数据落地）后自动恢复，恢复后自清除。
 */
export function useScrollRestore(): () => void {
  const active = useRouteActive()
  const activeRef = useRef(active)
  activeRef.current = active
  const savedScrollRef = useRef<number | null>(null)

  const saveScroll = useCallback(() => {
    if (!activeRef.current) return
    const container = document.querySelector(
      '[data-route-shell="admin"][data-route-active="true"] [data-admin-scroll-container]'
    )
    savedScrollRef.current = container instanceof HTMLElement ? container.scrollTop : null
  }, [])

  useLayoutEffect(() => {
    if (!active) {
      savedScrollRef.current = null
      return
    }
    if (savedScrollRef.current === null) return
    const container = document.querySelector(
      '[data-route-shell="admin"][data-route-active="true"] [data-admin-scroll-container]'
    )
    if (container instanceof HTMLElement) container.scrollTop = savedScrollRef.current
    savedScrollRef.current = null
  })

  return saveScroll
}
