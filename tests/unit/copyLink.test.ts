import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { toAbsoluteInternalUrl, copyToClipboard } from '../../src/lib/copyLink'

describe('copyLink', () => {
  const originalWindow = global.window
  const originalDocument = global.document
  const originalNavigator = global.navigator

  beforeEach(() => {
    vi.stubGlobal('window', {
      location: {
        origin: 'http://localhost:3000',
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('toAbsoluteInternalUrl', () => {
    it('returns path as-is when not in browser environment', () => {
      vi.stubGlobal('window', undefined)
      const result = toAbsoluteInternalUrl('/test-path')
      expect(result).toBe('/test-path')
    })

    it('returns absolute URL as-is', () => {
      const result = toAbsoluteInternalUrl('https://example.com/path')
      expect(result).toBe('https://example.com/path')
    })

    it('returns http URL as-is', () => {
      const result = toAbsoluteInternalUrl('http://example.com/path')
      expect(result).toBe('http://example.com/path')
    })

    it('adds origin to path without leading slash', () => {
      const result = toAbsoluteInternalUrl('test-path')
      expect(result).toBe('http://localhost:3000/test-path')
    })

    it('adds origin to path with leading slash', () => {
      const result = toAbsoluteInternalUrl('/test-path')
      expect(result).toBe('http://localhost:3000/test-path')
    })

    it('handles empty string', () => {
      const result = toAbsoluteInternalUrl('')
      expect(result).toBe('http://localhost:3000/')
    })

    it('handles root path', () => {
      const result = toAbsoluteInternalUrl('/')
      expect(result).toBe('http://localhost:3000/')
    })

    it('handles nested paths', () => {
      const result = toAbsoluteInternalUrl('/wiki/article/test')
      expect(result).toBe('http://localhost:3000/wiki/article/test')
    })

    it('handles paths with query strings', () => {
      const result = toAbsoluteInternalUrl('/path?query=value')
      expect(result).toBe('http://localhost:3000/path?query=value')
    })

    it('handles paths with hash', () => {
      const result = toAbsoluteInternalUrl('/path#section')
      expect(result).toBe('http://localhost:3000/path#section')
    })
  })

  describe('copyToClipboard', () => {
    it('uses navigator.clipboard when available', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('navigator', {
        clipboard: {
          writeText,
        },
      })

      const result = await copyToClipboard('test text')

      expect(writeText).toHaveBeenCalledWith('test text')
      expect(result).toBe(true)
    })

    it('falls back to execCommand when clipboard API unavailable', async () => {
      const execCommand = vi.fn().mockReturnValue(true)
      const mockTextarea = {
        value: '',
        style: {
          position: '',
          opacity: '',
          pointerEvents: '',
        },
        focus: vi.fn(),
        select: vi.fn(),
      }
      const mockBody = {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      }

      vi.stubGlobal('navigator', {})
      vi.stubGlobal('document', {
        createElement: vi.fn().mockReturnValue(mockTextarea),
        body: mockBody,
        execCommand,
      })

      const result = await copyToClipboard('fallback text')

      expect(mockTextarea.value).toBe('fallback text')
      expect(mockTextarea.style.position).toBe('fixed')
      expect(mockTextarea.style.opacity).toBe('0')
      expect(mockTextarea.style.pointerEvents).toBe('none')
      expect(mockBody.appendChild).toHaveBeenCalledWith(mockTextarea)
      expect(mockTextarea.focus).toHaveBeenCalled()
      expect(mockTextarea.select).toHaveBeenCalled()
      expect(execCommand).toHaveBeenCalledWith('copy')
      expect(mockBody.removeChild).toHaveBeenCalledWith(mockTextarea)
      expect(result).toBe(true)
    })

    it('returns false when execCommand fails', async () => {
      const execCommand = vi.fn().mockReturnValue(false)
      const mockTextarea = {
        value: '',
        style: {},
        focus: vi.fn(),
        select: vi.fn(),
      }
      const mockBody = {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      }

      vi.stubGlobal('navigator', {})
      vi.stubGlobal('document', {
        createElement: vi.fn().mockReturnValue(mockTextarea),
        body: mockBody,
        execCommand,
      })

      const result = await copyToClipboard('text')

      expect(result).toBe(false)
    })

    it('returns false when clipboard API throws error', async () => {
      const writeText = vi.fn().mockRejectedValue(new Error('Clipboard error'))
      vi.stubGlobal('navigator', {
        clipboard: {
          writeText,
        },
      })

      const result = await copyToClipboard('test text')

      expect(result).toBe(false)
    })

    it('returns false when fallback throws error', async () => {
      vi.stubGlobal('navigator', {})
      vi.stubGlobal('document', {
        createElement: () => {
          throw new Error('Document error')
        },
      })

      const result = await copyToClipboard('text')

      expect(result).toBe(false)
    })

    it('handles empty string', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('navigator', {
        clipboard: {
          writeText,
        },
      })

      const result = await copyToClipboard('')

      expect(writeText).toHaveBeenCalledWith('')
      expect(result).toBe(true)
    })

    it('handles special characters', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('navigator', {
        clipboard: {
          writeText,
        },
      })

      const specialText = 'Hello <world> & "everyone" \'here\''
      const result = await copyToClipboard(specialText)

      expect(writeText).toHaveBeenCalledWith(specialText)
      expect(result).toBe(true)
    })

    it('handles multiline text', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('navigator', {
        clipboard: {
          writeText,
        },
      })

      const multilineText = 'Line 1\nLine 2\nLine 3'
      const result = await copyToClipboard(multilineText)

      expect(writeText).toHaveBeenCalledWith(multilineText)
      expect(result).toBe(true)
    })
  })
})
