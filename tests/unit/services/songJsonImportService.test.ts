import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  musicExternalSource: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  musicTrack: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}))

const mockAddSongCoverFromUrl = vi.hoisted(() => vi.fn())
const mockAutoLinkInstrumental = vi.hoisted(() => vi.fn())
const mockInvalidateByPrefix = vi.hoisted(() => vi.fn())

vi.mock('../../../src/server/utils', async () => {
  const actual = await vi.importActual<typeof import('../../../src/server/utils')>(
    '../../../src/server/utils'
  )

  return {
    ...actual,
    prisma: mockPrisma,
    addSongCoverFromUrl: mockAddSongCoverFromUrl,
    autoLinkInstrumental: mockAutoLinkInstrumental,
    enhancedCache: {
      invalidateByPrefix: mockInvalidateByPrefix,
    },
  }
})

const validSong = {
  title: '惊鸿',
  artists: ['黄诗扶'],
  lyricists: ['A'],
  composers: ['B'],
  arrangers: ['C'],
  vocals: ['黄诗扶'],
  album: '专辑',
  audioUrl: 'https://example.com/audio.mp3',
  coverUrl: 'https://example.com/cover.jpg',
  lyric: '[00:00]歌词',
  description: '描述',
  releaseDate: '2026-01-01',
  durationMs: 180000,
  sources: [
    {
      platform: 'netease',
      sourceId: '123',
      sourceUrl: 'https://music.163.com/#/song?id=123',
      isPrimary: true,
    },
  ],
  customPlatformLinks: [{ label: '其他平台', url: 'https://example.com/song' }],
}

function existingSong(overrides: Record<string, unknown> = {}) {
  return {
    docId: 'song-doc-1',
    title: '惊鸿',
    artists: ['黄诗扶'],
    lyricists: [],
    composers: [],
    arrangers: [],
    vocals: [],
    album: '',
    audioUrl: '',
    lyric: null,
    description: null,
    releaseDate: null,
    durationMs: null,
    customPlatformLinks: null,
    coverId: null,
    coverAlbumDocId: null,
    deletedAt: null,
    externalSources: [],
    ...overrides,
  }
}

async function importService() {
  return import('../../../src/server/services/songJsonImport.service')
}

describe('song JSON import service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.musicExternalSource.findFirst.mockResolvedValue(null)
    mockPrisma.musicExternalSource.findMany.mockResolvedValue([])
    mockPrisma.musicExternalSource.create.mockResolvedValue({})
    mockPrisma.musicExternalSource.deleteMany.mockResolvedValue({ count: 0 })
    mockPrisma.musicTrack.findFirst.mockResolvedValue(null)
    mockPrisma.musicTrack.create.mockResolvedValue({
      docId: 'song-doc-new',
      coverId: null,
      coverAlbumDocId: null,
    })
    mockPrisma.musicTrack.update.mockResolvedValue({})
    mockAddSongCoverFromUrl.mockResolvedValue({})
    mockAutoLinkInstrumental.mockResolvedValue(undefined)
  })

  it('parses both top-level array and songs object payloads', async () => {
    const { previewSongJsonImport } = await importService()

    await expect(previewSongJsonImport([validSong])).resolves.toMatchObject({
      items: [expect.anything()],
    })
    await expect(previewSongJsonImport({ songs: [validSong] })).resolves.toMatchObject({
      items: [expect.anything()],
    })
  })

  it('supports huangshifu-songs style albumName and platformRecords fields', async () => {
    const { previewSongJsonImport } = await importService()

    const preview = await previewSongJsonImport({
      songs: [
        {
          title: '归来',
          artists: ['黄诗扶'],
          albumName: '俱往矣',
          platformRecords: [
            {
              platform: 'netease',
              platformId: '524782504',
              url: 'https://music.163.com/#/song?id=524782504',
            },
          ],
        },
      ],
    })
    const song = preview.items[0].input

    expect(song.album).toBe('俱往矣')
    expect(song.sources).toEqual([
      {
        platform: 'netease',
        sourceId: '524782504',
        sourceUrl: 'https://music.163.com/#/song?id=524782504',
        isPrimary: true,
      },
    ])
  })

  it('falls back to platformRecords when explicit sources are empty', async () => {
    const { previewSongJsonImport } = await importService()

    const preview = await previewSongJsonImport({
      songs: [
        {
          title: '归来',
          artists: ['黄诗扶'],
          sources: [],
          platformRecords: [
            {
              platform: 'tencent',
              platformId: '004RgKOm4gOIPZ',
              url: 'https://y.qq.com/n/ryqq/songDetail/004RgKOm4gOIPZ',
            },
          ],
        },
      ],
    })
    const song = preview.items[0].input

    expect(song.sources).toEqual([
      {
        platform: 'tencent',
        sourceId: '004RgKOm4gOIPZ',
        sourceUrl: 'https://y.qq.com/n/ryqq/songDetail/004RgKOm4gOIPZ',
        isPrimary: true,
      },
    ])
  })

  it('normalizes custom platform links through the shared music helper', async () => {
    const { previewSongJsonImport } = await importService()

    const preview = await previewSongJsonImport({
      songs: [
        {
          title: '归来',
          artists: ['黄诗扶'],
          customPlatformLinks: [
            { label: '官网', url: 'example.com/song' },
            { label: '无效', url: 'javascript:alert(1)' },
          ],
        },
      ],
    })
    const song = preview.items[0].input

    expect(song.customPlatformLinks).toEqual([{ label: '官网', url: 'https://example.com/song' }])
  })

  it('reports validation errors and does not write invalid songs', async () => {
    const { previewSongJsonImport, executeSongJsonImport } = await importService()

    const preview = await previewSongJsonImport({ songs: [{ title: '' }] })
    const result = await executeSongJsonImport(preview, new Map())

    expect(preview.invalidItems).toHaveLength(1)
    expect(result.summary.invalid).toBe(1)
    expect(mockPrisma.musicTrack.create).not.toHaveBeenCalled()
    expect(mockInvalidateByPrefix).not.toHaveBeenCalled()
  })

  it('creates new songs with sources and cover URL', async () => {
    const { previewSongJsonImport, executeSongJsonImport } = await importService()

    const preview = await previewSongJsonImport({ songs: [validSong] })
    const result = await executeSongJsonImport(preview, new Map())

    expect(result.summary.created).toBe(1)
    expect(mockPrisma.musicTrack.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: '惊鸿',
        artists: ['黄诗扶'],
        externalSources: {
          create: [
            expect.objectContaining({
              resourceType: 'song',
              platform: 'netease',
              sourceId: '123',
              isPrimary: true,
            }),
          ],
        },
      }),
    })
    expect(mockAddSongCoverFromUrl).toHaveBeenCalledWith(
      'song-doc-new',
      'https://example.com/cover.jpg',
      true
    )
    expect(mockInvalidateByPrefix).toHaveBeenCalledWith('music_list:')
  })

  it('auto-links instrumental relations after creating JSON imported songs', async () => {
    const { previewSongJsonImport, executeSongJsonImport } = await importService()

    const preview = await previewSongJsonImport({
      songs: [
        {
          title: '惊鸿 (伴奏)',
          artists: ['黄诗扶'],
        },
      ],
    })
    const result = await executeSongJsonImport(preview, new Map())

    expect(result.summary.created).toBe(1)
    expect(mockAutoLinkInstrumental).toHaveBeenCalledWith('song-doc-new', '惊鸿 (伴奏)', '黄诗扶')
  })

  it('fills only empty fields on duplicate songs and appends missing sources', async () => {
    const { previewSongJsonImport, executeSongJsonImport } = await importService()
    const song = existingSong({
      title: '惊鸿',
      artists: ['黄诗扶'],
      album: '已有专辑',
      externalSources: [],
    })
    mockPrisma.musicExternalSource.findFirst.mockResolvedValue({
      song,
    })

    const preview = await previewSongJsonImport({ songs: [validSong] })
    const result = await executeSongJsonImport(preview, new Map([[0, 'fill']]))

    expect(result.summary.filled).toBe(1)
    expect(mockPrisma.musicTrack.update).toHaveBeenCalledWith({
      where: { docId: 'song-doc-1' },
      data: expect.objectContaining({
        lyricists: ['A'],
        audioUrl: 'https://example.com/audio.mp3',
      }),
    })
    expect(mockPrisma.musicTrack.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          album: '专辑',
        }),
      })
    )
    expect(mockPrisma.musicExternalSource.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        songDocId: 'song-doc-1',
        platform: 'netease',
        sourceId: '123',
      }),
    })
  })

  it('overwrites duplicate songs and replaces sources', async () => {
    const { previewSongJsonImport, executeSongJsonImport } = await importService()
    const song = existingSong({
      album: '旧专辑',
      externalSources: [{ platform: 'tencent', sourceId: 'old', songDocId: 'song-doc-1' }],
    })
    mockPrisma.musicExternalSource.findFirst.mockResolvedValue({
      song,
    })

    const preview = await previewSongJsonImport({ songs: [validSong] })
    const result = await executeSongJsonImport(preview, new Map([[0, 'overwrite']]))

    expect(result.summary.overwritten).toBe(1)
    expect(mockPrisma.musicTrack.update).toHaveBeenCalledWith({
      where: { docId: 'song-doc-1' },
      data: expect.objectContaining({
        album: '专辑',
        lyric: '[00:00]歌词',
      }),
    })
    expect(mockPrisma.musicExternalSource.deleteMany).toHaveBeenCalledWith({
      where: {
        resourceType: 'song',
        songDocId: 'song-doc-1',
      },
    })
    expect(mockPrisma.musicExternalSource.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        songDocId: 'song-doc-1',
        platform: 'netease',
        sourceId: '123',
      }),
    })
  })

  it('skips duplicate songs when requested', async () => {
    const { previewSongJsonImport, executeSongJsonImport } = await importService()
    mockPrisma.musicExternalSource.findFirst.mockResolvedValue({
      song: existingSong(),
    })

    const preview = await previewSongJsonImport({ songs: [validSong] })
    const result = await executeSongJsonImport(preview, new Map([[0, 'skip']]))

    expect(result.summary.skipped).toBe(1)
    expect(mockPrisma.musicTrack.update).not.toHaveBeenCalled()
    expect(mockPrisma.musicExternalSource.create).not.toHaveBeenCalled()
    expect(mockInvalidateByPrefix).not.toHaveBeenCalled()
  })
})
