import { describe, expect, it } from 'vitest'

import { processWikiLinksForPreview } from '../../src/lib/markdownWikiLinks'

describe('markdownWikiLinks', () => {
  it('converts wiki links for preview without changing surrounding markdown', () => {
    expect(processWikiLinksForPreview('前文 [[页面标题]] 后文')).toBe(
      '前文 [页面标题](/wiki/页面标题) 后文'
    )
  })

  it('uses the right side of a pipe as slug', () => {
    expect(processWikiLinksForPreview('[[显示文本 | page-slug]]')).toBe(
      '[显示文本](/wiki/page-slug)'
    )
  })
})
