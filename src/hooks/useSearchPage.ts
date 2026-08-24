import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import type {
  WikiItem,
  PostItem,
  GalleryItem,
  SongItem,
  AlbumItem,
  LyricSearchItem,
} from '../types/entities'
import type { MixedSearchResult, SearchSuggestion, SearchFilters } from './useSearch'
import { useMixedSearch, useTraditionalSearch } from './useSearch'
import { useSearchHistory } from './useSearchHistory'
import type {
  GalleryDetailResponse,
  ImageSearchSessionPageResponse,
  ImageSearchSessionResponse,
  SearchMeta,
  SearchResultsResponse,
  SemanticSearchCategoryPages,
} from '../types/api'
import { apiGet } from '../lib/apiClient'
import {
  createEmptySearchResultPage,
  SEARCH_API_PAGE_PARAM_BY_CATEGORY,
  getSearchResultCount,
  SEARCH_CATEGORY_TYPE_BY_PAGE_PARAM,
  SEARCH_PAGE_PARAM_BY_CATEGORY,
  SEARCH_PAGE_PARAMS,
  clearSearchPaginationParams,
  type SearchPaginationCategory,
} from '../lib/searchPagination'
import {
  shouldWaitForGalleryThumbnail,
  THUMBNAIL_POLL_DEDUP_OPTIONS,
  THUMBNAIL_POLL_INTERVAL_MS,
  THUMBNAIL_POLL_MAX_ATTEMPTS,
} from '../lib/galleryThumbnails'
export type { SearchFilters } from './useSearch'
export type SearchResults = SearchResultsResponse

export interface SearchState {
  query: string
  includeDetail: boolean
  results: SearchResults
  loading: boolean
  loadingCategoryPages: ReadonlySet<SearchPaginationCategory>
  error: string | null
  pageErrorByCategory: Partial<Record<SearchPaginationCategory, string>>
  activeTab: string
  filters: SearchFilters
  suggestions: SearchSuggestion[]
  mixedResults: MixedSearchResult[]
  isMixedSearch: boolean
  aiSearching: boolean
  hotKeywords: string[]
  showFilters: boolean
  searchMeta?: SearchMeta
  imageSearchSessionId?: string | null
  imageCategoryPages?: SemanticSearchCategoryPages | null
}
function getSearchPageSignature(params: URLSearchParams) {
  return SEARCH_PAGE_PARAMS.map((param) => `${param}=${params.get(param) || ''}`).join('&')
}

function getPendingGalleryIds(state: SearchState) {
  const ids = new Set<string>()
  if (state.isMixedSearch) {
    state.mixedResults.forEach((result) => {
      if (result.sourceType !== 'gallery') return
      const gallery = result.data as GalleryItem
      if (shouldWaitForGalleryThumbnail(gallery)) ids.add(gallery.id)
    })
  } else {
    state.results.galleries.items.forEach((gallery) => {
      if (shouldWaitForGalleryThumbnail(gallery)) ids.add(gallery.id)
    })
  }
  return Array.from(ids)
}
export function useSearchPage(options?: { hotKeywordsEnabled?: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialQuery = searchParams.get('q') || ''
  const urlIncludeDetail = searchParams.get('detail') === '1'
  const hotKeywordsEnabled = options?.hotKeywordsEnabled ?? true

  // 搜索历史管理
  const {
    history: searchHistory,
    addToHistory,
    removeFromHistory: removeSearchHistoryItem,
    clearHistory: clearSearchHistory,
  } = useSearchHistory()

  // --- 原子搜索 hooks（委托层）---
  const mixedSearch = useMixedSearch()
  const traditionalSearch = useTraditionalSearch()

  const [state, setState] = useState<SearchState>({
    query: initialQuery,
    includeDetail: urlIncludeDetail,
    results: {
      wiki: createEmptySearchResultPage(),
      posts: createEmptySearchResultPage(),
      galleries: createEmptySearchResultPage(),
      music: createEmptySearchResultPage(),
      albums: createEmptySearchResultPage(),
      lyrics: createEmptySearchResultPage(),
    },
    loading: Boolean(initialQuery),
    loadingCategoryPages: new Set(),
    error: null,
    pageErrorByCategory: {},
    activeTab: 'all',
    filters: {
      selectedTags: [],
      dateRange: { start: '', end: '' },
      contentType: 'all',
      semanticImageSearch: false,
    },
    suggestions: [],
    imageSearchSessionId: null,
    imageCategoryPages: null,
    mixedResults: [],
    isMixedSearch: false,
    aiSearching: false,
    hotKeywords: [],
    showFilters: false,
    searchMeta: undefined,
  })

  const stateRef = useRef(state)
  stateRef.current = state
  // 搜索请求序号：丢弃过期响应，避免快速切换开关/换词时后返回者覆盖新结果
  const searchRequestRef = useRef(0)
  const suggestionRequestRef = useRef(0)
  const hotKeywordsRequestRef = useRef(0)
  const suggestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipNextUrlSearchRef = useRef(false)
  const searchContextSignatureRef = useRef<string | null>(null)
  const pageSignatureRef = useRef<string | null>(null)
  useEffect(() => {
    return () => {
      suggestionRequestRef.current += 1
      hotKeywordsRequestRef.current += 1
      if (suggestTimeoutRef.current) {
        clearTimeout(suggestTimeoutRef.current)
        suggestTimeoutRef.current = null
      }
    }
  }, [])
  useEffect(() => {
    const requestId = ++hotKeywordsRequestRef.current
    const loadHotKeywords = async () => {
      if (!hotKeywordsEnabled) {
        setState((prev) => ({ ...prev, hotKeywords: [] }))
        return
      }

      const keywords = await traditionalSearch.getHotKeywords()
      if (requestId === hotKeywordsRequestRef.current) {
        setState((prev) => ({ ...prev, hotKeywords: keywords }))
      }
    }
    void loadHotKeywords()
    return () => {
      hotKeywordsRequestRef.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotKeywordsEnabled])

  const searchPageSignature = getSearchPageSignature(searchParams)

  // 初始查询及 URL 驱动的详情状态变化；单个类别页码变化只请求该类别
  useEffect(() => {
    if (skipNextUrlSearchRef.current) {
      skipNextUrlSearchRef.current = false
      return
    }
    if (!initialQuery) return

    const contextSignature = `${initialQuery}\u0000${urlIncludeDetail ? '1' : '0'}`
    const previousPageSignature = pageSignatureRef.current
    const contextChanged = searchContextSignatureRef.current !== contextSignature
    const changedCategories =
      previousPageSignature === null
        ? []
        : SEARCH_PAGE_PARAMS.filter((param, index) => {
            if (param === SEARCH_PAGE_PARAM_BY_CATEGORY.semantic) return false
            const previous = previousPageSignature.split('&')[index]
            return previous !== `${param}=${searchParams.get(param) || ''}`
          }).flatMap((param) => [SEARCH_CATEGORY_TYPE_BY_PAGE_PARAM[param]])

    searchContextSignatureRef.current = contextSignature
    pageSignatureRef.current = searchPageSignature
    if (stateRef.current.includeDetail !== urlIncludeDetail) {
      setState((prev) => ({ ...prev, includeDetail: urlIncludeDetail }))
    }

    if (!contextChanged) {
      if (previousPageSignature === searchPageSignature) return
      if (changedCategories.length === 1) {
        const category = changedCategories[0]
        const page = Number(searchParams.get(SEARCH_PAGE_PARAM_BY_CATEGORY[category])) || 1
        void searchCategoryPage(category, page)
        return
      }
    }

    void performSearch(initialQuery, undefined, urlIncludeDetail, { preservePagination: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, urlIncludeDetail, searchPageSignature])
  const hasPendingGalleryThumbnails = getPendingGalleryIds(state).length > 0

  useEffect(() => {
    if (!hasPendingGalleryThumbnails) return
    const abortController = new AbortController()
    let attempts = 0
    let stopped = false
    let timeoutId: number | undefined

    const poll = async () => {
      attempts += 1
      const pendingIds = getPendingGalleryIds(stateRef.current)
      if (pendingIds.length === 0) return

      try {
        const refreshed = await Promise.all(
          pendingIds.map(async (galleryId) => {
            const data = await apiGet<GalleryDetailResponse>(
              `/api/galleries/${galleryId}`,
              undefined,
              THUMBNAIL_POLL_DEDUP_OPTIONS,
              abortController.signal
            )
            return data.gallery
          })
        )
        if (stopped) return
        const refreshedById = new Map(refreshed.map((gallery) => [gallery.id, gallery]))
        setState((prev) => {
          const hasChanged = prev.results.galleries.items.some((gallery) => {
            const refreshedGallery = refreshedById.get(gallery.id)
            if (!refreshedGallery) return false
            return gallery.images.some((image, index) => {
              const refreshedImage = refreshedGallery.images[index]
              return (
                refreshedImage &&
                (image.thumbnailUrl !== refreshedImage.thumbnailUrl ||
                  image.thumbnailStatus !== refreshedImage.thumbnailStatus)
              )
            })
          })
          if (!hasChanged) return prev
          return {
            ...prev,
            results: {
              ...prev.results,
              galleries: {
                ...prev.results.galleries,
                items: prev.results.galleries.items.map(
                  (gallery) => refreshedById.get(gallery.id) || gallery
                ) as GalleryItem[],
              },
            },
            mixedResults: prev.isMixedSearch
              ? prev.mixedResults.map((result) => {
                  if (result.sourceType !== 'gallery') return result
                  const gallery = refreshedById.get((result.data as GalleryItem).id)
                  return gallery ? { ...result, data: gallery } : result
                })
              : prev.mixedResults,
          }
        })
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('Poll search gallery thumbnails error:', error)
        }
      }

      if (!stopped && attempts < THUMBNAIL_POLL_MAX_ATTEMPTS) {
        timeoutId = window.setTimeout(poll, THUMBNAIL_POLL_INTERVAL_MS)
      }
    }

    timeoutId = window.setTimeout(poll, THUMBNAIL_POLL_INTERVAL_MS)

    return () => {
      stopped = true
      abortController.abort()
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [hasPendingGalleryThumbnails])

  // 搜索建议 -- 委托给 traditionalSearch.getSuggestions()
  const fetchSuggestions = useCallback(
    async (q: string) => {
      const requestId = ++suggestionRequestRef.current
      if (!q || q.length < 2) {
        setState((prev) => ({ ...prev, suggestions: [] }))
        return
      }
      const suggestions = await traditionalSearch.getSuggestions(q)
      if (requestId === suggestionRequestRef.current) {
        setState((prev) => ({ ...prev, suggestions }))
      }
    },
    [traditionalSearch]
  )
  const handleQueryChange = (val: string) => {
    setState((prev) => ({ ...prev, query: val }))
    if (suggestTimeoutRef.current) clearTimeout(suggestTimeoutRef.current)
    suggestTimeoutRef.current = setTimeout(() => fetchSuggestions(val), 300)
  }

  // 传统搜索 -- 委托给 traditionalSearch.search()
  const performSearch = useCallback(
    async (
      q: string,
      filtersOverride?: Partial<SearchFilters>,
      detailOverride?: boolean,
      options?: { preservePagination?: boolean }
    ) => {
      const currentQuery = (q || stateRef.current.query).trim()
      if (!currentQuery) return

      const requestId = ++searchRequestRef.current
      const includeDetail = detailOverride ?? stateRef.current.includeDetail

      addToHistory(currentQuery)

      if (suggestTimeoutRef.current) {
        clearTimeout(suggestTimeoutRef.current)
        suggestTimeoutRef.current = null
      }

      setState((prev) => ({
        ...prev,
        loading: true,
        loadingCategoryPages: new Set(),
        error: null,
        pageErrorByCategory: {},
        query: currentQuery,
      }))

      let sp = new URLSearchParams(searchParams)
      sp.set('q', currentQuery)
      if (includeDetail) {
        sp.set('detail', '1')
      } else {
        sp.delete('detail')
      }
      if (!options?.preservePagination) {
        sp = clearSearchPaginationParams(sp)
      }
      searchContextSignatureRef.current = `${currentQuery}\u0000${includeDetail ? '1' : '0'}`
      pageSignatureRef.current = getSearchPageSignature(sp)
      if (sp.toString() !== searchParams.toString()) {
        skipNextUrlSearchRef.current = true
        setSearchParams(sp)
      }
      const filters = { ...stateRef.current.filters, ...filtersOverride }
      const searchMode = filters.semanticImageSearch ? 'hybrid' : 'keyword'
      const pageParams = options?.preservePagination
        ? Object.fromEntries(
            Object.entries(SEARCH_API_PAGE_PARAM_BY_CATEGORY).flatMap(([category, apiParam]) => {
              const browserParam =
                SEARCH_PAGE_PARAM_BY_CATEGORY[category as SearchPaginationCategory]
              const value = Number(sp.get(browserParam))
              return Number.isInteger(value) && value > 0 ? [[apiParam, value]] : []
            })
          )
        : {}

      try {
        const data = await traditionalSearch.search(currentQuery, filters, {
          mode: searchMode,
          includeDetail,
          requestType: 'all',
          pageParams,
        })
        if (requestId !== searchRequestRef.current) return

        setState((prev) => ({
          ...prev,
          results: data,
          isMixedSearch: false,
          mixedResults: [],
          imageSearchSessionId: null,
          imageCategoryPages: null,
          loading: false,
          loadingCategoryPages: new Set(),
          error: null,
          pageErrorByCategory: {},
          searchMeta: data.searchMeta,
        }))
      } catch (error) {
        if (requestId !== searchRequestRef.current) return
        console.error('Search error:', error)
        setState((prev) => ({
          ...prev,
          loading: false,
          loadingCategoryPages: new Set(),
          error: error instanceof Error ? error.message : '搜索失败',
        }))
      }
    },
    [searchParams, addToHistory, traditionalSearch]
  )

  const searchCategoryPage = useCallback(
    async (category: SearchPaginationCategory, page: number) => {
      const currentQuery = stateRef.current.query.trim()
      if (!currentQuery || stateRef.current.isMixedSearch) return

      const requestId = ++searchRequestRef.current
      const filters = stateRef.current.filters
      const includeDetail = stateRef.current.includeDetail
      const searchMode = filters.semanticImageSearch ? 'hybrid' : 'keyword'
      const previousPage = stateRef.current.results[category].page
      const pageParam = SEARCH_API_PAGE_PARAM_BY_CATEGORY[category]
      const browserPageParam = SEARCH_PAGE_PARAM_BY_CATEGORY[category]
      const expectedParams = new URLSearchParams(searchParams)
      if (page > 1) expectedParams.set(browserPageParam, String(page))
      else expectedParams.delete(browserPageParam)
      pageSignatureRef.current = getSearchPageSignature(expectedParams)

      setState((prev) => {
        const loadingCategoryPages = new Set(prev.loadingCategoryPages)
        loadingCategoryPages.add(category)
        const pageErrorByCategory = { ...prev.pageErrorByCategory }
        delete pageErrorByCategory[category]
        return { ...prev, loadingCategoryPages, pageErrorByCategory }
      })

      try {
        const data = await traditionalSearch.search(currentQuery, filters, {
          mode: searchMode,
          includeDetail,
          requestType: category,
          pageParams: { [pageParam]: page },
        })
        if (requestId !== searchRequestRef.current) return

        const categoryPage = data[category]
        if (categoryPage.total > 0 && categoryPage.items.length === 0) {
          throw new Error('搜索分页返回了空结果')
        }
        setState((prev) => {
          const loadingCategoryPages = new Set(prev.loadingCategoryPages)
          loadingCategoryPages.delete(category)
          const pageErrorByCategory = { ...prev.pageErrorByCategory }
          delete pageErrorByCategory[category]
          return {
            ...prev,
            results: { ...prev.results, [category]: categoryPage },
            loadingCategoryPages,
            pageErrorByCategory,
          }
        })
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev)
            if (categoryPage.page > 1) next.set(browserPageParam, String(categoryPage.page))
            else next.delete(browserPageParam)
            if (next.toString() === prev.toString()) return prev
            pageSignatureRef.current = getSearchPageSignature(next)
            skipNextUrlSearchRef.current = true
            return next
          },
          { replace: true }
        )
      } catch (error) {
        if (requestId !== searchRequestRef.current) return
        const message = error instanceof Error ? error.message : '搜索分页失败'
        setState((prev) => {
          const loadingCategoryPages = new Set(prev.loadingCategoryPages)
          loadingCategoryPages.delete(category)
          return {
            ...prev,
            loadingCategoryPages,
            pageErrorByCategory: { ...prev.pageErrorByCategory, [category]: message },
          }
        })
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev)
            if (previousPage > 1) next.set(browserPageParam, String(previousPage))
            else next.delete(browserPageParam)
            if (next.toString() === prev.toString()) return prev
            pageSignatureRef.current = getSearchPageSignature(next)
            skipNextUrlSearchRef.current = true
            return next
          },
          { replace: true }
        )
      }
    },
    [searchParams, setSearchParams, traditionalSearch]
  )

  // 图片搜索 -- 委托给 mixedSearch.searchByImage()
  const handleImageSearch = useCallback(
    async (file: File) => {
      const requestId = ++searchRequestRef.current
      setSearchParams(
        (prev) => {
          const next = clearSearchPaginationParams(prev)
          next.delete('q')
          next.delete('detail')
          return next
        },
        { replace: true }
      )
      setState((prev) => ({
        ...prev,
        aiSearching: true,
        loading: true,
        loadingCategoryPages: new Set(),
        error: null,
        pageErrorByCategory: {},
      }))
      try {
        const response = await mixedSearch.searchByImage(file)
        if (requestId !== searchRequestRef.current) return
        setState((prev) => ({
          ...prev,
          isMixedSearch: true,
          imageSearchSessionId: response.sessionId,
          imageCategoryPages: response.categoryPages,
          mixedResults: response.results.items,
          activeTab: 'semantic',
          loading: false,
          error: null,
          aiSearching: false,
        }))
      } catch (error) {
        if (requestId !== searchRequestRef.current) return
        console.error('Semantic image search error:', error)
        setState((prev) => ({
          ...prev,
          mixedResults: [],
          loading: false,
          error: error instanceof Error ? error.message : '图片搜索失败',
          aiSearching: false,
        }))
      }
    },
    [mixedSearch, setSearchParams]
  )
  // 搜索详情开关：翻转状态并同步 URL；已有查询时立即按新开关重搜
  const toggleDetail = (checked: boolean) => {
    setState((prev) => ({ ...prev, includeDetail: checked }))
    const query = stateRef.current.query.trim()
    if (query) {
      void performSearch(query, undefined, checked)
      return
    }

    const sp = new URLSearchParams(searchParams)
    if (checked) sp.set('detail', '1')
    else sp.delete('detail')
    if (sp.toString() !== searchParams.toString()) setSearchParams(sp)
  }

  const fetchImageSearchPage = useCallback(
    async (source: 'semantic' | 'wiki' | 'post' | 'gallery', page: number) => {
      const sessionId = stateRef.current.imageSearchSessionId
      if (!sessionId) return
      const requestId = ++searchRequestRef.current
      setState((prev) => ({ ...prev, loading: true, error: null }))
      try {
        const response = await apiGet<ImageSearchSessionPageResponse>(
          `/api/search/by-image/${sessionId}`,
          { source, page }
        )
        if (requestId !== searchRequestRef.current) return
        setState((prev) => {
          const activeSource =
            prev.activeTab === 'wiki' || prev.activeTab === 'post' || prev.activeTab === 'gallery'
              ? prev.activeTab
              : 'semantic'
          return {
            ...prev,
            mixedResults: activeSource === source ? response.results.items : prev.mixedResults,
            loading: false,
            error: null,
            imageCategoryPages: prev.imageCategoryPages
              ? { ...prev.imageCategoryPages, [source]: response.results }
              : prev.imageCategoryPages,
          }
        })
      } catch (error) {
        if (requestId !== searchRequestRef.current) return
        const message = error instanceof Error ? error.message : '图片搜索分页失败'
        const expired = message.includes('过期') || message.includes('410')
        setState((prev) => ({
          ...prev,
          loading: false,
          error: message,
          ...(expired
            ? { imageSearchSessionId: null, imageCategoryPages: null, mixedResults: [] }
            : {}),
        }))
      }
    },
    []
  )

  const toggleTag = (tag: string) => {
    setState((prev) => ({
      ...prev,
      filters: {
        ...prev.filters,
        selectedTags: prev.filters.selectedTags.includes(tag)
          ? prev.filters.selectedTags.filter((t) => t !== tag)
          : [...prev.filters.selectedTags, tag],
      },
    }))
  }

  const updateFilters = (filters: Partial<SearchFilters>) => {
    setState((prev) => ({
      ...prev,
      filters: { ...prev.filters, ...filters },
    }))
  }

  const resetFilters = () => {
    setState((prev) => ({
      ...prev,
      filters: {
        selectedTags: [],
        dateRange: { start: '', end: '' },
        contentType: 'all',
        semanticImageSearch: false,
      },
    }))
  }

  const setActiveTab = (tab: string) => {
    setState((prev) => {
      if (!prev.isMixedSearch || !prev.imageCategoryPages) {
        return { ...prev, activeTab: tab }
      }
      const source = tab === 'wiki' || tab === 'post' || tab === 'gallery' ? tab : 'semantic'
      return { ...prev, activeTab: tab, mixedResults: prev.imageCategoryPages[source].items }
    })
  }

  const setShowFilters = (show: boolean) => {
    setState((prev) => ({ ...prev, showFilters: show }))
  }

  const dismissSuggestions = () => {
    setState((prev) => (prev.suggestions.length === 0 ? prev : { ...prev, suggestions: [] }))
  }

  const resultCounts = {
    wiki: getSearchResultCount(state.results.wiki),
    posts: getSearchResultCount(state.results.posts),
    galleries: getSearchResultCount(state.results.galleries),
    music: getSearchResultCount(state.results.music),
    albums: getSearchResultCount(state.results.albums),
    lyrics: getSearchResultCount(state.results.lyrics),
  }
  const totalResults = Object.values(resultCounts).reduce((sum, count) => sum + count, 0)
  const getMixedResultsCount = (type: 'gallery' | 'wiki' | 'post') =>
    state.mixedResults.filter((r) => r.sourceType === type).length

  const tabItems = (
    state.isMixedSearch
      ? [
          {
            id: 'semantic',
            label: '智能匹配',
            count: state.imageCategoryPages?.semantic.total ?? state.mixedResults.length,
          },
          {
            id: 'gallery',
            label: '图库',
            count: state.imageCategoryPages?.gallery.total ?? getMixedResultsCount('gallery'),
          },
          {
            id: 'wiki',
            label: '百科',
            count: state.imageCategoryPages?.wiki.total ?? getMixedResultsCount('wiki'),
          },
          {
            id: 'post',
            label: '帖子',
            count: state.imageCategoryPages?.post.total ?? getMixedResultsCount('post'),
          },
        ]
      : [
          { id: 'all', label: '全部', count: totalResults },
          { id: 'wiki', label: '百科', count: resultCounts.wiki },
          { id: 'posts', label: '帖子', count: resultCounts.posts },
          { id: 'galleries', label: '图集', count: resultCounts.galleries },
          { id: 'music', label: '音乐', count: resultCounts.music },
          ...(resultCounts.lyrics > 0
            ? [{ id: 'lyrics', label: '歌词', count: resultCounts.lyrics }]
            : []),
          { id: 'albums', label: '专辑', count: resultCounts.albums },
        ]
  ).filter((tab) => tab.id === 'all' || tab.count > 0)

  return {
    state,
    searchHistory,
    tabItems,
    totalResults,
    performSearch,
    searchCategoryPage,
    fetchImageSearchPage,
    handleQueryChange,
    handleImageSearch,
    toggleDetail,
    toggleTag,
    updateFilters,
    resetFilters,
    setActiveTab,
    setShowFilters,
    dismissSuggestions,
    removeSearchHistoryItem,
    clearSearchHistory,
  }
}
