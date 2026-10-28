import { beforeEach, describe, expect, it, vi } from 'vitest'

const deletePointsMock = vi.hoisted(() => vi.fn())

vi.mock('@huggingface/transformers', () => ({
  RawImage: { read: vi.fn() },
  pipeline: vi.fn(),
  env: { cacheDir: '', allowRemoteModels: true, allowLocalModels: false },
}))

vi.mock('../../src/server/vector/qdrantService', () => ({
  upsertTextEmbeddingPoint: vi.fn(),
  deleteTextEmbeddingPoint: vi.fn(),
  deleteTextEmbeddingPointsBySource: deletePointsMock,
}))

describe('textEmbeddingSync', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.IMAGE_EMBEDDING_MODEL
    delete process.env.IMAGE_EMBEDDING_VECTOR_SIZE
  })

  it('enqueueMusicTextEmbeddings 先删后建，生成的 chunk 不含歌词', async () => {
    const order: string[] = []
    const prismaMock = {
      musicTrack: {
        findMany: vi.fn().mockResolvedValue([
          {
            docId: 'song-1',
            title: '测试歌曲',
            artists: ['歌手A', '歌手B'],
            album: '专辑X',
            description: '独特描述词XYZ 背景介绍',
            lyric: '[00:00.00]歌词第一行\n[00:05.00]歌词第二行',
            lyricPlain: '歌词第一行\n歌词第二行',
          },
        ]),
      },
      textEmbeddingChunk: {
        deleteMany: vi.fn().mockImplementation(() => {
          order.push('db-delete')
          return Promise.resolve({ count: 1 })
        }),
        upsert: vi.fn().mockImplementation(() => {
          order.push('upsert')
          return Promise.resolve({})
        }),
      },
    }

    deletePointsMock.mockImplementation(() => {
      order.push('qdrant-delete')
      return Promise.resolve(2)
    })

    const { enqueueMusicTextEmbeddings } = await import('../../src/server/vector/textEmbeddingSync')
    const result = await enqueueMusicTextEmbeddings(prismaMock as never, ['song-1'])

    expect(result.requested).toBe(1)
    expect(result.queued).toBeGreaterThan(0)
    // 先删本地 chunk，再删 Qdrant 点，最后才建新 chunk
    expect(order[0]).toBe('db-delete')
    expect(order[1]).toBe('qdrant-delete')
    expect(deletePointsMock).toHaveBeenCalledWith('music', 'song-1')
    expect(order.slice(2).every((step) => step === 'upsert')).toBe(true)
    // chunk 文本只含标题/艺人/专辑/描述，绝不携带歌词
    for (const [args] of prismaMock.textEmbeddingChunk.upsert.mock.calls) {
      const chunkText: string = args.create.chunkText
      expect(chunkText).toContain('测试歌曲')
      expect(chunkText).toContain('独特描述词XYZ')
      expect(chunkText).not.toContain('歌词第一行')
      expect(chunkText).not.toContain('歌词第二行')
    }
  })
})
