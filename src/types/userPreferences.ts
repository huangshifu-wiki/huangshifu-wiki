export const VIEW_MODES = ['large', 'medium', 'small', 'list'] as const
export const THEME_MODES = ['default', 'dark', 'system'] as const
export const LIST_LOAD_MODES = ['pagination', 'incremental'] as const
export const VIEW_MODE_SCOPES = ['music', 'events', 'wiki', 'forum', 'gallery'] as const

export type ViewMode = (typeof VIEW_MODES)[number]
export type ThemeMode = (typeof THEME_MODES)[number]
export type ListLoadMode = (typeof LIST_LOAD_MODES)[number]
export type ViewModeScope = (typeof VIEW_MODE_SCOPES)[number]
export type ViewModePreferences = Record<ViewModeScope, ViewMode>

export const DEFAULT_VIEW_MODES: ViewModePreferences = {
  music: 'list',
  events: 'list',
  wiki: 'list',
  forum: 'list',
  gallery: 'medium',
}

export interface UserPreferences {
  /** Legacy/global view mode used by search and old preference payloads. */
  viewMode: ViewMode
  viewModes: ViewModePreferences
  theme: ThemeMode
  listLoadMode: ListLoadMode
  showCharacterCount: boolean
  publicFavorites: boolean
  publicHistory: boolean
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  viewMode: 'medium',
  viewModes: DEFAULT_VIEW_MODES,
  theme: 'system',
  listLoadMode: 'pagination',
  showCharacterCount: false,
  publicFavorites: false,
  publicHistory: false,
}
