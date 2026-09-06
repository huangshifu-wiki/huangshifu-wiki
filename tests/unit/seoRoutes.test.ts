import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, mockLogger } = vi.hoisted(() => {
  const createModel = () => ({ findMany: vi.fn() })
  return {
    prismaMock: {
      wikiPage: createModel(),
      post: createModel(),
      gallery: createModel(),
      event: createModel(),
      musicTrack: createModel(),
      album: createModel(),
    },
    mockLogger: {
      error: vi.fn(),
    },
  }
})

vi.mock('../../src/server/prisma', () => ({ prisma: prismaMock, default: prismaMock }))

vi.mock('../../src/server/utils/logger', () => ({ logger: mockLogger }))

import { registerSeoRoutes } from '../../src/server/routes/seo.routes'
import { enhancedCache } from '../../src/server/utils/cache'

type SitemapRow = { slug: string; updatedAt: Date }

const allModels = Object.keys(prismaMock) as Array<keyof typeof prismaMock>

const setFindManyResult = (model: keyof typeof prismaMock, rows: SitemapRow[]) => {
  prismaMock[model].findMany.mockResolvedValue(rows)
}

const setFindManyError = (model: keyof typeof prismaMock) => {
  prismaMock[model].findMany.mockRejectedValue(new Error('db down'))
}

const app = express()
registerSeoRoutes(app)

const slugRow = (slug: string, updatedAt = '2024-03-01T00:00:00Z'): SitemapRow => ({
  slug,
  updatedAt: new Date(updatedAt),
})

describe('服务端 SEO 路由', () => {
  beforeEach(() => {
    enhancedCache.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete process.env.PUBLIC_SITE_URL
  })

  describe('GET /robots.txt', () => {
    it('输出纯文本、禁止路径与配置站点的 sitemap 地址', async () => {
      process.env.PUBLIC_SITE_URL = 'https://seo.example.com'

      const response = await request(app).get('/robots.txt').expect(200)

      expect(response.headers['content-type']).toContain('text/plain')
      expect(response.headers['cache-control']).toBe('public, max-age=3600')
      expect(response.text).toContain('User-agent: *')
      expect(response.text).toContain('Allow: /')
      for (const path of [
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
      ]) {
        expect(response.text).toContain(`Disallow: ${path}`)
      }
      expect(response.text).toContain('Sitemap: https://seo.example.com/sitemap.xml')
    })
  })

  describe('GET /sitemap.xml', () => {
    it('汇总公开内容并输出转义后的 XML', async () => {
      process.env.PUBLIC_SITE_URL = 'https://seo.example.com'
      setFindManyResult('wikiPage', [slugRow('w&1', '2024-03-01T00:00:00Z')])
      setFindManyResult('post', [slugRow('p<2', '2024-03-02T00:00:00Z')])
      setFindManyResult('gallery', [slugRow('g3', '2024-03-03T00:00:00Z')])
      setFindManyResult('event', [slugRow('e4', '2024-03-04T00:00:00Z')])
      setFindManyResult('musicTrack', [slugRow('t5', '2024-03-05T00:00:00Z')])
      setFindManyResult('album', [slugRow('a6', '2024-03-06T00:00:00Z')])

      const response = await request(app).get('/sitemap.xml').expect(200)

      expect(response.headers['content-type']).toContain('application/xml')
      expect(response.headers['cache-control']).toBe('public, max-age=600')
      expect(response.text).toContain(
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
      )
      expect(response.text).toContain('<loc>https://seo.example.com/</loc>')
      expect(response.text).toContain('<loc>https://seo.example.com/wiki/w&amp;1</loc>')
      expect(response.text).toContain('<loc>https://seo.example.com/forum/p&lt;2</loc>')
      expect(response.text).toContain('<loc>https://seo.example.com/gallery/g3</loc>')
      expect(response.text).toContain('<loc>https://seo.example.com/events/e4</loc>')
      expect(response.text).toContain('<loc>https://seo.example.com/music/t5</loc>')
      expect(response.text).toContain('<loc>https://seo.example.com/album/a6</loc>')
      expect(response.text).toContain('<lastmod>2024-03-06T00:00:00.000Z</lastmod>')
      // URL 不携带 query/hash，原始字符不直接输出
      expect(response.text).not.toContain('w&1')
      expect(response.text).not.toContain('p<2')
      expect(response.text).not.toMatch(/<loc>[^<]*[?#]/)
    })

    it('数据库查询失败返回 500，不输出伪造的空 sitemap', async () => {
      setFindManyError('wikiPage')
      allModels
        .filter((model) => model !== 'wikiPage')
        .forEach((model) => setFindManyResult(model, []))

      const response = await request(app).get('/sitemap.xml').expect(500)

      expect(response.body).toEqual({ error: '服务器内部错误' })
      expect(response.text).not.toContain('<urlset')
      expect(mockLogger.error).toHaveBeenCalled()
    })
  })

  describe('GET /sitemap-:page.xml', () => {
    it('页码非法或超出范围返回 404', async () => {
      allModels.forEach((model) => setFindManyResult(model, []))

      await request(app).get('/sitemap-0.xml').expect(404)
      await request(app).get('/sitemap-abc.xml').expect(404)
      await request(app).get('/sitemap-2.xml').expect(404)
    })

    it('URL 超过单文件上限时主 sitemap 输出索引，分片输出子集', async () => {
      process.env.PUBLIC_SITE_URL = 'https://seo.example.com'
      const wikis = Array.from({ length: 45001 }, (_, index) => slugRow(`w${index}`))
      setFindManyResult('wikiPage', wikis)
      allModels
        .filter((model) => model !== 'wikiPage')
        .forEach((model) => setFindManyResult(model, []))

      const indexResponse = await request(app).get('/sitemap.xml').expect(200)
      expect(indexResponse.text).toContain(
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
      )
      expect(indexResponse.text).toContain('<loc>https://seo.example.com/sitemap-1.xml</loc>')
      expect(indexResponse.text).toContain('<loc>https://seo.example.com/sitemap-2.xml</loc>')

      const firstShard = await request(app).get('/sitemap-1.xml').expect(200)
      expect(firstShard.text).toContain('<urlset')
      expect((firstShard.text.match(/<url>/g) || []).length).toBe(45000)

      const secondShard = await request(app).get('/sitemap-2.xml').expect(200)
      expect((secondShard.text.match(/<url>/g) || []).length).toBe(2)
    })
  })
})
