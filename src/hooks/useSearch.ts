import { useState, useCallback, useRef } from "react";
import { apiGet, apiUpload } from "../lib/apiClient";
import type { GalleryItem, WikiItem, PostItem } from "../types/entities";

/**
 * 图片来源类型
 */
export type ImageSourceType = "gallery" | "wiki" | "post";

/**
 * 混合搜索结果项
 */
export interface MixedSearchResult {
  /** 来源类型 */
  sourceType: ImageSourceType;
  /** 来源ID */
  sourceId: string;
  /** 匹配的图片URL */
  imageUrl: string;
  /** 相似度分数 (0-1) */
  similarity: number;
  /** 具体数据 */
  data: GalleryItem | WikiItem | PostItem;
}

/**
 * 语义搜索响应
 */
export interface SemanticSearchResponse {
  mode: "semantic_text" | "semantic_image";
  query?: string;
  totalMatches: number;
  results: MixedSearchResult[];
}

/**
 * 向后兼容：语义搜索画廊响应
 */
export interface SemanticGalleriesResponse {
  mode: "semantic_text";
  query: string;
  totalMatches: number;
  totalGalleries: number;
  galleries: Array<GalleryItem & { similarity: number }>;
}

/**
 * 图片搜索响应
 */
export interface ImageSearchResponse {
  mode: "semantic_image";
  totalMatches: number;
  results: MixedSearchResult[];
}

/**
 * 搜索建议项
 */
export interface SearchSuggestion {
  type: "keyword" | "wiki" | "post" | "music" | "album";
  text: string;
  subtext?: string;
  id?: string;
}

/**
 * 传统搜索结果
 */
export interface TraditionalSearchResults {
  wiki: WikiItem[];
  posts: PostItem[];
  galleries: GalleryItem[];
  music: unknown[];
  albums: unknown[];
}

/**
 * 搜索过滤器
 */
export interface SearchFilters {
  selectedTags: string[];
  dateRange: { start: string; end: string };
  contentType: "all" | "wiki" | "posts" | "galleries" | "music" | "albums";
  semanticImageSearch: boolean;
}

/**
 * 使用混合搜索的 Hook
 */
export function useMixedSearch() {
  const [results, setResults] = useState<MixedSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * 执行语义搜索（文字）
   */
  const searchByText = useCallback(async (
    query: string,
    options?: { limit?: number; minScore?: number }
  ): Promise<MixedSearchResult[]> => {
    if (!query.trim()) {
      setResults([]);
      return [];
    }

    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setLoading(true);
    setError(null);

    try {
      const data = await apiGet<SemanticSearchResponse>(
        "/api/search/semantic-search",
        {
          q: query.trim(),
          limit: options?.limit || 24,
          minScore: options?.minScore,
        }
      );

      setResults(data.results || []);
      return data.results || [];
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return [];
      }
      const errorMsg = err instanceof Error ? err.message : "搜索失败";
      setError(errorMsg);
      console.error("Semantic search error:", err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 执行图片搜索
   */
  const searchByImage = useCallback(async (
    file: File,
    options?: { limit?: number; minScore?: number }
  ): Promise<MixedSearchResult[]> => {
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("limit", String(options?.limit || 24));
      if (options?.minScore !== undefined) {
        formData.append("minScore", String(options.minScore));
      }

      const data = await apiUpload<ImageSearchResponse>(
        "/api/search/by-image",
        formData
      );

      setResults(data.results || []);
      return data.results || [];
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "图片搜索失败";
      setError(errorMsg);
      console.error("Image search error:", err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 清空结果
   */
  const clearResults = useCallback(() => {
    setResults([]);
    setError(null);
  }, []);

  return {
    results,
    loading,
    error,
    searchByText,
    searchByImage,
    clearResults,
  };
}

/**
 * 使用传统搜索的 Hook
 */
export function useTraditionalSearch() {
  const [results, setResults] = useState<TraditionalSearchResults>({
    wiki: [],
    posts: [],
    galleries: [],
    music: [],
    albums: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 执行传统搜索
   */
  const search = useCallback(async (
    query: string,
    filters?: Partial<SearchFilters>
  ): Promise<TraditionalSearchResults> => {
    if (!query.trim()) {
      setResults({ wiki: [], posts: [], galleries: [], music: [], albums: [] });
      return { wiki: [], posts: [], galleries: [], music: [], albums: [] };
    }

    setLoading(true);
    setError(null);

    try {
      const typeMap: Record<string, string> = {
        wiki: "wiki",
        posts: "posts",
        galleries: "galleries",
        music: "music",
        albums: "albums",
      };
      const apiType =
        filters?.contentType === "all" || !filters?.contentType
          ? "all"
          : typeMap[filters.contentType] || "all";

      const data = await apiGet<TraditionalSearchResults>("/api/search", {
        q: query.trim(),
        type: apiType,
        ...(filters?.dateRange?.start
          ? { startDate: filters.dateRange.start }
          : {}),
        ...(filters?.dateRange?.end
          ? { endDate: filters.dateRange.end }
          : {}),
      });

      const normalizedResults = {
        wiki: data.wiki || [],
        posts: data.posts || [],
        galleries: data.galleries || [],
        music: data.music || [],
        albums: data.albums || [],
      };

      setResults(normalizedResults);
      return normalizedResults;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "搜索失败";
      setError(errorMsg);
      console.error("Traditional search error:", err);
      return { wiki: [], posts: [], galleries: [], music: [], albums: [] };
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 获取搜索建议
   */
  const getSuggestions = useCallback(async (
    query: string
  ): Promise<SearchSuggestion[]> => {
    if (!query || query.length < 2) {
      return [];
    }

    try {
      const data = await apiGet<{ suggestions: SearchSuggestion[] }>(
        "/api/search/suggest",
        { q: query }
      );
      return data.suggestions || [];
    } catch (err) {
      console.error("Search suggest error:", err);
      return [];
    }
  }, []);

  /**
   * 获取热门关键词
   */
  const getHotKeywords = useCallback(async (): Promise<string[]> => {
    try {
      const data = await apiGet<{ keywords: Array<{ keyword: string; count: number }> }>(
        "/api/search/hot-keywords"
      );
      return data.keywords?.map((k) => k.keyword) || [];
    } catch (err) {
      console.error("Fetch hot keywords error:", err);
      return [];
    }
  }, []);

  /**
   * 清空结果
   */
  const clearResults = useCallback(() => {
    setResults({ wiki: [], posts: [], galleries: [], music: [], albums: [] });
    setError(null);
  }, []);

  return {
    results,
    loading,
    error,
    search,
    getSuggestions,
    getHotKeywords,
    clearResults,
  };
}
