import { matchPath, type Location } from 'react-router-dom'

type ContentEditorRoute = {
  path: string
  fallbackPath: string
}

type EditorLocationState = {
  editorBackground?: Location
}

const EDITOR_ROUTES: ContentEditorRoute[] = [
  { path: '/wiki/new', fallbackPath: '/wiki' },
  { path: '/wiki/:slug/edit', fallbackPath: '/wiki' },
  { path: '/forum/new', fallbackPath: '/forum' },
  { path: '/forum/:postId/edit', fallbackPath: '/forum' },
  { path: '/gallery/new', fallbackPath: '/gallery' },
  { path: '/gallery/:galleryId/edit', fallbackPath: '/gallery' },
  { path: '/tickets/new', fallbackPath: '/tickets' },
  { path: '/tickets/:slug/edit', fallbackPath: '/tickets' },
  { path: '/admin/events/new', fallbackPath: '/admin/events' },
]

export const getContentEditorRoute = (pathname: string): ContentEditorRoute | null => {
  for (const route of EDITOR_ROUTES) {
    if (matchPath({ path: route.path, end: true }, pathname)) {
      return route
    }
  }
  return null
}

const isEditorBackgroundLocation = (value: unknown): value is Location => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Location>
  return (
    typeof candidate.pathname === 'string' &&
    candidate.pathname.startsWith('/') &&
    !candidate.pathname.startsWith('//') &&
    !getContentEditorRoute(candidate.pathname) &&
    typeof candidate.search === 'string' &&
    (candidate.search === '' || candidate.search.startsWith('?')) &&
    typeof candidate.hash === 'string' &&
    (candidate.hash === '' || candidate.hash.startsWith('#')) &&
    typeof candidate.key === 'string' &&
    'state' in candidate
  )
}

export const getContentBackgroundLocation = (location: Location): Location => {
  const editorRoute = getContentEditorRoute(location.pathname)
  if (!editorRoute) return location

  const state = location.state as EditorLocationState | null
  if (isEditorBackgroundLocation(state?.editorBackground)) {
    return state.editorBackground
  }

  return {
    pathname: editorRoute.fallbackPath,
    search: '',
    hash: '',
    state: null,
    key: 'content-editor-fallback',
  }
}
