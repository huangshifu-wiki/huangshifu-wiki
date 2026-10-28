import type { WikiRelationRecord } from '../components/wiki/types'

export type RelationWithOriginalIndex<T extends WikiRelationRecord> = T & {
  originalIndex: number
}

export function withOriginalRelationIndexes<T extends WikiRelationRecord>(
  relations: readonly T[]
): RelationWithOriginalIndex<T>[] {
  return relations.map((relation, originalIndex) => ({
    ...relation,
    originalIndex,
  }))
}
