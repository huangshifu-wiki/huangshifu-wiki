import React from 'react';
import { LayoutGrid, Grid3X3, Grid2x2, List } from 'lucide-react';
import { clsx } from 'clsx';
import { ViewMode } from '../types/userPreferences';
import { VIEW_MODE_LABELS } from '../lib/viewModes';

interface ViewModeSelectorProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  size?: 'sm' | 'md';
}

const VIEW_MODE_ICONS: Record<ViewMode, React.ReactNode> = {
  large: <LayoutGrid size={18} />,
  medium: <Grid3X3 size={18} />,
  small: <Grid2x2 size={18} />,
  list: <List size={18} />,
};

export const ViewModeSelector: React.FC<ViewModeSelectorProps> = ({ value, onChange, size = 'md' }) => {
  const modes: ViewMode[] = ['large', 'medium', 'small', 'list'];
  const showLabels = size === 'md';

  return (
    <div className={clsx(
      'inline-flex border border-[#e0dcd3] bg-white rounded p-0.5',
      size === 'sm' ? 'gap-0.5' : 'gap-1'
    )}>
      {modes.map((mode) => (
        <button
          key={mode}
          onClick={() => onChange(mode)}
          aria-label={VIEW_MODE_LABELS[mode]}
          className={clsx(
            'rounded transition-all inline-flex items-center gap-1.5 font-medium',
            size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-1.5 text-sm',
            value === mode
              ? 'bg-[#c8951e] text-white'
              : 'text-[#9e968e] hover:text-[#6b6560]'
          )}
          title={VIEW_MODE_LABELS[mode]}
        >
          {VIEW_MODE_ICONS[mode]}
          {showLabels && <span className="hidden sm:inline">{VIEW_MODE_LABELS[mode]}</span>}
        </button>
      ))}
    </div>
  );
};
