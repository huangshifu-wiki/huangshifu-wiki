import type { WikiRelationRecord } from '../components/wiki/types'
import type { WikiPageMetadata } from './wikiLinkParser'
import type { WikiItem } from '../types/entities'

/**
 * 质量评分等级
 */
export type QualityLevel = 'excellent' | 'good' | 'fair' | 'poor'

/**
 * 质量评分详情
 */
export type QualityScore = {
  /** 相关性得分 (0-40) */
  relevance: number
  /** 完整性得分 (0-30) */
  completeness: number
  /** 重要性得分 (0-30) */
  importance: number
  /** 总分 (0-100) */
  total: number
  /** 质量等级 */
  level: QualityLevel
  /** 改进建议 */
  suggestions: string[]
}

/**
 * 计算关联质量评分
 * @param relation 关联记录
 * @param currentPage 当前页面
 * @param metadata 目标页面的元数据
 * @returns 质量评分详情
 */
export function calculateRelationQuality(
  relation: WikiRelationRecord,
  currentPage: WikiItem | null,
  metadata: WikiPageMetadata | null
): QualityScore {
  let relevance = 0
  let completeness = 0
  let importance = 0
  const suggestions: string[] = []

  // 1. 相关性评分 (0-40 分)
  // 双向关联加分
  if (relation.bidirectional) {
    relevance += 15
  } else {
    suggestions.push('考虑设置为双向关联以增强页面间的联系')
  }

  // 关联类型评分
  if (relation.type === 'related_person' || relation.type === 'work_relation') {
    relevance += 15
  } else if (relation.type === 'timeline_relation') {
    relevance += 10
  } else {
    relevance += 5
    suggestions.push('选择更具体的关联类型（如相关人物、作品关联）')
  }

  // 有自定义标签加分
  if (relation.label && relation.label.trim().length > 0) {
    relevance += 10
  } else {
    suggestions.push('添加自定义标签以说明关联的具体含义')
  }

  // 2. 完整性评分 (0-30 分)
  if (metadata) {
    // 有封面图
    if (metadata.coverImage) {
      completeness += 10
    } else {
      suggestions.push('为目标页面添加封面图片')
    }

    // 有描述
    if (metadata.description && metadata.description.length > 20) {
      completeness += 10
    } else {
      suggestions.push('完善目标页面的描述信息')
    }

    // 有标签
    if (metadata.tags && metadata.tags.length > 0) {
      completeness += 5
    } else {
      suggestions.push('为目标页面添加标签')
    }

    // 有作者信息
    if (metadata.authorName) {
      completeness += 5
    }
  } else {
    suggestions.push('目标页面缺少元数据，请完善页面信息')
  }

  // 3. 重要性评分 (0-30 分)
  if (metadata) {
    // 根据标签数量判断重要性
    if (metadata.tags && metadata.tags.length >= 3) {
      importance += 15
    } else if (metadata.tags && metadata.tags.length >= 1) {
      importance += 8
    } else {
      suggestions.push('增加相关标签以提升页面重要性')
    }

    // 根据分类判断
    if (metadata.category) {
      importance += 10
    }

    // 描述长度判断内容质量
    if (metadata.description && metadata.description.length > 100) {
      importance += 5
    }
  }

  // 确保分数在合理范围内
  relevance = Math.min(40, Math.max(0, relevance))
  completeness = Math.min(30, Math.max(0, completeness))
  importance = Math.min(30, Math.max(0, importance))

  const total = relevance + completeness + importance

  // 确定质量等级
  let level: QualityLevel
  if (total >= 85) {
    level = 'excellent'
  } else if (total >= 70) {
    level = 'good'
  } else if (total >= 55) {
    level = 'fair'
  } else {
    level = 'poor'
  }

  return {
    relevance,
    completeness,
    importance,
    total,
    level,
    suggestions,
  }
}

/**
 * 获取质量等级对应的颜色类名
 */
export function getQualityLevelColor(level: QualityLevel): string {
  switch (level) {
    case 'excellent':
      return 'theme-status-success'
    case 'good':
      return 'theme-bg-info-soft theme-text-info'
    case 'fair':
      return 'theme-status-warning'
    case 'poor':
      return 'theme-status-error'
    default:
      return 'bg-surface-alt text-text-secondary'
  }
}

/**
 * 获取质量等级对应的图标
 */
export function getQualityLevelIcon(level: QualityLevel): string {
  switch (level) {
    case 'excellent':
      return '⭐ 优秀'
    case 'good':
      return '✓ 良好'
    case 'fair':
      return '~ 一般'
    case 'poor':
      return '! 待改进'
    default:
      return '?'
  }
}

/**
 * 获取质量等级的中文描述
 */
export function getQualityLevelLabel(level: QualityLevel): string {
  switch (level) {
    case 'excellent':
      return '优秀'
    case 'good':
      return '良好'
    case 'fair':
      return '一般'
    case 'poor':
      return '待改进'
    default:
      return '未知'
  }
}
