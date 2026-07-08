import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockSiteConfigFindUnique = vi.hoisted(() => vi.fn())
const mockImageMapFindMany = vi.hoisted(() => vi.fn())

vi.mock('../../src/server/utils/config', () => ({
  prisma: {
    siteConfig: {
      findUnique: mockSiteConfigFindUnique,
    },
    imageMap: {
      findMany: mockImageMapFindMany,
    },
  },
}))

describe('gallery response transformers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSiteConfigFindUnique.mockResolvedValue({ value: { strategy: 'local' } })
  })

  it('returns thumbnail status without using the original image as thumbnail fallback', async () => {
    const { toGalleryResponse } = await import('../../src/server/utils/response-transformers')

    mockImageMapFindMany.mockResolvedValue([
      {
        localUrl: '/uploads/galleries/test.jpg',
        externalUrl: null,
        s3Url: null,
        thumbnailUrl: null,
        variantStatus: 'processing',
      },
    ])

    const result = await toGalleryResponse({
      id: 'gallery-1',
      title: '测试图集',
      description: '',
      authorUid: 'user-1',
      authorName: '作者',
      tags: [],
      locationCode: null,
      locationDetail: null,
      copyright: null,
      status: 'published',
      published: true,
      publishedAt: null,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
      images: [
        {
          id: 'image-1',
          url: '/uploads/galleries/test.jpg',
          name: 'test.jpg',
          sortOrder: 0,
          assetId: 'asset-1',
          asset: {
            id: 'asset-1',
            publicUrl: '/uploads/galleries/test.jpg',
            fileName: 'test.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 1024,
            status: 'ready',
            storageKey: 'galleries/test.jpg',
          },
        },
      ],
    })

    expect(result.images[0]).toMatchObject({
      url: '',
      originalUrl: '/uploads/galleries/test.jpg',
      thumbnailUrl: null,
      thumbnailStatus: 'processing',
    })
  })

  it('keeps gallery originals local even when external image maps exist', async () => {
    const { toGalleryResponse } = await import('../../src/server/utils/response-transformers')

    mockSiteConfigFindUnique.mockResolvedValue({ value: { strategy: 'external' } })
    mockImageMapFindMany.mockResolvedValue([
      {
        localUrl: '/uploads/galleries/test.jpg',
        externalUrl: 'https://cdn.example.com/test.jpg',
        s3Url: 'https://s3.example.com/test.jpg',
        thumbnailUrl: '/uploads/variants/test-thumb.webp',
        variantStatus: 'ready',
      },
    ])

    const result = await toGalleryResponse({
      id: 'gallery-1',
      title: '测试图集',
      description: '',
      authorUid: 'user-1',
      authorName: '作者',
      tags: [],
      locationCode: null,
      locationDetail: null,
      copyright: null,
      status: 'published',
      published: true,
      publishedAt: null,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
      images: [
        {
          id: 'image-1',
          url: '/uploads/galleries/test.jpg',
          name: 'test.jpg',
          sortOrder: 0,
          assetId: 'asset-1',
          asset: {
            id: 'asset-1',
            publicUrl: '/uploads/galleries/test.jpg',
            fileName: 'test.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 1024,
            status: 'ready',
            storageKey: 'galleries/test.jpg',
          },
        },
      ],
    })

    expect(result.images[0]).toMatchObject({
      url: '/uploads/variants/test-thumb.webp',
      originalUrl: '/uploads/galleries/test.jpg',
      thumbnailUrl: '/uploads/variants/test-thumb.webp',
    })
    expect(mockSiteConfigFindUnique).not.toHaveBeenCalled()
  })

  it('serializes eventDate as string when provided', async () => {
    const { toGalleryResponse } = await import('../../src/server/utils/response-transformers')

    mockImageMapFindMany.mockResolvedValue([])

    const result = await toGalleryResponse({
      id: 'gallery-1',
      title: '测试图集',
      description: '',
      authorUid: 'user-1',
      authorName: '作者',
      tags: [],
      eventDate: '2024-06-15',
      locationCode: null,
      locationDetail: null,
      copyright: null,
      status: 'published',
      published: true,
      publishedAt: null,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
      images: [],
    })

    expect(result.eventDate).toBe('2024-06-15')
  })

  it('serializes eventDate as null when not provided', async () => {
    const { toGalleryResponse } = await import('../../src/server/utils/response-transformers')

    mockImageMapFindMany.mockResolvedValue([])

    const result = await toGalleryResponse({
      id: 'gallery-1',
      title: '测试图集',
      description: '',
      authorUid: 'user-1',
      authorName: '作者',
      tags: [],
      locationCode: null,
      locationDetail: null,
      copyright: null,
      status: 'published',
      published: true,
      publishedAt: null,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
      images: [],
    })

    expect(result.eventDate).toBeNull()
  })

  it('serializes eventDate as null when explicitly null', async () => {
    const { toGalleryResponse } = await import('../../src/server/utils/response-transformers')

    mockImageMapFindMany.mockResolvedValue([])

    const result = await toGalleryResponse({
      id: 'gallery-1',
      title: '测试图集',
      description: '',
      authorUid: 'user-1',
      authorName: '作者',
      tags: [],
      eventDate: null,
      locationCode: null,
      locationDetail: null,
      copyright: null,
      status: 'published',
      published: true,
      publishedAt: null,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
      images: [],
    })

    expect(result.eventDate).toBeNull()
  })
})
