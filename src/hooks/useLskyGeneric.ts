import { useMemo, useCallback } from 'react';
import { LskyProAPI, LskyProAPIError } from '../lib/lskyClient';

export interface UseLskyGenericOptions {
  baseUrl?: string;
  token?: string;
}

/**
 * 兰空 Pro API 泛型工厂 Hook
 *
 * 提取三个 Lsky Hook 共享的脚手架逻辑：
 * - baseUrl 初始化（支持 options 覆盖 / 环境变量回退）
 * - LskyProAPI 实例化（useMemo 防止重复创建）
 * - formatError 统一错误格式化（LskyProAPIError → Error → fallback）
 */
export function useLskyGeneric(options: UseLskyGenericOptions = {}) {
  const baseUrl = options.baseUrl || import.meta.env.VITE_LSKY_BASE_URL || '';

  const api = useMemo(
    () => new LskyProAPI({ baseUrl, token: options.token }),
    [baseUrl, options.token],
  );

  const formatError = useCallback((err: unknown, fallback: string): string => {
    if (err instanceof LskyProAPIError) return err.message;
    if (err instanceof Error) return err.message;
    return fallback;
  }, []);

  return { api, baseUrl, formatError };
}
