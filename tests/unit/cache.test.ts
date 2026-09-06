import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  EnhancedCache,
  enhancedCache,
  CACHE_KEYS,
  CACHE_TTL_SEC,
} from '../../src/server/utils/cache'

describe('EnhancedCache', () => {
  let cache: EnhancedCache

  beforeEach(() => {
    vi.useFakeTimers()
    cache = new EnhancedCache({ stdTTL: 10, maxKeys: 100, checkperiod: 99999 })
  })

  describe('get / set', () => {
    it('sets and gets values', () => {
      cache.set('k', 'v')
      expect(cache.get('k')).toBe('v')
    })

    it('returns undefined for missing keys', () => {
      expect(cache.get('nope')).toBeUndefined()
    })

    it('returns true on successful set', () => {
      expect(cache.set('k', 'v')).toBe(true)
    })
  })

  describe('delete', () => {
    it('deletes existing key', () => {
      cache.set('k', 'k')
      expect(cache.delete('k')).toBeGreaterThan(0)
    })
  })

  describe('has', () => {
    it('returns true for set key', () => {
      cache.set('k', 'v')
      expect(cache.has('k')).toBe(true)
    })

    it('returns false for unset key', () => {
      expect(cache.has('absent')).toBe(false)
    })
  })

  describe('clear', () => {
    it('flushes all entries', () => {
      cache.set('a', 1)
      cache.set('b', 2)
      cache.clear()
      expect(cache.get('a')).toBeUndefined()
      expect(cache.get('b')).toBeUndefined()
    })
  })

  describe('getStats', () => {
    it('tracks hits and misses', () => {
      cache.set('x', 1)
      cache.get('x')
      cache.get('y')
      const s = cache.getStats()
      expect(s.hits).toBe(1)
      expect(s.misses).toBe(1)
    })
  })
})

describe('EnhancedCache.generateKey', () => {
  it('generates key with colon separator', () => {
    expect(EnhancedCache.generateKey('auth', 'user', '123')).toBe('auth:user:123')
  })

  it('filters out undefined parts', () => {
    expect(EnhancedCache.generateKey('api', 'user', undefined, 'detail')).toBe('api:user:detail')
  })
})

describe('exported constants', () => {
  it('CACHE_KEYS has expected shape', () => {
    expect(CACHE_KEYS.WIKI_PAGE).toBe('wiki:page')
    expect(CACHE_KEYS.AUTH_USER).toBe('auth:user')
  })

  it('CACHE_TTL_SEC has expected values (in seconds)', () => {
    expect(CACHE_TTL_SEC.ANNOUNCEMENT).toBe(60)
    expect(CACHE_TTL_SEC.WIKI_PAGE).toBe(180)
    expect(CACHE_TTL_SEC.AUTH_USER).toBe(300)
  })
})
