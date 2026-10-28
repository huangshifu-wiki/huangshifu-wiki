import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILTER_OPTIONS,
  filterAndSortRelations,
  type RelationWithMetadata,
} from '../../src/lib/relationSorter'
import { withOriginalRelationIndexes } from '../../src/lib/wikiRelationIndex'

describe('wikiRelationIndex', () => {
  it('keeps original indexes when duplicate target and type relations are sorted', () => {
    const relations: RelationWithMetadata[] = [
      {
        type: 'related_person',
        targetSlug: 'same-target',
        label: 'B relation',
        bidirectional: false,
      },
      {
        type: 'related_person',
        targetSlug: 'same-target',
        label: 'A relation',
        bidirectional: false,
      },
    ]

    const result = filterAndSortRelations(
      withOriginalRelationIndexes(relations),
      DEFAULT_FILTER_OPTIONS,
      'alphabetical'
    )

    expect(result.map((relation) => relation.label)).toEqual(['A relation', 'B relation'])
    expect(result.map((relation) => relation.originalIndex)).toEqual([1, 0])
  })
})
