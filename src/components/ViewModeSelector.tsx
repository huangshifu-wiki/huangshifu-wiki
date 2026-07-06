import React from 'react'
import { LayoutGrid, Grid3X3, Grid2x2, List } from '@/src/components/icons'
import { clsx } from 'clsx'
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
  large: <LayoutGrid size={20} />,
  medium: <Grid3X3 size={17} />,
  small: <Grid2x2 size={14} />,
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
    <div
      className={clsx(
        'inline-flex shrink-0 border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] rounded p-0.5 shadow-[0_8px_22px_rgba(72,53,25,0.06)]',
        size === 'sm' ? 'gap-0.5' : 'gap-1'
      )}
    >
      {modes.map((mode) => {
        const label = VIEW_MODE_LABELS[mode]
        return (
          <button
            key={mode}
            onClick={() => onChange(mode)}
            aria-label={label}
            className={clsx(
              'min-h-9 min-w-9 rounded transition-all inline-flex items-center justify-center gap-1.5 font-medium',
              size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-1.5 text-sm',
              value === mode
                ? 'bg-[var(--color-theme-accent)] text-white'
                : 'text-text-muted hover:bg-[var(--book-panel-hover)] hover:text-text-secondary'
            )}
            title={label}
          >
            {VIEW_MODE_ICONS[mode]}
            {showLabels && <span className="hidden sm:inline">{label}</span>}
          </button>
        )
      })}
    </div>
  )
}
