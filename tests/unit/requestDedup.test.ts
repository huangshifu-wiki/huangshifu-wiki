import { describe, expect, it, beforeEach } from 'vitest';
import {
  generateRequestKey,
  clearCache,
  getCacheStats,
  preloadCache,
  invalidateCache,
  invalidateCacheByPrefix,
} from '../../src/utils/requestDedup';

describe('requestDedup', () => {
  beforeEach(() => {
    clearCache();
  });

  describe('generateRequestKey', () => {
    it('generates key with method and url', () => {
      const key = generateRequestKey('GET', '/api/test');
      expect(key).toBe('GET|/api/test|');
    });

    it('includes body in key when provided', () => {
      const key = generateRequestKey('POST', '/api/test', { foo: 'bar' });
      expect(key).toBe('POST|/api/test|{"foo":"bar"}');
    });

    it('uppercases method', () => {
      const key = generateRequestKey('get', '/api/test');
      expect(key).toContain('GET|');
    });

    it('handles undefined body gracefully', () => {
      const key = generateRequestKey('DELETE', '/api/items/1');
      expect(key).toBe('DELETE|/api/items/1|');
    });
  });

  describe('clearCache', () => {
    it('clears all cache entries', () => {
      preloadCache('key1', 'value1');
      preloadCache('key2', 'value2');
      clearCache();
      expect(getCacheStats().cacheSize).toBe(0);
    });
  });

  describe('preloadCache / getCacheStats', () => {
    it('preloads data into cache', () => {
      preloadCache('test-key', { data: 'hello' });
      const stats = getCacheStats();
      expect(stats.cacheSize).toBe(1);
    });

    it('reports correct stats after multiple preloads', () => {
      preloadCache('a', 1);
      preloadCache('b', 2);
      preloadCache('c', 3);
      const stats = getCacheStats();
      expect(stats.cacheSize).toBe(3);
    });
  });

  describe('invalidateCache', () => {
    it('removes specific cache entry', () => {
      preloadCache('keep-me', 'val1');
      preloadCache('remove-me', 'val2');
      invalidateCache('remove-me');
      const stats = getCacheStats();
      expect(stats.cacheSize).toBe(1);
    });

    it('does nothing for non-existent key', () => {
      invalidateCache('non-existent');
      expect(getCacheStats().cacheSize).toBe(0);
    });
  });

  describe('invalidateCacheByPrefix', () => {
    it('removes all entries matching prefix', () => {
      preloadCache('user:1:data', 'a');
      preloadCache('user:2:data', 'b');
      preloadCache('post:1:data', 'c');
      invalidateCacheByPrefix('user:');
      const stats = getCacheStats();
      expect(stats.cacheSize).toBe(1);
    });

    it('handles empty cache gracefully', () => {
      invalidateCacheByPrefix('any:');
      expect(getCacheStats().cacheSize).toBe(0);
    });

    it('removes all entries when prefix matches everything', () => {
      preloadCache('a:1', 'x');
      preloadCache('b:2', 'y');
      invalidateCacheByPrefix('');
      expect(getCacheStats().cacheSize).toBe(0);
    });
  });
});
