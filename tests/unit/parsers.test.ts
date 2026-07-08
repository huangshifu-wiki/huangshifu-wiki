import { describe, expect, it } from 'vitest'
import {
  parseDate,
  normalizeOptionalDateOnly,
  normalizeOptionalDateOnlyString,
  parseInteger,
  parseBoolean,
  extractBase64Payload,
  parseMinSimilarityScore,
  toEmbeddingPayload,
  normalizeTagList,
  serializeTags,
  hasTag,
  normalizeWikiSlug,
  normalizeOptionalDocId,
  normalizeKeyword,
  parseAssetIdList,
  parseContentStatus,
  normalizeWikiWriteStatus,
  normalizePostWriteStatus,
  parseFavoriteType,
  parseMusicPlatform,
  parseDisplayAlbumMode,
  parseBrowsingTargetType,
  parseModerationTargetType,
  normalizeModerationTargetType,
  parsePostSort,
} from '../../src/server/utils/parsers'
import {
  getWikiDraftButtonText,
  getWikiSaveResultText,
  getWikiSubmitButtonText,
} from '../../src/lib/wikiWriteText'

describe('parsers', () => {
  const makeUser = (role: 'admin' | 'user') => ({
    uid: role === 'admin' ? 'admin' : 'user1',
    publicId: role === 'admin' ? '1' : '2',
    email: `${role}@test.com`,
    displayName: role,
    photoURL: null as string | null,
    wechatBound: false,
    role,
    status: 'active' as const,
    banReason: null as string | null,
    bannedAt: null as string | null,
    emailVerified: true,
    level: 1,
    signature: '',
    bio: '',
  })

  describe('parseDate', () => {
    it('returns null for null/undefined', () => {
      expect(parseDate(null)).toBeNull()
      expect(parseDate(undefined)).toBeNull()
    })

    it('parses valid ISO string', () => {
      const result = parseDate('2024-01-15T00:00:00.000Z')
      expect(result).toBeInstanceOf(Date)
      expect(result?.toISOString()).toBe('2024-01-15T00:00:00.000Z')
    })

    it('parses Date object', () => {
      const date = new Date('2024-06-01')
      expect(parseDate(date)).toEqual(date)
    })

    it('returns null for invalid date string', () => {
      expect(parseDate('not-a-date')).toBeNull()
      expect(parseDate('')).toBeNull()
    })
  })

  describe('normalizeOptionalDateOnly', () => {
    it('accepts valid date-only strings', () => {
      const result = normalizeOptionalDateOnly('2026-02-28')
      expect(result).toBeInstanceOf(Date)
      expect(result?.toISOString()).toBe('2026-02-28T00:00:00.000Z')
    })

    it('rejects out-of-range calendar dates', () => {
      expect(normalizeOptionalDateOnly('2026-02-31')).toBeUndefined()
      expect(normalizeOptionalDateOnly('2026-13-01')).toBeUndefined()
    })

    it('normalizes empty values to null', () => {
      expect(normalizeOptionalDateOnly(null)).toBeNull()
      expect(normalizeOptionalDateOnly('')).toBeNull()
      expect(normalizeOptionalDateOnly('   ')).toBeNull()
    })
  })

  describe('normalizeOptionalDateOnlyString', () => {
    it('accepts valid date-only strings without applying local timezone offsets', () => {
      expect(normalizeOptionalDateOnlyString('2024-06-15')).toBe('2024-06-15')
      expect(normalizeOptionalDateOnlyString(' 2024-06-15 ')).toBe('2024-06-15')
    })

    it('rejects out-of-range calendar dates and non-date values', () => {
      expect(normalizeOptionalDateOnlyString('2026-02-31')).toBeUndefined()
      expect(normalizeOptionalDateOnlyString('2026-13-01')).toBeUndefined()
      expect(normalizeOptionalDateOnlyString('2026-2-1')).toBeUndefined()
      expect(normalizeOptionalDateOnlyString(20260201)).toBeUndefined()
    })

    it('normalizes empty values to null', () => {
      expect(normalizeOptionalDateOnlyString(null)).toBeNull()
      expect(normalizeOptionalDateOnlyString('')).toBeNull()
      expect(normalizeOptionalDateOnlyString('   ')).toBeNull()
    })
  })

  describe('parseInteger', () => {
    it('parses valid integer', () => {
      expect(parseInteger(42, 0)).toBe(42)
      expect(parseInteger('10', 0)).toBe(10)
    })

    it('returns fallback for non-finite values', () => {
      expect(parseInteger(NaN, 99)).toBe(99)
      expect(parseInteger(Infinity, 99)).toBe(99)
      expect(parseInteger('abc', 99)).toBe(99)
      expect(parseInteger(undefined, 99)).toBe(99)
    })

    it('floors decimal values', () => {
      expect(parseInteger(3.9, 0)).toBe(3)
      expect(parseInteger(-1.5, 0)).toBe(-2)
    })

    it('applies min constraint', () => {
      expect(parseInteger(-5, 0, { min: 0 })).toBe(0)
      expect(parseInteger(5, 0, { min: 0 })).toBe(5)
    })

    it('applies max constraint', () => {
      expect(parseInteger(200, 0, { max: 100 })).toBe(100)
      expect(parseInteger(50, 0, { max: 100 })).toBe(50)
    })

    it('applies both min and max constraints', () => {
      expect(parseInteger(-5, 50, { min: 0, max: 100 })).toBe(0)
      expect(parseInteger(150, 50, { min: 0, max: 100 })).toBe(100)
      expect(parseInteger(50, 0, { min: 0, max: 100 })).toBe(50)
    })
  })

  describe('parseBoolean', () => {
    it('returns boolean as-is', () => {
      expect(parseBoolean(true)).toBe(true)
      expect(parseBoolean(false)).toBe(false)
    })

    it('parses string true variants', () => {
      expect(parseBoolean('true')).toBe(true)
      expect(parseBoolean('TRUE')).toBe(true)
      expect(parseBoolean('1')).toBe(true)
    })

    it('parses string false variants', () => {
      expect(parseBoolean('false')).toBe(false)
      expect(parseBoolean('FALSE')).toBe(false)
      expect(parseBoolean('0')).toBe(false)
    })

    it('parses numeric 1/0', () => {
      expect(parseBoolean(1)).toBe(true)
      expect(parseBoolean(0)).toBe(false)
    })

    it('returns fallback for unknown values', () => {
      expect(parseBoolean('yes')).toBe(false)
      expect(parseBoolean(2)).toBe(false)
      expect(parseBoolean(null)).toBe(false)
      expect(parseBoolean(undefined, true)).toBe(true)
    })
  })

  describe('extractBase64Payload', () => {
    it('returns null for non-string', () => {
      expect(extractBase64Payload(null)).toBeNull()
      expect(extractBase64Payload(123)).toBeNull()
      expect(extractBase64Payload({})).toBeNull()
    })

    it('returns null for empty/whitespace string', () => {
      expect(extractBase64Payload('')).toBeNull()
      expect(extractBase64Payload('   ')).toBeNull()
    })

    it('extracts payload from data URI', () => {
      const result = extractBase64Payload('data:image/png;base64,abc123')
      expect(result).toBe('abc123')
    })

    it('returns raw string without data: prefix', () => {
      const result = extractBase64Payload('rawbase64string')
      expect(result).toBe('rawbase64string')
    })

    it('returns null for data URI without comma', () => {
      expect(extractBase64Payload('data:image/png;base64')).toBeNull()
    })
  })

  describe('parseMinSimilarityScore', () => {
    it('returns undefined for empty/null/undefined', () => {
      expect(parseMinSimilarityScore(undefined)).toBeUndefined()
      expect(parseMinSimilarityScore(null)).toBeUndefined()
      expect(parseMinSimilarityScore('')).toBeUndefined()
    })

    it('clamps value to [0, 1]', () => {
      expect(parseMinSimilarityScore(0.5)).toBe(0.5)
      expect(parseMinSimilarityScore(2)).toBe(1)
      expect(parseMinSimilarityScore(-1)).toBe(0)
      expect(parseMinSimilarityScore('0.8')).toBe(0.8)
    })

    it('returns undefined for non-finite values', () => {
      expect(parseMinSimilarityScore(NaN)).toBeUndefined()
      expect(parseMinSimilarityScore('abc')).toBeUndefined()
    })
  })

  describe('toEmbeddingPayload', () => {
    it('returns null for falsy/non-object values', () => {
      expect(toEmbeddingPayload(null)).toBeNull()
      expect(toEmbeddingPayload(undefined)).toBeNull()
      expect(toEmbeddingPayload('string')).toBeNull()
      expect(toEmbeddingPayload(123)).toBeNull()
    })

    it('returns null when galleryId or galleryImageId is missing', () => {
      expect(toEmbeddingPayload({ galleryId: 'g1' })).toBeNull()
      expect(toEmbeddingPayload({ galleryImageId: 'img1' })).toBeNull()
      expect(toEmbeddingPayload({})).toBeNull()
    })

    it('returns normalized payload with all fields', () => {
      const result = toEmbeddingPayload({
        galleryId: 'g1',
        galleryImageId: 'img1',
        imageUrl: 'http://example.com/img.jpg',
        imageName: 'test.jpg',
        extra: 'ignored',
      })
      expect(result).toEqual({
        galleryId: 'g1',
        galleryImageId: 'img1',
        imageUrl: 'http://example.com/img.jpg',
        imageName: 'test.jpg',
      })
    })

    it('uses empty string for missing optional fields', () => {
      const result = toEmbeddingPayload({ galleryId: 'g1', galleryImageId: 'img1' })
      expect(result?.imageUrl).toBe('')
      expect(result?.imageName).toBe('')
    })
  })

  describe('normalizeTagList', () => {
    it('returns empty array for non-array', () => {
      expect(normalizeTagList(null)).toEqual([])
      expect(normalizeTagList('tags')).toEqual([])
      expect(normalizeTagList(123)).toEqual([])
    })

    it('trims and filters strings', () => {
      expect(normalizeTagList([' a ', 'b', '', ' c '])).toEqual(['a', 'b', 'c'])
    })

    it('filters out non-string items', () => {
      expect(normalizeTagList(['a', 123, null, undefined, 'b'])).toEqual(['a', 'b'])
    })

    it('limits to 30 items', () => {
      const tags = Array.from({ length: 35 }, (_, i) => `tag${i}`)
      expect(normalizeTagList(tags)).toHaveLength(30)
    })
  })

  describe('serializeTags', () => {
    it('returns empty array for falsy values', () => {
      expect(serializeTags(null)).toEqual([])
      expect(serializeTags(undefined)).toEqual([])
      expect(serializeTags(0)).toEqual([])
      expect(serializeTags('')).toEqual([])
    })

    it('returns array as-is', () => {
      const arr = ['a', 'b']
      expect(serializeTags(arr)).toEqual(arr)
    })

    it('returns empty array for non-array truthy values', () => {
      expect(serializeTags('string')).toEqual([])
      expect(serializeTags(123)).toEqual([])
    })
  })

  describe('hasTag', () => {
    it('returns true when tag exists', () => {
      expect(hasTag(['music', 'wiki'], 'music')).toBe(true)
    })

    it('returns false when tag does not exist', () => {
      expect(hasTag(['music', 'wiki'], 'photo')).toBe(false)
    })

    it('handles non-array values gracefully', () => {
      expect(hasTag(null, 'tag')).toBe(false)
      expect(hasTag('tag', 'tag')).toBe(false)
    })
  })

  describe('normalizeWikiSlug', () => {
    it('returns null for non-string', () => {
      expect(normalizeWikiSlug(null)).toBeNull()
      expect(normalizeWikiSlug(123)).toBeNull()
      expect(normalizeWikiSlug({})).toBeNull()
    })

    it('trims and lowercases', () => {
      expect(normalizeWikiSlug('  Test-SLUG  ')).toBe('test-slug')
    })

    it('handles empty string', () => {
      expect(normalizeWikiSlug('')).toBe('')
    })

    it('preserves unicode characters', () => {
      expect(normalizeWikiSlug('黄诗扶 Wiki')).toBe('黄诗扶 wiki')
    })
  })

  describe('normalizeOptionalDocId', () => {
    it('returns null for non-string', () => {
      expect(normalizeOptionalDocId(null)).toBeNull()
      expect(normalizeOptionalDocId(123)).toBeNull()
      expect(normalizeOptionalDocId(undefined)).toBeNull()
    })

    it('returns trimmed string', () => {
      expect(normalizeOptionalDocId('  abc  ')).toBe('abc')
    })

    it('returns null for whitespace-only string', () => {
      expect(normalizeOptionalDocId('   ')).toBeNull()
    })
  })

  describe('normalizeKeyword', () => {
    it('trims, lowercases, collapses spaces', () => {
      expect(normalizeKeyword('  Hello   World  ')).toBe('hello world')
    })

    it('limits to 64 characters', () => {
      const long = 'a'.repeat(100)
      expect(normalizeKeyword(long)).toHaveLength(64)
    })

    it('handles empty string', () => {
      expect(normalizeKeyword('')).toBe('')
    })
  })

  describe('parseAssetIdList', () => {
    it('returns empty array for non-array', () => {
      expect(parseAssetIdList(null)).toEqual([])
      expect(parseAssetIdList('id1')).toEqual([])
    })

    it('deduplicates and trims strings', () => {
      expect(parseAssetIdList([' a ', ' b ', ' a ', '  '])).toEqual(['a', 'b'])
    })

    it('filters out non-string items', () => {
      expect(parseAssetIdList([123, null, 'id1', undefined, 'id1'])).toEqual(['id1'])
    })

    it('returns empty array for empty input', () => {
      expect(parseAssetIdList([])).toEqual([])
    })
  })

  describe('parseContentStatus', () => {
    it('returns valid statuses', () => {
      expect(parseContentStatus('draft')).toBe('draft')
      expect(parseContentStatus('pending')).toBe('pending')
      expect(parseContentStatus('published')).toBe('published')
      expect(parseContentStatus('rejected')).toBe('rejected')
    })

    it('returns null for invalid statuses', () => {
      expect(parseContentStatus('unknown')).toBeNull()
      expect(parseContentStatus('DRAFT')).toBeNull()
      expect(parseContentStatus(null)).toBeNull()
      expect(parseContentStatus(123)).toBeNull()
    })
  })

  describe('normalizeWikiWriteStatus', () => {
    const adminUser = makeUser('admin')
    const normalUser = makeUser('user')

    it('admin keeps draft when explicitly saving draft', () => {
      expect(normalizeWikiWriteStatus('draft', adminUser)).toBe('draft')
    })

    it('admin gets published for non-draft statuses', () => {
      expect(normalizeWikiWriteStatus('pending', adminUser)).toBe('published')
      expect(normalizeWikiWriteStatus('published', adminUser)).toBe('published')
      expect(normalizeWikiWriteStatus(null, adminUser)).toBe('published')
    })

    it('normal user with pending stays pending', () => {
      expect(normalizeWikiWriteStatus('pending', normalUser)).toBe('pending')
    })

    it('normal user with rejected stays rejected', () => {
      expect(normalizeWikiWriteStatus('rejected', normalUser)).toBe('rejected')
    })

    it('normal user defaults to draft', () => {
      expect(normalizeWikiWriteStatus('draft', normalUser)).toBe('draft')
      expect(normalizeWikiWriteStatus('published', normalUser)).toBe('draft')
      expect(normalizeWikiWriteStatus(null, normalUser)).toBe('draft')
    })
  })

  describe('normalizePostWriteStatus', () => {
    const postAdmin = makeUser('admin')
    const postNormal = makeUser('user')

    it('admin skips review unless saving draft', () => {
      expect(normalizePostWriteStatus('pending', postAdmin)).toBe('published')
      expect(normalizePostWriteStatus('published', postAdmin)).toBe('published')
      expect(normalizePostWriteStatus('draft', postAdmin)).toBe('draft')
      expect(normalizePostWriteStatus(null, postAdmin)).toBe('published')
    })

    it('normal user with pending/rejected preserved', () => {
      expect(normalizePostWriteStatus('pending', postNormal)).toBe('pending')
      expect(normalizePostWriteStatus('rejected', postNormal)).toBe('rejected')
    })

    it('normal user defaults to draft', () => {
      expect(normalizePostWriteStatus('draft', postNormal)).toBe('draft')
      expect(normalizePostWriteStatus(null, postNormal)).toBe('draft')
    })
  })

  describe('wikiWriteText', () => {
    const t = (key: string) => key

    it('returns shared button labels', () => {
      expect(getWikiDraftButtonText(t, 'draft')).toBe('wiki.saving')
      expect(getWikiDraftButtonText(t, 'pending')).toBe('wiki.saveDraft')
      expect(getWikiSubmitButtonText(t, true, false)).toBe('wiki.publishWiki')
      expect(getWikiSubmitButtonText(t, false, true)).toBe('wiki.submitting')
    })

    it('returns shared save result labels', () => {
      expect(getWikiSaveResultText(t, 'draft')).toBe('wiki.draftSaved')
      expect(getWikiSaveResultText(t, 'pending')).toBe('wiki.reviewSubmitted')
      expect(getWikiSaveResultText(t, 'published')).toBe('wiki.pagePublished')
    })
  })

  describe('parseFavoriteType', () => {
    it('returns valid types', () => {
      expect(parseFavoriteType('wiki')).toBe('wiki')
      expect(parseFavoriteType('post')).toBe('post')
      expect(parseFavoriteType('music')).toBe('music')
      expect(parseFavoriteType('gallery')).toBe('gallery')
    })

    it('returns null for invalid types', () => {
      expect(parseFavoriteType('video')).toBeNull()
      expect(parseFavoriteType(null)).toBeNull()
    })
  })

  describe('parseMusicPlatform', () => {
    it('returns valid platforms', () => {
      expect(parseMusicPlatform('netease')).toBe('netease')
      expect(parseMusicPlatform('tencent')).toBe('tencent')
      expect(parseMusicPlatform('kugou')).toBe('kugou')
      expect(parseMusicPlatform('baidu')).toBe('baidu')
      expect(parseMusicPlatform('kuwo')).toBe('kuwo')
    })

    it('returns null for invalid platforms', () => {
      expect(parseMusicPlatform('spotify')).toBeNull()
      expect(parseMusicPlatform(null)).toBeNull()
    })
  })

  describe('parseDisplayAlbumMode', () => {
    it('returns valid modes', () => {
      expect(parseDisplayAlbumMode('none')).toBe('none')
      expect(parseDisplayAlbumMode('linked')).toBe('linked')
      expect(parseDisplayAlbumMode('manual')).toBe('manual')
    })

    it('returns null for invalid modes', () => {
      expect(parseDisplayAlbumMode('grid')).toBeNull()
    })
  })

  describe('parseBrowsingTargetType', () => {
    it('returns valid types', () => {
      expect(parseBrowsingTargetType('wiki')).toBe('wiki')
      expect(parseBrowsingTargetType('post')).toBe('post')
      expect(parseBrowsingTargetType('music')).toBe('music')
    })

    it('returns null for invalid types', () => {
      expect(parseBrowsingTargetType('gallery')).toBeNull()
    })
  })

  describe('parseModerationTargetType', () => {
    it('returns valid types', () => {
      expect(parseModerationTargetType('wiki')).toBe('wiki')
      expect(parseModerationTargetType('post')).toBe('post')
      expect(parseModerationTargetType('gallery')).toBe('gallery')
      expect(parseModerationTargetType('comment')).toBe('comment')
    })

    it('returns null for invalid types', () => {
      expect(parseModerationTargetType('music')).toBeNull()
    })
  })

  describe('normalizeModerationTargetType', () => {
    it('normalizes posts to post', () => {
      expect(normalizeModerationTargetType('posts')).toBe('post')
      expect(normalizeModerationTargetType('galleries')).toBe('gallery')
      expect(normalizeModerationTargetType('comments')).toBe('comment')
    })

    it('passes through valid types', () => {
      expect(normalizeModerationTargetType('wiki')).toBe('wiki')
      expect(normalizeModerationTargetType('post')).toBe('post')
      expect(normalizeModerationTargetType('gallery')).toBe('gallery')
      expect(normalizeModerationTargetType('comment')).toBe('comment')
    })

    it('returns null for invalid types', () => {
      expect(normalizeModerationTargetType('music')).toBeNull()
    })
  })

  describe('parsePostSort', () => {
    it('returns valid sort types', () => {
      expect(parsePostSort('hot')).toBe('hot')
      expect(parsePostSort('recommended')).toBe('recommended')
    })

    it('defaults to latest for invalid types', () => {
      expect(parsePostSort('oldest')).toBe('latest')
      expect(parsePostSort(null)).toBe('latest')
      expect(parsePostSort(undefined)).toBe('latest')
    })
  })
})
