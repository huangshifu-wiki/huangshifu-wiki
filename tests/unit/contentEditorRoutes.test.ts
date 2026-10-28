import { describe, expect, it } from 'vitest'
import {
  getContentBackgroundLocation,
  getContentEditorRoute,
} from '../../src/lib/contentEditorRoutes'
import type { Location } from 'react-router-dom'

const location = (pathname: string, state: unknown = null): Location => ({
  pathname,
  search: '?tab=latest',
  hash: '#item',
  state,
  key: 'entry-1',
})

describe('content editor route mapping', () => {
  it.each([
    ['/wiki/new', '/wiki'],
    ['/wiki/example/edit', '/wiki'],
    ['/forum/new', '/forum'],
    ['/forum/post-1/edit', '/forum'],
    ['/gallery/new', '/gallery'],
    ['/gallery/123/edit', '/gallery'],
    ['/tickets/new', '/tickets'],
    ['/tickets/example/edit', '/tickets'],
    ['/admin/events/new', '/admin/events'],
  ] as const)('uses the correct list background for %s', (pathname, fallbackPath) => {
    expect(getContentBackgroundLocation(location(pathname)).pathname).toBe(fallbackPath)
  })

  it.each([
    '/wiki',
    '/wiki/example',
    '/wiki/example/history',
    '/wiki/example/branches',
    '/wiki/example/prs/123',
    '/forum/post-1',
    '/gallery/123',
    '/tickets/example',
    '/admin/events',
    '/settings/profile',
  ])('does not treat %s as an editor route', (pathname) => {
    expect(getContentEditorRoute(pathname)).toBeNull()
  })

  it('uses a real background location with its search, hash, key, and state', () => {
    const background = location('/forum', { page: 2 })
    const current = location('/forum/new', { editorBackground: background })

    expect(getContentBackgroundLocation(current)).toBe(background)
  })

  it.each([
    null,
    { pathname: '//elsewhere.example', search: '', hash: '', state: null, key: 'x' },
    { pathname: '/forum/new', search: '', hash: '', state: null, key: 'x' },
    { pathname: '/forum', search: 'page=2', hash: '', state: null, key: 'x' },
    { pathname: '/forum', search: '', hash: '', key: 'x' },
  ])('uses the list as fallback for invalid editor background %j', (background) => {
    expect(
      getContentBackgroundLocation(location('/forum/new', { editorBackground: background }))
    ).toEqual({
      pathname: '/forum',
      search: '',
      hash: '',
      state: null,
      key: 'content-editor-fallback',
    })
  })

  it('does not rewrite ordinary page locations', () => {
    const current = location('/forum', { page: 2 })

    expect(getContentBackgroundLocation(current)).toBe(current)
  })
})
