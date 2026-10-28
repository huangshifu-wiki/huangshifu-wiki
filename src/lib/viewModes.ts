import type { ViewMode } from '../types/userPreferences'

export interface ViewModeConfig {
  gridCols: string
  cardHeight: string
  gap: string
}

export const VIEW_MODE_CONFIG: Record<ViewMode, ViewModeConfig> = {
  large: {
    gridCols: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    cardHeight: 'h-[300px] sm:h-[360px]',
    gap: 'gap-4 sm:gap-6',
  },
  medium: {
    gridCols: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
    cardHeight: 'h-[220px] sm:h-[280px]',
    gap: 'gap-3 sm:gap-4',
  },
  small: {
    gridCols: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6',
    cardHeight: 'h-[180px] sm:h-[200px]',
    gap: 'gap-3',
  },
  list: {
    gridCols: 'grid-cols-1',
    cardHeight: 'h-auto',
    gap: 'gap-2',
  },
}

export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  large: '舒适',
  medium: '标准',
  small: '紧凑',
  list: '列表',
}
