import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  isInternalLinkPath,
  normalizeContentLinks,
  validateContentLinks,
} from '../../src/lib/contentLinks'
import type { ContentLink } from '../../src/types/entities'

const validateLinks = (links: ContentLink[], { externalOnly = false } = {}) =>
  validateContentLinks(links, {
    field: 'relatedLinks',
    label: '相关链接',
    labelLimit: 80,
    maxItems: 20,
    allowInternalPath: !externalOnly,
  })?.message ?? null

describe('isInternalLinkPath', () => {
  it('接受已注册内容路由的站内路径，允许带查询和锚点', () => {
    expect(isInternalLinkPath('/gallery/1024')).toBe(true)
    expect(isInternalLinkPath('/events/259')).toBe(true)
    expect(isInternalLinkPath('/music?kw=星河')).toBe(true)
    expect(isInternalLinkPath('/wiki/huangshifu#早年')).toBe(true)
  })

  it('未编码的中文 slug 与百分号编码形式同等放行', () => {
    expect(isInternalLinkPath('/wiki/黄诗扶')).toBe(true)
    expect(isInternalLinkPath('/wiki/%E9%BB%84%E8%AF%97%E6%89%B6')).toBe(true)
  })

  it('拒绝畸形百分号编码', () => {
    expect(isInternalLinkPath('/wiki/%E4%B8%')).toBe(false)
  })

  it('拒绝协议相对写法和未注册路由', () => {
    expect(isInternalLinkPath('//evil.com')).toBe(false)
    expect(isInternalLinkPath('/\\evil.com')).toBe(false)
    expect(isInternalLinkPath('gallery/1024')).toBe(false)
    expect(isInternalLinkPath('/admin/users')).toBe(false)
    expect(isInternalLinkPath('/')).toBe(false)
  })

  it('拒绝点段与编码点段：归一化后指向的不是写的那个地址', () => {
    expect(isInternalLinkPath('/wiki/x/../../admin/users')).toBe(false)
    expect(isInternalLinkPath('/gallery/1/../../settings/account')).toBe(false)
    expect(isInternalLinkPath('/wiki/%2e%2e/admin/users')).toBe(false)
    expect(isInternalLinkPath('/wiki/./../forum/1')).toBe(false)
  })
})

describe('normalizeContentLinks', () => {
  it('去掉首尾空白并丢弃空行', () => {
    expect(
      normalizeContentLinks([
        { label: '  配套游记  ', url: ' /events/259 ' },
        { label: '', url: '' },
      ])
    ).toEqual([{ label: '配套游记', url: '/events/259' }])
  })
})

describe('validateContentLinks', () => {
  it('空行不报错，半填的行报错', () => {
    expect(validateLinks([{ label: '', url: '' }])).toBeNull()
    expect(validateLinks([{ label: '配套游记', url: '' }])).toBe('相关链接地址不能为空')
    expect(validateLinks([{ label: '', url: '/events/259' }])).toBe('相关链接名称不能为空')
  })

  it('按 allowInternalPath 决定是否放行站内路径', () => {
    expect(validateLinks([{ label: '游记', url: '/events/259' }])).toBeNull()
    expect(validateLinks([{ label: '游记', url: '/events/259' }], { externalOnly: true })).toBe(
      '相关链接地址必须是有效的 http/https URL'
    )
  })

  it('把不合法的站内路径单独提示，不与站外地址混淆', () => {
    expect(validateLinks([{ label: '后台', url: '/admin/users' }])).toBe(
      '相关链接站内路径需指向内容页，例如 /gallery/1024'
    )
    expect(validateLinks([{ label: '绕行', url: '/wiki/x/../../admin/users' }])).toBe(
      '相关链接站内路径需指向内容页，例如 /gallery/1024'
    )
  })

  it('挡掉可在 href 中执行的协议', () => {
    expect(validateLinks([{ label: '奖励', url: 'javascript:alert(1)' }])).toBe(
      '相关链接地址必须是有效的 http/https URL'
    )
  })

  it('校验名称长度与条数上限，空行不占额度', () => {
    expect(validateLinks([{ label: '长'.repeat(81), url: 'https://example.com' }])).toBe(
      '相关链接名称不能超过80个字符'
    )
    const full = Array.from({ length: 20 }, (_, index) => ({
      label: `链接${index}`,
      url: 'https://example.com',
    }))
    expect(validateLinks([...full, { label: '', url: '' }])).toBeNull()
    expect(validateLinks([...full, { label: '第21条', url: 'https://example.com' }])).toBe(
      '相关链接最多20条'
    )
  })
})

// 白名单是 App.tsx 路由表的第二份真相，任一侧改名都要在这里暴露出来
const CONTENT_LINK_ROOTS = [
  'wiki',
  'forum',
  'gallery',
  'events',
  'tickets',
  'music',
  'album',
  'search',
  'announcements',
  'more',
  'users',
]

describe('站内路径白名单与路由表同步', () => {
  const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')

  it.each(CONTENT_LINK_ROOTS)('/%s 仍是内容路由且在白名单内', (root) => {
    expect(appSource).toContain(`path="/${root}`)
    expect(isInternalLinkPath(`/${root}/1`)).toBe(true)
  })
})
