const PRIVATE_EXACT_PATHS = new Set([
  '/login',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/setup',
])

const PRIVATE_PREFIXES = ['/admin', '/settings', '/users/', '/__ui']

// 编辑、上传创建与协作（分支/PR/历史）类子路径段
const PRIVATE_SEGMENTS = new Set(['edit', 'new', 'history', 'branches', 'prs', 'pr'])

// 私有路径判定：客户端 meta 与服务端 X-Robots-Tag 共用同一份策略，避免两侧不一致
export const isPrivateSeoPath = (pathname: string): boolean => {
  const segments = pathname.split('/').filter(Boolean)
  return (
    PRIVATE_EXACT_PATHS.has(pathname) ||
    PRIVATE_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    segments.some((segment) => PRIVATE_SEGMENTS.has(segment))
  )
}
