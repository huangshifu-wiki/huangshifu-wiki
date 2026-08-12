export type RouteSkeletonVariant = 'default' | 'wiki' | 'gallery' | 'music' | 'forum' | 'events'

const ROUTE_SKELETON_VARIANTS: Array<{
  basePath: string
  variant: Exclude<RouteSkeletonVariant, 'default'>
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
