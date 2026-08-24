export const SEARCH_PAGE_SIZE = 20

export const SEARCH_PAGINATION_DOCK_GROUP = 'search-results'

export const SEARCH_PAGE_PARAM_BY_CATEGORY = {
  semantic: 'searchSemanticPage',
  wiki: 'searchWikiPage',
  posts: 'searchPostsPage',
  galleries: 'searchGalleriesPage',
  music: 'searchMusicPage',
  lyrics: 'searchLyricsPage',
  albums: 'searchAlbumsPage',
} as const

export const SEARCH_PAGE_PARAMS = Object.freeze(Object.values(SEARCH_PAGE_PARAM_BY_CATEGORY))
export function clearSearchPaginationParams(params: URLSearchParams) {
  const next = new URLSearchParams(params)
  SEARCH_PAGE_PARAMS.forEach((param) => next.delete(param))
  return next
}
