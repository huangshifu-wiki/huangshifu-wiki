// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  hasStoredPreferenceValues,
  mergeStoredPreferences,
  normalizeThemeMode,
  normalizeStoredPreferences,
  readBootstrapThemeMode,
  resolveThemeMode,
  applyResolvedTheme,
  readStoredPreferences,
  writeStoredPreferences,
  THEME_STORAGE_KEY,
} from '../../src/lib/theme'
import { DEFAULT_PREFERENCES } from '../../src/types/userPreferences'

describe('theme helpers', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.colorScheme = ''
    let meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      document.head.appendChild(meta)
    }
    meta.setAttribute('content', '#FFD700')
  })

  it('normalizes unsupported theme values to system', () => {
    expect(normalizeThemeMode('sepia')).toBe('system')
    expect(normalizeThemeMode('dark')).toBe('dark')
  })

  it('reads stored theme mode from user preferences payload', () => {
    window.localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({
        guest: {
          viewMode: 'medium',
          theme: 'dark',
        },
        users: {},
      })
    )

    expect(readStoredPreferences().theme).toBe('dark')
  })

  it('normalizes stored preferences and ignores unsupported values', () => {
    window.localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({
        viewMode: 'cinema',
        theme: 'sepia',
        extra: 'ignored',
      })
    )

    expect(readStoredPreferences()).toEqual(DEFAULT_PREFERENCES)
    expect(
      normalizeStoredPreferences({
        viewMode: 'large',
        viewModes: DEFAULT_PREFERENCES.viewModes,
        theme: 'dark',
        showCharacterCount: true,
        extra: 'ignored',
      } as Record<string, unknown>)
    ).toEqual({
      viewMode: 'large',
      viewModes: DEFAULT_PREFERENCES.viewModes,
      theme: 'dark',
      listLoadMode: 'pagination',
      showCharacterCount: true,
      publicFavorites: false,
      publicHistory: false,
    })
  })

  it('detects whether stored preferences contain supported values', () => {
    expect(hasStoredPreferenceValues(undefined)).toBe(false)
    expect(hasStoredPreferenceValues({})).toBe(false)
    expect(hasStoredPreferenceValues({ theme: 'dark' })).toBe(true)
    expect(hasStoredPreferenceValues({ viewMode: 'small' })).toBe(true)
    expect(hasStoredPreferenceValues({ viewModes: { music: 'large' } })).toBe(true)
    expect(hasStoredPreferenceValues({ listLoadMode: 'incremental' })).toBe(true)
    expect(hasStoredPreferenceValues({ showCharacterCount: false })).toBe(true)
    expect(hasStoredPreferenceValues({ publicFavorites: false })).toBe(true)
    expect(hasStoredPreferenceValues({ theme: 'sepia' })).toBe(false)
  })

  it('merges stored preferences onto an existing base without resetting missing fields', () => {
    expect(
      mergeStoredPreferences(
        {
          viewMode: 'small',
          theme: 'dark',
          showCharacterCount: true,
        },
        {
          theme: 'default',
        }
      )
    ).toEqual({
      viewMode: 'small',
      viewModes: {
        ...DEFAULT_PREFERENCES.viewModes,
        gallery: 'small',
      },
      theme: 'default',
      listLoadMode: 'pagination',
      showCharacterCount: true,
      publicFavorites: false,
      publicHistory: false,
    })
  })

  it('ignores unsupported scoped view modes without resetting existing scoped values', () => {
    expect(
      mergeStoredPreferences(
        {
          viewMode: 'medium',
          viewModes: {
            ...DEFAULT_PREFERENCES.viewModes,
            music: 'large',
          },
        },
        {
          viewModes: {
            music: 'cinema',
            wiki: 'small',
          },
        } as Record<string, unknown>
      ).viewModes
    ).toEqual({
      ...DEFAULT_PREFERENCES.viewModes,
      music: 'large',
      wiki: 'small',
    })
  })

  it('writes only normalized user preference fields', () => {
    writeStoredPreferences({
      viewMode: 'small',
      viewModes: {
        ...DEFAULT_PREFERENCES.viewModes,
        gallery: 'small',
      },
      theme: 'dark',
      showCharacterCount: true,
    })

    expect(JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY) || '{}')).toEqual({
      guest: {
        viewMode: 'small',
        viewModes: {
          ...DEFAULT_PREFERENCES.viewModes,
          gallery: 'small',
        },
        theme: 'dark',
        listLoadMode: 'pagination',
        showCharacterCount: true,
        publicFavorites: false,
        publicHistory: false,
      },
      users: {},
    })
  })

  it('stores user-scoped preferences without affecting guest preferences', () => {
    writeStoredPreferences(
      {
        viewMode: 'list',
        theme: 'default',
        showCharacterCount: true,
      },
      'user-1'
    )

    expect(readStoredPreferences()).toEqual(DEFAULT_PREFERENCES)
    expect(readStoredPreferences('user-1')).toEqual({
      viewMode: 'list',
      viewModes: {
        ...DEFAULT_PREFERENCES.viewModes,
        gallery: 'list',
      },
      theme: 'default',
      listLoadMode: 'pagination',
      showCharacterCount: true,
      publicFavorites: false,
      publicHistory: false,
    })
    expect(JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY) || '{}')).toEqual({
      users: {
        'user-1': {
          viewMode: 'list',
          viewModes: {
            ...DEFAULT_PREFERENCES.viewModes,
            gallery: 'list',
          },
          theme: 'default',
          listLoadMode: 'pagination',
          showCharacterCount: true,
          publicFavorites: false,
          publicHistory: false,
        },
      },
    })
  })

  it('reads legacy flat storage as guest preferences', () => {
    window.localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({
        viewMode: 'small',
        theme: 'dark',
      })
    )

    expect(readStoredPreferences()).toEqual({
      viewMode: 'small',
      viewModes: {
        ...DEFAULT_PREFERENCES.viewModes,
        gallery: 'small',
      },
      theme: 'dark',
      listLoadMode: 'pagination',
      showCharacterCount: false,
      publicFavorites: false,
      publicHistory: false,
    })
  })

  it('uses legacy flat storage as authenticated fallback during migration', () => {
    window.localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({
        viewMode: 'small',
        theme: 'dark',
      })
    )

    expect(readStoredPreferences('user-1', { includeLegacyFallback: true })).toEqual({
      viewMode: 'small',
      viewModes: {
        ...DEFAULT_PREFERENCES.viewModes,
        gallery: 'small',
      },
      theme: 'dark',
      listLoadMode: 'pagination',
      showCharacterCount: false,
      publicFavorites: false,
      publicHistory: false,
    })
    expect(readStoredPreferences('user-1')).toEqual(DEFAULT_PREFERENCES)
  })

  it('bootstrap intentionally ignores user-scoped theme and keeps guest theme', () => {
    window.localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({
        guest: {
          viewMode: 'medium',
          theme: 'default',
        },
        users: {
          'user-1': {
            viewMode: 'small',
            theme: 'dark',
          },
        },
      })
    )

    expect(readBootstrapThemeMode()).toBe('default')
  })

  it('uses legacy flat theme as bootstrap fallback during migration', () => {
    window.localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({
        viewMode: 'small',
        theme: 'dark',
      })
    )

    expect(readBootstrapThemeMode()).toBe('dark')
  })

  it('bootstrap intentionally ignores user-scoped theme when guest preferences are absent', () => {
    window.localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({
        users: {
          'user-1': {
            viewMode: 'small',
            theme: 'dark',
          },
        },
      })
    )

    expect(readBootstrapThemeMode()).toBe('system')
  })

  it('resolves system theme using matchMedia', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList)

    expect(resolveThemeMode('system')).toBe('dark')
  })

  it('applies resolved theme to html and theme-color meta', () => {
    applyResolvedTheme('dark')

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      '#1f1a16'
    )
  })

  it('skips duplicate DOM writes when the resolved theme is already applied', () => {
    applyResolvedTheme('dark')

    const rootSetAttributeSpy = vi.spyOn(document.documentElement, 'setAttribute')
    const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement
    const metaSetAttributeSpy = vi.spyOn(meta, 'setAttribute')

    applyResolvedTheme('dark')

    expect(rootSetAttributeSpy).not.toHaveBeenCalled()
    expect(metaSetAttributeSpy).not.toHaveBeenCalled()

    rootSetAttributeSpy.mockRestore()
    metaSetAttributeSpy.mockRestore()
  })
})
