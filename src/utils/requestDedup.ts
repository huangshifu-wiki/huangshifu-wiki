/**
 * 请求去重与缓存工具
 *
 * 解决首屏重复请求问题：
 * - /api/announcements/latest 请求了 3 次
 * - /api/notifications 请求了 2 次
 *
 * 实现策略：
 * 1. 基于 Promise 的并发请求去重（in-flight deduplication）
 * 2. SWR (Stale-While-Revalidate) 缓存策略
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  staleTime: number;
}

interface InFlightRequest<T> {
  promise: Promise<T>;
  timestamp: number;
}

export interface DedupOptions {
  /** 缓存有效时间（毫秒），默认 60000ms (1分钟) */
  staleTime?: number;
  /** 是否启用 SWR 策略，默认 true */
  swr?: boolean;
  /** SWR 重新验证的冷却时间（毫秒），默认 5000ms (5秒) */
  swrCooldown?: number;
}

const MAX_CACHE_SIZE = 200;
const INFLIGHT_TIMEOUT_MS = 30000;

const cache = new Map<string, CacheEntry<unknown>>();

const inFlightRequests = new Map<string, InFlightRequest<unknown>>();

const swrCooldowns = new Map<string, number>();

function debugLog(message: string, ...args: unknown[]): void {
  if (process.env.NODE_ENV !== 'production') {
    console.debug(`[RequestDedup] ${message}`, ...args);
  }
}

function evictOldestCacheEntry(): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
}

function cleanupStaleInFlightRequests(): void {
  const now = Date.now();
  for (const [key, req] of inFlightRequests.entries()) {
    if (now - req.timestamp > INFLIGHT_TIMEOUT_MS) {
      inFlightRequests.delete(key);
    }
  }
}

/**
 * 生成请求的唯一标识键
 */
export function generateRequestKey(
  method: string,
  url: string,
  body?: unknown
): string {
  const bodyKey = body ? JSON.stringify(body) : '';
  return `${method.toUpperCase()}|${url}|${bodyKey}`;
}

/**
 * 检查缓存是否有效
 */
function isCacheValid<T>(entry: CacheEntry<T>, staleTime: number): boolean {
  return Date.now() - entry.timestamp < staleTime;
}

/**
 * 检查 SWR 冷却是否生效
 */
function isSwrOnCooldown(key: string, cooldown: number): boolean {
  const lastRevalidate = swrCooldowns.get(key);
  if (!lastRevalidate) return false;
  return Date.now() - lastRevalidate < cooldown;
}

/**
 * 清除指定缓存
 */
export function clearCache(key?: string): void {
  if (key) {
    cache.delete(key);
    inFlightRequests.delete(key);
    swrCooldowns.delete(key);
  } else {
    cache.clear();
    inFlightRequests.clear();
    swrCooldowns.clear();
  }
}

/**
 * 获取缓存统计信息（用于调试）
 */
export function getCacheStats(): {
  cacheSize: number;
  inFlightSize: number;
  cooldownSize: number;
} {
  return {
    cacheSize: cache.size,
    inFlightSize: inFlightRequests.size,
    cooldownSize: swrCooldowns.size,
  };
}

/**
 * 请求去重与缓存包装器
 *
 * @param requestFn - 实际执行请求的函数
 * @param key - 请求唯一标识
 * @param options - 去重和缓存选项
 * @returns Promise<T>
 *
 * @example
 * ```typescript
 * const data = await dedupedRequest(
 *   () => fetch('/api/announcements/latest').then(r => r.json()),
 *   'GET|/api/announcements/latest|',
 *   { staleTime: 30000 }
 * );
 * ```
 */
export async function dedupedRequest<T>(
  requestFn: () => Promise<T>,
  key: string,
  options: DedupOptions = {}
): Promise<T> {
  const {
    staleTime = 60000,
    swr = true,
    swrCooldown: swrCooldownMs = 5000,
  } = options;

  cleanupStaleInFlightRequests();

  // 1. 检查是否有正在进行的相同请求，直接复用 Promise
  const inFlight = inFlightRequests.get(key) as InFlightRequest<T> | undefined;
  if (inFlight) {
    debugLog(`Reusing in-flight request: ${key}`);
    return inFlight.promise;
  }

  // 2. 检查缓存
  const cached = cache.get(key) as CacheEntry<T> | undefined;

  if (cached && isCacheValid(cached, staleTime)) {
    debugLog(`Cache hit: ${key}`);

    // SWR 策略：在后台重新验证（如果不在冷却期）
    if (swr && !isSwrOnCooldown(key, swrCooldownMs)) {
      debugLog(`SWR revalidating in background: ${key}`);
      swrCooldowns.set(key, Date.now());

      // 后台重新验证，不阻塞当前返回
      const revalidatePromise = requestFn()
        .then((data) => {
          if (data !== undefined && data !== null) {
            evictOldestCacheEntry();
            cache.set(key, { data, timestamp: Date.now(), staleTime });
          }
          debugLog(`SWR revalidate success: ${key}`);
          return data;
        })
        .catch((error) => {
          debugLog(`SWR revalidate failed: ${key}`, error);
        })
        .finally(() => {
          inFlightRequests.delete(key);
        });

      inFlightRequests.set(key, {
        promise: revalidatePromise as Promise<unknown>,
        timestamp: Date.now(),
      });
    }

    return cached.data;
  }

  // 3. 缓存无效或不存在，发起新请求
  evictOldestCacheEntry();
  debugLog(`Cache miss, fetching: ${key}`);

  const promise = requestFn()
    .then((data) => {
      if (data !== undefined && data !== null) {
        evictOldestCacheEntry();
        cache.set(key, { data, timestamp: Date.now(), staleTime });
      }
      return data;
    })
    .catch((error) => {
      if (cached && swr) {
        debugLog(`Request failed, using stale cache: ${key}`);
        return cached.data;
      }
      throw error;
    })
    .finally(() => {
      // 清理进行中的请求记录
      inFlightRequests.delete(key);
    });

  // 记录进行中的请求
  inFlightRequests.set(key, {
    promise: promise as Promise<unknown>,
    timestamp: Date.now(),
  });

  return promise;
}

/**
 * 创建带去重功能的请求函数包装器
 *
 * @param requestFn - 原始请求函数
 * @param defaultOptions - 默认选项
 * @returns 带去重功能的请求函数
 *
 * @example
 * ```typescript
 * const dedupedGet = createDedupedRequest(apiGet, { staleTime: 30000 });
 * const data = await dedupedGet('/api/announcements/latest');
 * ```
 */
export function createDedupedRequest<TArgs extends unknown[], TResult>(
  requestFn: (...args: TArgs) => Promise<TResult>,
  defaultOptions: DedupOptions = {}
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    // 生成缓存键（基于函数名和参数）
    const key = generateRequestKey('DEDUP', requestFn.name, args);
    return dedupedRequest(() => requestFn(...args), key, defaultOptions);
  };
}

/**
 * 预加载数据到缓存
 *
 * @param key - 缓存键
 * @param data - 预加载数据
 * @param staleTime - 缓存有效时间
 */
export function preloadCache<T>(
  key: string,
  data: T,
  staleTime: number = 60000
): void {
  cache.set(key, { data, timestamp: Date.now(), staleTime });
  debugLog(`Preloaded cache: ${key}`);
}

/**
 * 使指定缓存失效
 */
export function invalidateCache(key: string): void {
  cache.delete(key);
  swrCooldowns.delete(key);
  debugLog(`Invalidated cache: ${key}`);
}

/**
 * 使匹配前缀的所有缓存失效
 */
export function invalidateCacheByPrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.includes(prefix)) {
      cache.delete(key);
      swrCooldowns.delete(key);
    }
  }
  debugLog(`Invalidated cache by prefix: ${prefix}`);
}
