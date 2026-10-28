import type { WikiRelationRecord } from '../components/wiki/types'

export type WikiRelationDisplayData = WikiRelationRecord & {
  targetTitle?: string | null
}

export function getWikiRelationDisplayTitle(relation: WikiRelationDisplayData): string {
  const label = relation.label?.trim()
  if (label) return label

  const targetTitle = relation.targetTitle?.trim()
  return targetTitle || relation.targetSlug
}
