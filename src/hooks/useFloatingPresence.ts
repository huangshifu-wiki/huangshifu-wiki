import { useEffect, useRef, useState } from 'react'

export const FLOATING_TRANSITION_MS = 220

export const useFloatingPresence = (open: boolean, durationMs: number = FLOATING_TRANSITION_MS) => {
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(open)
  const mountedRef = useRef(open)
  const timeoutRef = useRef<number | null>(null)
  const frameRef = useRef<number | null>(null)
  const wasOpenRef = useRef(open)

  useEffect(() => {
    const updateMounted = (nextMounted: boolean) => {
      mountedRef.current = nextMounted
      setMounted(nextMounted)
    }

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
      updateMounted(true)
      if (wasOpenRef.current) {
        setVisible(true)
      } else {
        setVisible(false)
        frameRef.current = window.requestAnimationFrame(() => {
          frameRef.current = window.requestAnimationFrame(() => {
            frameRef.current = null
            setVisible(true)
          })
        })
      }
      wasOpenRef.current = true
      return clearPending
    }

    wasOpenRef.current = false
    setVisible(false)
    if (!mountedRef.current) {
      return clearPending
    }

    timeoutRef.current = window.setTimeout(() => {
      updateMounted(false)
      timeoutRef.current = null
    }, durationMs)

    return clearPending
  }, [durationMs, open])

  return {
    mounted,
    state: visible ? 'open' : 'closed',
  } as const
}
