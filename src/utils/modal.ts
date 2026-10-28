import type { MouseEvent } from 'react'

export function isBackdropClick<T extends HTMLElement>(event: MouseEvent<T>): boolean {
  return event.target === event.currentTarget
}
