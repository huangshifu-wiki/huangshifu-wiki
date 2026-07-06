// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import {
  UserPreferencesProvider,
  useUserPreferences,
} from '../../src/context/UserPreferencesContext'
import { THEME_STORAGE_KEY, readStoredPreferences } from '../../src/lib/theme'
import { DEFAULT_PREFERENCES } from '../../src/types/userPreferences'

const mockApiGet = vi.hoisted(() => vi.fn())
const mockApiPatch = vi.hoisted(() => vi.fn())
const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
  apiPatch: mockApiPatch,
}))

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

function PreferenceProbe() {
  const { preferences, resolvedTheme, loading, getScopedViewMode } = useUserPreferences()

  if (loading) {
    return <div>loading</div>
  }

  return (
    <div>
      <span data-testid="view-mode">{preferences.viewMode}</span>
      <span data-testid="music-view-mode">{getScopedViewMode('music')}</span>
      <span data-testid="gallery-view-mode">{getScopedViewMode('gallery')}</span>
      <span data-testid="theme-mode">{preferences.theme}</span>
      <span data-testid="resolved-theme">{resolvedTheme}</span>
    </div>
  )
}

describe('UserPreferencesProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.colorScheme = ''
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    )

    let meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      document.head.appendChild(meta)
    }
    meta.setAttribute('content', '#FFD700')
  })

  afterEach(() => {
    cleanup()
  })

  it('falls back to stored preferences when authenticated user has no server preferences', async () => {
    window.localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({
        guest: {
          viewMode: 'small',
          theme: 'dark',
        },
        users: {
          'user-1': {
            viewMode: 'small',
            theme: 'dark',
          },
        },
      })
    )

    mockUseAuth.mockReturnValue({
      user: { uid: 'user-1' },
      loading: false,
    })
    mockApiGet.mockResolvedValue({
      user: {
        uid: 'user-1',
        nickname: 'Tester',
        role: 'user',
        status: 'active',
        preferences: {},
      },
    })

    render(
      <UserPreferencesProvider>
        <PreferenceProbe />
      </UserPreferencesProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('view-mode')).toHaveTextContent('small')
    })

    expect(screen.getByTestId('theme-mode')).toHaveTextContent('dark')
    expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('merges partial server preferences with stored preferences for authenticated users', async () => {
    window.localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({
        guest: {
          viewMode: 'large',
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

    mockUseAuth.mockReturnValue({
      user: { uid: 'user-1' },
      loading: false,
    })
    mockApiGet.mockResolvedValue({
      user: {
        uid: 'user-1',
        nickname: 'Tester',
        role: 'user',
        status: 'active',
        preferences: {
          theme: 'default',
        },
      },
    })

    render(
      <UserPreferencesProvider>
        <PreferenceProbe />
      </UserPreferencesProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('view-mode')).toHaveTextContent('small')
    })

    expect(screen.getByTestId('theme-mode')).toHaveTextContent('default')
    expect(screen.getByTestId('resolved-theme')).toHaveTextContent('default')
    expect(document.documentElement.getAttribute('data-theme')).toBe('default')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('does not inherit guest preferences for a different authenticated user', async () => {
    window.localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({
        guest: {
          viewMode: 'small',
          theme: 'dark',
        },
        users: {},
      })
    )

    mockUseAuth.mockReturnValue({
      user: { uid: 'user-2' },
      loading: false,
    })
    mockApiGet.mockResolvedValue({
      user: {
        uid: 'user-2',
        nickname: 'Tester',
        role: 'user',
        status: 'active',
        preferences: {},
      },
    })

    render(
      <UserPreferencesProvider>
        <PreferenceProbe />
      </UserPreferencesProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('view-mode')).toHaveTextContent('medium')
    })

    expect(screen.getByTestId('theme-mode')).toHaveTextContent('system')
    expect(screen.getByTestId('resolved-theme')).toHaveTextContent('default')
    expect(readStoredPreferences('user-2')).toEqual({
      viewMode: 'medium',
      viewModes: DEFAULT_PREFERENCES.viewModes,
      theme: 'system',
      listLoadMode: 'pagination',
      showCharacterCount: false,
      publicFavorites: false,
      publicHistory: false,
    })
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

  it('preserves legacy flat preferences for authenticated users during migration', async () => {
    window.localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({
        viewMode: 'small',
        theme: 'dark',
      })
    )

    mockUseAuth.mockReturnValue({
      user: { uid: 'user-3' },
      loading: false,
    })
    mockApiGet.mockResolvedValue({
      user: {
        uid: 'user-3',
        nickname: 'Tester',
        role: 'user',
        status: 'active',
        preferences: {},
      },
    })

    render(
      <UserPreferencesProvider>
        <PreferenceProbe />
      </UserPreferencesProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('view-mode')).toHaveTextContent('small')
    })

    expect(screen.getByTestId('theme-mode')).toHaveTextContent('dark')
    expect(readStoredPreferences('user-3')).toEqual({
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

  it('uses channel-specific default view modes for new users', async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
    })

    render(
      <UserPreferencesProvider>
        <PreferenceProbe />
      </UserPreferencesProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('music-view-mode')).toHaveTextContent('list')
    })

    expect(screen.getByTestId('gallery-view-mode')).toHaveTextContent('medium')
  })
})
