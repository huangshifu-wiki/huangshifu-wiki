import { useRef, useState } from 'react'
import type { FocusEvent } from 'react'
import { Copy, MoreVertical } from '@/src/components/icons'
import { clsx } from 'clsx'
import { useDismissableLayer } from '../hooks/useClickOutside'

interface CommentActionMenuProps {
  alignClassName?: string
  copyLabel: string
  menuLabel: string
  onCopyLink: () => void | Promise<void>
  visibleOnDesktop: boolean
}

export const CommentActionMenu = ({
  alignClassName,
  copyLabel,
  menuLabel,
  onCopyLink,
  visibleOnDesktop,
}: CommentActionMenuProps) => {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const closeMenu = () => setOpen(false)

  useDismissableLayer(menuRef, closeMenu, open)

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget
    if (!nextTarget || !event.currentTarget.contains(nextTarget as Node)) {
      closeMenu()
    }
  }

  const handleCopy = async () => {
    await onCopyLink()
    closeMenu()
  }

  return (
    <div
      ref={menuRef}
      onBlur={handleBlur}
      className={clsx(
        'relative ml-auto transition-opacity duration-150 md:opacity-0 md:focus-within:opacity-100',
        (open || visibleOnDesktop) && 'md:opacity-100',
        alignClassName
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={menuLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className={clsx(
          'inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent text-text-muted transition-colors',
          'hover:border-border hover:bg-surface-alt hover:text-brand-gold focus-visible:border-brand-gold focus-visible:outline-none',
          open && 'border-border bg-surface-alt text-brand-gold'
        )}
      >
        <MoreVertical size={14} />
      </button>

      <div
        role="menu"
        aria-hidden={!open}
        className={clsx(
          'absolute right-0 top-full z-30 mt-1 min-w-32 rounded-md border border-border bg-surface p-1 shadow-lg transition-all',
          open
            ? 'visible translate-y-0 opacity-100'
            : 'invisible -translate-y-1 opacity-0 pointer-events-none'
        )}
      >
        <button
          type="button"
          role="menuitem"
          tabIndex={open ? 0 : -1}
          onClick={() => void handleCopy()}
          className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs font-medium text-text-secondary transition-colors hover:bg-surface-alt hover:text-brand-gold focus-visible:bg-surface-alt focus-visible:text-brand-gold focus-visible:outline-none"
        >
          <Copy size={12} />
          {copyLabel}
        </button>
      </div>
    </div>
  )
}
