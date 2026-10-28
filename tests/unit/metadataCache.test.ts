import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { metadataCache, preloadMetadata } from '../../src/lib/metadataCache'
import type { WikiPageMetadata } from '../../src/lib/wikiLinkParser'

describe('metadataCache', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    metadataCache.clear()
    vi.resetAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('get', () => {
    it('returns cached metadata without fetching', async () => {
      const mockMetadata: WikiPageMetadata = {
        title: 'Cached Page',
        slug: 'cached-page',
      }
      metadataCache.set('cached-page', mockMetadata)

      const result = await metadataCache.get('cached-page')

      expect(result).toEqual(mockMetadata)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('fetches metadata when not cached', async () => {
      const mockMetadata = {
        title: 'Test Page',
        slug: 'test-page',
        description: 'Test description',
      }
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ page: mockMetadata }), { status: 200 })
      )

      const result = await metadataCache.get('test-page')

      expect(fetchMock).toHaveBeenCalledWith('/api/wiki/test-page', expect.any(Object))
      expect(result).toMatchObject({
        title: 'Test Page',
        slug: 'test-page',
        description: 'Test description',
      })
    })

    it('returns null when fetch fails', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'))

      const result = await metadataCache.get('nonexistent-page')

      expect(result).toBeNull()
    })

    it('returns null when response is empty', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(null), { status: 200 }))

      const result = await metadataCache.get('empty-page')

      expect(result).toBeNull()
    })

    it('returns null when response page is empty', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ page: null }), { status: 200 }))

      const result = await metadataCache.get('empty-page-wrapper')

      expect(result).toBeNull()
    })

    it('deduplicates concurrent requests for same slug', async () => {
      const mockMetadata = { title: 'Page', slug: 'dedup-page' }
      fetchMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () => resolve(new Response(JSON.stringify({ page: mockMetadata }), { status: 200 })),
              50
            )
          })
      )

      const promise1 = metadataCache.get('dedup-page')
      const promise2 = metadataCache.get('dedup-page')
      const promise3 = metadataCache.get('dedup-page')

      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3])

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(result1).toEqual(result2)
      expect(result2).toEqual(result3)
    })

    it('maps API response to WikiPageMetadata correctly', async () => {
      const apiResponse = {
        title: 'Full Page',
        slug: 'full-page',
        category: 'Category',
        description: 'Description',
        coverImage: 'cover.jpg',
        tags: ['tag1', 'tag2'],
        authorName: 'Author',
        publishDate: '2024-01-01',
        updatedAt: '2024-01-02',
        contentSummary: 'Summary',
      }
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ page: apiResponse }), { status: 200 })
      )

      const result = await metadataCache.get('full-page')

      expect(result).toEqual({
        title: 'Full Page',
        slug: 'full-page',
        category: 'Category',
        description: 'Description',
        coverImage: 'cover.jpg',
        tags: ['tag1', 'tag2'],
        authorName: 'Author',
        publishDate: '2024-01-01',
        updatedAt: '2024-01-02',
        contentSummary: 'Summary',
      })
    })
  })

  describe('getBatch', () => {
    it('returns cached items without fetching', async () => {
      const metadata1: WikiPageMetadata = { title: 'Page 1', slug: 'page-1' }
      const metadata2: WikiPageMetadata = { title: 'Page 2', slug: 'page-2' }
      metadataCache.set('page-1', metadata1)
      metadataCache.set('page-2', metadata2)

      const result = await metadataCache.getBatch(['page-1', 'page-2'])

      expect(result.get('page-1')).toEqual(metadata1)
      expect(result.get('page-2')).toEqual(metadata2)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('fetches missing items', async () => {
      const cachedMetadata: WikiPageMetadata = { title: 'Cached', slug: 'cached' }
      metadataCache.set('cached', cachedMetadata)

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ page: { title: 'New', slug: 'new' } }), { status: 200 })
      )

      const result = await metadataCache.getBatch(['cached', 'new'])

      expect(result.get('cached')).toEqual(cachedMetadata)
      expect(result.get('new')).toMatchObject({ title: 'New', slug: 'new' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('returns empty map for empty array', async () => {
      const result = await metadataCache.getBatch([])
      expect(result.size).toBe(0)
    })

    it('handles partial failures gracefully', async () => {
      const cachedMetadata: WikiPageMetadata = { title: 'Cached', slug: 'cached' }
      metadataCache.set('cached', cachedMetadata)

      fetchMock.mockRejectedValueOnce(new Error('Network error'))

      const result = await metadataCache.getBatch(['cached', 'failing'])

      expect(result.get('cached')).toEqual(cachedMetadata)
      expect(result.has('failing')).toBe(false)
    })
  })

  describe('set', () => {
    it('stores metadata in cache', () => {
      const metadata: WikiPageMetadata = { title: 'Test', slug: 'test' }
      metadataCache.set('test', metadata)

      expect(metadataCache.size()).toBe(1)
    })

    it('overwrites existing metadata', async () => {
      const originalMetadata: WikiPageMetadata = { title: 'Original', slug: 'test' }
      metadataCache.set('test', originalMetadata)

      const newMetadata: WikiPageMetadata = { title: 'Updated', slug: 'test' }
      metadataCache.set('test', newMetadata)

      const result = await metadataCache.get('test')
      expect(result?.title).toBe('Updated')
    })
  })

  describe('clear', () => {
    it('clears all cache when no slug provided', () => {
      metadataCache.set('page-1', { title: 'Page 1', slug: 'page-1' })
      metadataCache.set('page-2', { title: 'Page 2', slug: 'page-2' })

      metadataCache.clear()

      expect(metadataCache.size()).toBe(0)
    })

    it('clears specific slug when provided', () => {
      metadataCache.set('page-1', { title: 'Page 1', slug: 'page-1' })
      metadataCache.set('page-2', { title: 'Page 2', slug: 'page-2' })

      metadataCache.clear('page-1')

      expect(metadataCache.size()).toBe(1)
    })
  })

  describe('size', () => {
    it('returns 0 for empty cache', () => {
      expect(metadataCache.size()).toBe(0)
    })

    it('returns correct count', () => {
      metadataCache.set('page-1', { title: 'Page 1', slug: 'page-1' })
      metadataCache.set('page-2', { title: 'Page 2', slug: 'page-2' })
      metadataCache.set('page-3', { title: 'Page 3', slug: 'page-3' })

      expect(metadataCache.size()).toBe(3)
    })
  })

  describe('preloadMetadata', () => {
    it('is an alias for getBatch', async () => {
      const metadata: WikiPageMetadata = { title: 'Preload', slug: 'preload' }
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ page: metadata }), { status: 200 })
      )

      const result = await preloadMetadata(['preload'])

      expect(result.get('preload')).toMatchObject(metadata)
    })
  })
})
