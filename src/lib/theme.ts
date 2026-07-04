import {
  DEFAULT_PREFERENCES,
  LIST_LOAD_MODES,
  THEME_MODES,
  VIEW_MODES,
  type ListLoadMode,
  type ThemeMode,
  type UserPreferences,
  type ViewMode,
} from '../types/userPreferences'
import { readBootstrapAuthUid } from './auth'
import { THEME_META_COLOR } from './colorTokens'

export type ResolvedTheme = 'default' | 'dark'

export const THEME_STORAGE_KEY = 'user_preferences'

type ThemeStorageState = {
  guest?: Partial<UserPreferences>
  legacy?: Partial<UserPreferences>
  users: Record<string, Partial<UserPreferences>>
}

function isOneOf<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && values.includes(value)
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return isOneOf(THEME_MODES, value)
}

export function normalizeThemeMode(value: unknown): ThemeMode {
  if (isThemeMode(value)) {
    return value
  }

  return 'system'
}

export function isViewMode(value: unknown): value is ViewMode {
  return isOneOf(VIEW_MODES, value)
}

export function normalizeViewMode(value: unknown): ViewMode {
  if (isViewMode(value)) {
    return value
  }

  return DEFAULT_PREFERENCES.viewMode
}

export function isListLoadMode(value: unknown): value is ListLoadMode {
  return isOneOf(LIST_LOAD_MODES, value)
}

export function normalizeListLoadMode(value: unknown): ListLoadMode {
  if (isListLoadMode(value)) {
    return value
  }

  return DEFAULT_PREFERENCES.listLoadMode
}

export function isBooleanPreference(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

export function normalizeStoredPreferences(
  value?: Partial<UserPreferences> | Record<string, unknown> | null
): UserPreferences {
  return {
    ...DEFAULT_PREFERENCES,
    viewMode: normalizeViewMode(value?.viewMode),
    theme: normalizeThemeMode(value?.theme),
    listLoadMode: normalizeListLoadMode(value?.listLoadMode),
    showCharacterCount: isBooleanPreference(value?.showCharacterCount)
      ? value.showCharacterCount
      : DEFAULT_PREFERENCES.showCharacterCount,
    publicFavorites: isBooleanPreference(value?.publicFavorites)
      ? value.publicFavorites
      : DEFAULT_PREFERENCES.publicFavorites,
    publicHistory: isBooleanPreference(value?.publicHistory)
      ? value.publicHistory
      : DEFAULT_PREFERENCES.publicHistory,
  }
}

export function hasStoredPreferenceValues(
  value?: Partial<UserPreferences> | Record<string, unknown> | null
): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }

  return (
    isViewMode(value.viewMode) ||
    isThemeMode(value.theme) ||
    isListLoadMode(value.listLoadMode) ||
    isBooleanPreference(value.showCharacterCount) ||
    isBooleanPreference(value.publicFavorites) ||
    isBooleanPreference(value.publicHistory)
  )
}

export function mergeStoredPreferences(
  base: Partial<UserPreferences>,
  value?: Partial<UserPreferences> | Record<string, unknown> | null
): UserPreferences {
  const normalizedBase = normalizeStoredPreferences(base)
  if (!value || typeof value !== 'object') {
    return normalizedBase
  }

  return {
    viewMode: isViewMode(value.viewMode) ? value.viewMode : normalizedBase.viewMode,
    theme: isThemeMode(value.theme) ? value.theme : normalizedBase.theme,
    listLoadMode: isListLoadMode(value.listLoadMode)
      ? value.listLoadMode
      : normalizedBase.listLoadMode,
    showCharacterCount: isBooleanPreference(value.showCharacterCount)
      ? value.showCharacterCount
      : normalizedBase.showCharacterCount,
    publicFavorites: isBooleanPreference(value.publicFavorites)
      ? value.publicFavorites
      : normalizedBase.publicFavorites,
    publicHistory: isBooleanPreference(value.publicHistory)
      ? value.publicHistory
      : normalizedBase.publicHistory,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readThemeStorageState(): ThemeStorageState {
  if (typeof window === 'undefined') {
    return { users: {} }
  }

  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (!raw) {
      return { users: {} }
    }

    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) {
      return { users: {} }
    }

    const users: Record<string, Partial<UserPreferences>> = isRecord(parsed.users)
      ? Object.fromEntries(Object.entries(parsed.users).filter(([, value]) => isRecord(value)))
      : {}

    if (isRecord(parsed.guest)) {
      return {
        guest: parsed.guest,
        users,
      }
    }

    if (!('guest' in parsed) && !('users' in parsed)) {
      return {
        legacy: parsed,
        users,
      }
    }

    return { users }
  } catch {
    return { users: {} }
  }
}

function writeThemeStorageState(state: ThemeStorageState): void {
  if (typeof window === 'undefined') {
    return
  }

  const nextState: { guest?: UserPreferences; users: Record<string, UserPreferences> } = {
    users: Object.fromEntries(
      Object.entries(state.users).map(([uid, preferences]) => [
        uid,
        normalizeStoredPreferences(preferences),
      ])
    ),
  }

  const guestSource = state.guest ?? state.legacy
  if (guestSource) {
    nextState.guest = normalizeStoredPreferences(guestSource)
  }

  window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(nextState))
}

function resolveStoredPreferences(
  state: ThemeStorageState,
  uid?: string | null,
  options?: { includeLegacyFallback?: boolean }
): Partial<UserPreferences> | undefined {
  if (uid) {
    return state.users[uid] ?? (options?.includeLegacyFallback ? state.legacy : undefined)
  }

  return state.guest ?? state.legacy
}

export function getSystemResolvedTheme(): ResolvedTheme {
  if (typeof window === 'undefined') {
    return 'default'
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default'
}

export function resolveThemeMode(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') {
    return getSystemResolvedTheme()
  }

  return mode
}

export function readBootstrapThemeMode(): ThemeMode {
  if (typeof window === 'undefined') {
    return DEFAULT_PREFERENCES.theme
  }

  const bootstrapUid = readBootstrapAuthUid()
  return readStoredPreferences(bootstrapUid, { includeLegacyFallback: true }).theme
}

export function readStoredPreferences(
  uid?: string | null,
  options?: { includeLegacyFallback?: boolean }
): UserPreferences {
  if (typeof window === 'undefined') {
    return DEFAULT_PREFERENCES
  }

  try {
    const state = readThemeStorageState()
    return normalizeStoredPreferences(resolveStoredPreferences(state, uid, options))
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function writeStoredPreferences(
  preferences: Partial<UserPreferences>,
  uid?: string | null
): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const state = readThemeStorageState()
    const normalized = normalizeStoredPreferences(preferences)

    if (uid) {
      state.users[uid] = normalized
    } else {
      state.guest = normalized
    }

    writeThemeStorageState(state)
  } catch {
    // ignore storage failures
  }
}

export function applyResolvedTheme(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') {
    return
  }

  const root = document.documentElement
  const meta = document.querySelector('meta[name="theme-color"]')
  const colorScheme = theme === 'dark' ? 'dark' : 'light'
  const metaColor = THEME_META_COLOR[theme]

  if (
    root.getAttribute('data-theme') === theme &&
    root.style.colorScheme === colorScheme &&
    (!meta || meta.getAttribute('content') === metaColor)
  ) {
    return
  }

  root.setAttribute('data-theme', theme)
  root.style.colorScheme = colorScheme

  if (meta) {
    meta.setAttribute('content', metaColor)
  }
}
