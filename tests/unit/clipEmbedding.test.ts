import { beforeEach, describe, expect, it, vi } from 'vitest';

const readMock = vi.hoisted(() => vi.fn());
const pipelineMock = vi.hoisted(() => vi.fn());

vi.mock('@huggingface/transformers', () => ({
  RawImage: {
    read: readMock,
  },
  pipeline: pipelineMock,
  env: {
    cacheDir: '',
    allowRemoteModels: true,
    allowLocalModels: false,
  },
}));

describe('clipEmbedding', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.IMAGE_EMBEDDING_MODEL;
    delete process.env.IMAGE_EMBEDDING_VECTOR_SIZE;
  });

  it('returns default model and vector size', async () => {
    const module = await import('../../src/server/vector/clipEmbedding');
    expect(module.getEmbeddingModelName()).toBe('Xenova/clip-vit-base-patch32');
    expect(module.getEmbeddingVectorSize()).toBe(512);
  });

  it('reads model and vector size from env with validation', async () => {
    process.env.IMAGE_EMBEDDING_MODEL = 'custom/model';
    process.env.IMAGE_EMBEDDING_VECTOR_SIZE = '256';

    const module = await import('../../src/server/vector/clipEmbedding');
    expect(module.getEmbeddingModelName()).toBe('custom/model');
    expect(module.getEmbeddingVectorSize()).toBe(256);

    process.env.IMAGE_EMBEDDING_VECTOR_SIZE = '-1';
    expect(module.getEmbeddingVectorSize()).toBe(512);
  });

  it('generates normalized embedding vector', async () => {
    process.env.IMAGE_EMBEDDING_VECTOR_SIZE = '2';

    readMock.mockResolvedValueOnce({ kind: 'image' });
    const extractorMock = vi.fn().mockResolvedValueOnce({ data: [3, 4] });
    pipelineMock.mockResolvedValueOnce(extractorMock);

    const module = await import('../../src/server/vector/clipEmbedding');
    const vector = await module.generateImageEmbedding(Buffer.from([1, 2, 3]));

    expect(pipelineMock).toHaveBeenCalledWith(
      'image-feature-extraction',
      'Xenova/clip-vit-base-patch32',
      expect.objectContaining({
        cache_dir: expect.any(String),
      })
    );
    expect(readMock).toHaveBeenCalledTimes(1);
    expect(extractorMock).toHaveBeenCalledWith(
      { kind: 'image' },
      { pooling: 'mean', normalize: true },
    );
    expect(vector[0]).toBeCloseTo(0.6, 6);
    expect(vector[1]).toBeCloseTo(0.8, 6);
  });

  it('throws when image buffer is empty', async () => {
    const module = await import('../../src/server/vector/clipEmbedding');
    await expect(module.generateImageEmbedding(Buffer.alloc(0))).rejects.toThrow('图片内容为空，无法生成向量');
  });

  it('throws when output vector size mismatches expected size', async () => {
    process.env.IMAGE_EMBEDDING_VECTOR_SIZE = '3';

    readMock.mockResolvedValueOnce({ kind: 'image' });
    const extractorMock = vi.fn().mockResolvedValueOnce({ data: [1, 2] });
    pipelineMock.mockResolvedValueOnce(extractorMock);

    const module = await import('../../src/server/vector/clipEmbedding');
    await expect(module.generateImageEmbedding(Buffer.from([9]))).rejects.toThrow('向量维度异常');
  });
});
