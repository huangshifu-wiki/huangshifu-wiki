// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  applyFontPreference,
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

const bootstrapHtml = readFileSync('index.html', 'utf8')

describe('theme helpers', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-font')
    document.documentElement.style.colorScheme = ''
    let meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      document.head.appendChild(meta)
    }
    meta.setAttribute('content', '#FFD700')
  })

  afterEach(() => {
    document.documentElement.removeAttribute('data-font')
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
    ).toMatchObject({
      viewMode: 'large',
      viewModes: DEFAULT_PREFERENCES.viewModes,
      theme: 'dark',
      showCharacterCount: true,
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
    ).toMatchObject({
      viewMode: 'small',
      viewModes: {
        ...DEFAULT_PREFERENCES.viewModes,
        gallery: 'small',
      },
      theme: 'default',
      showCharacterCount: true,
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

    expect(JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY) || '{}')).toMatchObject({
      guest: {
        viewMode: 'small',
        viewModes: {
          ...DEFAULT_PREFERENCES.viewModes,
          gallery: 'small',
        },
        theme: 'dark',
        showCharacterCount: true,
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
    expect(readStoredPreferences('user-1')).toMatchObject({
      viewMode: 'list',
      viewModes: {
        ...DEFAULT_PREFERENCES.viewModes,
        gallery: 'list',
      },
      theme: 'default',
      showCharacterCount: true,
    })
    expect(JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY) || '{}')).toMatchObject({
      users: {
        'user-1': {
          viewMode: 'list',
          viewModes: {
            ...DEFAULT_PREFERENCES.viewModes,
            gallery: 'list',
          },
          theme: 'default',
          showCharacterCount: true,
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

    expect(readStoredPreferences()).toMatchObject({
      viewMode: 'small',
      viewModes: {
        ...DEFAULT_PREFERENCES.viewModes,
        gallery: 'small',
      },
      theme: 'dark',
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

    expect(readStoredPreferences('user-1', { includeLegacyFallback: true })).toMatchObject({
      viewMode: 'small',
      viewModes: {
        ...DEFAULT_PREFERENCES.viewModes,
        gallery: 'small',
      },
      theme: 'dark',
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

  it.each([
    { input: { useSpecialFonts: false }, normalized: false, merged: false, valid: true },
    { input: { useSpecialFonts: true }, normalized: true, merged: true, valid: true },
    { input: {}, normalized: true, merged: false, valid: false },
    { input: { useSpecialFonts: 'false' }, normalized: true, merged: false, valid: false },
  ])('保留合法字体偏好并忽略非法值：$input', ({ input, normalized, merged, valid }) => {
    expect(normalizeStoredPreferences(input).useSpecialFonts).toBe(normalized)
    expect(mergeStoredPreferences({ useSpecialFonts: false }, input).useSpecialFonts).toBe(merged)
    expect(hasStoredPreferenceValues(input)).toBe(valid)
  })

  it('隔离访客和各账号的字体偏好并保留后续更新', () => {
    writeStoredPreferences({ useSpecialFonts: true })
    writeStoredPreferences({ useSpecialFonts: false }, 'font-user-a')
    expect(readStoredPreferences().useSpecialFonts).toBe(true)
    expect(readStoredPreferences('font-user-a').useSpecialFonts).toBe(false)
    expect(readStoredPreferences('font-user-b').useSpecialFonts).toBe(true)

    writeStoredPreferences(
      mergeStoredPreferences(readStoredPreferences('font-user-a'), { theme: 'dark' }),
      'font-user-a'
    )
    expect(readStoredPreferences('font-user-a')).toMatchObject({
      useSpecialFonts: false,
      theme: 'dark',
    })
    expect(readStoredPreferences().useSpecialFonts).toBe(true)
  })

  it.each([
    {
      name: '访客关闭',
      uid: null,
      stored: JSON.stringify({ guest: { useSpecialFonts: false }, users: {} }),
      expected: 'system',
    },
    {
      name: '账号覆盖访客',
      uid: 'font-user-a',
      stored: JSON.stringify({
        guest: { useSpecialFonts: true },
        users: { 'font-user-a': { useSpecialFonts: false } },
      }),
      expected: 'system',
    },
    {
      name: '账号缺省',
      uid: 'font-user-a',
      stored: JSON.stringify({
        guest: { useSpecialFonts: false },
        users: { 'font-user-a': {} },
      }),
      expected: 'special',
    },
    {
      name: '旧版偏好',
      uid: null,
      stored: JSON.stringify({ useSpecialFonts: false }),
      expected: 'system',
    },
    { name: '损坏存储', uid: null, stored: '{', expected: undefined },
  ])('首帧应用真实启动脚本的字体偏好：$name', ({ uid, stored, expected }) => {
    const dom = new JSDOM(bootstrapHtml, {
      url: 'http://localhost',
      runScripts: 'outside-only',
    })
    try {
      Object.assign(dom.window, { __HSF_BOOTSTRAP_AUTH_UID__: uid })
      dom.window.localStorage.setItem(THEME_STORAGE_KEY, stored)
      const script = dom.window.document.head.querySelectorAll('script')[1]
      dom.window.eval(script.textContent!)
      expect(dom.window.document.documentElement.dataset.font).toBe(expected)
    } finally {
      dom.window.close()
    }
  })

  it('关闭特殊字体后可以恢复', () => {
    applyFontPreference(false)
    expect(document.documentElement.dataset.font).toBe('system')
    applyFontPreference(true)
    expect(document.documentElement.dataset.font).toBe('special')
  })
})
