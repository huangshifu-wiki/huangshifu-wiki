/**
 * 内存缓存工具 - 用于优化 API 响应时间
 * 支持 TTL、自动清理和统计信息
 */

import NodeCache from 'node-cache';

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  maxSize: number;
  hitRate: number;
}

const NAMESPACE_QUOTA_RATIO = 0.4;

class EnhancedCache {
  private cache: NodeCache;
  private hits = 0;
  private misses = 0;
  private readonly maxKeys: number;

  constructor(options?: { stdTTL?: number; maxKeys?: number; checkperiod?: number }) {
    const stdTTL = typeof options === 'object' ? options.stdTTL ?? 300 : 300;
    this.maxKeys = typeof options === 'object' && options.maxKeys !== undefined
      ? options.maxKeys
      : Number(process.env.CACHE_MAX_KEYS) || 5000;
    const checkperiod = typeof options === 'object' ? options.checkperiod ?? 60 : 60;

    this.cache = new NodeCache({
      stdTTL,
      checkperiod,
      maxKeys: this.maxKeys,
      useClones: false,
    });

    this.cache.on('evict', (_key, _value) => {
    });
  }

  get<T>(key: string): T | undefined {
    const value = this.cache.get<T>(key);
    if (value === undefined) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    return value;
  }

  set<T>(key: string, value: T, ttl?: number): boolean {
    if (this.isNamespaceOverQuota(key)) {
      this.evictOldestInNamespace(key);
    }
    return ttl !== undefined ? this.cache.set(key, value, ttl) : this.cache.set(key, value);
  }

  delete(key: string): number {
    return this.cache.del(key);
  }

  invalidateByPrefix(prefix: string): number {
    const keys = this.cache.keys().filter((k) => k.startsWith(prefix));
    if (keys.length === 0) return 0;
    return this.cache.del(keys);
  }

  clear(): void {
    this.cache.flushAll();
    this.hits = 0;
    this.misses = 0;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.keys().length,
      maxSize: this.maxKeys,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  getNativeStats(): NodeCache.Stats {
    return this.cache.getStats();
  }

  destroy(): void {
    this.cache.close();
    this.hits = 0;
    this.misses = 0;
  }

  static generateKey(prefix: string, ...parts: (string | number | boolean | undefined)[]): string {
    return `${prefix}:${parts.filter(p => p !== undefined).join(':')}`;
  }

  private getNamespacePrefix(key: string): string {
    const colonIndex = key.indexOf(':');
    return colonIndex > 0 ? key.slice(0, colonIndex) : '';
  }

  private isNamespaceOverQuota(key: string): boolean {
    const prefix = this.getNamespacePrefix(key);
    if (!prefix) return false;
    const keys = this.cache.keys().filter((k) => k.startsWith(prefix + ':'));
    return keys.length >= Math.floor(this.maxKeys * NAMESPACE_QUOTA_RATIO);
  }

  private evictOldestInNamespace(key: string): void {
    const prefix = this.getNamespacePrefix(key);
    if (!prefix) return;
    const nsKeys = this.cache.keys()
      .filter((k) => k.startsWith(prefix + ':'))
      .sort((a, b) => {
        const tA = this.cache.getTtl(a);
        const tB = this.cache.getTtl(b);
        return (tA ?? 0) - (tB ?? 0);
      });
    if (nsKeys.length > 0) {
      this.cache.del(nsKeys[0]);
    }
  }
}

export const enhancedCache = new EnhancedCache({
  stdTTL: 300,
  maxKeys: Number(process.env.CACHE_MAX_KEYS) || 5000,
  checkperiod: 60,
});

export const CACHE_KEYS = {
  ANNOUNCEMENT_LATEST: 'announcement:latest',
  AUTH_USER: 'auth:user',
  WIKI_LIST: 'wiki:list',
  WIKI_PAGE: 'wiki:page',
  WIKI_TIMELINE: 'wiki:timeline',
  WIKI_RECOMMENDED: 'wiki:recommended',
  SITE_CONFIG: 'site:config',
  MUSIC_PLAY_URL: 'music:playUrl',
} as const;

export { EnhancedCache };

export const CACHE_TTL_SEC = {
  ANNOUNCEMENT: 60,
  AUTH_USER: 300,
  WIKI_LIST: 120,
  WIKI_PAGE: 180,
  WIKI_TIMELINE: 300,
  WIKI_RECOMMENDED: 60,
  SITE_CONFIG: 300,
  MUSIC_PLAY_URL: 600,
} as const;
