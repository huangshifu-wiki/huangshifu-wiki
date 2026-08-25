import { describe, expect, it, vi } from 'vitest'
import {
  diffImportTrackWithExisting,
  batchMatchAndDiffImportTracks,
} from '../../src/server/utils/musicImportMatch'
import type {
  SongImportExistingSongSummary,
  MusicImportTrackWithMeta,
} from '../../src/server/utils/musicImportMatch'

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
  describe('diffImportTrackWithExisting', () => {
    it('returns new status when no existing song is matched', () => {
      const track: MusicImportTrackWithMeta = {
        sourceId: '1001',
        title: '新歌测试',
        artists: ['黄诗扶'],
        album: '新专辑',
        picId: 'pic1',
        urlId: 'url1',
        lyricId: 'lyric1',
        cover: 'https://example.com/cover.jpg',
        sourceUrl: 'https://music.163.com/#/song?id=1001',
      }

      const result = diffImportTrackWithExisting({
        platform: 'netease',
        track,
        existingSong: null,
        matchType: 'none',
      })

      expect(result.status).toBe('new')
      expect(result.matchType).toBe('none')
      expect(result.existingSong).toBeNull()
      expect(result.diffs).toHaveLength(0)
    })

    it('returns identical status when everything matches and source is bound', () => {
      const existing: SongImportExistingSongSummary = {
        docId: 'song_1',
        slug: '101',
        title: '九万字',
        artists: ['黄诗扶'],
        album: '九万字',
        hasCover: true,
        hasLyric: true,
        durationMs: 240000,
        releaseDate: '2026-01-01',
        externalSources: [{ platform: 'netease', sourceId: '1001' }],
      }

      const track: MusicImportTrackWithMeta = {
        sourceId: '1001',
        title: '九万字',
        artists: ['黄诗扶'],
        album: '九万字',
        picId: 'pic1',
        urlId: 'url1',
        lyricId: 'lyric1',
        cover: 'https://example.com/cover.jpg',
        sourceUrl: 'https://music.163.com/#/song?id=1001',
        durationMs: 242000, // 差异 2 秒 <= 5 秒，视为一致
        releaseDate: '2026-01-01',
      }

      const result = diffImportTrackWithExisting({
        platform: 'netease',
        track,
        existingSong: existing,
        matchType: 'source',
      })

      expect(result.status).toBe('identical')
      expect(result.diffs.every((d) => d.status === 'same')).toBe(true)
    })

    it('detects fillable status when external source needs binding and album is missing', () => {
      const existing: SongImportExistingSongSummary = {
        docId: 'song_2',
        slug: '102',
        title: '吹梦到西洲',
        artists: ['黄诗扶', '妖扬'],
        album: '',
        hasCover: false,
        hasLyric: false,
        durationMs: null,
        releaseDate: null,
        externalSources: [{ platform: 'tencent', sourceId: 'qq_999' }],
      }

      const track: MusicImportTrackWithMeta = {
        sourceId: 'netease_888',
        title: '吹梦到西洲',
        artists: ['黄诗扶', '妖扬'],
        album: '吹梦到西洲专辑',
        picId: 'pic2',
        urlId: 'url2',
        lyricId: 'lyric2',
        cover: 'https://example.com/cover2.jpg',
        sourceUrl: 'https://music.163.com/#/song?id=888',
        lyric: '[00:00.00]测试歌词',
        durationMs: 280000,
        releaseDate: '2026-05-20',
      }

      const result = diffImportTrackWithExisting({
        platform: 'netease',
        track,
        existingSong: existing,
        matchType: 'title_artist',
      })

      expect(result.status).toBe('fillable')
      const fillDiffs = result.diffs.filter((d) => d.status === 'fill')
      const fillFields = fillDiffs.map((d) => d.field)
      expect(fillFields).toContain('externalSource')
      expect(fillFields).toContain('album')
      expect(fillFields).toContain('cover')
      expect(fillFields).toContain('duration')
      expect(fillFields).toContain('releaseDate')
      expect(fillFields).toContain('lyric')
    })

    it('detects conflict status when duration differs significantly (>5s) or title differs', () => {
      const existing: SongImportExistingSongSummary = {
        docId: 'song_3',
        slug: '103',
        title: '人间不值得',
        artists: ['黄诗扶'],
        album: '原版专辑',
        hasCover: true,
        hasLyric: true,
        durationMs: 200000,
        releaseDate: '2026-01-01',
        externalSources: [{ platform: 'netease', sourceId: '777' }],
      }

      const track: MusicImportTrackWithMeta = {
        sourceId: '777',
        title: '人间不值得 (Live版)',
        artists: ['黄诗扶'],
        album: '现场Live专辑',
        picId: 'pic3',
        urlId: 'url3',
        lyricId: 'lyric3',
        cover: 'https://example.com/cover3.jpg',
        sourceUrl: 'https://music.163.com/#/song?id=777',
        durationMs: 230000, // 差异 30s > 5s
        releaseDate: '2026-08-01',
      }

      const result = diffImportTrackWithExisting({
        platform: 'netease',
        track,
        existingSong: existing,
        matchType: 'source',
      })

      expect(result.status).toBe('conflict')
      const conflictDiffs = result.diffs.filter((d) => d.status === 'conflict')
      const conflictFields = conflictDiffs.map((d) => d.field)
      expect(conflictFields).toContain('title')
      expect(conflictFields).toContain('album')
      expect(conflictFields).toContain('duration')
      expect(conflictFields).toContain('releaseDate')
    })
  })

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

      const tracks: MusicImportTrackWithMeta[] = [
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
