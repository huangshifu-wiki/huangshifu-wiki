import { beforeEach, describe, expect, it, vi } from 'vitest'

const readMock = vi.hoisted(() => vi.fn())
const pipelineMock = vi.hoisted(() => vi.fn())
const fetchMock = vi.hoisted(() => vi.fn())

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
}))

// mock sharpSafe：斩断其 runtimeConfigService→prisma 依赖（prisma 实例化会加载项目 .env，
// 把 beforeEach 删除的 IMAGE_EMBEDDING_MODEL 写回，污染模型名断言）
vi.mock('../../src/server/utils/sharpSafe', () => ({
  getSharpInputPixelLimit: vi.fn(() => 25_000_000),
  resolveSharpInputPixelLimit: vi.fn((hardCap: number) => hardCap),
}))

// mock sharp：嵌入预缩在单测中不真实解码；metadata 默认返回空对象（宽高未知，走预缩
// 路径），透传用例中用 mockResolvedValueOnce 覆盖
const sharpMetadataMock = vi.hoisted(() => vi.fn().mockResolvedValue({}))
const sharpToBufferMock = vi.hoisted(() => vi.fn().mockResolvedValue(Buffer.from('prepared-image')))

vi.mock('sharp', () => {
  const mockInstance = {
    metadata: sharpMetadataMock,
    resize: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    toBuffer: sharpToBufferMock,
  }
  return {
    default: vi.fn(() => mockInstance),
  }
})

describe('clipEmbedding', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
    } as Response)
    delete process.env.IMAGE_EMBEDDING_MODEL
    delete process.env.IMAGE_EMBEDDING_VECTOR_SIZE
    delete process.env.IMAGE_EMBEDDING_DTYPE
    delete process.env.TRANSFORMERS_OFFLINE
    delete process.env.SKIP_NETWORK_PROBE
    delete process.env.HF_PROBE_TIMEOUT_MS
  })

  it('returns default model and vector size', async () => {
    const module = await import('../../src/server/vector/clipEmbedding')
    expect(module.getEmbeddingModelName()).toBe('OFA-Sys/chinese-clip-vit-base-patch16')
    expect(module.getEmbeddingVectorSize()).toBe(512)
  })

  it('reads model and vector size from env with validation', async () => {
    process.env.IMAGE_EMBEDDING_MODEL = 'custom/model'
    process.env.IMAGE_EMBEDDING_VECTOR_SIZE = '256'

    const module = await import('../../src/server/vector/clipEmbedding')
    expect(module.getEmbeddingModelName()).toBe('custom/model')
    expect(module.getEmbeddingVectorSize()).toBe(256)

    process.env.IMAGE_EMBEDDING_VECTOR_SIZE = '-1'
    expect(module.getEmbeddingVectorSize()).toBe(512)
  })

  it('generates normalized embedding vector', async () => {
    process.env.IMAGE_EMBEDDING_VECTOR_SIZE = '2'

    readMock.mockResolvedValueOnce({ kind: 'image' })
    const extractorMock = vi.fn().mockResolvedValueOnce({ data: [3, 4] })
    pipelineMock.mockResolvedValueOnce(extractorMock)

    const module = await import('../../src/server/vector/clipEmbedding')
    const vector = await module.generateImageEmbedding(Buffer.from([1, 2, 3]))

    expect(pipelineMock).toHaveBeenCalledWith(
      expect.stringContaining('image-feature-extraction'),
      expect.any(String),
      expect.objectContaining({
        cache_dir: expect.any(String),
        dtype: expect.any(String),
      })
    )
    expect(readMock).toHaveBeenCalledTimes(1)
    expect(extractorMock).toHaveBeenCalledWith(
      { kind: 'image' },
      { pooling: 'mean', normalize: true }
    )
    expect(vector[0]).toBeCloseTo(0.6, 6)
    expect(vector[1]).toBeCloseTo(0.8, 6)
  })

  it('passes through images already within embedding size without re-encoding', async () => {
    process.env.IMAGE_EMBEDDING_VECTOR_SIZE = '2'

    sharpMetadataMock.mockResolvedValueOnce({ width: 800, height: 600 })
    readMock.mockResolvedValueOnce({ kind: 'image' })
    const extractorMock = vi.fn().mockResolvedValueOnce({ data: [3, 4] })
    pipelineMock.mockResolvedValueOnce(extractorMock)

    const module = await import('../../src/server/vector/clipEmbedding')
    const input = Buffer.from([1, 2, 3])
    const vector = await module.generateImageEmbedding(input)

    expect(sharpToBufferMock).not.toHaveBeenCalled()
    expect(readMock).toHaveBeenCalledTimes(1)
    expect(vector[0]).toBeCloseTo(0.6, 6)
    expect(vector[1]).toBeCloseTo(0.8, 6)
  })

  it('throws when image buffer is empty', async () => {
    const module = await import('../../src/server/vector/clipEmbedding')
    await expect(module.generateImageEmbedding(Buffer.alloc(0))).rejects.toThrow(
      '图片内容为空，无法生成向量'
    )
  })

  it('throws when output vector size mismatches expected size', async () => {
    process.env.IMAGE_EMBEDDING_VECTOR_SIZE = '3'

    readMock.mockResolvedValueOnce({ kind: 'image' })
    const extractorMock = vi.fn().mockResolvedValueOnce({ data: [1, 2] })
    pipelineMock.mockResolvedValueOnce(extractorMock)

    const module = await import('../../src/server/vector/clipEmbedding')
    await expect(module.generateImageEmbedding(Buffer.from([9]))).rejects.toThrow('向量维度异常')
  })

  it('isImageModelLoaded returns false when no model is loaded', async () => {
    const module = await import('../../src/server/vector/clipEmbedding')
    expect(module.isImageModelLoaded()).toBe(false)
  })

  it('isTextModelLoaded returns false when no model is loaded', async () => {
    const module = await import('../../src/server/vector/clipEmbedding')
    expect(module.isTextModelLoaded()).toBe(false)
  })

  it('isTokenizerLoaded returns false when no model is loaded', async () => {
    const module = await import('../../src/server/vector/clipEmbedding')
    expect(module.isTokenizerLoaded()).toBe(false)
  })

  it('getModelLoadError returns aggregated object with all nulls initially', async () => {
    const module = await import('../../src/server/vector/clipEmbedding')
    const errors = module.getModelLoadError()
    expect(errors).toEqual({ image: null, text: null, tokenizer: null })
  })

  it('getActualDtype falls back to getEmbeddingDtype when no model loaded', async () => {
    const module = await import('../../src/server/vector/clipEmbedding')
    expect(module.getActualDtype()).toBe('q8')
  })

  it('getActualDtype respects IMAGE_EMBEDDING_DTYPE env', async () => {
    process.env.IMAGE_EMBEDDING_DTYPE = 'fp32'
    const module = await import('../../src/server/vector/clipEmbedding')
    expect(module.getActualDtype()).toBe('fp32')
  })
})
