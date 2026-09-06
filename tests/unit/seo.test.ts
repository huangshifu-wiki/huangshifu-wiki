import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Request } from 'express'

import {
  getStaticRouteSeo,
  normalizeCanonicalPath,
  SEO_SITE_NAME,
  summarizeSeoText,
  toAbsoluteSeoUrl,
} from '../../src/lib/seo'
import {
  buildSitemapIndexXml,
  buildSitemapXml,
  getPublicSiteUrl,
  getRobotsDirective,
  isDocumentPath,
} from '../../src/server/utils/seo'
import type { SitemapEntry } from '../../src/server/utils/seo'

afterEach(() => {
  vi.unstubAllEnvs()
})

const createRequest = (protocol = 'https', host = 'fallback.example') =>
  ({
    protocol,
    get: (key: string) => (key.toLowerCase() === 'host' ? host : undefined),
  }) as unknown as Request

describe('summarizeSeoText', () => {
  it('去除 HTML、Markdown 标记并压缩空白', () => {
    const value =
      '<p>**标题** [链接](https://a.com) ![图](https://i.png)\n# 段落\n> 引用 `代码`</p>'
    expect(summarizeSeoText(value, 'fallback')).toBe('标题 链接 段落 引用 代码')
  })

  it('按字符长度截断，保证 description 有界', () => {
    expect(summarizeSeoText('a'.repeat(200), 'fallback', 160)).toBe('a'.repeat(160))
  })

  it('空值或纯空白返回 fallback', () => {
    expect(summarizeSeoText(null, '默认描述')).toBe('默认描述')
    expect(summarizeSeoText(undefined, '默认描述')).toBe('默认描述')
    expect(summarizeSeoText('   \n  ', '默认描述')).toBe('默认描述')
  })
})

describe('normalizeCanonicalPath', () => {
  it('移除 query、hash 与末尾斜杠', () => {
    expect(normalizeCanonicalPath('/wiki/123/?x=1#top')).toBe('/wiki/123')
  })

  it('保留根路径', () => {
    expect(normalizeCanonicalPath('/')).toBe('/')
    expect(normalizeCanonicalPath('')).toBe('/')
  })

  it('补全开头的斜杠', () => {
    expect(normalizeCanonicalPath('gallery/')).toBe('/gallery')
  })
})

describe('toAbsoluteSeoUrl（非浏览器环境）', () => {
  it('绝对 http(s) URL 原样保留', () => {
    expect(toAbsoluteSeoUrl('https://cdn.example/x.png')).toBe('https://cdn.example/x.png')
    expect(toAbsoluteSeoUrl('http://cdn.example/x.png')).toBe('http://cdn.example/x.png')
  })

  it('非浏览器环境返回去除 hash 后的相对路径', () => {
    expect(toAbsoluteSeoUrl('/music/1#top')).toBe('/music/1')
  })

  it('空值返回空串，便于调用方过滤', () => {
    expect(toAbsoluteSeoUrl('')).toBe('')
  })
})

describe('getRobotsDirective', () => {
  it('私有区域与编辑/协作路径返回 noindex, nofollow', () => {
    expect(getRobotsDirective('/admin/settings', false)).toBe('noindex, nofollow')
    expect(getRobotsDirective('/login', false)).toBe('noindex, nofollow')
    expect(getRobotsDirective('/setup', false)).toBe('noindex, nofollow')
    expect(getRobotsDirective('/users/u123', false)).toBe('noindex, nofollow')
    expect(getRobotsDirective('/__ui', false)).toBe('noindex, nofollow')
    expect(getRobotsDirective('/gallery/3/edit', false)).toBe('noindex, nofollow')
    expect(getRobotsDirective('/gallery/new', false)).toBe('noindex, nofollow')
    expect(getRobotsDirective('/wiki/abc/history', false)).toBe('noindex, nofollow')
    expect(getRobotsDirective('/wiki/abc/prs/1', false)).toBe('noindex, nofollow')
  })

  it('搜索页、公告页、更多页或带 query 的公开列表返回 noindex, follow', () => {
    expect(getRobotsDirective('/search', false)).toBe('noindex, follow')
    expect(getRobotsDirective('/announcements', false)).toBe('noindex, follow')
    expect(getRobotsDirective('/more', false)).toBe('noindex, follow')
    expect(getRobotsDirective('/events', true)).toBe('noindex, follow')
    expect(getRobotsDirective('/wiki', true)).toBe('noindex, follow')
  })

  it('其余文档路径返回 index, follow', () => {
    expect(getRobotsDirective('/wiki/123', false)).toBe('index, follow')
    expect(getRobotsDirective('/', false)).toBe('index, follow')
  })
})

describe('isDocumentPath', () => {
  it('排除 API、静态目录与常见静态文件扩展名', () => {
    expect(isDocumentPath('/api/wiki')).toBe(false)
    expect(isDocumentPath('/assets/app-v5.js')).toBe(false)
    expect(isDocumentPath('/uploads/img.png')).toBe(false)
    expect(isDocumentPath('/robots.txt')).toBe(false)
    expect(isDocumentPath('/sitemap.xml')).toBe(false)
    expect(isDocumentPath('/main.css')).toBe(false)
  })

  it('SPA 文档路径返回 true', () => {
    expect(isDocumentPath('/')).toBe(true)
    expect(isDocumentPath('/wiki')).toBe(true)
    expect(isDocumentPath('/admin')).toBe(true)
    expect(isDocumentPath('/search')).toBe(true)
  })
})

describe('getPublicSiteUrl', () => {
  it('优先使用合法的 PUBLIC_SITE_URL 并去掉末尾斜杠', () => {
    vi.stubEnv('PUBLIC_SITE_URL', 'https://seo.example.com/')
    expect(getPublicSiteUrl(createRequest())).toBe('https://seo.example.com')
  })

  it('非法配置退回请求协议和 Host', () => {
    vi.stubEnv('PUBLIC_SITE_URL', 'ftp://bad.example')
    expect(getPublicSiteUrl(createRequest('https', 'req.example'))).toBe('https://req.example')
  })

  it('未配置时退回请求协议和 Host', () => {
    vi.stubEnv('PUBLIC_SITE_URL', '')
    expect(getPublicSiteUrl(createRequest('http', 'localhost:3003'))).toBe('http://localhost:3003')
  })
})

describe('sitemap XML 构建', () => {
  it('urlset 输出转义 loc 与 ISO lastmod，且不带 query/hash', () => {
    const entries: SitemapEntry[] = [
      { path: '/wiki/a&b?x=1#top', lastmod: new Date('2024-01-02T03:04:05.000Z') },
      { path: '/forum/p<1"', lastmod: new Date('2024-02-03T00:00:00.000Z') },
    ]
    const xml = buildSitemapXml(entries, 'https://seo.example.com')

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml).toContain('<loc>https://seo.example.com/wiki/a&amp;b</loc>')
    expect(xml).toContain('<loc>https://seo.example.com/forum/p&lt;1&quot;</loc>')
    expect(xml).toContain('<lastmod>2024-01-02T03:04:05.000Z</lastmod>')
    expect(xml).not.toContain('?x=1')
    expect(xml).not.toContain('#top')
    expect(xml).not.toContain('p<1"')
  })

  it('sitemap index 输出分片地址', () => {
    const xml = buildSitemapIndexXml(2, 'https://seo.example.com')
    expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml).toContain('<loc>https://seo.example.com/sitemap-1.xml</loc>')
    expect(xml).toContain('<loc>https://seo.example.com/sitemap-2.xml</loc>')
  })
})

describe('getStaticRouteSeo', () => {
  it('首页与基础列表页可索引且 canonical 无 query', () => {
    const home = getStaticRouteSeo('/', '')
    expect(home).toMatchObject({
      title: `${SEO_SITE_NAME}｜音乐作品、专辑、活动与百科资料`,
      canonicalPath: '/',
      robots: 'index,follow',
      ogType: 'website',
    })
    expect(getStaticRouteSeo('/wiki', '')).toMatchObject({
      robots: 'index,follow',
      canonicalPath: '/wiki',
    })
    expect(getStaticRouteSeo('/music', '')).toMatchObject({
      robots: 'index,follow',
      canonicalPath: '/music',
    })
  })

  it('搜索页与带 query 的列表页 noindex,follow', () => {
    expect(getStaticRouteSeo('/search', '?q=黄诗扶')).toMatchObject({
      robots: 'noindex,follow',
      canonicalPath: '/search',
    })
    expect(getStaticRouteSeo('/wiki', '?tag=演出')).toMatchObject({
      robots: 'noindex,follow',
      canonicalPath: '/wiki',
    })
  })

  it('公告页与更多页 noindex,follow', () => {
    expect(getStaticRouteSeo('/announcements', '')).toMatchObject({
      title: `公告｜${SEO_SITE_NAME}`,
      robots: 'noindex,follow',
      canonicalPath: '/announcements',
    })
    expect(getStaticRouteSeo('/more', '')).toMatchObject({
      title: `更多｜${SEO_SITE_NAME}`,
      robots: 'noindex,follow',
      canonicalPath: '/more',
    })
  })

  it('私有区域、认证与编辑路径 noindex,nofollow', () => {
    expect(getStaticRouteSeo('/admin', '')).toMatchObject({ robots: 'noindex,nofollow' })
    expect(getStaticRouteSeo('/settings/profile', '')).toMatchObject({
      robots: 'noindex,nofollow',
    })
    expect(getStaticRouteSeo('/users/u123', '')).toMatchObject({ robots: 'noindex,nofollow' })
    expect(getStaticRouteSeo('/gallery/new', '')).toMatchObject({ robots: 'noindex,nofollow' })
    expect(getStaticRouteSeo('/wiki/abc/edit', '')).toMatchObject({
      robots: 'noindex,nofollow',
    })
  })

  it('详情路径返回 null 交给详情组件管理', () => {
    expect(getStaticRouteSeo('/wiki/123', '')).toBeNull()
    expect(getStaticRouteSeo('/forum/456', '')).toBeNull()
    expect(getStaticRouteSeo('/gallery/789', '')).toBeNull()
    expect(getStaticRouteSeo('/events/some-slug', '')).toBeNull()
    expect(getStaticRouteSeo('/music/s1', '')).toBeNull()
    expect(getStaticRouteSeo('/album/a1', '')).toBeNull()
  })
})
