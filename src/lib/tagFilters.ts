import { normalizeStringListInput } from './musicCredits'

export type TagFilterMode = 'any' | 'all'

export interface TagFilter {
  tags: string[]
  mode: TagFilterMode
}

/** 查询标签按完整词匹配，不拆分标签中的标点。 */
export function normalizeTagFilter(tags: unknown, mode: unknown): TagFilter {
  return {
    tags: normalizeStringListInput(typeof tags === 'string' ? [tags] : tags),
    mode: mode === 'all' ? 'all' : 'any',
  }
}
