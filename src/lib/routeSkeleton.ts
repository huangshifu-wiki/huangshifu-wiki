import type { PageSkeletonVariant } from '../components/PageSkeleton'

export type RouteSkeletonVariant = PageSkeletonVariant

const ROUTE_SKELETON_VARIANTS: Array<{
  basePath: string
  variant: Extract<PageSkeletonVariant, 'wiki' | 'gallery' | 'music' | 'forum' | 'events'>
}> = [
  { basePath: '/music', variant: 'music' },
  { basePath: '/gallery', variant: 'gallery' },
  { basePath: '/events', variant: 'events' },
  { basePath: '/wiki', variant: 'wiki' },
  { basePath: '/forum', variant: 'forum' },
]

export function getRouteSkeletonVariant(pathname: string): RouteSkeletonVariant {
  const match = ROUTE_SKELETON_VARIANTS.find(
    ({ basePath }) => pathname === basePath || pathname.startsWith(`${basePath}/`)
  )

  return match?.variant ?? 'default'
}
