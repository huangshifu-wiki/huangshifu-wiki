import { useEffect } from 'react'
import type { RefObject } from 'react'

type ClickOutsideHandler = (event: PointerEvent) => void

export const useClickOutside = (
  ref: RefObject<HTMLElement | null>,
  onClickOutside: ClickOutsideHandler,
  enabled: boolean
) => {
  useEffect(() => {
    if (!enabled) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        onClickOutside(event)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [enabled, onClickOutside, ref])
}

type DismissHandler = () => void

export const useDismissableLayer = (
  ref: RefObject<HTMLElement | null>,
  onDismiss: DismissHandler,
  enabled: boolean
) => {
  useClickOutside(ref, onDismiss, enabled)

  useEffect(() => {
    if (!enabled) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onDismiss()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [enabled, onDismiss])
}
