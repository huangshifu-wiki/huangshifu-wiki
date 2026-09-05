import type { Router } from 'express'
import { prisma } from '../prisma'
import {
  buildSitemapIndexXml,
  buildSitemapXml,
  enhancedCache,
  getPublicSiteUrl,
  logger,
  type SitemapEntry,
} from '../utils'

const SITEMAP_CACHE_KEY = 'seo:sitemap'
const SITEMAP_CACHE_TTL_SEC = 600
const SITEMAP_CACHE_CONTROL = 'public, max-age=600'
const SITEMAP_MAX_URLS = 45000
const ROBOTS_CACHE_CONTROL = 'public, max-age=3600'

const ROBOTS_DISALLOWED_PATHS = [
  '/api/',
  '/admin',
  '/settings',
  '/login',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/setup',
  '/search',
  '/__ui',
]

// 汇总公开内容 URL：Wiki/Post/Gallery 要求已发布且未删除，其余仅要求未删除
const loadSitemapEntries = async (): Promise<SitemapEntry[]> => {
  const [wikis, posts, galleries, events, tracks, albums] = await Promise.all([
    prisma.wikiPage.findMany({
      where: { status: 'published', deletedAt: null },
      select: { slug: true, updatedAt: true },
    }),
    prisma.post.findMany({
      where: { status: 'published', deletedAt: null },
      select: { slug: true, updatedAt: true },
    }),
    prisma.gallery.findMany({
      where: { status: 'published', deletedAt: null },
      select: { slug: true, updatedAt: true },
    }),
    prisma.event.findMany({
      where: { deletedAt: null },
      select: { slug: true, updatedAt: true },
    }),
    prisma.musicTrack.findMany({
      where: { deletedAt: null },
      select: { slug: true, updatedAt: true },
    }),
    prisma.album.findMany({
      where: { deletedAt: null },
      select: { slug: true, updatedAt: true },
    }),
  ])

  const entries = new Map<string, SitemapEntry>()
  const addEntry = (path: string, lastmod: Date) => {
    if (!path || entries.has(path)) {
      return
    }
    entries.set(path, { path, lastmod })
  }

  wikis.forEach((item) => addEntry(`/wiki/${item.slug}`, item.updatedAt))
  posts.forEach((item) => addEntry(`/forum/${item.slug}`, item.updatedAt))
  galleries.forEach((item) => addEntry(`/gallery/${item.slug}`, item.updatedAt))
  events.forEach((item) => addEntry(`/events/${item.slug}`, item.updatedAt))
  tracks.forEach((item) => addEntry(`/music/${item.slug}`, item.updatedAt))
  albums.forEach((item) => addEntry(`/album/${item.slug}`, item.updatedAt))

  // 首页 lastmod 取全部内容的最新更新时间
  const latest = [...entries.values()].reduce<Date | null>(
    (acc, entry) => (!acc || entry.lastmod > acc ? entry.lastmod : acc),
    null
  )
  addEntry('/', latest ?? new Date())

  // 使用码点比较排序，保证跨环境顺序稳定
  return [...entries.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

const getSitemapEntries = async (): Promise<SitemapEntry[]> => {
  const cached = enhancedCache.get<SitemapEntry[]>(SITEMAP_CACHE_KEY)
  if (cached) {
    return cached
  }
  const entries = await loadSitemapEntries()
  enhancedCache.set(SITEMAP_CACHE_KEY, entries, SITEMAP_CACHE_TTL_SEC)
  return entries
}

export const registerSeoRoutes = (app: Router): void => {
  app.get('/robots.txt', (req, res) => {
    const siteUrl = getPublicSiteUrl(req)
    const lines = [
      'User-agent: *',
      'Allow: /',
      ...ROBOTS_DISALLOWED_PATHS.map((path) => `Disallow: ${path}`),
      '',
      `Sitemap: ${siteUrl}/sitemap.xml`,
      '',
    ]
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Cache-Control', ROBOTS_CACHE_CONTROL)
    res.status(200).send(lines.join('\n'))
  })

  app.get('/sitemap.xml', async (req, res) => {
    try {
      const entries = await getSitemapEntries()
      const siteUrl = getPublicSiteUrl(req)
      res.setHeader('Content-Type', 'application/xml; charset=utf-8')
      res.setHeader('Cache-Control', SITEMAP_CACHE_CONTROL)
      if (entries.length > SITEMAP_MAX_URLS) {
        const pageCount = Math.ceil(entries.length / SITEMAP_MAX_URLS)
        res.status(200).send(buildSitemapIndexXml(pageCount, siteUrl))
        return
      }
      res.status(200).send(buildSitemapXml(entries, siteUrl))
    } catch (error) {
      logger.error({ err: error }, 'Failed to build sitemap.xml')
      res.status(500).json({ error: '服务器内部错误' })
    }
  })

  app.get('/sitemap-:page.xml', async (req, res) => {
    const page = Number(req.params.page)
    if (!Number.isInteger(page) || page < 1) {
      res.status(404).json({ error: 'Not Found' })
      return
    }
    try {
      const entries = await getSitemapEntries()
      const pageCount = Math.max(1, Math.ceil(entries.length / SITEMAP_MAX_URLS))
      if (page > pageCount) {
        res.status(404).json({ error: 'Not Found' })
        return
      }
      const slice = entries.slice((page - 1) * SITEMAP_MAX_URLS, page * SITEMAP_MAX_URLS)
      res.setHeader('Content-Type', 'application/xml; charset=utf-8')
      res.setHeader('Cache-Control', SITEMAP_CACHE_CONTROL)
      res.status(200).send(buildSitemapXml(slice, getPublicSiteUrl(req)))
    } catch (error) {
      logger.error({ err: error }, 'Failed to build sitemap shard')
      res.status(500).json({ error: '服务器内部错误' })
    }
  })
}
