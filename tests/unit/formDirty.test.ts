import { describe, expect, it } from 'vitest'

import { hasFormChanges } from '../../src/utils/formDirty'

describe('hasFormChanges', () => {
  it('完全相同的对象无差异', () => {
    const form = { title: '标题', content: '正文', tags: ['a', 'b'] }
    expect(hasFormChanges(form, { ...form })).toBe(false)
  })

  it('键序不同视为相同', () => {
    expect(hasFormChanges({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false)
  })

  it('标量字段变化检出差异', () => {
    expect(hasFormChanges({ title: '新' }, { title: '旧' })).toBe(true)
  })

  it('嵌套对象与数组深度比较', () => {
    expect(hasFormChanges({ relations: [{ targetSlug: 'a' }] }, { relations: [] })).toBe(true)
    expect(
      hasFormChanges(
        { relations: [{ targetSlug: 'a', kind: 'related' }] },
        { relations: [{ kind: 'related', targetSlug: 'a' }] }
      )
    ).toBe(false)
  })

  it('数组顺序敏感', () => {
    expect(hasFormChanges([1, 2], [2, 1])).toBe(true)
  })

  it('undefined 属性与缺失键视为相同', () => {
    expect(hasFormChanges({ a: 1, note: undefined }, { a: 1 })).toBe(false)
  })

  it('null 与 undefined 视为不同', () => {
    expect(hasFormChanges({ note: null }, { note: undefined })).toBe(true)
  })

  it('数组中的 undefined 元素与 null 等价', () => {
    expect(hasFormChanges([undefined], [null])).toBe(false)
    expect(hasFormChanges(['a', undefined], ['a'])).toBe(true)
  })
})
