import type { TagFilter } from '../../lib/tagFilters'

/** JSON 标签字段在分页前按并集或交集匹配。 */
export function buildTagFilterWhere(filter: TagFilter) {
  if (!filter.tags.length) return {}
  if (filter.mode === 'all' || filter.tags.length === 1) {
    return { tags: { array_contains: filter.tags } }
  }
  return { OR: filter.tags.map((tag) => ({ tags: { array_contains: [tag] } })) }
}
