import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const qdrantClientInstanceMock = {
  getCollections: vi.fn(),
  getCollection: vi.fn(),
  createCollection: vi.fn(),
  deleteCollection: vi.fn(),
  createPayloadIndex: vi.fn(),
  upsert: vi.fn(),
  search: vi.fn(),
  scroll: vi.fn(),
  delete: vi.fn(),
};

vi.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: vi.fn(() => qdrantClientInstanceMock),
}));

describe('qdrantService', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(qdrantClientInstanceMock).forEach((fn) => {
      if (typeof fn === 'function' && 'mockReset' in fn) {
        (fn as ReturnType<typeof vi.fn>).mockReset();
      }
    });
    qdrantClientInstanceMock.getCollections.mockResolvedValue({ collections: [] });
    qdrantClientInstanceMock.createCollection.mockResolvedValue({ result: true });
    qdrantClientInstanceMock.createPayloadIndex.mockResolvedValue({ result: true });
    qdrantClientInstanceMock.upsert.mockResolvedValue({ result: true });
    qdrantClientInstanceMock.search.mockResolvedValue([]);
    qdrantClientInstanceMock.scroll.mockResolvedValue({ points: [], next_offset: null });
    qdrantClientInstanceMock.delete.mockResolvedValue({ result: true });
    delete process.env.QDRANT_COLLECTION;
    delete process.env.QDRANT_URL;
    delete process.env.QDRANT_API_KEY;
    delete process.env.IMAGE_EMBEDDING_VECTOR_SIZE;
  });

  it('uses defaults when env vars are unset', async () => {
    const { getQdrantCollectionName, getQdrantClient } = await import('../../src/server/vector/qdrantService');
    expect(getQdrantCollectionName()).toBe('hsf_image_embeddings');
    expect(getQdrantClient()).toBeDefined();
  });

  it('reads collection name and vector size from env', async () => {
    process.env.QDRANT_COLLECTION = 'custom_collection';
    process.env.QDRANT_URL = 'http://custom:6333';
    process.env.QDRANT_API_KEY = 'secret_key';
    process.env.IMAGE_EMBEDDING_VECTOR_SIZE = '256';

    const { getQdrantCollectionName, getQdrantClient } = await import('../../src/server/vector/qdrantService');
    expect(getQdrantCollectionName()).toBe('custom_collection');

    const client = getQdrantClient();
    expect(client).toBeDefined();
  });

  it('creates collection when it does not exist', async () => {
    qdrantClientInstanceMock.getCollections.mockResolvedValueOnce({ collections: [] });

    const { ensureQdrantCollection } = await import('../../src/server/vector/qdrantService');
    await ensureQdrantCollection();

    expect(qdrantClientInstanceMock.createCollection).toHaveBeenCalledWith(
      'hsf_image_embeddings',
      expect.objectContaining({
        vectors: expect.objectContaining({ size: 512, distance: 'Cosine' }),
      }),
    );
  });

  it('skips creation when collection already exists with matching dimensions', async () => {
    qdrantClientInstanceMock.getCollections.mockResolvedValueOnce({
      collections: [{ name: 'hsf_image_embeddings' }],
    });
    qdrantClientInstanceMock.getCollection.mockResolvedValueOnce({
      config: { params: { vectors: { size: 512 } } },
    });

    const { ensureQdrantCollection } = await import('../../src/server/vector/qdrantService');
    await ensureQdrantCollection();

    expect(qdrantClientInstanceMock.createCollection).not.toHaveBeenCalled();
  });

  it('creates sourceId index when image collection already exists', async () => {
    qdrantClientInstanceMock.getCollections.mockResolvedValueOnce({
      collections: [{ name: 'hsf_image_embeddings' }],
    });
    qdrantClientInstanceMock.getCollection.mockResolvedValueOnce({
      config: { params: { vectors: { size: 512 } } },
    });

    const { ensureQdrantCollection } = await import('../../src/server/vector/qdrantService');
    await ensureQdrantCollection();

    expect(qdrantClientInstanceMock.createPayloadIndex).toHaveBeenCalledWith(
      'hsf_image_embeddings',
      expect.objectContaining({
        field_name: 'sourceId',
        field_schema: 'keyword',
        wait: true,
      }),
    );
  });

  it('creates sourceType and sourceId indexes for new image collection', async () => {
    qdrantClientInstanceMock.getCollections.mockResolvedValueOnce({ collections: [] });

    const { ensureQdrantCollection } = await import('../../src/server/vector/qdrantService');
    await ensureQdrantCollection();

    expect(qdrantClientInstanceMock.createPayloadIndex).toHaveBeenCalledWith(
      'hsf_image_embeddings',
      expect.objectContaining({
        field_name: 'sourceType',
        field_schema: 'keyword',
        wait: true,
      }),
    );
    expect(qdrantClientInstanceMock.createPayloadIndex).toHaveBeenCalledWith(
      'hsf_image_embeddings',
      expect.objectContaining({
        field_name: 'sourceId',
        field_schema: 'keyword',
        wait: true,
      }),
    );
  });

  describe('ensureTextQdrantCollection', () => {
    it('creates sourceType and sourceId indexes for new text collection', async () => {
      qdrantClientInstanceMock.getCollections.mockResolvedValueOnce({ collections: [] });

      const { ensureTextQdrantCollection } = await import('../../src/server/vector/qdrantService');
      await ensureTextQdrantCollection();

      expect(qdrantClientInstanceMock.createPayloadIndex).toHaveBeenCalledWith(
        'hsf_text_embeddings',
        expect.objectContaining({
          field_name: 'sourceType',
          field_schema: 'keyword',
          wait: true,
        }),
      );
      expect(qdrantClientInstanceMock.createPayloadIndex).toHaveBeenCalledWith(
        'hsf_text_embeddings',
        expect.objectContaining({
          field_name: 'sourceId',
          field_schema: 'keyword',
          wait: true,
        }),
      );
    });

    it('creates sourceType and sourceId indexes when text collection already exists', async () => {
      qdrantClientInstanceMock.getCollections.mockResolvedValueOnce({
        collections: [{ name: 'hsf_text_embeddings' }],
      });
      qdrantClientInstanceMock.getCollection.mockResolvedValueOnce({
        config: { params: { vectors: { size: 512 } } },
      });

      const { ensureTextQdrantCollection } = await import('../../src/server/vector/qdrantService');
      await ensureTextQdrantCollection();

      expect(qdrantClientInstanceMock.createCollection).not.toHaveBeenCalled();
      expect(qdrantClientInstanceMock.createPayloadIndex).toHaveBeenCalledWith(
        'hsf_text_embeddings',
        expect.objectContaining({
          field_name: 'sourceType',
          field_schema: 'keyword',
          wait: true,
        }),
      );
      expect(qdrantClientInstanceMock.createPayloadIndex).toHaveBeenCalledWith(
        'hsf_text_embeddings',
        expect.objectContaining({
          field_name: 'sourceId',
          field_schema: 'keyword',
          wait: true,
        }),
      );
    });

    it('handles already existing indexes gracefully for text collection', async () => {
      qdrantClientInstanceMock.getCollections.mockResolvedValueOnce({
        collections: [{ name: 'hsf_text_embeddings' }],
      });
      qdrantClientInstanceMock.getCollection.mockResolvedValueOnce({
        config: { params: { vectors: { size: 512 } } },
      });
      qdrantClientInstanceMock.createPayloadIndex.mockRejectedValueOnce(new Error('already exists'));
      qdrantClientInstanceMock.createPayloadIndex.mockRejectedValueOnce(new Error('already exists'));

      const { ensureTextQdrantCollection } = await import('../../src/server/vector/qdrantService');
      await expect(ensureTextQdrantCollection()).resolves.toBeUndefined();
    });
  });

  describe('upsertImageEmbeddingPoint', () => {
    it('upserts gallery type embedding point', async () => {
      const { upsertImageEmbeddingPoint } = await import('../../src/server/vector/qdrantService');

      await upsertImageEmbeddingPoint({
        pointId: 'point-1',
        vector: [0.1, 0.2],
        sourceType: 'gallery',
        sourceId: 'img_1',
        imageUrl: 'https://example.com/1.jpg',
        galleryId: 'gal_1',
        galleryImageId: 'img_1',
        imageName: 'test.jpg',
        updatedAt: '2025-01-01T00:00:00Z',
      });

      expect(qdrantClientInstanceMock.getCollections).toHaveBeenCalled();
      expect(qdrantClientInstanceMock.upsert).toHaveBeenCalledWith(
        'hsf_image_embeddings',
        expect.objectContaining({
          wait: true,
          points: expect.arrayContaining([
            expect.objectContaining({
              id: 'point-1',
              vector: [0.1, 0.2],
              payload: expect.objectContaining({
                sourceType: 'gallery',
                sourceId: 'img_1',
                imageUrl: 'https://example.com/1.jpg',
                galleryId: 'gal_1',
                galleryImageId: 'img_1',
                imageName: 'test.jpg',
              }),
            }),
          ]),
        }),
      );
    });

    it('upserts wiki type embedding point', async () => {
      const { upsertImageEmbeddingPoint } = await import('../../src/server/vector/qdrantService');

      await upsertImageEmbeddingPoint({
        pointId: 'point-2',
        vector: [0.3, 0.4],
        sourceType: 'wiki',
        sourceId: 'page-slug',
        imageUrl: 'https://example.com/wiki.jpg',
        wikiPageSlug: 'page-slug',
        updatedAt: '2025-01-01T00:00:00Z',
      });

      expect(qdrantClientInstanceMock.upsert).toHaveBeenCalledWith(
        'hsf_image_embeddings',
        expect.objectContaining({
          wait: true,
          points: expect.arrayContaining([
            expect.objectContaining({
              id: 'point-2',
              payload: expect.objectContaining({
                sourceType: 'wiki',
                sourceId: 'page-slug',
                wikiPageSlug: 'page-slug',
              }),
            }),
          ]),
        }),
      );
    });

    it('upserts post type embedding point', async () => {
      const { upsertImageEmbeddingPoint } = await import('../../src/server/vector/qdrantService');

      await upsertImageEmbeddingPoint({
        pointId: 'point-3',
        vector: [0.5, 0.6],
        sourceType: 'post',
        sourceId: 'post_123',
        imageUrl: 'https://example.com/post.jpg',
        postId: 'post_123',
        updatedAt: '2025-01-01T00:00:00Z',
      });

      expect(qdrantClientInstanceMock.upsert).toHaveBeenCalledWith(
        'hsf_image_embeddings',
        expect.objectContaining({
          wait: true,
          points: expect.arrayContaining([
            expect.objectContaining({
              id: 'point-3',
              payload: expect.objectContaining({
                sourceType: 'post',
                sourceId: 'post_123',
                postId: 'post_123',
              }),
            }),
          ]),
        }),
      );
    });
  });

  describe('searchImageEmbeddingPoints', () => {
    it('searches embedding points with score threshold', async () => {
      qdrantClientInstanceMock.search.mockResolvedValueOnce([
        {
          id: 1,
          score: 0.95,
          payload: {
            sourceType: 'gallery',
            sourceId: 'img_1',
            imageUrl: 'https://example.com/1.jpg',
            galleryId: 'gal_1',
            updatedAt: '2025-01-01T00:00:00Z',
          },
        },
      ]);

      const { searchImageEmbeddingPoints } = await import('../../src/server/vector/qdrantService');
      const results = await searchImageEmbeddingPoints({ vector: [0.1, 0.2], limit: 5, minScore: 0.8 });

      expect(qdrantClientInstanceMock.search).toHaveBeenCalledWith(
        'hsf_image_embeddings',
        expect.objectContaining({
          vector: [0.1, 0.2],
          limit: 5,
          score_threshold: 0.8,
          with_payload: true,
          with_vector: false,
        }),
      );
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(1);
      expect(results[0].payload?.sourceType).toBe('gallery');
      expect(results[0].payload?.sourceId).toBe('img_1');
    });

    it('handles backward compatibility for old payload format', async () => {
      qdrantClientInstanceMock.search.mockResolvedValueOnce([
        {
          id: 1,
          score: 0.9,
          payload: {
            galleryImageId: 'old_img_1',
            galleryId: 'old_gal_1',
            imageUrl: 'https://example.com/old.jpg',
            imageName: 'old.jpg',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        },
      ]);

      const { searchImageEmbeddingPoints } = await import('../../src/server/vector/qdrantService');
      const results = await searchImageEmbeddingPoints({ vector: [0.1, 0.2], limit: 5 });

      expect(results).toHaveLength(1);
      expect(results[0].payload?.sourceType).toBe('gallery');
      expect(results[0].payload?.sourceId).toBe('old_img_1');
      expect(results[0].payload?.galleryImageId).toBe('old_img_1');
    });

    it('applies sourceType filter when provided', async () => {
      qdrantClientInstanceMock.search.mockResolvedValueOnce([]);

      const { searchImageEmbeddingPoints } = await import('../../src/server/vector/qdrantService');
      await searchImageEmbeddingPoints({ vector: [0.1, 0.2], limit: 5, sourceType: 'gallery' });

      expect(qdrantClientInstanceMock.search).toHaveBeenCalledWith(
        'hsf_image_embeddings',
        expect.objectContaining({
          vector: [0.1, 0.2],
          limit: 5,
          filter: {
            must: [{ key: 'sourceType', match: { value: 'gallery' } }],
          },
        }),
      );
    });

    it('omits filter when sourceType is not provided', async () => {
      qdrantClientInstanceMock.search.mockResolvedValueOnce([]);

      const { searchImageEmbeddingPoints } = await import('../../src/server/vector/qdrantService');
      await searchImageEmbeddingPoints({ vector: [0.1, 0.2], limit: 5 });

      const callArgs = qdrantClientInstanceMock.search.mock.calls[0][1];
      expect(callArgs.filter).toBeUndefined();
    });
  });

  describe('toEmbeddingPayload', () => {
    it('correctly parses new format payload', async () => {
      const { toEmbeddingPayload } = await import('../../src/server/vector/qdrantService');

      const payload = toEmbeddingPayload({
        sourceType: 'wiki',
        sourceId: 'wiki-page',
        imageUrl: 'https://example.com/wiki.png',
        wikiPageSlug: 'wiki-page',
        updatedAt: '2025-01-01T00:00:00Z',
      });

      expect(payload).toEqual({
        sourceType: 'wiki',
        sourceId: 'wiki-page',
        imageUrl: 'https://example.com/wiki.png',
        wikiPageSlug: 'wiki-page',
        updatedAt: '2025-01-01T00:00:00Z',
      });
    });

    it('returns null for null or undefined payload', async () => {
      const { toEmbeddingPayload } = await import('../../src/server/vector/qdrantService');

      expect(toEmbeddingPayload(null)).toBeNull();
      expect(toEmbeddingPayload(undefined)).toBeNull();
    });

    it('returns null for unrecognized payload format', async () => {
      const { toEmbeddingPayload } = await import('../../src/server/vector/qdrantService');

      expect(toEmbeddingPayload({ unknownField: 'value' })).toBeNull();
    });
  });

  describe('deleteImageEmbeddingPoint', () => {
    it('deletes embedding point by id', async () => {
      const { deleteImageEmbeddingPoint } = await import('../../src/server/vector/qdrantService');

      await deleteImageEmbeddingPoint('point-123');

      expect(qdrantClientInstanceMock.delete).toHaveBeenCalledWith(
        'hsf_image_embeddings',
        expect.objectContaining({
          wait: true,
          points: ['point-123'],
        }),
      );
    });
  });

  describe('deleteTextEmbeddingPointsBySource', () => {
    it('deletes all points matching source with single page', async () => {
      qdrantClientInstanceMock.scroll.mockResolvedValueOnce({
        points: [{ id: 'p1' }, { id: 'p2' }],
        next_offset: null,
      });

      const { deleteTextEmbeddingPointsBySource } = await import('../../src/server/vector/qdrantService');
      const count = await deleteTextEmbeddingPointsBySource('wiki', 'page-1');

      expect(count).toBe(2);
      expect(qdrantClientInstanceMock.scroll).toHaveBeenCalledWith(
        'hsf_text_embeddings',
        expect.objectContaining({
          filter: {
            must: [
              { key: 'sourceType', match: { value: 'wiki' } },
              { key: 'sourceId', match: { value: 'page-1' } },
            ],
          },
          with_payload: false,
          with_vector: false,
          limit: 1000,
          offset: undefined,
        }),
      );
      expect(qdrantClientInstanceMock.delete).toHaveBeenCalledWith(
        'hsf_text_embeddings',
        expect.objectContaining({
          wait: true,
          points: ['p1', 'p2'],
        }),
      );
    });

    it('paginates through multiple pages of results', async () => {
      qdrantClientInstanceMock.scroll
        .mockResolvedValueOnce({
          points: [{ id: 'p1' }, { id: 'p2' }],
          next_offset: 'offset-1',
        })
        .mockResolvedValueOnce({
          points: [{ id: 'p3' }],
          next_offset: null,
        });

      const { deleteTextEmbeddingPointsBySource } = await import('../../src/server/vector/qdrantService');
      const count = await deleteTextEmbeddingPointsBySource('post', 'post-1');

      expect(count).toBe(3);
      expect(qdrantClientInstanceMock.scroll).toHaveBeenCalledTimes(2);
      expect(qdrantClientInstanceMock.scroll).toHaveBeenNthCalledWith(
        2,
        'hsf_text_embeddings',
        expect.objectContaining({
          offset: 'offset-1',
        }),
      );
      expect(qdrantClientInstanceMock.delete).toHaveBeenCalledWith(
        'hsf_text_embeddings',
        expect.objectContaining({
          wait: true,
          points: ['p1', 'p2', 'p3'],
        }),
      );
    });

    it('returns 0 when no points match', async () => {
      qdrantClientInstanceMock.scroll.mockResolvedValueOnce({
        points: [],
        next_offset: null,
      });

      const { deleteTextEmbeddingPointsBySource } = await import('../../src/server/vector/qdrantService');
      const count = await deleteTextEmbeddingPointsBySource('wiki', 'nonexistent');

      expect(count).toBe(0);
      expect(qdrantClientInstanceMock.delete).not.toHaveBeenCalled();
    });
  });

  it('ensures collection only once across multiple calls', async () => {
    const { ensureQdrantCollection } = await import('../../src/server/vector/qdrantService');

    await Promise.all([ensureQdrantCollection(), ensureQdrantCollection(), ensureQdrantCollection()]);

    expect(qdrantClientInstanceMock.getCollections).toHaveBeenCalledTimes(1);
  });
});
