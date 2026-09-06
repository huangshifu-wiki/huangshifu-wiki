import { describe, expect, it } from 'vitest'

import {
  buildLegacyDuplicateWikiTitleKey,
  getWikiUniqueConflictMessage,
  normalizeWikiTitleKey,
} from '../../src/server/wiki/wikiTitleKey'

describe('wikiTitleKey', () => {
  it('normalizes title keys with the existing trimmed-title semantics', () => {
    expect(normalizeWikiTitleKey(' 黄诗扶 ')).toBe('黄诗扶')
    expect(normalizeWikiTitleKey('Test')).toBe('Test')
    expect(normalizeWikiTitleKey('test')).toBe('test')
  })

  it('builds the deterministic legacy duplicate suffix key', () => {
    expect(buildLegacyDuplicateWikiTitleKey('Same Title', 'beta')).toBe('Same Title [beta]')
    expect(buildLegacyDuplicateWikiTitleKey(' Same Title ', 'beta')).toBe('Same Title [beta]')
  })

  it('maps title unique constraint errors to a conflict message', () => {
    expect(
      getWikiUniqueConflictMessage({
        code: 'P2002',
        meta: { target: ['titleKey'] },
      })
    ).toBe('该标题的百科已存在，请修改标题或编辑已有页面')
  })

  it('maps slug unique constraint errors to a conflict message', () => {
    expect(
      getWikiUniqueConflictMessage({
        code: 'P2002',
        meta: { target: 'WikiPage_slug_key' },
      })
    ).toBe('该页面标识已存在，请修改标题后重试')
  })

  it('ignores non-unique errors', () => {
    expect(getWikiUniqueConflictMessage({ code: 'P2025' })).toBeNull()
  })
})
