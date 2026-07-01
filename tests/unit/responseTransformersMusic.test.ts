import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockSiteConfigFindUnique = vi.hoisted(() => vi.fn())

vi.mock('../../src/server/utils/config', () => ({
  prisma: {
    siteConfig: {
      findUnique: mockSiteConfigFindUnique,
    },
  },
}))

describe('music response transformers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSiteConfigFindUnique.mockResolvedValue({ value: { strategy: 'local' } })
  })

  it('includes description for detail responses and excludes it when requested', async () => {
    const { toSongResponse } = await import('../../src/server/utils/response-transformers')

    const baseSong = {
      docId: 'song-doc-1',
      title: '测试歌曲',
      artists: ['歌手'],
      lyricists: [],
      composers: [],
      arrangers: [],
      vocals: [],
      album: '专辑',
      audioUrl: '',
      lyric: '歌词',
      description: 'Markdown 描述',
      releaseDate: null,
      durationMs: null,
      coverId: null,
      coverAlbumDocId: null,
      externalSources: [
        {
          id: 'source-1',
          resourceType: 'song',
          platform: 'netease',
          sourceId: '12345',
          sourceUrl: null,
          isPrimary: true,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-02T00:00:00.000Z'),
        },
      ],
      customPlatformLinks: null,
      displayAlbumMode: 'linked',
      manualAlbumName: null,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
      covers: [],
      albumRelations: [],
      instrumentalLinks: [],
    }

    const detail = toSongResponse(baseSong as Parameters<typeof toSongResponse>[0])
    expect(detail.description).toBe('Markdown 描述')
    expect(detail.lyric).toBe('歌词')
    expect(detail.playable).toBe(true)
    expect(detail.sources).toEqual([
      expect.objectContaining({
        platform: 'netease',
        sourceId: '12345',
        isPrimary: true,
      }),
    ])

    const listItem = toSongResponse(baseSong as Parameters<typeof toSongResponse>[0], {
      excludeLyric: true,
      excludeDescription: true,
    })
    expect(listItem.description).toBeUndefined()
    expect(listItem.lyric).toBeUndefined()
  })

  it('resolves song covers in compact music responses', async () => {
    const { toMusicResponse } = await import('../../src/server/utils/response-transformers')

    const response = toMusicResponse({
      docId: 'song-doc-1',
      title: '测试歌曲',
      artists: ['歌手'],
      album: '专辑',
      audioUrl: '',
      releaseDate: null,
      durationMs: null,
      coverId: 'cover-2',
      coverAlbumDocId: null,
      covers: [
        { id: 'cover-1', publicUrl: '/uploads/cover-1.jpg', isDefault: true },
        { id: 'cover-2', publicUrl: '/uploads/cover-2.jpg', isDefault: false },
      ],
      albumRelations: [],
      externalSources: [],
      displayAlbumMode: 'linked',
      manualAlbumName: null,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    })

    expect(response.cover).toBe('/uploads/cover-2.jpg')
  })

  it('resolves inherited album covers in compact music responses', async () => {
    const { toMusicResponse } = await import('../../src/server/utils/response-transformers')

    const response = toMusicResponse({
      docId: 'song-doc-1',
      title: '测试歌曲',
      artists: ['歌手'],
      album: '专辑',
      audioUrl: '',
      releaseDate: null,
      durationMs: null,
      coverId: null,
      coverAlbumDocId: 'album-doc-1',
      covers: [],
      albumRelations: [
        {
          album: {
            docId: 'album-doc-1',
            coverId: 'album-cover-1',
            covers: [
              {
                id: 'album-cover-1',
                publicUrl: '/uploads/album-cover-1.jpg',
                isDefault: true,
              },
            ],
          },
        },
      ],
      externalSources: [],
      displayAlbumMode: 'linked',
      manualAlbumName: null,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    })

    expect(response.cover).toBe('/uploads/album-cover-1.jpg')
  })
})
