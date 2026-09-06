import { describe, expect, it, vi } from 'vitest'
import { batchMatchAndDiffImportTracks } from '../../src/server/utils/musicImportMatch'

const mockPrisma = vi.hoisted(() => ({
  musicExternalSource: {
    findMany: vi.fn(),
  },
  musicTrack: {
    findMany: vi.fn(),
  },
}))

vi.mock('../../src/server/prisma', () => ({
  prisma: mockPrisma,
}))

describe('musicImportMatch - 歌曲导入预检与Diff比对引擎', () => {
  describe('batchMatchAndDiffImportTracks', () => {
    it('accurately matches by sourceId and title_artist and aggregates summary stats', async () => {
      mockPrisma.musicExternalSource.findMany.mockResolvedValueOnce([
        {
          id: 'es_1',
          platform: 'netease',
          sourceId: 'src_101',
          song: {
            docId: 'doc_101',
            slug: '101',
            title: '曲目一',
            artists: ['黄诗扶'],
            album: '专辑A',
            coverId: 'cover_1',
            coverAlbumDocId: null,
            lyric: '歌词文本',
            durationMs: 180000,
            releaseDate: new Date('2026-01-01'),
            deletedAt: null,
            externalSources: [{ platform: 'netease', sourceId: 'src_101' }],
          },
        },
      ])

      mockPrisma.musicTrack.findMany.mockResolvedValueOnce([
        {
          docId: 'doc_102',
          slug: '102',
          title: '曲目二',
          artists: ['黄诗扶'],
          album: '',
          coverId: null,
          coverAlbumDocId: null,
          lyric: null,
          durationMs: null,
          releaseDate: null,
          deletedAt: null,
          externalSources: [],
        },
      ])

      const tracks: Parameters<typeof batchMatchAndDiffImportTracks>[0]['tracks'] = [
        {
          sourceId: 'src_101',
          title: '曲目一',
          artists: ['黄诗扶'],
          album: '专辑A',
          picId: 'p1',
          urlId: 'u1',
          lyricId: 'l1',
          cover: 'https://example.com/c1.jpg',
          sourceUrl: 'https://music.163.com/#/song?id=src_101',
          durationMs: 180000,
        },
        {
          sourceId: 'src_102',
          title: '曲目二',
          artists: ['黄诗扶'],
          album: '新填专辑B',
          picId: 'p2',
          urlId: 'u2',
          lyricId: 'l2',
          cover: 'https://example.com/c2.jpg',
          sourceUrl: 'https://music.163.com/#/song?id=src_102',
        },
        {
          sourceId: 'src_103',
          title: '全新未收录曲目三',
          artists: ['黄诗扶'],
          album: '专辑C',
          picId: 'p3',
          urlId: 'u3',
          lyricId: 'l3',
          cover: 'https://example.com/c3.jpg',
          sourceUrl: 'https://music.163.com/#/song?id=src_103',
        },
      ]

      const { matches, summary } = await batchMatchAndDiffImportTracks({
        platform: 'netease',
        tracks,
      })

      expect(matches).toHaveLength(3)
      expect(matches[0].matchType).toBe('source')
      expect(matches[0].status).toBe('identical')

      expect(matches[1].matchType).toBe('title_artist')
      expect(matches[1].status).toBe('fillable')

      expect(matches[2].matchType).toBe('none')
      expect(matches[2].status).toBe('new')

      expect(summary).toEqual({
        newCount: 1,
        fillableCount: 1,
        conflictCount: 0,
        identicalCount: 1,
      })
    })
  })
})
