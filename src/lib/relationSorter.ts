import type { WikiRelationRecord } from '../components/wiki/types'
import type { WikiPageMetadata } from './wikiLinkParser'
import type { QualityLevel } from './relationQuality'

/**
 * 排序策略类型
 */
export type SortStrategy =
  | 'quality' // 按质量评分排序
  | 'type_grouped' // 按类型分组
  | 'date' // 按时间排序
  | 'alphabetical' // 按字母顺序

/**
 * 筛选选项
 */
export type FilterOptions = {
  /** 类型筛选 */
  type: 'all' | 'related_person' | 'work_relation' | 'timeline_relation' | 'custom'
  /** 质量筛选 */
  quality: 'all' | 'excellent' | 'good' | 'fair'
  /** 搜索关键词 */
  search: string
}

/**
 * 带元数据的关联记录
 */
export type RelationWithMetadata = WikiRelationRecord & {
  metadata?: WikiPageMetadata | null
  qualityScore?: number
}

/**
 * 默认筛选选项
 */
export const DEFAULT_FILTER_OPTIONS: FilterOptions = {
  type: 'all',
  quality: 'all',
  search: '',
}

/**
 * 默认排序策略
 */
export const DEFAULT_SORT_STRATEGY: SortStrategy = 'quality'

/**
 * 筛选关联记录
 */
export function filterRelations<T extends RelationWithMetadata>(
  relations: T[],
  options: FilterOptions
): T[] {
  return relations.filter((relation) => {
    // 类型筛选
    if (options.type !== 'all' && relation.type !== options.type) {
      return false
    }

    // 质量筛选
    if (options.quality !== 'all') {
      const qualityThreshold: Record<FilterOptions['quality'], number> = {
        all: 0,
        excellent: 85,
        good: 70,
        fair: 55,
      }
      const threshold = qualityThreshold[options.quality]
      if ((relation.qualityScore || 0) < threshold) {
        return false
      }
    }

    // 搜索筛选
    if (options.search.trim()) {
      const searchLower = options.search.toLowerCase()
      const title = relation.metadata?.title?.toLowerCase() || ''
      const description = relation.metadata?.description?.toLowerCase() || ''
      const label = relation.label?.toLowerCase() || ''
      const targetSlug = relation.targetSlug.toLowerCase()
      const tags = relation.metadata?.tags?.join(' ').toLowerCase() || ''

      const searchableText = `${title} ${description} ${label} ${targetSlug} ${tags}`
      if (!searchableText.includes(searchLower)) {
        return false
      }
    }

    return true
  })
}

/**
 * 排序关联记录
 */
export function sortRelations<T extends RelationWithMetadata>(
  relations: T[],
  strategy: SortStrategy
): T[] {
  const sorted = [...relations]

  switch (strategy) {
    case 'quality':
      sorted.sort((a, b) => {
        const scoreA = a.qualityScore || 0
        const scoreB = b.qualityScore || 0
        return scoreB - scoreA
      })
      break

    case 'type_grouped':
      // 按类型分组排序
      const typeOrder: Record<WikiRelationRecord['type'], number> = {
        related_person: 1,
        work_relation: 2,
        timeline_relation: 3,
        custom: 4,
      }
      sorted.sort((a, b) => {
        const typeA = typeOrder[a.type] || 99
        const typeB = typeOrder[b.type] || 99
        if (typeA !== typeB) return typeA - typeB
        // 同类型内按质量排序
        const scoreA = a.qualityScore || 0
        const scoreB = b.qualityScore || 0
        return scoreB - scoreA
      })
      break

    case 'date':
      // 按元数据中的时间信息排序（如果有）
      sorted.sort((a, b) => {
        const dateA = a.metadata?.publishDate ? new Date(a.metadata.publishDate).getTime() : 0
        const dateB = b.metadata?.publishDate ? new Date(b.metadata.publishDate).getTime() : 0
        return dateB - dateA
      })
      break

    case 'alphabetical':
      // 按标题字母顺序排序
      sorted.sort((a, b) => {
        const titleA = a.metadata?.title || a.label || a.targetSlug
        const titleB = b.metadata?.title || b.label || b.targetSlug
        return titleA.localeCompare(titleB, 'zh-Hans-CN')
      })
      break
  }

  return sorted
}

/**
 * 筛选并排序关联记录
 */
export function filterAndSortRelations<T extends RelationWithMetadata>(
  relations: T[],
  filterOptions: FilterOptions,
  sortStrategy: SortStrategy
): T[] {
  const filtered = filterRelations(relations, filterOptions)
  return sortRelations(filtered, sortStrategy)
}

/**
 * 获取类型标签
 */
export function getTypeLabel(type: WikiRelationRecord['type']): string {
  const labels: Record<WikiRelationRecord['type'], string> = {
    related_person: '相关人物',
    work_relation: '作品关联',
    timeline_relation: '时间线关联',
    custom: '自定义关系',
  }
  return labels[type] || type
}

/**
 * 获取质量筛选标签
 */
export function getQualityFilterLabel(quality: FilterOptions['quality']): string {
  const labels: Record<FilterOptions['quality'], string> = {
    all: '全部质量',
    excellent: '优秀 85+',
    good: '良好 70+',
    fair: '一般 55+',
  }
  return labels[quality] || quality
}

/**
 * 获取排序策略标签
 */
export function getSortStrategyLabel(strategy: SortStrategy): string {
  const labels: Record<SortStrategy, string> = {
    quality: '质量优先',
    type_grouped: '类型分组',
    date: '时间排序',
    alphabetical: '字母顺序',
  }
  return labels[strategy] || strategy
}
