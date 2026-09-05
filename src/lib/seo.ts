import { useEffect } from 'react'
import { toAbsoluteInternalUrl } from './copyLink'
import { isPrivateSeoPath } from './seoPrivatePaths'

export const SEO_SITE_NAME = '黄诗扶 Wiki'

export const SEO_SITE_DESCRIPTION =
  '黄诗扶 Wiki，整理黄诗扶的音乐作品、歌曲、专辑、活动、图集与百科资料。'

export type SeoRobots = 'index,follow' | 'noindex,follow' | 'noindex,nofollow'

export type SeoJsonLd = Record<string, unknown> | Record<string, unknown>[]

export interface SeoMetadata {
  title: string
  description: string
  canonicalPath: string
  robots: SeoRobots
  ogType: string
  ogImage?: string
  ogImageAlt?: string
  jsonLd?: SeoJsonLd
}

const SEO_DATA_ATTR = 'data-hsf-seo'

// 站内相对路径转绝对 URL：复用 copyLink 的绝对化逻辑，空值返回空串便于调用方过滤
export const toAbsoluteSeoUrl = (value: string): string => {
  if (!value) {
    return ''
  }
  return toAbsoluteInternalUrl(value.split('#')[0])
}

// 生成有界的 SEO 摘要：去除 HTML、Markdown 图片/链接/标题/引用/强调/代码标记并压缩空白
export const summarizeSeoText = (
  value: string | null | undefined,
  fallback: string,
  maxLength = 160
): string => {
  const source = typeof value === 'string' ? value : ''
  const text = source
    .replace(/<[^>]*>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[*_`~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) {
    return fallback
  }
  if (text.length <= maxLength) {
    return text
  }
  // 截断点落在代理对中间时回退一位，避免拆散 emoji 等增补平面字符
  return text.slice(0, maxLength).replace(/[\uD800-\uDBFF]$/, '')
}

// canonical 路径规范化：去 query/hash，保留根路径，其余路径移除末尾斜杠
export const normalizeCanonicalPath = (pathname: string): string => {
  const withoutQuery = pathname.split(/[?#]/)[0]
  if (!withoutQuery || withoutQuery === '/') {
    return '/'
  }
  const trimmed = withoutQuery.replace(/\/+$/, '')
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

type ManagedMeta = {
  key: string
  attribute: 'name' | 'property'
  content: string | null
}

// 按 data-hsf-seo 标记创建或更新 meta；content 为 null 时移除，避免导航后残留旧标签
const setManagedMeta = (head: HTMLElement, { key, attribute, content }: ManagedMeta) => {
  const existing = head.querySelector<HTMLMetaElement>(`meta[${SEO_DATA_ATTR}="${key}"]`)
  if (content === null) {
    existing?.remove()
    return
  }
  const meta = existing ?? document.createElement('meta')
  meta.setAttribute(SEO_DATA_ATTR, key)
  meta.setAttribute(attribute, key)
  meta.setAttribute('content', content)
  if (!existing) {
    head.appendChild(meta)
  }
}

export const applySeoMetadata = (metadata: SeoMetadata): void => {
  if (typeof document === 'undefined' || !document.head) {
    return
  }
  const head = document.head

  document.title = metadata.title
  const canonicalUrl = toAbsoluteSeoUrl(normalizeCanonicalPath(metadata.canonicalPath))

  const managedMetas: ManagedMeta[] = [
    { key: 'description', attribute: 'name', content: metadata.description },
    { key: 'robots', attribute: 'name', content: metadata.robots },
    { key: 'og:title', attribute: 'property', content: metadata.title },
    { key: 'og:description', attribute: 'property', content: metadata.description },
    { key: 'og:url', attribute: 'property', content: canonicalUrl },
    { key: 'og:type', attribute: 'property', content: metadata.ogType },
    { key: 'og:site_name', attribute: 'property', content: SEO_SITE_NAME },
    { key: 'og:locale', attribute: 'property', content: 'zh_CN' },
    {
      key: 'og:image',
      attribute: 'property',
      content: metadata.ogImage ? toAbsoluteSeoUrl(metadata.ogImage) : null,
    },
    {
      key: 'og:image:alt',
      attribute: 'property',
      content: metadata.ogImage && metadata.ogImageAlt ? metadata.ogImageAlt : null,
    },
  ]
  managedMetas.forEach((item) => setManagedMeta(head, item))

  let link = head.querySelector<HTMLLinkElement>(`link[${SEO_DATA_ATTR}="canonical"]`)
  if (!link) {
    link = document.createElement('link')
    link.setAttribute(SEO_DATA_ATTR, 'canonical')
    link.rel = 'canonical'
    head.appendChild(link)
  }
  link.setAttribute('href', canonicalUrl)

  // JSON-LD 通过 textContent 写入，不拼接 HTML 字符串
  const script = head.querySelector<HTMLScriptElement>(
    `script[type="application/ld+json"][${SEO_DATA_ATTR}="jsonld"]`
  )
  if (metadata.jsonLd) {
    const next = script ?? document.createElement('script')
    next.type = 'application/ld+json'
    next.setAttribute(SEO_DATA_ATTR, 'jsonld')
    next.textContent = JSON.stringify(metadata.jsonLd)
    if (!script) {
      head.appendChild(next)
    }
  } else {
    script?.remove()
  }
}

export const useSeo = (metadata: SeoMetadata): void => {
  // 依赖使用原始字段与序列化后的 JSON-LD，避免页面普通状态更新时重复改写 head
  const serializedJsonLd = metadata.jsonLd ? JSON.stringify(metadata.jsonLd) : ''
  useEffect(() => {
    applySeoMetadata(metadata)
  }, [
    metadata.title,
    metadata.description,
    metadata.canonicalPath,
    metadata.robots,
    metadata.ogType,
    metadata.ogImage,
    metadata.ogImageAlt,
    serializedJsonLd,
  ])
}

// 详情页加载中/失败/空数据的通用元数据：不可索引但允许跟随链接
export const getDetailFallbackSeo = (options: {
  canonicalPath: string
  title: string
  description?: string
}): SeoMetadata => ({
  title: options.title,
  description: options.description || SEO_SITE_DESCRIPTION,
  canonicalPath: options.canonicalPath,
  robots: 'noindex,follow',
  ogType: 'website',
})

const PUBLIC_LIST_ROUTES: Record<string, string> = {
  '/': '首页',
  '/wiki': '百科',
  '/forum': '社区',
  '/gallery': '图集',
  '/events': '活动',
  '/music': '音乐',
}

const buildListSeo = (pathname: string, robots: SeoRobots): SeoMetadata => {
  const label = PUBLIC_LIST_ROUTES[pathname]
  return {
    title:
      pathname === '/'
        ? `${SEO_SITE_NAME}｜音乐作品、专辑、活动与百科资料`
        : `${label}｜${SEO_SITE_NAME}`,
    description: SEO_SITE_DESCRIPTION,
    canonicalPath: pathname,
    robots,
    ogType: 'website',
  }
}

export const SEARCH_SEO_METADATA: SeoMetadata = {
  title: `搜索｜${SEO_SITE_NAME}`,
  description: '搜索黄诗扶 Wiki 中的百科、音乐、活动、图集和社区内容。',
  canonicalPath: '/search',
  robots: 'noindex,follow',
  ogType: 'website',
}

// 布局级静态路由元数据；详情路径返回 null，由详情组件自行管理
export const getStaticRouteSeo = (pathname: string, search: string): SeoMetadata | null => {
  const normalized = normalizeCanonicalPath(pathname)

  if (isPrivateSeoPath(normalized)) {
    return {
      title: SEO_SITE_NAME,
      description: SEO_SITE_DESCRIPTION,
      canonicalPath: normalized,
      robots: 'noindex,nofollow',
      ogType: 'website',
    }
  }

  if (normalized === '/search') {
    return SEARCH_SEO_METADATA
  }

  if (PUBLIC_LIST_ROUTES[normalized]) {
    return buildListSeo(normalized, search ? 'noindex,follow' : 'index,follow')
  }

  return null
}
