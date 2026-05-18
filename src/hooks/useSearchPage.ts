import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import type { WikiItem, PostItem, GalleryItem, SongItem, AlbumItem } from "../types/entities";
import type {
  MixedSearchResult,
  SearchSuggestion,
  SearchFilters,
  SearchMeta,
} from "./useSearch";
import { useMixedSearch, useTraditionalSearch } from "./useSearch";
import type { TextSearchResult } from "../types/api";
import { useSearchHistory } from "./useSearchHistory";

// 向后兼容：re-export SearchFilters，供 SearchFilters 组件使用
export type { SearchFilters } from "./useSearch";

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
  searchMeta?: SearchMeta
  textSemanticResults: TextSearchResult[]
}

export function useSearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") || "";

  // 搜索历史管理
  const { addToHistory } = useSearchHistory();

  // --- 原子搜索 hooks（委托层）---
  const mixedSearch = useMixedSearch();
  const traditionalSearch = useTraditionalSearch();

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
    textSemanticResults: [],
  });

  const stateRef = useRef(state)
  stateRef.current = state

  const suggestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 获取热门关键词 -- 委托给 traditionalSearch.getHotKeywords()
  useEffect(() => {
    const loadHotKeywords = async () => {
      const keywords = await traditionalSearch.getHotKeywords();
      setState((prev) => ({ ...prev, hotKeywords: keywords }));
    };
    loadHotKeywords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 初始查询
  useEffect(() => {
    if (initialQuery) {
      performSearch(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  // 搜索建议 -- 委托给 traditionalSearch.getSuggestions()
  const fetchSuggestions = useCallback(async (q: string) => {
    if (!q || q.length < 2) {
      setState((prev) => ({ ...prev, suggestions: [] }));
      return;
    }
    const suggestions = await traditionalSearch.getSuggestions(q);
    setState((prev) => ({ ...prev, suggestions }));
  }, [traditionalSearch]);

  const handleQueryChange = (val: string) => {
    setState((prev) => ({ ...prev, query: val }));
    if (suggestTimeoutRef.current) clearTimeout(suggestTimeoutRef.current);
    suggestTimeoutRef.current = setTimeout(() => fetchSuggestions(val), 300);
  };

  // 混合（语义文字）搜索 -- 委托给 mixedSearch.searchByText()
  const performMixedSearch = useCallback(
    async (q: string, limit = 24): Promise<MixedSearchResult[]> => {
      return mixedSearch.searchByText(q, { limit });
    },
    [mixedSearch]
  );

  // 传统搜索 -- 委托给 traditionalSearch.search()
  // 保留编排逻辑：历史记录、URL 同步、标签过滤、searchMeta
  const performSearch = useCallback(
    async (q: string, filtersOverride?: Partial<SearchFilters>) => {
      const currentQuery = q || stateRef.current.query;
      if (!currentQuery.trim()) return;

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

      const sp = new URLSearchParams(searchParams);
      sp.set("q", currentQuery);
      setSearchParams(sp);

      const filters = { ...stateRef.current.filters, ...filtersOverride }
      const searchMode = filters.semanticImageSearch ? 'hybrid' : 'keyword'

      try {
        const data = await traditionalSearch.search(currentQuery, filters, { mode: searchMode })

        const filterFn = (item: WikiItem | PostItem | GalleryItem) => {
          const matchesTags =
            filters.selectedTags.length === 0 ||
            filters.selectedTags.every((tag: string) =>
              (item.tags || []).includes(tag)
            )
          return matchesTags
        }

        setState((prev) => ({
          ...prev,
          results: {
            wiki: data.wiki.filter(filterFn) as WikiItem[],
            posts: data.posts.filter(filterFn) as PostItem[],
            galleries: data.galleries.filter(filterFn) as GalleryItem[],
            music: data.music as SongItem[],
            albums: data.albums as AlbumItem[],
          },
          isMixedSearch: false,
          mixedResults: [],
          loading: false,
          searchMeta: data.searchMeta,
          textSemanticResults: [],
        }));
      } catch (e) {
        console.error("Search error:", e);
        setState((prev) => ({ ...prev, loading: false }));
      }
    },
    [searchParams, addToHistory, traditionalSearch]
  );

  // 图片搜索 -- 委托给 mixedSearch.searchByImage()
  const handleImageSearch = useCallback(
    async (file: File) => {
      setState((prev) => ({
        ...prev,
        aiSearching: true,
        loading: true,
        hasSearched: true,
      }));
      try {
        const results = await mixedSearch.searchByImage(file, { limit: 24 });
        setState((prev) => ({
          ...prev,
          isMixedSearch: true,
          mixedResults: results,
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
    },
    [mixedSearch]
  );

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
    state.results.albums.length +
    (state.textSemanticResults?.length ?? 0);

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
        ...(state.textSemanticResults.length > 0
          ? [{ id: "textSemantic" as const, label: "语义匹配", count: state.textSemanticResults.length }]
          : []),
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
