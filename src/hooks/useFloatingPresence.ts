import { useEffect, useRef, useState } from 'react'

export const FLOATING_TRANSITION_MS = 220

/** 浮层受控挂载状态：mounted 期间宿主可保持磨砂等样式，state 直接驱动 data-state */
export interface FloatingPresence {
  mounted: boolean
  state: 'open' | 'closed'
}

/**
 * 浮层受控挂载：open 翻转的同一渲染里切换 data-state，让 CSS 过渡立即从当前计算值
 * 反向（连续快速点击时不会出现"点了没反应"的空转渲染）；关闭动画结束后才卸载。
 *
 * - mounted：关闭动画期间保持挂载，供磨砂背景等宿主样式延续
 * - state：'open' | 'closed'，直接驱动 data-state
 */
export const useFloatingPresence = (
  open: boolean,
  durationMs: number = FLOATING_TRANSITION_MS
): FloatingPresence => {
  // exited：卸载完成；entered：入场预热完成（浏览器已绘制过收起态，可以安全触发过渡）
  const [exited, setExited] = useState(!open)
  const [entered, setEntered] = useState(open)
  const exitedRef = useRef(!open)
  const enteredRef = useRef(open)
  const timeoutRef = useRef<number | null>(null)
  const frameRef = useRef<number | null>(null)

  // 渲染期派生：收起与"关闭途中重开"在当次渲染即翻转 data-state，过渡平滑反向
  const mounted = open || !exited
  const visible = open && entered

  useEffect(() => {
    const clearPending = () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }

    clearPending()

    if (open) {
      if (exitedRef.current) {
        // 重新挂载：重置卸载标记，本渲染已以收起态挂载
        exitedRef.current = false
        setExited(false)
      }
      if (!enteredRef.current) {
        // 新挂载（或预热被取消后重开）：等两帧让浏览器先绘制收起态，再进入展开态
        frameRef.current = window.requestAnimationFrame(() => {
          frameRef.current = window.requestAnimationFrame(() => {
            frameRef.current = null
            enteredRef.current = true
            setEntered(true)
          })
        })
      }
      return clearPending
    }

    if (!exitedRef.current) {
      // 收起过渡结束后卸载，并重置入场标记供下次全新打开
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null
        exitedRef.current = true
        enteredRef.current = false
        setExited(true)
        setEntered(false)
      }, durationMs)
    }

    return clearPending
  }, [durationMs, open])

  return {
    mounted,
    state: visible ? 'open' : 'closed',
  }
}
