import type { WikiPageMetadata } from './wikiLinkParser'
import { apiGet } from './apiClient'

type WikiPageMetadataResponse = {
  page?: Partial<WikiPageMetadata> | null
}

/**
 * 元数据缓存类
 * 用于缓存 Wiki 页面的元数据，避免重复请求
 */
class MetadataCache {
  private cache: Map<string, WikiPageMetadata> = new Map()
  private pendingRequests: Map<string, Promise<WikiPageMetadata | null>> = new Map()

  /**
   * 获取单个页面的元数据
   * @param slug 页面 slug
   * @returns 页面元数据
   */
  async get(slug: string): Promise<WikiPageMetadata | null> {
    // 检查缓存
    if (this.cache.has(slug)) {
      return this.cache.get(slug)!
    }

    // 检查是否有进行中的请求
    if (this.pendingRequests.has(slug)) {
      return this.pendingRequests.get(slug)!
    }

    // 发起请求
    const promise = this.fetchMetadata(slug)
    this.pendingRequests.set(slug, promise)

    try {
      const result = await promise
      if (result) {
        this.cache.set(slug, result)
      }
      return result
    } finally {
      this.pendingRequests.delete(slug)
    }
  }

  /**
   * 批量获取页面元数据
   * @param slugs 页面 slug 列表
   * @returns 元数据 Map
   */
  async getBatch(slugs: string[]): Promise<Map<string, WikiPageMetadata>> {
    const result = new Map<string, WikiPageMetadata>()
    const missingSlugs: string[] = []

    // 先从缓存中获取
    for (const slug of slugs) {
      const cached = this.cache.get(slug)
      if (cached) {
        result.set(slug, cached)
      } else {
        missingSlugs.push(slug)
      }
    }

    // 获取缺失的元数据
    if (missingSlugs.length > 0) {
      const promises = missingSlugs.map((slug) => this.get(slug))
      await Promise.all(promises)

      // 再次检查缓存
      for (const slug of missingSlugs) {
        const cached = this.cache.get(slug)
        if (cached) {
          result.set(slug, cached)
        }
      }
    }

    return result
  }

  /**
   * 设置元数据
   * @param slug 页面 slug
   * @param metadata 元数据
   */
  set(slug: string, metadata: WikiPageMetadata): void {
    this.cache.set(slug, metadata)
  }

  /**
   * 清除缓存
   * @param slug 可选的页面 slug，不提供则清除所有缓存
   */
  clear(slug?: string): void {
    if (slug) {
      this.cache.delete(slug)
    } else {
      this.cache.clear()
    }
  }

  /**
   * 获取缓存大小
   */
  size(): number {
    return this.cache.size
  }

  /**
   * 从 API 获取元数据
   */
  private async fetchMetadata(slug: string): Promise<WikiPageMetadata | null> {
    try {
      const response = await apiGet<WikiPageMetadataResponse>(`/api/wiki/${slug}`)
      const page = response?.page
      if (!page) {
        return null
      }

      return {
        title: page.title || slug,
        slug: page.slug || slug,
        category: page.category,
        description: page.description,
        coverImage: page.coverImage,
        tags: page.tags,
        authorName: page.authorName,
        publishDate: page.publishDate,
        updatedAt: page.updatedAt,
        contentSummary: page.contentSummary,
      }
    } catch (error) {
      console.error(`Failed to fetch metadata for ${slug}:`, error)
      return null
    }
  }
}

/**
 * 全局元数据缓存实例
 */
export const metadataCache = new MetadataCache()

/**
 * 预加载页面元数据
 * @param slugs 页面 slug 列表
 */
export async function preloadMetadata(slugs: string[]): Promise<Map<string, WikiPageMetadata>> {
  return metadataCache.getBatch(slugs)
}
