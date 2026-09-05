import type { Request } from 'express'
import { isPrivateSeoPath } from '../../lib/seoPrivatePaths'
import { logger } from './logger'

export const PUBLIC_SITE_URL_ENV = 'PUBLIC_SITE_URL'

// 生成站点根 URL：优先读取 PUBLIC_SITE_URL；未配置或非法时退回请求协议 + Host
export const getPublicSiteUrl = (req: Request): string => {
  const configured = process.env[PUBLIC_SITE_URL_ENV]?.trim()
  if (configured) {
    try {
      const parsed = new URL(configured)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return configured.replace(/\/+$/, '')
      }
    } catch {
      // 非法 URL 走 fallback
    }
    logger.warn(
      { env: PUBLIC_SITE_URL_ENV, value: configured },
      'PUBLIC_SITE_URL is not a valid http(s) URL; falling back to request protocol and host'
    )
  }
  return `${req.protocol}://${req.get('host')}`
}

// 转义 XML 保留字符
export const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

export interface SitemapEntry {
  path: string
  lastmod: Date
}

// 站点地图 URL 不允许携带 query/hash
const normalizeSitemapPath = (path: string): string => path.split(/[?#]/)[0]

// 输出 XML 声明与 urlset，每项仅包含规范化 <loc> 与 ISO <lastmod>
export const buildSitemapXml = (entries: SitemapEntry[], siteUrl: string): string => {
  const urls = entries
    .map((entry) => ({
      path: normalizeSitemapPath(entry.path),
      lastmod: entry.lastmod,
    }))
    .filter((entry) => entry.path)
    .map(
      (entry) =>
        `  <url>\n    <loc>${escapeXml(`${siteUrl}${entry.path}`)}</loc>\n    <lastmod>${entry.lastmod.toISOString()}</lastmod>\n  </url>`
    )

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`
}

// URL 数量超过单文件上限时输出 sitemap index
export const buildSitemapIndexXml = (pageCount: number, siteUrl: string): string => {
  const items = Array.from({ length: pageCount }, (_, index) => {
    const loc = `${siteUrl}/sitemap-${index + 1}.xml`
    return `  <sitemap>\n    <loc>${escapeXml(loc)}</loc>\n  </sitemap>`
  })

  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join('\n')}\n</sitemapindex>`
}

// 文档路径的 robots 指令：私有页 nofollow，筛选/搜索页 noindex，其余可索引
export const getRobotsDirective = (
  pathname: string,
  hasQuery: boolean
): 'index, follow' | 'noindex, follow' | 'noindex, nofollow' => {
  if (isPrivateSeoPath(pathname)) {
    return 'noindex, nofollow'
  }

  if (hasQuery || pathname === '/search') {
    return 'noindex, follow'
  }

  return 'index, follow'
}

const NON_DOCUMENT_PREFIXES = ['/api/', '/assets/', '/uploads/']

const STATIC_FILE_EXTENSION =
  /\.(js|css|json|xml|txt|html|svg|png|jpg|jpeg|webp|gif|bmp|ico|map|wasm|woff2?|ttf|otf|eot|mp3|mp4|webm|lrc)$/i

// 判断是否为 HTML 文档路径，避免给 API、图片和构建产物添加无意义的 X-Robots-Tag
export const isDocumentPath = (pathname: string): boolean => {
  if (NON_DOCUMENT_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return false
  }
  return !STATIC_FILE_EXTENSION.test(pathname)
}
