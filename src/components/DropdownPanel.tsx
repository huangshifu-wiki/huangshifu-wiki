import type { ReactNode } from 'react'

interface DropdownPanelProps {
  open: boolean
  className: string
  children: ReactNode
}

export const DropdownPanel = ({ open, className, children }: DropdownPanelProps) => {
  return (
    <div
      className={`floating-dropdown ${className}`}
      data-state={open ? 'open' : 'closed'}
      aria-hidden={!open}
    >
      {children}
    </div>
  )
}
