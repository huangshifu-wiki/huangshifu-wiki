import React, { useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from 'react'
import { Filter } from '@/src/components/icons'
import { Button, cn } from '@/src/components/ui'
import { useDismissableLayer } from '../hooks/useClickOutside'
import { useFloatingPresence } from '../hooks/useFloatingPresence'
import { TagFilterPanel, type TagFilterPanelProps } from './TagFilterPanel'

interface MobileTagFiltersProps extends TagFilterPanelProps {
  scopeKey: string
}

export const MobileTagFilters = React.forwardRef<HTMLDivElement, MobileTagFiltersProps>(
  ({ scopeKey, tags, value, onToggleTag, onModeChange, onClear, className, ...props }, ref) => {
    const [open, setOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)
    const panelRef = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)
    const panelId = useId()
    const presence = useFloatingPresence(open, 180)
    useImperativeHandle(ref, () => rootRef.current!)

    const close = useCallback(() => {
      if (panelRef.current?.contains(document.activeElement)) buttonRef.current?.focus()
      setOpen(false)
    }, [])
    useDismissableLayer(rootRef, close, open)
    useEffect(close, [scopeKey, close])

    return (
      <div ref={rootRef} className={cn('contents md:hidden', className)} {...props}>
        <Button
          ref={buttonRef}
          type="button"
          variant="secondary"
          size="sm"
          className="col-start-2 row-start-1 self-start"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => (open ? close() : setOpen(true))}
        >
          <Filter size={16} aria-hidden="true" />
          筛选
        </Button>
        {presence.mounted && (
          <div
            ref={panelRef}
            id={panelId}
            className="floating-expand col-span-2 grid min-w-0"
            data-state={presence.state}
            aria-hidden={!open}
            inert={!open}
          >
            <div className="min-h-0 overflow-hidden">
              <TagFilterPanel
                tags={tags}
                value={value}
                onToggleTag={onToggleTag}
                onModeChange={onModeChange}
                onClear={onClear}
                className="mt-3 border-y border-[var(--book-ink-line)]"
              />
            </div>
          </div>
        )}
      </div>
    )
  }
)
MobileTagFilters.displayName = 'MobileTagFilters'
