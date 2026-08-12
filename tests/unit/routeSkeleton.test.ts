import { describe, expect, it } from 'vitest'

import { getRouteSkeletonVariant } from '../../src/lib/routeSkeleton'

describe('getRouteSkeletonVariant', () => {
  it.each([
    ['/', 'default'],
    ['/music', 'music'],
    ['/music/123', 'music'],
    ['/gallery', 'gallery'],
    ['/gallery/123/edit', 'gallery'],
    ['/events', 'events'],
    ['/events/123', 'events'],
    ['/wiki', 'wiki'],
    ['/wiki/intro/history', 'wiki'],
    ['/forum', 'forum'],
    ['/forum/123/edit', 'forum'],
    ['/forumatic', 'default'],
    ['/settings', 'default'],
  ] as const)('maps %s to %s', (pathname, expectedVariant) => {
    expect(getRouteSkeletonVariant(pathname)).toBe(expectedVariant)
  })
})
