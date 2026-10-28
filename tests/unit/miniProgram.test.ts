import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  getMiniProgramLoginPayload,
  clearMiniProgramLoginParams,
  isMiniProgramWebView,
  type MiniProgramLoginPayload,
} from '../../src/lib/miniProgram'

describe('miniProgram', () => {
  const originalWindow = global.window
  const originalNavigator = global.navigator

  beforeEach(() => {
    // Reset window and navigator mocks
    vi.stubGlobal('window', {
      location: {
        search: '',
        href: 'http://localhost:3000/',
      },
      history: {
        replaceState: vi.fn(),
      },
    })
    vi.stubGlobal('navigator', {
      userAgent: '',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('getMiniProgramLoginPayload', () => {
    it('returns null when not in browser environment', () => {
      vi.stubGlobal('window', undefined)
      const result = getMiniProgramLoginPayload()
      expect(result).toBeNull()
    })

    it('returns null when no wx_code param', () => {
      vi.stubGlobal('window', {
        location: {
          search: '?other=value',
        },
      })
      const result = getMiniProgramLoginPayload()
      expect(result).toBeNull()
    })

    it('returns payload when wx_code is present', () => {
      vi.stubGlobal('window', {
        location: {
          search: '?wx_code=abc123',
        },
      })
      const result = getMiniProgramLoginPayload()
      expect(result).toEqual({
        code: 'abc123',
        displayName: undefined,
        photoURL: undefined,
      })
    })

    it('includes display name when provided', () => {
      vi.stubGlobal('window', {
        location: {
          search: '?wx_code=abc123&wx_display_name=TestUser',
        },
      })
      const result = getMiniProgramLoginPayload()
      expect(result).toEqual({
        code: 'abc123',
        displayName: 'TestUser',
        photoURL: undefined,
      })
    })

    it('includes photo URL when provided', () => {
      vi.stubGlobal('window', {
        location: {
          search: '?wx_code=abc123&wx_photo_url=http://example.com/photo.jpg',
        },
      })
      const result = getMiniProgramLoginPayload()
      expect(result).toEqual({
        code: 'abc123',
        displayName: undefined,
        photoURL: 'http://example.com/photo.jpg',
      })
    })

    it('returns all fields when all params provided', () => {
      vi.stubGlobal('window', {
        location: {
          search:
            '?wx_code=abc123&wx_display_name=TestUser&wx_photo_url=http://example.com/photo.jpg',
        },
      })
      const result = getMiniProgramLoginPayload()
      expect(result).toEqual({
        code: 'abc123',
        displayName: 'TestUser',
        photoURL: 'http://example.com/photo.jpg',
      })
    })

    it('trims whitespace from params', () => {
      vi.stubGlobal('window', {
        location: {
          search: '?wx_code=%20abc123%20&wx_display_name=%20TestUser%20',
        },
      })
      const result = getMiniProgramLoginPayload()
      expect(result?.code).toBe('abc123')
      expect(result?.displayName).toBe('TestUser')
    })

    it('returns undefined for empty string params', () => {
      vi.stubGlobal('window', {
        location: {
          search: '?wx_code=abc123&wx_display_name=&wx_photo_url=',
        },
      })
      const result = getMiniProgramLoginPayload()
      expect(result?.displayName).toBeUndefined()
      expect(result?.photoURL).toBeUndefined()
    })
  })

  describe('clearMiniProgramLoginParams', () => {
    it('does nothing when not in browser environment', () => {
      vi.stubGlobal('window', undefined)
      expect(() => clearMiniProgramLoginParams()).not.toThrow()
    })

    it('removes wx_code param from URL', () => {
      const replaceState = vi.fn()
      vi.stubGlobal('window', {
        location: {
          search: '?wx_code=abc123&other=value',
          href: 'http://localhost:3000/?wx_code=abc123&other=value',
        },
        history: {
          replaceState,
        },
      })

      clearMiniProgramLoginParams()

      expect(replaceState).toHaveBeenCalledWith({}, '', 'http://localhost:3000/?other=value')
    })

    it('removes all mini program params', () => {
      const replaceState = vi.fn()
      vi.stubGlobal('window', {
        location: {
          search: '?wx_code=abc&wx_display_name=test&wx_photo_url=url&other=value',
          href: 'http://localhost:3000/?wx_code=abc&wx_display_name=test&wx_photo_url=url&other=value',
        },
        history: {
          replaceState,
        },
      })

      clearMiniProgramLoginParams()

      expect(replaceState).toHaveBeenCalledWith({}, '', 'http://localhost:3000/?other=value')
    })

    it('does not call replaceState when no params to remove', () => {
      const replaceState = vi.fn()
      vi.stubGlobal('window', {
        location: {
          search: '?other=value',
          href: 'http://localhost:3000/?other=value',
        },
        history: {
          replaceState,
        },
      })

      clearMiniProgramLoginParams()

      expect(replaceState).not.toHaveBeenCalled()
    })
  })

  describe('isMiniProgramWebView', () => {
    it('returns false when not in browser environment', () => {
      vi.stubGlobal('window', undefined)
      expect(isMiniProgramWebView()).toBe(false)
    })

    it('returns false when navigator is undefined', () => {
      vi.stubGlobal('window', {})
      vi.stubGlobal('navigator', undefined)
      expect(isMiniProgramWebView()).toBe(false)
    })

    it('returns true when __wxjs_environment is miniprogram', () => {
      vi.stubGlobal('window', {
        __wxjs_environment: 'miniprogram',
      })
      vi.stubGlobal('navigator', { userAgent: '' })
      expect(isMiniProgramWebView()).toBe(true)
    })

    it('returns true when userAgent contains miniProgram', () => {
      vi.stubGlobal('window', {})
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) miniProgram',
      })
      expect(isMiniProgramWebView()).toBe(true)
    })

    it('returns true when userAgent contains MiniProgram', () => {
      vi.stubGlobal('window', {})
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) MiniProgram',
      })
      expect(isMiniProgramWebView()).toBe(true)
    })

    it('returns false for regular browser', () => {
      vi.stubGlobal('window', {})
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0',
      })
      expect(isMiniProgramWebView()).toBe(false)
    })

    it('returns false for empty userAgent', () => {
      vi.stubGlobal('window', {})
      vi.stubGlobal('navigator', { userAgent: '' })
      expect(isMiniProgramWebView()).toBe(false)
    })
  })
})
