import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiUpload } from "../lib/apiClient";
import type { WikiItem, PostItem, GalleryItem, SongItem, AlbumItem } from "../types/entities";
import type { MixedSearchResult, SearchSuggestion } from "./useSearch";
import { useSearchHistory } from "./useSearchHistory";

export interface SearchFilters {
  selectedTags: string[];
  dateRange: { start: string; end: string };
  contentType: "all" | "wiki" | "posts" | "galleries" | "music" | "albums";
  semanticImageSearch: boolean;
}

export interface SearchResults {
  wiki: WikiItem[];
  posts: PostItem[];
  galleries: GalleryItem[];
  music: SongItem[];
  albums: AlbumItem[];
}

export interface SearchState {
  query: string;
  results: SearchResults;
  loading: boolean;
  hasSearched: boolean;
  activeTab: string;
  filters: SearchFilters;
  suggestions: SearchSuggestion[];
  mixedResults: MixedSearchResult[];
  isMixedSearch: boolean;
  aiSearching: boolean;
  hotKeywords: string[];
  showFilters: boolean;
  searchMeta?: {
    mode: string;
    query: string;
    degraded: boolean;
    degradationReason?: string;
    keywordResultCount: number;
    vectorResultCount: number;
  };
}

export function useSearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") || "";

  // 搜索历史管理
  const { addToHistory } = useSearchHistory();

  const [state, setState] = useState<SearchState>({
    query: initialQuery,
    results: { wiki: [], posts: [], galleries: [], music: [], albums: [] },
    loading: false,
    hasSearched: Boolean(initialQuery),
    activeTab: "all",
    filters: {
      selectedTags: [],
      dateRange: { start: "", end: "" },
      contentType: "all",
      semanticImageSearch: false,
    },
    suggestions: [],
    mixedResults: [],
    isMixedSearch: false,
    aiSearching: false,
    hotKeywords: [],
    showFilters: false,
    searchMeta: undefined,
  });

  const suggestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 获取热门关键词
  useEffect(() => {
    const fetchHotKeywords = async () => {
      try {
        const data = await apiGet<{
          keywords: Array<{ keyword: string; count: number }>;
        }>("/api/search/hot-keywords");
        setState((prev) => ({
          ...prev,
          hotKeywords: data.keywords?.map((k) => k.keyword) || [],
        }));
      } catch (e) {
        console.error("Fetch hot keywords error:", e);
      }
    };
    fetchHotKeywords();
  }, []);

  // 初始查询
  useEffect(() => {
    if (initialQuery) {
      performSearch(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (!q || q.length < 2) {
      setState((prev) => ({ ...prev, suggestions: [] }));
      return;
    }
    try {
      const data = await apiGet<{ suggestions: SearchSuggestion[] }>(
        "/api/search/suggest",
        { q }
      );
      setState((prev) => ({ ...prev, suggestions: data.suggestions || [] }));
    } catch (e) {
      console.error("Suggest error:", e);
    }
  }, []);

  const handleQueryChange = (val: string) => {
    setState((prev) => ({ ...prev, query: val }));
    if (suggestTimeoutRef.current) clearTimeout(suggestTimeoutRef.current);
    suggestTimeoutRef.current = setTimeout(() => fetchSuggestions(val), 300);
  };

  const performMixedSearch = async (q: string, limit = 24) => {
    try {
      const data = await apiGet<{
        mode: string;
        totalMatches: number;
        results: MixedSearchResult[];
      }>("/api/search/semantic-search", {
        q: q.trim(),
        limit,
      });
      return data.results || [];
    } catch (err) {
      console.error("Mixed search error:", err);
      return [];
    }
  };

  const performSearch = async (q: string, filtersOverride?: Partial<SearchFilters>) => {
    const currentQuery = q || state.query;
    if (!currentQuery.trim()) return;

    // 记录搜索历史
    addToHistory(currentQuery);

    if (suggestTimeoutRef.current) {
      clearTimeout(suggestTimeoutRef.current);
      suggestTimeoutRef.current = null;
    }

    setState((prev) => ({
      ...prev,
      loading: true,
      hasSearched: true,
      query: currentQuery,
      suggestions: [],
    }));

    // 更新 URL
    const sp = new URLSearchParams(searchParams);
    sp.set("q", currentQuery);
    setSearchParams(sp);

    const filters = { ...state.filters, ...filtersOverride };

    try {
      if (filters.semanticImageSearch && currentQuery) {
        const mixedSearchResults = await performMixedSearch(currentQuery, 24);
        setState((prev) => ({
          ...prev,
          mixedResults: mixedSearchResults,
          isMixedSearch: true,
          activeTab: "semantic",
          loading: false,
        }));
        return;
      }

      const typeMap: Record<string, string> = {
        wiki: "wiki",
        posts: "posts",
        galleries: "galleries",
        music: "music",
        albums: "albums",
      };
      const apiType =
        filters.contentType === "all"
          ? "all"
          : typeMap[filters.contentType] || "all";

      const data = await apiGet<{
        wiki: WikiItem[];
        posts: PostItem[];
        galleries: GalleryItem[];
        music: SongItem[];
        albums: AlbumItem[];
        searchMeta?: {
          mode: string;
          query: string;
          degraded: boolean;
          degradationReason?: string;
          keywordResultCount: number;
          vectorResultCount: number;
        };
      }>("/api/search", {
        q: currentQuery,
        type: apiType,
        mode: filters.semanticImageSearch ? "hybrid" : "keyword",
        ...(filters.dateRange.start ? { startDate: filters.dateRange.start } : {}),
        ...(filters.dateRange.end ? { endDate: filters.dateRange.end } : {}),
      });

      const filterFn = (item: WikiItem | PostItem | GalleryItem) => {
        const matchesTags =
          filters.selectedTags.length === 0 ||
          filters.selectedTags.every((tag: string) => (item.tags || []).includes(tag));
        return matchesTags;
      };

      setState((prev) => ({
        ...prev,
        results: {
          wiki: (data.wiki || []).filter(filterFn),
          posts: (data.posts || []).filter(filterFn),
          galleries: (data.galleries || []).filter(filterFn),
          music: data.music || [],
          albums: data.albums || [],
        },
        isMixedSearch: false,
        mixedResults: [],
        loading: false,
        searchMeta: data.searchMeta,
      }));
    } catch (e) {
      console.error("Search error:", e);
      setState((prev) => ({ ...prev, loading: false }));
    }
  };

  const handleImageSearch = async (file: File) => {
    setState((prev) => ({
      ...prev,
      aiSearching: true,
      loading: true,
      hasSearched: true,
    }));
    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("limit", "24");

      const data = await apiUpload<{
        mode: string;
        totalMatches: number;
        results: MixedSearchResult[];
      }>("/api/search/by-image", formData);

      setState((prev) => ({
        ...prev,
        isMixedSearch: true,
        mixedResults: data.results || [],
        activeTab: "semantic",
        loading: false,
        aiSearching: false,
      }));
    } catch (err) {
      console.error("Semantic image search error:", err);
      setState((prev) => ({
        ...prev,
        mixedResults: [],
        loading: false,
        aiSearching: false,
      }));
    }
  };

  const toggleTag = (tag: string) => {
    setState((prev) => ({
      ...prev,
      filters: {
        ...prev.filters,
        selectedTags: prev.filters.selectedTags.includes(tag)
          ? prev.filters.selectedTags.filter((t) => t !== tag)
          : [...prev.filters.selectedTags, tag],
      },
    }));
  };

  const updateFilters = (filters: Partial<SearchFilters>) => {
    setState((prev) => ({
      ...prev,
      filters: { ...prev.filters, ...filters },
    }));
  };

  const resetFilters = () => {
    setState((prev) => ({
      ...prev,
      filters: {
        selectedTags: [],
        dateRange: { start: "", end: "" },
        contentType: "all",
        semanticImageSearch: false,
      },
    }));
  };

  const setActiveTab = (tab: string) => {
    setState((prev) => ({ ...prev, activeTab: tab }));
  };

  const setShowFilters = (show: boolean) => {
    setState((prev) => ({ ...prev, showFilters: show }));
  };

  const dismissSuggestions = () => {
    setState((prev) =>
      prev.suggestions.length === 0 ? prev : { ...prev, suggestions: [] }
    );
  };

  const totalResults =
    state.results.wiki.length +
    state.results.posts.length +
    state.results.galleries.length +
    state.results.music.length +
    state.results.albums.length;

  const getMixedResultsCount = (type: "gallery" | "wiki" | "post") => {
    return state.mixedResults.filter((r) => r.sourceType === type).length;
  };

  const tabItems = state.isMixedSearch
    ? [
        { id: "semantic", label: "智能匹配", count: state.mixedResults.length },
        { id: "gallery", label: "图库", count: getMixedResultsCount("gallery") },
        { id: "wiki", label: "百科", count: getMixedResultsCount("wiki") },
        { id: "post", label: "帖子", count: getMixedResultsCount("post") },
      ]
    : [
        { id: "all", label: "全部", count: totalResults },
        { id: "wiki", label: "百科", count: state.results.wiki.length },
        { id: "posts", label: "帖子", count: state.results.posts.length },
        { id: "galleries", label: "图集", count: state.results.galleries.length },
        { id: "music", label: "音乐", count: state.results.music.length },
        { id: "albums", label: "专辑", count: state.results.albums.length },
      ];

  return {
    state,
    fileInputRef,
    tabItems,
    totalResults,
    performSearch,
    handleQueryChange,
    handleImageSearch,
    toggleTag,
    updateFilters,
    resetFilters,
    setActiveTab,
    setShowFilters,
    dismissSuggestions,
  };
}
