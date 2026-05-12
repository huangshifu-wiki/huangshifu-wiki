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

/**
 * @deprecated MemoryCache 已废弃，请使用 EnhancedCache（基于 node-cache）。
 * 该类保留仅为了向后兼容，新代码应使用 enhancedCache 实例。
 * 计划在后续版本中移除。
 */
class MemoryCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private hits = 0;
  private misses = 0;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly maxSize: number;

  constructor(options?: { cleanupIntervalMs?: number; maxSize?: number }) {
    const cleanupIntervalMs = typeof options === 'object' ? options.cleanupIntervalMs ?? 60000 : 60000;
    this.maxSize = typeof options === 'object' && options.maxSize !== undefined ? options.maxSize : 1000;
    this.cleanupInterval = setInterval(() => this.cleanup(), cleanupIntervalMs);
  }

  /**
   * 获取缓存值
   */
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // 检查是否过期
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    this.hits++;
    return entry.value as T;
  }

  /**
   * 设置缓存值
   * @param ttl 过期时间（毫秒），默认 5 分钟
   */
  set<T>(key: string, value: T, ttl = 300000): void {
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
    });
  }

  /**
   * 删除缓存
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * 检查是否存在（未过期）
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * 获取缓存统计
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * 清理过期缓存
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 销毁缓存实例（清理定时器）
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
  }

  /**
   * 生成缓存键
   */
  static generateKey(prefix: string, ...parts: (string | number | boolean | undefined)[]): string {
    return `${prefix}:${parts.filter(p => p !== undefined).join(':')}`;
  }
}

/**
 * 基于 node-cache 的增强缓存类
 * 支持 TTL、最大键数量限制、命中率统计
 */
class EnhancedCache {
  private cache: NodeCache;
  private hits = 0;
  private misses = 0;
  private readonly maxKeys: number;

  constructor(options?: { stdTTL?: number; maxKeys?: number; checkperiod?: number }) {
    const stdTTL = typeof options === 'object' ? options.stdTTL ?? 300 : 300; // 默认 5 分钟（秒）
    this.maxKeys = typeof options === 'object' && options.maxKeys !== undefined ? options.maxKeys : 1000;
    const checkperiod = typeof options === 'object' ? options.checkperiod ?? 60 : 60;

    this.cache = new NodeCache({
      stdTTL,
      checkperiod,
      maxKeys: this.maxKeys,
      useClones: false,
    });

    this.cache.on('evict', (_key, _value) => {
      // 当达到 maxKeys 时，node-cache 会自动驱逐最老的键
    });
  }

  /**
   * 获取缓存值
   * @param key 缓存键
   */
  get<T>(key: string): T | undefined {
    const value = this.cache.get<T>(key);
    if (value === undefined) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    return value;
  }

  /**
   * 设置缓存值
   * @param key 缓存键
   * @param value 缓存值
   * @param ttl 过期时间（秒），默认使用构造时的 stdTTL
   */
  set<T>(key: string, value: T, ttl?: number): boolean {
    return ttl !== undefined ? this.cache.set(key, value, ttl) : this.cache.set(key, value);
  }

  /**
   * 删除缓存
   * @param key 缓存键
   */
  delete(key: string): number {
    return this.cache.del(key);
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.flushAll();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * 检查是否存在（未过期）
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * 获取缓存统计
   */
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

  /**
   * 获取 node-cache 原生统计（keys、hits、misses）
   */
  getNativeStats(): NodeCache.Stats {
    return this.cache.getStats();
  }

  /**
   * 销毁缓存实例
   */
  destroy(): void {
    this.cache.close();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * 生成缓存键
   */
  static generateKey(prefix: string, ...parts: (string | number | boolean | undefined)[]): string {
    return `${prefix}:${parts.filter(p => p !== undefined).join(':')}`;
  }
}

// 全局缓存实例（已废弃，保留仅为了向后兼容）
// 新代码请使用 enhancedCache（基于 node-cache，TTL 单位为秒）
/** @deprecated 使用 enhancedCache 替代 */
export const apiCache = new MemoryCache();

// 增强缓存实例（用于新场景）
export const enhancedCache = new EnhancedCache({
  stdTTL: 300, // 5 分钟
  maxKeys: 1000,
  checkperiod: 60,
});

// 缓存键前缀常量
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

// 默认 TTL 配置（毫秒，用于 MemoryCache）
export const CACHE_TTL = {
  ANNOUNCEMENT: 60000,      // 1 分钟
  AUTH_USER: 300000,        // 5 分钟
  WIKI_LIST: 120000,        // 2 分钟
  WIKI_PAGE: 180000,        // 3 分钟
  WIKI_TIMELINE: 300000,    // 5 分钟
  WIKI_RECOMMENDED: 60000,  // 1 分钟
  SITE_CONFIG: 300000,      // 5 分钟
  MUSIC_PLAY_URL: 600000,   // 10 分钟
} as const;

export default MemoryCache;
export { MemoryCache, EnhancedCache };
