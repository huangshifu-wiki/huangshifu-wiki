import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

const STORAGE_PREFIX = 'scrollPos:'
const RESTORE_MAX_POLLS = 30
const RESTORE_POLL_MS = 50

/**
 * 全局滚动位置同步：滚动时实时把当前位置写入 sessionStorage，
 * pathname 变化（含首次挂载/刷新）时恢复该页面上次保存的位置。
 * 存储 key 只含 pathname（不含 search），筛选/分页/排序参数变化不丢位置。
 */
export function ScrollPositionSync(): null {
  const location = useLocation()
  const pathname = location.pathname
  const prevPathnameRef = useRef<string | null>(null)
  const rafRef = useRef<number | null>(null)

  // pathname 变化（含首次挂载/刷新）时，恢复该页面上次保存的滚动位置
  useLayoutEffect(() => {
    const changed = prevPathnameRef.current !== pathname
    prevPathnameRef.current = pathname
    if (!changed) return
    let saved: number
    try {
      saved = Number(sessionStorage.getItem(STORAGE_PREFIX + pathname))
    } catch {
      return
    }
    if (!Number.isFinite(saved) || saved <= 0) return
    let polls = 0
    const interval = window.setInterval(() => {
      polls += 1
      if (document.documentElement.scrollHeight > saved) {
        window.scrollTo(0, saved)
        window.clearInterval(interval)
      } else if (polls >= RESTORE_MAX_POLLS) {
        // 内容迟迟未渲染到可容纳目标位置，放弃恢复（留在顶部）
        window.clearInterval(interval)
      }
    }, RESTORE_POLL_MS)
    return () => window.clearInterval(interval)
  }, [pathname])

  // 滚动时实时保存当前窗口位置（rAF 节流）
  useEffect(() => {
    const saveScroll = () => {
      if (rafRef.current !== null) return
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null
        try {
          sessionStorage.setItem(STORAGE_PREFIX + pathname, String(window.scrollY))
        } catch {
          // sessionStorage 不可用（隐私模式等）时静默
        }
      })
    }
    window.addEventListener('scroll', saveScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', saveScroll)
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [pathname])

  return null
}
