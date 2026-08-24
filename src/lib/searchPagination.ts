export const SEARCH_PAGE_SIZE = 20

export const SEARCH_PAGINATION_DOCK_GROUP = 'search-results'

export type SearchPaginationCategory =
  | 'wiki'
  | 'posts'
  | 'galleries'
  | 'music'
  | 'lyrics'
  | 'albums'

export const SEARCH_PAGE_PARAM_BY_CATEGORY = {
  semantic: 'searchSemanticPage',
  wiki: 'searchWikiPage',
  posts: 'searchPostsPage',
  galleries: 'searchGalleriesPage',
  music: 'searchMusicPage',
  lyrics: 'searchLyricsPage',
  albums: 'searchAlbumsPage',
} as const
export const SEARCH_API_PAGE_PARAM_BY_CATEGORY = {
  wiki: 'wikiPage',
  posts: 'postsPage',
  galleries: 'galleriesPage',
  music: 'musicPage',
  lyrics: 'lyricsPage',
  albums: 'albumsPage',
} as const satisfies Record<SearchPaginationCategory, string>
export const SEARCH_CATEGORY_TYPE_BY_PAGE_PARAM = {
  [SEARCH_PAGE_PARAM_BY_CATEGORY.wiki]: 'wiki',
  [SEARCH_PAGE_PARAM_BY_CATEGORY.posts]: 'posts',
  [SEARCH_PAGE_PARAM_BY_CATEGORY.galleries]: 'galleries',
  [SEARCH_PAGE_PARAM_BY_CATEGORY.music]: 'music',
  [SEARCH_PAGE_PARAM_BY_CATEGORY.lyrics]: 'lyrics',
  [SEARCH_PAGE_PARAM_BY_CATEGORY.albums]: 'albums',
} as const

export const SEARCH_PAGE_PARAMS = Object.freeze(Object.values(SEARCH_PAGE_PARAM_BY_CATEGORY))
export function clearSearchPaginationParams(params: URLSearchParams) {
  const next = new URLSearchParams(params)
  SEARCH_PAGE_PARAMS.forEach((param) => next.delete(param))
  return next
}

import type { SearchResultPage } from '../types/api'
export function getSearchResultCount<T>(page: SearchResultPage<T>) {
  return Math.max(page.total, page.items.length)
}

export const createEmptySearchResultPage = <T>(): SearchResultPage<T> => ({
  items: [],
  total: 0,
  page: 1,
  limit: SEARCH_PAGE_SIZE,
  totalPages: 1,
  hasMore: false,
})
