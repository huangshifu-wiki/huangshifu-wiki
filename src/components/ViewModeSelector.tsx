import React from 'react'
import { Grid2x2, Grid3X3, Grid3x2, List } from '@/src/components/icons'
import { clsx } from 'clsx'
import { Button } from '@/src/components/ui'
import { VIEW_MODE_LABELS } from '../lib/viewModes'
import type { ViewMode } from '../types/userPreferences'

interface ViewModeSelectorProps {
  value: ViewMode
  onChange: (mode: ViewMode) => void
  size?: 'sm' | 'md'
  modes?: readonly ViewMode[]
}

const DEFAULT_VIEW_MODE_OPTIONS: readonly ViewMode[] = ['large', 'medium', 'small', 'list']

const VIEW_MODE_ICONS: Record<ViewMode, React.ReactNode> = {
  large: <Grid2x2 size={16} />,
  medium: <Grid3x2 size={16} />,
  small: <Grid3X3 size={16} />,
  list: <List size={16} />,
}

export const ViewModeSelector: React.FC<ViewModeSelectorProps> = ({
  value,
  onChange,
  size = 'md',
  modes = DEFAULT_VIEW_MODE_OPTIONS,
}) => {
  const showLabels = size === 'md'

  return (
    <div className="inline-flex shrink-0 overflow-hidden rounded border border-[var(--book-ink-line)]">
      {modes.map((mode) => {
        const label = VIEW_MODE_LABELS[mode]
        return (
          <Button
            key={mode}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(mode)}
            aria-label={label}
            aria-pressed={value === mode}
            className={clsx(
              'min-h-0 rounded-none border-0',
              size === 'sm' ? 'p-1.5' : 'px-3 py-1.5',
              value === mode
                ? 'bg-brand-gold text-white'
                : 'bg-[var(--book-panel-bg)] text-text-muted hover:bg-[var(--book-panel-hover)] hover:text-text-secondary'
            )}
            title={label}
          >
            {VIEW_MODE_ICONS[mode]}
            {showLabels && <span className="ml-1.5 hidden sm:inline">{label}</span>}
          </Button>
        )
      })}
    </div>
  )
}
