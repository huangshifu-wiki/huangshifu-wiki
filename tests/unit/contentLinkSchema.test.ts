import { describe, expect, it } from 'vitest'
import { createContentLinkListSchema } from '../../src/server/schemas/contentLink.schema'
import { galleryRelatedLinksSchema } from '../../src/server/schemas/gallery.schema'

const externalOnly = createContentLinkListSchema({
  label: '外部链接',
  labelLimit: 80,
  maxItems: 20,
})

const firstError = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? null : result.error!.issues[0].message

describe('galleryRelatedLinksSchema', () => {
  it('接受站外地址与站内路径，并去掉首尾空白', () => {
    const result = galleryRelatedLinksSchema.parse([
      { label: '  配套游记  ', url: ' /events/259 ' },
      { label: '报道', url: 'https://example.com/news' },
    ])

    expect(result).toEqual([
      { label: '配套游记', url: '/events/259' },
      { label: '报道', url: 'https://example.com/news' },
    ])
  })

  it('未提供时默认空数组，空行不占额度', () => {
    expect(galleryRelatedLinksSchema.parse(undefined)).toEqual([])

    const filled = Array.from({ length: 20 }, (_, index) => ({
      label: `链接${index}`,
      url: 'https://example.com',
    }))
    expect(galleryRelatedLinksSchema.parse([...filled, { label: '', url: '' }])).toHaveLength(20)
  })

  it('拒绝协议相对地址、点段绕行、未注册路由和危险协议', () => {
    for (const url of [
      '//evil.com',
      '/\\evil.com',
      '/admin/users',
      '/wiki/x/../../admin/users',
      '/wiki/%2e%2e/admin/users',
      'javascript:alert(1)',
      '',
    ]) {
      expect(galleryRelatedLinksSchema.safeParse([{ label: '坏链接', url }]).success).toBe(false)
    }
  })

  it('拒绝缺少名称的链接、非数组输入和超量条目', () => {
    const missingLabel = galleryRelatedLinksSchema.safeParse([{ url: '/events/259' }])
    expect(missingLabel.success).toBe(false)
    expect(firstError(missingLabel)).toBe('相关链接名称不能为空')

    expect(galleryRelatedLinksSchema.safeParse('not-a-list').success).toBe(false)

    const tooMany = Array.from({ length: 21 }, (_, index) => ({
      label: `链接${index}`,
      url: 'https://example.com',
    }))
    expect(firstError(galleryRelatedLinksSchema.safeParse(tooMany))).toBe('相关链接最多20条')
  })
})

describe('createContentLinkListSchema 关闭站内路径时', () => {
  it('仍然拒绝站内路径，并按分组名报错', () => {
    const rejected = externalOnly.safeParse([{ label: '游记', url: '/events/259' }])
    expect(rejected.success).toBe(false)
    expect(firstError(rejected)).toBe('外部链接地址必须是有效的 http/https URL')
    expect(externalOnly.safeParse([{ label: '报道', url: 'https://example.com' }]).success).toBe(
      true
    )
  })
})
