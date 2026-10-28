import { describe, expect, it } from 'vitest'
import {
  filterRelations,
  sortRelations,
  filterAndSortRelations,
  getTypeLabel,
  getQualityFilterLabel,
  getSortStrategyLabel,
  DEFAULT_FILTER_OPTIONS,
  DEFAULT_SORT_STRATEGY,
  type FilterOptions,
  type SortStrategy,
  type RelationWithMetadata,
} from '../../src/lib/relationSorter'
import type { WikiRelationRecord } from '../../src/components/wiki/types'

function createMockRelation(overrides?: Partial<RelationWithMetadata>): RelationWithMetadata {
  return {
    targetSlug: 'target',
    type: 'related_person',
    label: '测试关联',
    bidirectional: false,
    ...overrides,
  }
}

describe('relationSorter', () => {
  describe('filterRelations', () => {
    const mockRelations: RelationWithMetadata[] = [
      createMockRelation({
        type: 'related_person',
        qualityScore: 90,
        targetSlug: 'page-a',
        metadata: { title: '页面A', slug: 'page-a' },
      }),
      createMockRelation({
        type: 'work_relation',
        qualityScore: 75,
        targetSlug: 'page-b',
        metadata: { title: '页面B', slug: 'page-b' },
      }),
      createMockRelation({
        type: 'timeline_relation',
        qualityScore: 60,
        targetSlug: 'page-c',
        metadata: { title: '页面C', slug: 'page-c' },
      }),
      createMockRelation({
        type: 'custom',
        qualityScore: 50,
        targetSlug: 'page-d',
        metadata: { title: '页面D', slug: 'page-d' },
      }),
    ]

    it('returns all relations when no filters applied', () => {
      const result = filterRelations(mockRelations, DEFAULT_FILTER_OPTIONS)
      expect(result).toHaveLength(4)
    })

    it('filters by type', () => {
      const options: FilterOptions = { ...DEFAULT_FILTER_OPTIONS, type: 'related_person' }
      const result = filterRelations(mockRelations, options)
      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('related_person')
    })

    it('filters by quality - excellent (85+)', () => {
      const options: FilterOptions = { ...DEFAULT_FILTER_OPTIONS, quality: 'excellent' }
      const result = filterRelations(mockRelations, options)
      expect(result).toHaveLength(1)
      expect(result[0].qualityScore).toBeGreaterThanOrEqual(85)
    })

    it('filters by quality - good (70+)', () => {
      const options: FilterOptions = { ...DEFAULT_FILTER_OPTIONS, quality: 'good' }
      const result = filterRelations(mockRelations, options)
      expect(result).toHaveLength(2)
      expect(result.every((r) => (r.qualityScore || 0) >= 70)).toBe(true)
    })

    it('filters by quality - fair (55+)', () => {
      const options: FilterOptions = { ...DEFAULT_FILTER_OPTIONS, quality: 'fair' }
      const result = filterRelations(mockRelations, options)
      expect(result).toHaveLength(3)
    })

    it('filters by search keyword in title', () => {
      const options: FilterOptions = { ...DEFAULT_FILTER_OPTIONS, search: '页面A' }
      const result = filterRelations(mockRelations, options)
      expect(result).toHaveLength(1)
      expect(result[0].metadata?.title).toBe('页面A')
    })

    it('filters by search keyword in targetSlug', () => {
      const options: FilterOptions = { ...DEFAULT_FILTER_OPTIONS, search: 'page-b' }
      const result = filterRelations(mockRelations, options)
      expect(result).toHaveLength(1)
      expect(result[0].targetSlug).toBe('page-b')
    })

    it('filters by search keyword case-insensitively', () => {
      const options: FilterOptions = { ...DEFAULT_FILTER_OPTIONS, search: 'PAGE-A' }
      const result = filterRelations(mockRelations, options)
      expect(result).toHaveLength(1)
    })

    it('returns empty array when no matches', () => {
      const options: FilterOptions = { ...DEFAULT_FILTER_OPTIONS, search: 'nonexistent' }
      const result = filterRelations(mockRelations, options)
      expect(result).toHaveLength(0)
    })

    it('combines multiple filters', () => {
      const options: FilterOptions = { type: 'related_person', quality: 'good', search: '' }
      const result = filterRelations(mockRelations, options)
      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('related_person')
      expect(result[0].qualityScore).toBeGreaterThanOrEqual(70)
    })
  })

  describe('sortRelations', () => {
    const mockRelations: RelationWithMetadata[] = [
      createMockRelation({
        type: 'custom',
        qualityScore: 50,
        targetSlug: 'z-page',
        metadata: { title: 'Z页面', slug: 'z-page' },
      }),
      createMockRelation({
        type: 'related_person',
        qualityScore: 90,
        targetSlug: 'a-page',
        metadata: { title: 'A页面', slug: 'a-page' },
      }),
      createMockRelation({
        type: 'work_relation',
        qualityScore: 75,
        targetSlug: 'm-page',
        metadata: { title: 'M页面', slug: 'm-page' },
      }),
    ]

    it('sorts by quality descending', () => {
      const result = sortRelations(mockRelations, 'quality')
      expect(result[0].qualityScore).toBe(90)
      expect(result[1].qualityScore).toBe(75)
      expect(result[2].qualityScore).toBe(50)
    })

    it('sorts by type grouped', () => {
      const result = sortRelations(mockRelations, 'type_grouped')
      expect(result[0].type).toBe('related_person')
      expect(result[1].type).toBe('work_relation')
      expect(result[2].type).toBe('custom')
    })

    it('sorts alphabetically by title', () => {
      const result = sortRelations(mockRelations, 'alphabetical')
      expect(result[0].metadata?.title).toBe('A页面')
      expect(result[1].metadata?.title).toBe('M页面')
      expect(result[2].metadata?.title).toBe('Z页面')
    })

    it('sorts by date when publishDate available', () => {
      const relationsWithDate: RelationWithMetadata[] = [
        createMockRelation({ metadata: { title: 'Old', slug: 'old', publishDate: '2023-01-01' } }),
        createMockRelation({ metadata: { title: 'New', slug: 'new', publishDate: '2024-01-01' } }),
        createMockRelation({
          metadata: { title: 'Middle', slug: 'middle', publishDate: '2023-06-01' },
        }),
      ]
      const result = sortRelations(relationsWithDate, 'date')
      expect(result[0].metadata?.title).toBe('New')
      expect(result[1].metadata?.title).toBe('Middle')
      expect(result[2].metadata?.title).toBe('Old')
    })

    it('falls back to label when metadata title is missing', () => {
      const relations: RelationWithMetadata[] = [
        createMockRelation({ label: 'B标签', metadata: undefined }),
        createMockRelation({ label: 'A标签', metadata: undefined }),
      ]
      const result = sortRelations(relations, 'alphabetical')
      expect(result[0].label).toBe('A标签')
      expect(result[1].label).toBe('B标签')
    })

    it('falls back to targetSlug when both title and label missing', () => {
      const relations: RelationWithMetadata[] = [
        createMockRelation({ targetSlug: 'z-slug', label: '', metadata: undefined }),
        createMockRelation({ targetSlug: 'a-slug', label: '', metadata: undefined }),
      ]
      const result = sortRelations(relations, 'alphabetical')
      expect(result[0].targetSlug).toBe('a-slug')
      expect(result[1].targetSlug).toBe('z-slug')
    })

    it('does not mutate original array', () => {
      const original = [...mockRelations]
      sortRelations(mockRelations, 'quality')
      expect(mockRelations).toEqual(original)
    })
  })

  describe('filterAndSortRelations', () => {
    it('combines filter and sort operations', () => {
      const relations: RelationWithMetadata[] = [
        createMockRelation({ type: 'related_person', qualityScore: 60 }),
        createMockRelation({ type: 'related_person', qualityScore: 90 }),
        createMockRelation({ type: 'work_relation', qualityScore: 80 }),
      ]

      const filterOptions: FilterOptions = { type: 'related_person', quality: 'all', search: '' }
      const result = filterAndSortRelations(relations, filterOptions, 'quality')

      expect(result).toHaveLength(2)
      expect(result[0].qualityScore).toBe(90)
      expect(result[1].qualityScore).toBe(60)
    })
  })

  describe('getTypeLabel', () => {
    it('returns correct labels for all types', () => {
      expect(getTypeLabel('related_person')).toBe('相关人物')
      expect(getTypeLabel('work_relation')).toBe('作品关联')
      expect(getTypeLabel('timeline_relation')).toBe('时间线关联')
      expect(getTypeLabel('custom')).toBe('自定义关系')
    })

    it('returns type itself for unknown type', () => {
      expect(getTypeLabel('unknown_type' as WikiRelationRecord['type'])).toBe('unknown_type')
    })
  })

  describe('getQualityFilterLabel', () => {
    it('returns correct labels for all quality levels', () => {
      expect(getQualityFilterLabel('all')).toBe('全部质量')
      expect(getQualityFilterLabel('excellent')).toBe('优秀 85+')
      expect(getQualityFilterLabel('good')).toBe('良好 70+')
      expect(getQualityFilterLabel('fair')).toBe('一般 55+')
    })

    it('returns quality itself for unknown quality', () => {
      expect(getQualityFilterLabel('unknown' as FilterOptions['quality'])).toBe('unknown')
    })
  })

  describe('getSortStrategyLabel', () => {
    it('returns correct labels for all strategies', () => {
      expect(getSortStrategyLabel('quality')).toBe('质量优先')
      expect(getSortStrategyLabel('type_grouped')).toBe('类型分组')
      expect(getSortStrategyLabel('date')).toBe('时间排序')
      expect(getSortStrategyLabel('alphabetical')).toBe('字母顺序')
    })

    it('returns strategy itself for unknown strategy', () => {
      expect(getSortStrategyLabel('unknown' as SortStrategy)).toBe('unknown')
    })
  })

  describe('default constants', () => {
    it('has correct default filter options', () => {
      expect(DEFAULT_FILTER_OPTIONS).toEqual({
        type: 'all',
        quality: 'all',
        search: '',
      })
    })

    it('has correct default sort strategy', () => {
      expect(DEFAULT_SORT_STRATEGY).toBe('quality')
    })
  })
})
