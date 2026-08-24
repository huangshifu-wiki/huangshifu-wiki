import { useState, useCallback } from 'react'
import { createEmptySearchResultPage } from '../lib/searchPagination'
import { apiGet, apiUpload } from '../lib/apiClient'
import type {
  ImageSearchSessionResponse,
  SearchResultsResponse,
  SemanticSearchResult,
} from '../types/api'

export type { SearchMeta, SearchResultsResponse, SemanticSearchResult } from '../types/api'

/**
 * 图片来源类型
 */
export type ImageSourceType = SemanticSearchResult['sourceType']

export type MixedSearchResult = SemanticSearchResult
export type ImageSearchResponse = ImageSearchSessionResponse

/**
 * 搜索建议项
 */
export interface SearchSuggestion {
  type: 'keyword' | 'wiki' | 'post' | 'music' | 'album'
  text: string
  subtext?: string
  id?: string
}

export type TraditionalSearchResults = SearchResultsResponse

const EMPTY_TRADITIONAL_RESULTS: TraditionalSearchResults = {
  wiki: createEmptySearchResultPage(),
  posts: createEmptySearchResultPage(),
  galleries: createEmptySearchResultPage(),
  music: createEmptySearchResultPage(),
  albums: createEmptySearchResultPage(),
  lyrics: createEmptySearchResultPage(),
}

/**
 * 搜索过滤器
 */
export interface SearchFilters {
  selectedTags: string[]
  dateRange: { start: string; end: string }
  contentType: 'all' | 'wiki' | 'posts' | 'galleries' | 'music' | 'albums' | 'lyrics'
  semanticImageSearch: boolean
}

/**
 * 图片搜索请求委托。
 * 搜索结果和加载状态由 useSearchPage 统一管理，避免维护第二份状态树。
 */
export function useMixedSearch() {
  const searchByImage = useCallback(
    async (file: File, options?: { minScore?: number }): Promise<ImageSearchResponse> => {
      const formData = new FormData()
      formData.append('image', file)
      if (options?.minScore !== undefined) {
        formData.append('minScore', String(options.minScore))
      }
      return apiUpload<ImageSearchResponse>('/api/search/by-image', formData)
    },
    []
  )

  return { searchByImage }
}

/**
 * 使用传统搜索的 Hook
 */
export function useTraditionalSearch() {
  const [results, setResults] = useState<TraditionalSearchResults>(EMPTY_TRADITIONAL_RESULTS)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * 执行传统搜索
   */
  const search = useCallback(
    async (
      query: string,
      filters?: Partial<SearchFilters>,
      options?: {
        mode?: 'keyword' | 'vector' | 'hybrid'
        includeDetail?: boolean
        pageParams?: Record<string, number>
      }
    ): Promise<TraditionalSearchResults> => {
      if (!query.trim()) {
        setResults(EMPTY_TRADITIONAL_RESULTS)
        return EMPTY_TRADITIONAL_RESULTS
      }

      setLoading(true)
      setError(null)

      try {
        const typeMap: Record<string, string> = {
          wiki: 'wiki',
          posts: 'posts',
          galleries: 'galleries',
          music: 'music',
          albums: 'albums',
          lyrics: 'lyrics',
        }
        const apiType =
          filters?.contentType === 'all' || !filters?.contentType
            ? 'all'
            : typeMap[filters.contentType] || 'all'

        const mode = options?.mode || 'keyword'

        const data = await apiGet<TraditionalSearchResults>('/api/search', {
          q: query.trim(),
          type: apiType,
          mode,
          ...(options?.includeDetail ? { detail: '1' } : {}),
          ...(filters?.dateRange?.start ? { startDate: filters.dateRange.start } : {}),
          ...(filters?.dateRange?.end ? { endDate: filters.dateRange.end } : {}),
          ...(filters?.selectedTags?.length ? { tags: filters.selectedTags.join(',') } : {}),
          ...options?.pageParams,
        })

        setResults(data)
        return data
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : '搜索失败'
        setError(errorMsg)
        console.error('Traditional search error:', err)
        throw err
      } finally {
        setLoading(false)
      }
    },
    []
  )

  /**
   * 获取搜索建议
   */
  const getSuggestions = useCallback(async (query: string): Promise<SearchSuggestion[]> => {
    if (!query || query.length < 2) {
      return []
    }

    try {
      const data = await apiGet<{ suggestions: SearchSuggestion[] }>('/api/search/suggest', {
        q: query,
      })
      return data.suggestions || []
    } catch (err) {
      console.error('Search suggest error:', err)
      return []
    }
  }, [])

  /**
   * 获取热门关键词
   */
  const getHotKeywords = useCallback(async (): Promise<string[]> => {
    try {
      const data = await apiGet<{ keywords: Array<{ keyword: string; count: number }> }>(
        '/api/search/hot-keywords'
      )
      return data.keywords?.map((k) => k.keyword) || []
    } catch (err) {
      console.error('Fetch hot keywords error:', err)
      return []
    }
  }, [])

  /**
   * 清空结果
   */
  const clearResults = useCallback(() => {
    setResults(EMPTY_TRADITIONAL_RESULTS)
    setError(null)
  }, [])

  return {
    results,
    loading,
    error,
    search,
    getSuggestions,
    getHotKeywords,
    clearResults,
  }
}
