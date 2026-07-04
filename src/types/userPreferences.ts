export const VIEW_MODES = ['large', 'medium', 'small', 'list'] as const
export const THEME_MODES = ['default', 'dark', 'system'] as const
export const LIST_LOAD_MODES = ['pagination', 'incremental'] as const

export type ViewMode = (typeof VIEW_MODES)[number]
export type ThemeMode = (typeof THEME_MODES)[number]
export type ListLoadMode = (typeof LIST_LOAD_MODES)[number]

export interface UserPreferences {
  viewMode: ViewMode
  theme: ThemeMode
  listLoadMode: ListLoadMode
  showCharacterCount: boolean
  publicFavorites: boolean
  publicHistory: boolean
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  viewMode: 'medium',
  theme: 'system',
  listLoadMode: 'pagination',
  showCharacterCount: false,
  publicFavorites: false,
  publicHistory: false,
}
