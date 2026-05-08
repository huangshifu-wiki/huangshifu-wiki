import { useState, useCallback } from 'react';

const STORAGE_KEY = 'huangshifu_search_history';
const MAX_HISTORY = 20;

interface HistoryItem {
  query: string;
  timestamp: number;
}

/**
 * 搜索历史管理 Hook
 * 使用 localStorage 持久化用户的搜索历史记录
 */
export function useSearchHistory() {
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  /**
   * 添加搜索词到历史记录
   * 自动去重，最新的搜索排在最前面
   */
  const addToHistory = useCallback((query: string) => {
    if (!query || query.trim().length === 0) return;

    const trimmed = query.trim();
    const newHistory = [
      { query: trimmed, timestamp: Date.now() },
      ...history.filter((h) => h.query !== trimmed),
    ].slice(0, MAX_HISTORY);

    setHistory(newHistory);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
    } catch {
      // localStorage 可能已满
    }
  }, [history]);

  /**
   * 从历史记录中移除指定搜索词
   */
  const removeFromHistory = useCallback((query: string) => {
    const newHistory = history.filter((h) => h.query !== query);
    setHistory(newHistory);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
    } catch {}
  }, [history]);

  /**
   * 清空所有搜索历史
   */
  const clearHistory = useCallback(() => {
    setHistory([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  return { history, addToHistory, removeFromHistory, clearHistory };
}
