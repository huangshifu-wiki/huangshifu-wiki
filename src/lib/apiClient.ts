import {
  classifyError,
  logApiError,
  NetworkError,
  type ApiErrorContext,
  getAuthErrorCallback,
} from './errorHandler';
import {
  dedupedRequest,
  generateRequestKey,
  clearCache,
  invalidateCache,
  invalidateCacheByPrefix,
  preloadCache,
  getCacheStats,
  type DedupOptions,
} from '../utils/requestDedup';
import type { z } from 'zod';

interface BaseRequestOptions extends RequestInit {
  query?: Record<string, string | number | boolean | undefined | null>;
  /** 是否启用请求去重，默认 true */
  dedup?: boolean;
  /** 去重和缓存选项 */
  dedupOptions?: DedupOptions;
}

interface RequestOptions<T = unknown> extends BaseRequestOptions {
  /** 可选的 Zod schema 运行时验证 */
  schema?: z.ZodSchema<T>;
}

const API_JSON_HEADERS = {
  'Content-Type': 'application/json',
};

/**
 * 默认去重选项
 */
const DEFAULT_DEDUP_OPTIONS: DedupOptions = {
  staleTime: 30000, // 默认 30 秒缓存
  swr: true,
  swrCooldown: 5000,
};

function buildUrl(path: string, query?: RequestOptions['query']) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function parseResponse<T>(response: Response, context?: Omit<ApiErrorContext, 'statusCode' | 'responseData'>): Promise<T> {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = classifyError(response.status, data);

    if (context) {
      logApiError(error, {
        ...context,
        statusCode: response.status,
        responseData: data,
      });
    } else {
      console.error('[API Error]', {
        url: response.url,
        status: response.status,
        error: error.message,
      });
    }

    const authErrorCallback = getAuthErrorCallback();
    if (authErrorCallback && (response.status === 401 || response.status === 403)) {
      authErrorCallback(error);
    }

    throw error;
  }

  return data as T;
}

/**
 * 执行实际请求
 */
async function executeRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { query, headers, dedup: _dedup, dedupOptions: _dedupOptions, schema, ...rest } = options;
  const url = buildUrl(path, query);

  const context: Omit<ApiErrorContext, 'statusCode' | 'responseData'> = {
    url: path,
    method: rest.method || 'GET',
    requestBody: rest.body,
  };

  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      ...API_JSON_HEADERS,
      ...(headers || {}),
    },
    ...rest,
  });

  const data = await parseResponse<T>(response, context);

  if (schema) {
    return schema.parse(data) as T;
  }

  return data;
}

/**
 * 核心 API 请求函数（集成请求去重）
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}) {
  const { dedup = true, dedupOptions, method = 'GET', body } = options;

  // 只有 GET 请求默认启用去重
  const shouldDedup = dedup && method.toUpperCase() === 'GET';

  if (shouldDedup) {
    const url = buildUrl(path, options.query);
    const key = generateRequestKey(method, url, body);
    const mergedOptions = { ...DEFAULT_DEDUP_OPTIONS, ...dedupOptions };

    return dedupedRequest(
      () => executeRequest<T>(path, options),
      key,
      mergedOptions
    );
  }

  // 非 GET 请求或禁用去重，直接执行
  return executeRequest<T>(path, options);
}

export async function apiGet<T>(path: string, query?: RequestOptions['query'], dedupOptions?: DedupOptions) {
  return apiRequest<T>(path, { method: 'GET', query, dedup: true, dedupOptions });
}

export async function apiPost<T>(path: string, body?: unknown) {
  return apiRequest<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    dedup: false, // POST 请求默认不去重
  });
}

export async function apiPut<T>(path: string, body?: unknown) {
  return apiRequest<T>(path, {
    method: 'PUT',
    body: body === undefined ? undefined : JSON.stringify(body),
    dedup: false,
  });
}

export async function apiPatch<T>(path: string, body?: unknown) {
  return apiRequest<T>(path, {
    method: 'PATCH',
    body: body === undefined ? undefined : JSON.stringify(body),
    dedup: false,
  });
}

export async function apiDelete<T>(path: string) {
  return apiRequest<T>(path, { method: 'DELETE', dedup: false });
}

export function apiDownload(path: string): Promise<Response> {
  return fetch(path, { credentials: 'include' })
}

export interface ApiUploadOptions {
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}

export async function apiUpload<T>(path: string, formData: FormData, options?: ApiUploadOptions) {
  const { signal, onProgress } = options || {};

  const context: Omit<ApiErrorContext, 'statusCode' | 'responseData'> = {
    url: path,
    method: 'POST',
    requestBody: '[FormData]',
  };

  // 如果提供了进度回调，使用 XMLHttpRequest
  if (onProgress) {
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            resolve(xhr.responseText as unknown as T);
          }
        } else {
          try {
            const data = JSON.parse(xhr.responseText);
            const error = classifyError(xhr.status, data);
            logApiError(error, { ...context, statusCode: xhr.status, responseData: data });
            reject(error);
          } catch {
            const error = new Error(`Upload failed: ${xhr.status}`);
            logApiError(error, { ...context, statusCode: xhr.status, responseData: null });
            reject(error);
          }
        }
      });

      xhr.addEventListener('error', () => {
        const error = new NetworkError('Network error');
        logApiError(error, { ...context, statusCode: 0, responseData: null });
        reject(error);
      });
      xhr.addEventListener('abort', () => {
        const error = new Error('Upload cancelled');
        logApiError(error, { ...context, statusCode: 0, responseData: null });
        reject(error);
      });

      xhr.open('POST', path);
      xhr.withCredentials = true;
      if (signal) {
        signal.addEventListener('abort', () => xhr.abort());
      }
      xhr.send(formData);
    });
  }

  // 否则使用 fetch
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    body: formData,
    signal,
  });

  return parseResponse<T>(response, context);
}

export async function apiUploadWithRetry<T>(
  path: string,
  formData: FormData,
  options: {
    retries?: number;
    delay?: number;
    onRetry?: (attempt: number, error: Error) => void;
  } = {}
): Promise<T> {
  const { retries = 3, delay = 1000, onRetry } = options;
  let lastError: Error;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await apiUpload<T>(path, formData);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));

      if (attempt <= retries) {
        onRetry?.(attempt, lastError);
        await new Promise((resolve) => setTimeout(resolve, delay * attempt));
      }
    }
  }

  throw lastError!;
}

// ============================================================================
// 缓存管理工具导出
// ============================================================================

/**
 * 清除 API 缓存
 * @param key - 可选，指定缓存键清除；不传则清除所有缓存
 */
export { clearCache as clearApiCache };

/**
 * 使指定缓存失效
 */
export { invalidateCache as invalidateApiCache };

/**
 * 使匹配前缀的所有缓存失效
 */
export { invalidateCacheByPrefix as invalidateApiCacheByPrefix };

/**
 * 预加载数据到缓存
 */
export { preloadCache as preloadApiCache };

/**
 * 获取缓存统计信息
 */
export { getCacheStats as getApiCacheStats };

/**
 * 生成请求缓存键
 */
export { generateRequestKey as generateApiCacheKey };

// ============================================================================
// 导出错误类型供外部使用
// ============================================================================

export {
  NetworkError,
  AuthError,
  BusinessError,
  ServerError,
  PermissionError,
  NotFoundError,
  ValidationError,
  type AppError,
} from './errorHandler';
