import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PrismaClient, EmbeddingStatus } from '@prisma/client';

// Mock clipEmbedding module
vi.mock('../../src/server/vector/clipEmbedding', () => ({
  getEmbeddingModelName: vi.fn(() => 'Xenova/clip-vit-base-patch32'),
  getEmbeddingVectorSize: vi.fn(() => 512),
}));

vi.mock('../../src/server/vector/qdrantService', () => ({
  upsertImageEmbeddingPoint: vi.fn(),
  deleteImageEmbeddingPointsBySource: vi.fn(() => Promise.resolve(0)),
}));

import {
  extractWikiImages,
  extractPostImages,
  enqueueWikiImageEmbeddings,
  enqueuePostImageEmbeddings,
  enqueueMissingWikiImageEmbeddings,
  enqueueMissingPostImageEmbeddings,
} from '../../src/server/vector/wikiPostEmbedding';

describe('wikiPostEmbedding', () => {
  describe('extractWikiImages', () => {
    it('should extract local upload images from markdown', () => {
      const content = '![alt text](/uploads/image1.jpg) some text ![another](/uploads/path/image2.png)';
      const result = extractWikiImages(content);
      expect(result).toEqual(['/uploads/image1.jpg', '/uploads/path/image2.png']);
    });

    it('should extract external URL images from markdown', () => {
      const content = '![external](https://example.com/image.jpg) and ![another](http://test.com/pic.png)';
      const result = extractWikiImages(content);
      expect(result).toEqual(['https://example.com/image.jpg', 'http://test.com/pic.png']);
    });

    it('should extract mixed local and external images', () => {
      const content = `
        ![local](/uploads/local.jpg)
        ![external](https://cdn.example.com/img.png)
        Some text here
        ![another local](/uploads/nested/path/img.webp)
      `;
      const result = extractWikiImages(content);
      expect(result).toEqual([
        '/uploads/local.jpg',
        'https://cdn.example.com/img.png',
        '/uploads/nested/path/img.webp',
      ]);
    });

    it('should return empty array for content without images', () => {
      const content = 'This is just plain text without any images.';
      const result = extractWikiImages(content);
      expect(result).toEqual([]);
    });

    it('should return empty array for empty content', () => {
      expect(extractWikiImages('')).toEqual([]);
      expect(extractWikiImages(null as unknown as string)).toEqual([]);
      expect(extractWikiImages(undefined as unknown as string)).toEqual([]);
    });

    it('should handle images with empty alt text', () => {
      const content = '![](/uploads/no-alt.jpg) and ![ ](/uploads/space-alt.png)';
      const result = extractWikiImages(content);
      expect(result).toEqual(['/uploads/no-alt.jpg', '/uploads/space-alt.png']);
    });

    it('should handle images with special characters in URL', () => {
      const content = '![img](/uploads/image%20with%20spaces.jpg) ![img2](https://example.com/img?v=123&t=abc)';
      const result = extractWikiImages(content);
      expect(result).toEqual(['/uploads/image%20with%20spaces.jpg', 'https://example.com/img?v=123&t=abc']);
    });

    it('should extract images from HTML img tags', () => {
      const content = '<img src="/uploads/html-img.jpg" alt="test"> and <img src="https://cdn.example.com/img.png" class="photo">';
      const result = extractWikiImages(content);
      expect(result).toEqual(['/uploads/html-img.jpg', 'https://cdn.example.com/img.png']);
    });

    it('should extract images from both Markdown and HTML img tags', () => {
      const content = '![md](/uploads/md.jpg) <img src="/uploads/html.jpg"> ![md2](/uploads/md2.jpg)';
      const result = extractWikiImages(content);
      expect(result).toEqual(['/uploads/md.jpg', '/uploads/md2.jpg', '/uploads/html.jpg']);
    });

    it('should deduplicate image URLs from Markdown and HTML', () => {
      const content = '![img](/uploads/same.jpg) <img src="/uploads/same.jpg">';
      const result = extractWikiImages(content);
      expect(result).toEqual(['/uploads/same.jpg']);
    });

    it('should handle HTML img tags with single quotes', () => {
      const content = "<img src='/uploads/single-quote.jpg' alt='test'>";
      const result = extractWikiImages(content);
      expect(result).toEqual(['/uploads/single-quote.jpg']);
    });
  });

  describe('extractPostImages', () => {
    it('should have same behavior as extractWikiImages', () => {
      const content = '![alt](/uploads/test.jpg) ![alt2](https://example.com/img.png)';
      const wikiResult = extractWikiImages(content);
      const postResult = extractPostImages(content);
      expect(postResult).toEqual(wikiResult);
      expect(postResult).toEqual(['/uploads/test.jpg', 'https://example.com/img.png']);
    });
  });

  describe('enqueueWikiImageEmbeddings', () => {
    const mockPrisma = {
      wikiPage: {
        findMany: vi.fn(),
      },
      wikiImageEmbedding: {
        deleteMany: vi.fn(),
        upsert: vi.fn(),
      },
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return zero counts for empty slug array', async () => {
      const result = await enqueueWikiImageEmbeddings(mockPrisma as unknown as PrismaClient, []);
      expect(result).toEqual({ requested: 0, queued: 0 });
      expect(mockPrisma.wikiPage.findMany).not.toHaveBeenCalled();
    });

    it('should create embedding tasks for wiki pages with images', async () => {
      mockPrisma.wikiPage.findMany.mockResolvedValue([
        { slug: 'page1', content: '![img1](/uploads/1.jpg) ![img2](/uploads/2.png)' },
        { slug: 'page2', content: '![img3](https://example.com/3.jpg)' },
      ]);

      const result = await enqueueWikiImageEmbeddings(mockPrisma as unknown as PrismaClient, ['page1', 'page2']);

      expect(result.requested).toBe(2);
      expect(result.queued).toBe(3);
      expect(mockPrisma.wikiImageEmbedding.upsert).toHaveBeenCalledTimes(3);
    });

    it('should deduplicate slugs', async () => {
      mockPrisma.wikiPage.findMany.mockResolvedValue([
        { slug: 'page1', content: '![img](/uploads/1.jpg)' },
      ]);

      await enqueueWikiImageEmbeddings(mockPrisma as unknown as PrismaClient, ['page1', 'page1', ' page1 ']);

      expect(mockPrisma.wikiPage.findMany).toHaveBeenCalledWith({
        where: { slug: { in: ['page1'] }, status: 'published' },
        select: { slug: true, content: true },
      });
    });

    it('should update existing embedding to pending status', async () => {
      mockPrisma.wikiPage.findMany.mockResolvedValue([
        { slug: 'page1', content: '![img](/uploads/1.jpg)' },
      ]);

      await enqueueWikiImageEmbeddings(mockPrisma as unknown as PrismaClient, ['page1']);

      expect(mockPrisma.wikiImageEmbedding.upsert).toHaveBeenCalledWith({
        where: {
          wikiPageSlug_imageUrl: {
            wikiPageSlug: 'page1',
            imageUrl: '/uploads/1.jpg',
          },
        },
        update: {
          status: EmbeddingStatus.pending,
          lastError: null,
        },
        create: {
          wikiPageSlug: 'page1',
          imageUrl: '/uploads/1.jpg',
          modelName: 'Xenova/clip-vit-base-patch32',
          vectorSize: 512,
          status: EmbeddingStatus.pending,
        },
      });
    });

    it('should handle wiki pages without images', async () => {
      mockPrisma.wikiPage.findMany.mockResolvedValue([
        { slug: 'page1', content: 'Just text without images' },
        { slug: 'page2', content: '![img](/uploads/1.jpg)' },
      ]);

      const result = await enqueueWikiImageEmbeddings(mockPrisma as unknown as PrismaClient, ['page1', 'page2']);

      expect(result.queued).toBe(1);
      expect(mockPrisma.wikiImageEmbedding.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('enqueuePostImageEmbeddings', () => {
    const mockPrisma = {
      post: {
        findMany: vi.fn(),
      },
      postImageEmbedding: {
        deleteMany: vi.fn(),
        upsert: vi.fn(),
      },
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return zero counts for empty postIds array', async () => {
      const result = await enqueuePostImageEmbeddings(mockPrisma as unknown as PrismaClient, []);
      expect(result).toEqual({ requested: 0, queued: 0 });
    });

    it('should create embedding tasks for posts with images', async () => {
      mockPrisma.post.findMany.mockResolvedValue([
        { id: 'post1', content: '![img1](/uploads/1.jpg)' },
        { id: 'post2', content: '![img2](/uploads/2.jpg) ![img3](/uploads/3.jpg)' },
      ]);

      const result = await enqueuePostImageEmbeddings(mockPrisma as unknown as PrismaClient, ['post1', 'post2']);

      expect(result.requested).toBe(2);
      expect(result.queued).toBe(3);
    });

    it('should upsert with correct composite key', async () => {
      mockPrisma.post.findMany.mockResolvedValue([
        { id: 'post1', content: '![img](/uploads/1.jpg)' },
      ]);

      await enqueuePostImageEmbeddings(mockPrisma as unknown as PrismaClient, ['post1']);

      expect(mockPrisma.postImageEmbedding.upsert).toHaveBeenCalledWith({
        where: {
          postId_imageUrl: {
            postId: 'post1',
            imageUrl: '/uploads/1.jpg',
          },
        },
        update: {
          status: EmbeddingStatus.pending,
          lastError: null,
        },
        create: {
          postId: 'post1',
          imageUrl: '/uploads/1.jpg',
          modelName: 'Xenova/clip-vit-base-patch32',
          vectorSize: 512,
          status: EmbeddingStatus.pending,
        },
      });
    });
  });

  describe('enqueueMissingWikiImageEmbeddings', () => {
    const mockPrisma = {
      wikiPage: {
        findMany: vi.fn(),
      },
      wikiImageEmbedding: {
        findMany: vi.fn(),
        createMany: vi.fn(),
      },
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return zero counts when no wiki pages exist', async () => {
      mockPrisma.wikiPage.findMany.mockResolvedValue([]);

      const result = await enqueueMissingWikiImageEmbeddings(mockPrisma as unknown as PrismaClient, 10);

      expect(result).toEqual({ requested: 0, queued: 0 });
    });

    it('should return zero counts when wiki pages have no images', async () => {
      mockPrisma.wikiPage.findMany.mockResolvedValue([
        { slug: 'page1', content: 'No images here' },
        { slug: 'page2', content: 'Also no images' },
      ]);

      const result = await enqueueMissingWikiImageEmbeddings(mockPrisma as unknown as PrismaClient, 10);

      expect(result).toEqual({ requested: 0, queued: 0 });
    });

    it('should only create tasks for images without existing embeddings', async () => {
      mockPrisma.wikiPage.findMany.mockResolvedValue([
        { slug: 'page1', content: '![img1](/uploads/1.jpg) ![img2](/uploads/2.jpg)' },
        { slug: 'page2', content: '![img3](/uploads/3.jpg)' },
      ]);
      mockPrisma.wikiImageEmbedding.findMany.mockResolvedValue([
        { wikiPageSlug: 'page1', imageUrl: '/uploads/1.jpg' },
      ]);

      const result = await enqueueMissingWikiImageEmbeddings(mockPrisma as unknown as PrismaClient, 10);

      expect(result.requested).toBe(2);
      expect(result.queued).toBe(2); // img2 and img3
      expect(mockPrisma.wikiImageEmbedding.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            wikiPageSlug: 'page1',
            imageUrl: '/uploads/2.jpg',
            status: EmbeddingStatus.pending,
          }),
          expect.objectContaining({
            wikiPageSlug: 'page2',
            imageUrl: '/uploads/3.jpg',
            status: EmbeddingStatus.pending,
          }),
        ]),
        skipDuplicates: true,
      });
    });

    it('should respect the limit parameter', async () => {
      mockPrisma.wikiPage.findMany.mockResolvedValue([
        { slug: 'page1', content: '![img](/uploads/1.jpg)' },
      ]);
      mockPrisma.wikiImageEmbedding.findMany.mockResolvedValue([]);

      await enqueueMissingWikiImageEmbeddings(mockPrisma as unknown as PrismaClient, 5);

      expect(mockPrisma.wikiPage.findMany).toHaveBeenCalledWith({
        where: { status: 'published' },
        select: { slug: true, content: true },
        take: 5,
        orderBy: { updatedAt: 'asc' },
      });
    });

    it('should return zero queued when all images already have embeddings', async () => {
      mockPrisma.wikiPage.findMany.mockResolvedValue([
        { slug: 'page1', content: '![img](/uploads/1.jpg)' },
      ]);
      mockPrisma.wikiImageEmbedding.findMany.mockResolvedValue([
        { wikiPageSlug: 'page1', imageUrl: '/uploads/1.jpg' },
      ]);

      const result = await enqueueMissingWikiImageEmbeddings(mockPrisma as unknown as PrismaClient, 10);

      expect(result).toEqual({ requested: 1, queued: 0 });
      expect(mockPrisma.wikiImageEmbedding.createMany).not.toHaveBeenCalled();
    });
  });

  describe('enqueueMissingPostImageEmbeddings', () => {
    const mockPrisma = {
      post: {
        findMany: vi.fn(),
      },
      postImageEmbedding: {
        findMany: vi.fn(),
        createMany: vi.fn(),
      },
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return zero counts when no posts exist', async () => {
      mockPrisma.post.findMany.mockResolvedValue([]);

      const result = await enqueueMissingPostImageEmbeddings(mockPrisma as unknown as PrismaClient, 10);

      expect(result).toEqual({ requested: 0, queued: 0 });
    });

    it('should create tasks only for missing embeddings', async () => {
      mockPrisma.post.findMany.mockResolvedValue([
        { id: 'post1', content: '![img1](/uploads/1.jpg) ![img2](/uploads/2.jpg)' },
        { id: 'post2', content: '![img1](/uploads/1.jpg)' }, // Same image, different post
      ]);
      mockPrisma.postImageEmbedding.findMany.mockResolvedValue([
        { postId: 'post1', imageUrl: '/uploads/1.jpg' },
      ]);

      const result = await enqueueMissingPostImageEmbeddings(mockPrisma as unknown as PrismaClient, 10);

      expect(result.requested).toBe(2);
      expect(result.queued).toBe(2); // post1/img2 and post2/img1
    });

    it('should handle multiple images across multiple posts', async () => {
      mockPrisma.post.findMany.mockResolvedValue([
        { id: 'post1', content: '![a](/uploads/a.jpg)' },
        { id: 'post2', content: '![b](/uploads/b.jpg)' },
        { id: 'post3', content: '![c](/uploads/c.jpg)' },
      ]);
      mockPrisma.postImageEmbedding.findMany.mockResolvedValue([]);

      const result = await enqueueMissingPostImageEmbeddings(mockPrisma as unknown as PrismaClient, 10);

      expect(result.queued).toBe(3);
      expect(mockPrisma.postImageEmbedding.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ postId: 'post1', imageUrl: '/uploads/a.jpg' }),
          expect.objectContaining({ postId: 'post2', imageUrl: '/uploads/b.jpg' }),
          expect.objectContaining({ postId: 'post3', imageUrl: '/uploads/c.jpg' }),
        ],
        skipDuplicates: true,
      });
    });
  });
});
