import { describe, expect, it } from 'vitest'
import {
  calculateRelationQuality,
  getQualityLevelColor,
  getQualityLevelIcon,
  getQualityLevelLabel,
  type QualityLevel,
} from '../../src/lib/relationQuality'
import type { WikiRelationRecord } from '../../src/components/wiki/types'
import type { WikiPageMetadata } from '../../src/lib/wikiLinkParser'
import type { WikiItem } from '../../src/types/entities'

function createMockRelation(overrides?: Partial<WikiRelationRecord>): WikiRelationRecord {
  return {
    targetSlug: 'target',
    type: 'related_person',
    label: '',
    bidirectional: false,
    ...overrides,
  }
}

function createMockMetadata(overrides?: Partial<WikiPageMetadata>): WikiPageMetadata {
  return {
    title: '测试页面',
    slug: 'test-page',
    ...overrides,
  }
}

describe('relationQuality', () => {
  describe('calculateRelationQuality', () => {
    it('calculates quality for excellent relation', () => {
      const relation = createMockRelation({
        type: 'related_person',
        bidirectional: true,
        label: '重要关联',
      })
      const metadata = createMockMetadata({
        coverImage: 'cover.jpg',
        description: '这是一个非常详细的描述，长度超过100个字符。'.repeat(3),
        tags: ['标签1', '标签2', '标签3'],
        category: '分类',
        authorName: '作者',
      })

      const result = calculateRelationQuality(relation, null, metadata)

      expect(result.total).toBeGreaterThanOrEqual(85)
      expect(result.level).toBe('excellent')
      expect(result.relevance).toBeGreaterThan(0)
      expect(result.completeness).toBeGreaterThan(0)
      expect(result.importance).toBeGreaterThan(0)
    })

    it('calculates quality for poor relation', () => {
      const relation = createMockRelation({
        type: 'custom',
        bidirectional: false,
        label: '',
      })
      const metadata = createMockMetadata({
        coverImage: undefined,
        description: '短描述',
        tags: [],
      })

      const result = calculateRelationQuality(relation, null, metadata)

      expect(result.total).toBeLessThan(55)
      expect(result.level).toBe('poor')
    })

    it('gives higher relevance for bidirectional relations', () => {
      const uniRelation = createMockRelation({
        bidirectional: false,
        label: '标签',
        type: 'related_person',
      })
      const biRelation = createMockRelation({
        bidirectional: true,
        label: '标签',
        type: 'related_person',
      })
      const metadata = createMockMetadata()

      const uniResult = calculateRelationQuality(uniRelation, null, metadata)
      const biResult = calculateRelationQuality(biRelation, null, metadata)

      expect(biResult.relevance).toBeGreaterThan(uniResult.relevance)
      expect(uniResult.suggestions).toContain('考虑设置为双向关联以增强页面间的联系')
    })

    it('scores different relation types appropriately', () => {
      const personRelation = createMockRelation({
        type: 'related_person',
        bidirectional: true,
        label: '标签',
      })
      const workRelation = createMockRelation({
        type: 'work_relation',
        bidirectional: true,
        label: '标签',
      })
      const timelineRelation = createMockRelation({
        type: 'timeline_relation',
        bidirectional: true,
        label: '标签',
      })
      const customRelation = createMockRelation({
        type: 'custom',
        bidirectional: true,
        label: '标签',
      })

      const metadata = createMockMetadata()

      const personScore = calculateRelationQuality(personRelation, null, metadata)
      const workScore = calculateRelationQuality(workRelation, null, metadata)
      const timelineScore = calculateRelationQuality(timelineRelation, null, metadata)
      const customScore = calculateRelationQuality(customRelation, null, metadata)

      expect(personScore.relevance).toBeGreaterThanOrEqual(timelineScore.relevance)
      expect(workScore.relevance).toBeGreaterThanOrEqual(timelineScore.relevance)
      expect(timelineScore.relevance).toBeGreaterThanOrEqual(customScore.relevance)
    })

    it('adds suggestion when label is missing', () => {
      const relation = createMockRelation({
        label: '',
        bidirectional: true,
        type: 'related_person',
      })
      const metadata = createMockMetadata()

      const result = calculateRelationQuality(relation, null, metadata)

      expect(result.suggestions).toContain('添加自定义标签以说明关联的具体含义')
    })

    it('adds suggestions for incomplete metadata', () => {
      const relation = createMockRelation({
        bidirectional: true,
        label: '标签',
        type: 'related_person',
      })
      const metadata = createMockMetadata({
        coverImage: undefined,
        description: undefined,
        tags: [],
      })

      const result = calculateRelationQuality(relation, null, metadata)

      expect(result.suggestions).toContain('为目标页面添加封面图片')
      expect(result.suggestions).toContain('完善目标页面的描述信息')
      expect(result.suggestions).toContain('为目标页面添加标签')
    })

    it('handles null metadata gracefully', () => {
      const relation = createMockRelation({
        bidirectional: true,
        label: '标签',
        type: 'related_person',
      })

      const result = calculateRelationQuality(relation, null, null)

      expect(result.completeness).toBe(0)
      expect(result.importance).toBe(0)
      expect(result.suggestions).toContain('目标页面缺少元数据，请完善页面信息')
    })

    it('caps scores at maximum values', () => {
      const relation = createMockRelation({
        type: 'related_person',
        bidirectional: true,
        label: '标签',
      })
      const metadata = createMockMetadata({
        coverImage: 'cover.jpg',
        description: 'a'.repeat(1000),
        tags: ['t1', 't2', 't3', 't4', 't5'],
        category: 'cat',
        authorName: 'author',
      })

      const result = calculateRelationQuality(relation, null, metadata)

      expect(result.relevance).toBeLessThanOrEqual(40)
      expect(result.completeness).toBeLessThanOrEqual(30)
      expect(result.importance).toBeLessThanOrEqual(30)
    })

    it('calculates correct quality levels', () => {
      const relation = createMockRelation({
        bidirectional: true,
        label: '标签',
        type: 'related_person',
      })

      // Excellent (85+)
      const excellentMeta = createMockMetadata({
        coverImage: 'cover.jpg',
        description: 'a'.repeat(150),
        tags: ['t1', 't2', 't3', 't4', 't5'],
        category: 'cat',
      })
      expect(calculateRelationQuality(relation, null, excellentMeta).level).toBe('excellent')

      // Good (70-84)
      const goodMeta = createMockMetadata({
        coverImage: 'cover.jpg',
        description: 'a'.repeat(50),
        tags: ['t1', 't2'],
        category: 'cat',
      })
      const goodResult = calculateRelationQuality(relation, null, goodMeta)
      expect(goodResult.total).toBeGreaterThanOrEqual(70)
      expect(goodResult.total).toBeLessThan(85)
      expect(goodResult.level).toBe('good')

      // Fair (55-69)
      const fairMeta = createMockMetadata({
        description: 'a'.repeat(50),
        tags: ['t1'],
      })
      const fairResult = calculateRelationQuality(relation, null, fairMeta)
      expect(fairResult.total).toBeGreaterThanOrEqual(55)
      expect(fairResult.total).toBeLessThan(70)
      expect(fairResult.level).toBe('fair')
    })
  })

  describe('getQualityLevelColor', () => {
    it('returns correct color classes', () => {
      expect(getQualityLevelColor('excellent')).toBe('theme-status-success')
      expect(getQualityLevelColor('good')).toBe('theme-bg-info-soft theme-text-info')
      expect(getQualityLevelColor('fair')).toBe('theme-status-warning')
      expect(getQualityLevelColor('poor')).toBe('theme-status-error')
    })

    it('returns default color for unknown level', () => {
      expect(getQualityLevelColor('unknown' as QualityLevel)).toBe(
        'bg-surface-alt text-text-secondary'
      )
    })
  })

  describe('getQualityLevelIcon', () => {
    it('returns correct icons', () => {
      expect(getQualityLevelIcon('excellent')).toBe('⭐ 优秀')
      expect(getQualityLevelIcon('good')).toBe('✓ 良好')
      expect(getQualityLevelIcon('fair')).toBe('~ 一般')
      expect(getQualityLevelIcon('poor')).toBe('! 待改进')
    })

    it('returns default icon for unknown level', () => {
      expect(getQualityLevelIcon('unknown' as QualityLevel)).toBe('?')
    })
  })

  describe('getQualityLevelLabel', () => {
    it('returns correct labels', () => {
      expect(getQualityLevelLabel('excellent')).toBe('优秀')
      expect(getQualityLevelLabel('good')).toBe('良好')
      expect(getQualityLevelLabel('fair')).toBe('一般')
      expect(getQualityLevelLabel('poor')).toBe('待改进')
    })

    it('returns default label for unknown level', () => {
      expect(getQualityLevelLabel('unknown' as QualityLevel)).toBe('未知')
    })
  })
})
