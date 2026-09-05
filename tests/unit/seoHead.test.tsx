// @vitest-environment jsdom
import React from 'react'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { applySeoMetadata, useSeo } from '../../src/lib/seo'
import type { SeoMetadata } from '../../src/lib/seo'

const wikiMetadata: SeoMetadata = {
  title: '词条A｜黄诗扶 Wiki',
  description: '词条A 的描述',
  canonicalPath: '/wiki/a/?utm=1#top',
  robots: 'index,follow',
  ogType: 'article',
  ogImage: 'https://img.example/cover.png',
  ogImageAlt: '封面',
  jsonLd: { '@context': 'https://schema.org', '@type': 'Article', headline: '词条A' },
}

const listMetadata: SeoMetadata = {
  title: '百科｜黄诗扶 Wiki',
  description: '百科列表描述',
  canonicalPath: '/wiki',
  robots: 'index,follow',
  ogType: 'website',
}

const getMeta = (key: string) =>
  document.querySelector<HTMLMetaElement>(`meta[data-hsf-seo="${key}"]`)

const resetHead = () => {
  document.head.querySelectorAll('[data-hsf-seo]').forEach((el) => el.remove())
  document.title = ''
}

beforeEach(() => {
  resetHead()
})

describe('applySeoMetadata', () => {
  it('写入 title、description、robots、canonical 与 OG 标签', () => {
    applySeoMetadata(wikiMetadata)

    expect(document.title).toBe('词条A｜黄诗扶 Wiki')
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      '词条A 的描述'
    )
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'index,follow'
    )
    // canonical 唯一且规范化（去 query/hash 并补浏览器 origin）
    const canonicals = document.querySelectorAll('link[data-hsf-seo="canonical"]')
    expect(canonicals).toHaveLength(1)
    expect(canonicals[0].getAttribute('href')).toBe('http://localhost:3000/wiki/a')
    expect(getMeta('og:type')?.getAttribute('content')).toBe('article')
    expect(getMeta('og:url')?.getAttribute('content')).toBe('http://localhost:3000/wiki/a')
    expect(getMeta('og:image')?.getAttribute('content')).toBe('https://img.example/cover.png')
    expect(getMeta('og:image:alt')?.getAttribute('content')).toBe('封面')
    expect(getMeta('og:site_name')?.getAttribute('content')).toBe('黄诗扶 Wiki')
    expect(getMeta('og:locale')?.getAttribute('content')).toBe('zh_CN')
  })

  it('第二次应用后旧 og:image 不残留，JSON-LD 被替换', () => {
    applySeoMetadata(wikiMetadata)
    const firstScript = document.querySelector('script[data-hsf-seo="jsonld"]')
    expect(firstScript?.textContent).toContain('词条A')

    applySeoMetadata(listMetadata)

    expect(document.title).toBe('百科｜黄诗扶 Wiki')
    expect(getMeta('og:image')).toBeNull()
    expect(getMeta('og:image:alt')).toBeNull()
    expect(getMeta('og:type')?.getAttribute('content')).toBe('website')
    expect(getMeta('og:url')?.getAttribute('content')).toBe('http://localhost:3000/wiki')

    // 旧 JSON-LD 被整体移除，不残留上一篇内容
    expect(document.querySelector('script[data-hsf-seo="jsonld"]')).toBeNull()

    // 每个管理标签只保留一份，不产生重复标签
    expect(document.querySelectorAll('meta[data-hsf-seo="description"]')).toHaveLength(1)
    expect(document.querySelectorAll('meta[data-hsf-seo="og:title"]')).toHaveLength(1)
    expect(document.querySelectorAll('link[data-hsf-seo="canonical"]')).toHaveLength(1)
  })

  it('JSON-LD 支持数组并通过 textContent 原位替换', () => {
    const arrayMetadata: SeoMetadata = {
      ...listMetadata,
      jsonLd: [
        { '@context': 'https://schema.org', '@type': 'WebSite', name: '黄诗扶 Wiki' },
        { '@context': 'https://schema.org', '@type': 'WebPage', name: '百科' },
      ],
    }
    applySeoMetadata(arrayMetadata)
    const script = document.querySelector('script[data-hsf-seo="jsonld"]')
    expect(script).not.toBeNull()
    const parsed = JSON.parse(script?.textContent ?? 'null')
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(2)

    const nextMetadata: SeoMetadata = {
      ...listMetadata,
      jsonLd: { '@context': 'https://schema.org', '@type': 'WebPage', name: '下一页' },
    }
    applySeoMetadata(nextMetadata)
    const nextScript = document.querySelector('script[data-hsf-seo="jsonld"]')
    expect(nextScript).toBe(script)
    expect(JSON.parse(nextScript?.textContent ?? 'null')).toMatchObject({ name: '下一页' })
  })
})

describe('useSeo', () => {
  const Probe = ({ metadata }: { metadata: SeoMetadata }) => {
    useSeo(metadata)
    return null
  }

  it('组件挂载后写入 head，导航式更新不残留旧标签', () => {
    const { rerender } = render(<Probe metadata={wikiMetadata} />)

    expect(document.title).toBe('词条A｜黄诗扶 Wiki')
    expect(getMeta('og:image')).not.toBeNull()

    rerender(<Probe metadata={listMetadata} />)

    expect(document.title).toBe('百科｜黄诗扶 Wiki')
    expect(getMeta('og:image')).toBeNull()
    expect(document.querySelector('script[data-hsf-seo="jsonld"]')).toBeNull()
    expect(document.querySelector('link[data-hsf-seo="canonical"]')?.getAttribute('href')).toBe(
      'http://localhost:3000/wiki'
    )
  })
})
