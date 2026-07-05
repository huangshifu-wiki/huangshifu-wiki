import { describe, expect, it } from 'vitest'
import { DEFAULT_WIKI_CATEGORIES } from '../../prisma/wikiCategoryDefaults'

describe('DEFAULT_WIKI_CATEGORIES', () => {
  it('does not include removed legacy wiki categories', () => {
    const categoryIds = DEFAULT_WIKI_CATEGORIES.map((category) => category.id)

    expect(categoryIds).not.toContain('event')
    expect(categoryIds).not.toContain('timeline')
  })
})
