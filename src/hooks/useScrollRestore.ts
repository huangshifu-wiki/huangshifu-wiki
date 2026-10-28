import { useCallback, useLayoutEffect, useRef } from 'react'

/**
 * 静默刷新时的滚动位置保持：
 * 发起刷新前调用返回的 saveScroll() 记录后台滚动容器位置，
 * 下一次 React commit（数据落地）后自动恢复，恢复后自清除。
 */
export function useScrollRestore(): () => void {
  const savedScrollRef = useRef<number | null>(null)

  const saveScroll = useCallback(() => {
    const container = document.querySelector('[data-admin-scroll-container]')
    savedScrollRef.current = container instanceof HTMLElement ? container.scrollTop : null
  }, [])

  useLayoutEffect(() => {
    if (savedScrollRef.current === null) return
    const container = document.querySelector('[data-admin-scroll-container]')
    if (container instanceof HTMLElement) container.scrollTop = savedScrollRef.current
    savedScrollRef.current = null
  })

  return saveScroll
}
