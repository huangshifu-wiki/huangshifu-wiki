import { useRef, useState } from 'react'
import type { FocusEvent } from 'react'
import { Copy, MoreVertical } from '@/src/components/icons'
import { clsx } from 'clsx'
import { useDismissableLayer } from '../hooks/useClickOutside'
import { Button, IconButton } from '@/src/components/ui'

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
      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((current) => !current)}
        aria-label={menuLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className={clsx(
          'h-7 w-7 text-text-muted',
          'hover:border-[var(--book-ink-line)] hover:bg-[var(--book-panel-bg)] hover:text-brand-gold focus-visible:border-brand-gold focus-visible:outline-none',
          open && 'border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] text-brand-gold'
        )}
      >
        <MoreVertical size={14} />
      </IconButton>

      <div
        role="menu"
        aria-hidden={!open}
        className={clsx(
          'absolute right-0 top-full z-30 mt-1 min-w-32 rounded border border-[var(--book-ink-line)] bg-[var(--book-panel-bg-strong)] p-1 shadow-[var(--book-panel-shadow)] backdrop-blur-[12px] transition-all',
          open
            ? 'visible translate-y-0 opacity-100'
            : 'invisible -translate-y-1 opacity-0 pointer-events-none'
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          role="menuitem"
          tabIndex={open ? 0 : -1}
          onClick={() => void handleCopy()}
          className="w-full justify-start px-2.5"
          leftIcon={<Copy size={12} />}
        >
          {copyLabel}
        </Button>
      </div>
    </div>
  )
}
