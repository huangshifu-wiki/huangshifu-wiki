import { describe, it, expect } from 'vitest'
import {
  scanMarkdownLinks,
  replaceMarkdownLinks,
  generateStorageMappings,
  generateStorageSwitchMappings,
  analyzeLinkDistribution,
} from '../../src/lib/markdownLinkReplacer'

describe('scanMarkdownLinks', () => {
  it('returns empty arrays for empty content', () => {
    const result = scanMarkdownLinks('')
    expect(result.images).toEqual([])
    expect(result.links).toEqual([])
    expect(result.references).toEqual([])
  })

  it('scans simple image links ![alt](url)', () => {
    const content = 'Here is an image ![logo](https://example.com/logo.png) in text.'
    const result = scanMarkdownLinks(content)
    expect(result.images).toEqual(['https://example.com/logo.png'])
    expect(result.links).toEqual([])
  })

  it('scans image links with title ![alt](url "title")', () => {
    const content = '![avatar](/uploads/avatar.jpg "User Avatar")'
    const result = scanMarkdownLinks(content)
    expect(result.images).toEqual(['/uploads/avatar.jpg'])
  })

  it('scans multiple image links', () => {
    const content = `
![img1](/uploads/1.png)
Some text
![img2](https://example.com/2.png "title")
    `
    const result = scanMarkdownLinks(content)
    expect(result.images).toHaveLength(2)
    expect(result.images).toContain('/uploads/1.png')
    expect(result.images).toContain('https://example.com/2.png')
  })

  it('scans simple links [text](url)', () => {
    const content = 'Click [here](https://example.com/docs) for docs.'
    const result = scanMarkdownLinks(content)
    expect(result.links).toEqual(['https://example.com/docs'])
    expect(result.images).toEqual([])
  })

  it('scans links with title [text](url "title")', () => {
    const content = '[GitHub](https://github.com "GitHub Repository")'
    const result = scanMarkdownLinks(content)
    expect(result.links).toEqual(['https://github.com'])
  })

  it('excludes image links from links array', () => {
    const content = '![img](https://example.com/img.png)'
    const result = scanMarkdownLinks(content)
    expect(result.links).toEqual([])
    expect(result.images).toEqual(['https://example.com/img.png'])
  })

  it('scans reference link definitions [id]: url', () => {
    const content = `
Some text with [link][ref1]

[ref1]: https://example.com/ref
[ref2]: /uploads/doc.pdf
    `
    const result = scanMarkdownLinks(content)
    expect(result.references).toEqual([
      { id: 'ref1', url: 'https://example.com/ref' },
      { id: 'ref2', url: '/uploads/doc.pdf' },
    ])
  })

  it('scans HTML img tags', () => {
    const content = '<img src="https://example.com/html-img.png" alt="HTML Image" />'
    const result = scanMarkdownLinks(content)
    expect(result.images).toContain('https://example.com/html-img.png')
  })

  it('scans HTML img tags with single quotes', () => {
    const content = "<img src='/uploads/single-quote.png' />"
    const result = scanMarkdownLinks(content)
    expect(result.images).toContain('/uploads/single-quote.png')
  })

  it('scans HTML a tags', () => {
    const content = '<a href="https://example.com/page">Link</a>'
    const result = scanMarkdownLinks(content)
    expect(result.links).toContain('https://example.com/page')
  })

  it('scans HTML a tags with single quotes', () => {
    const content = "<a href='/local/page'>Local Link</a>"
    const result = scanMarkdownLinks(content)
    expect(result.links).toContain('/local/page')
  })

  it('deduplicates image links', () => {
    const content = `
![img](https://example.com/dup.png)
![img](https://example.com/dup.png)
    `
    const result = scanMarkdownLinks(content)
    expect(result.images).toEqual(['https://example.com/dup.png'])
  })

  it('deduplicates regular links', () => {
    const content = `
[link](https://example.com/dup)
[another](https://example.com/dup)
    `
    const result = scanMarkdownLinks(content)
    expect(result.links).toEqual(['https://example.com/dup'])
  })

  it('handles mixed content with images, links, and references', () => {
    const content = `
# Title

![logo](/uploads/logo.png)

Visit [our site](https://example.com) for more info.

See also [details][ref1].

[ref1]: https://example.com/details
    `
    const result = scanMarkdownLinks(content)
    expect(result.images).toEqual(['/uploads/logo.png'])
    expect(result.links).toEqual(['https://example.com'])
    expect(result.references).toEqual([{ id: 'ref1', url: 'https://example.com/details' }])
  })

  it('handles content without any links', () => {
    const content = 'This is plain text with no links at all.'
    const result = scanMarkdownLinks(content)
    expect(result.images).toEqual([])
    expect(result.links).toEqual([])
    expect(result.references).toEqual([])
  })
})

describe('replaceMarkdownLinks', () => {
  describe('string matching mode (useRegex: false)', () => {
    it('replaces image links ![alt](oldUrl)', () => {
      const content = '![logo](https://old.com/img.png)'
      const mappings = [{ oldUrl: 'https://old.com/img.png', newUrl: 'https://new.com/img.png' }]
      const result = replaceMarkdownLinks(content, mappings)
      expect(result.content).toBe('![logo](https://new.com/img.png)')
      expect(result.replaced).toBe(true)
      expect(result.replaceCount).toBe(1)
    })

    it('replaces regular links [text](oldUrl)', () => {
      const content = 'Click [here](https://old.com/docs)'
      const mappings = [{ oldUrl: 'https://old.com/docs', newUrl: 'https://new.com/docs' }]
      const result = replaceMarkdownLinks(content, mappings)
      expect(result.content).toBe('Click [here](https://new.com/docs)')
      expect(result.replaced).toBe(true)
    })

    it('replaces reference link definitions [id]: oldUrl', () => {
      const content = '[ref]: https://old.com/resource'
      const mappings = [{ oldUrl: 'https://old.com/resource', newUrl: 'https://new.com/resource' }]
      const result = replaceMarkdownLinks(content, mappings)
      expect(result.content).toBe('[ref]: https://new.com/resource')
      expect(result.replaced).toBe(true)
    })

    it('replaces HTML img tags', () => {
      const content = '<img src="https://old.com/pic.png" alt="pic" />'
      const mappings = [{ oldUrl: 'https://old.com/pic.png', newUrl: 'https://new.com/pic.png' }]
      const result = replaceMarkdownLinks(content, mappings)
      expect(result.content).toBe('<img src="https://new.com/pic.png" alt="pic" />')
      expect(result.replaced).toBe(true)
    })

    it('replaces HTML a tags', () => {
      const content = '<a href="https://old.com/page">Link</a>'
      const mappings = [{ oldUrl: 'https://old.com/page', newUrl: 'https://new.com/page' }]
      const result = replaceMarkdownLinks(content, mappings)
      expect(result.content).toBe('<a href="https://new.com/page">Link</a>')
      expect(result.replaced).toBe(true)
    })

    it('returns unchanged content when no match', () => {
      const content = '![img](https://other.com/img.png)'
      const mappings = [{ oldUrl: 'https://old.com/img.png', newUrl: 'https://new.com/img.png' }]
      const result = replaceMarkdownLinks(content, mappings)
      expect(result.content).toBe(content)
      expect(result.replaced).toBe(false)
      expect(result.replaceCount).toBe(0)
    })

    it('replaces image URLs and tracks type as image', () => {
      const content = '![img](https://old.com/img.png)'
      const mappings = [{ oldUrl: 'https://old.com/img.png', newUrl: 'https://new.com/img.png' }]
      const result = replaceMarkdownLinks(content, mappings)
      expect(result.replacements).toContainEqual({
        oldUrl: 'https://old.com/img.png',
        newUrl: 'https://new.com/img.png',
        type: 'image',
      })
    })
  })

  describe('regex matching mode (useRegex: true)', () => {
    it('replaces using regex pattern for domain', () => {
      const content = `
![img1](https://cdn1.example.com/a.png)
![img2](https://cdn2.example.com/b.png)
[link](https://cdn1.example.com/doc.pdf)
      `
      const mappings = [
        {
          oldUrl: 'https://cdn\\d+\\.example\\.com/',
          newUrl: 'https://new.example.com/',
          useRegex: true,
        },
      ]
      const result = replaceMarkdownLinks(content, mappings)
      expect(result.content).toContain('https://new.example.com/a.png')
      expect(result.content).toContain('https://new.example.com/b.png')
      expect(result.content).toContain('https://new.example.com/doc.pdf')
      expect(result.replaced).toBe(true)
    })

    it('catches invalid regex patterns gracefully', () => {
      const content = '![img](https://example.com/img.png)'
      const mappings = [{ oldUrl: '[invalid regex', newUrl: 'https://new.com/', useRegex: true }]
      expect(() => {
        replaceMarkdownLinks(content, mappings)
      }).not.toThrow()
    })

    it('replaces all matches with regex', () => {
      const content = `
[1](https://old.com/1)
[2](https://old.com/2)
[3](https://old.com/3)
      `
      const mappings = [
        { oldUrl: 'https://old\\.com/', newUrl: 'https://new.com/', useRegex: true },
      ]
      const result = replaceMarkdownLinks(content, mappings)
      expect(result.replaceCount).toBe(3)
    })
  })

  describe('multiple mappings', () => {
    it('applies multiple mappings in sequence', () => {
      const content = `
![img1](https://s3.old.com/uploads/a.png)
![img2](https://cdn.old.com/assets/b.png)
      `
      const mappings = [
        { oldUrl: 'https://s3.old.com/uploads/a.png', newUrl: 'https://s3.new.com/uploads/a.png' },
        { oldUrl: 'https://cdn.old.com/assets/b.png', newUrl: 'https://cdn.new.com/assets/b.png' },
      ]
      const result = replaceMarkdownLinks(content, mappings)
      expect(result.content).toContain('https://s3.new.com/uploads/a.png')
      expect(result.content).toContain('https://cdn.new.com/assets/b.png')
      expect(result.replaceCount).toBe(2)
    })

    it('tracks replacements for each mapping', () => {
      const content = `
![a](https://old.com/a.png)
[b](https://old.com/b.pdf)
      `
      const mappings = [
        { oldUrl: 'https://old.com/a.png', newUrl: 'https://new.com/a.png' },
        { oldUrl: 'https://old.com/b.pdf', newUrl: 'https://new.com/b.pdf' },
      ]
      const result = replaceMarkdownLinks(content, mappings)
      expect(result.replacements).toHaveLength(2)
      expect(result.replacements[0].type).toBe('image')
      expect(result.replacements[1].type).toBe('link')
    })
  })

  describe('edge cases', () => {
    it('handles empty content', () => {
      const result = replaceMarkdownLinks('', [
        { oldUrl: 'https://old.com/', newUrl: 'https://new.com/' },
      ])
      expect(result.content).toBe('')
      expect(result.replaced).toBe(false)
    })

    it('handles empty mappings', () => {
      const content = '![img](https://example.com/img.png)'
      const result = replaceMarkdownLinks(content, [])
      expect(result.content).toBe(content)
      expect(result.replaced).toBe(false)
    })

    it('handles special characters in URLs', () => {
      const content = '![img](https://example.com/path?query=value&other=123)'
      const mappings = [
        {
          oldUrl: 'https://example.com/path?query=value&other=123',
          newUrl: 'https://new.com/path?query=value&other=123',
        },
      ]
      const result = replaceMarkdownLinks(content, mappings)
      expect(result.content).toBe('![img](https://new.com/path?query=value&other=123)')
    })

    it('replaces links with title attribute', () => {
      const content = '![img](https://old.com/img.png "Image Title")'
      const mappings = [{ oldUrl: 'https://old.com/img.png', newUrl: 'https://new.com/img.png' }]
      const result = replaceMarkdownLinks(content, mappings)
      expect(result.content).toBe('![img](https://new.com/img.png "Image Title")')
    })
  })
})

describe('generateStorageMappings', () => {
  it('generates simple mapping without regex', () => {
    const result = generateStorageMappings('https://old.com/', 'https://new.com/')
    expect(result).toEqual({
      oldUrl: 'https://old.com/',
      newUrl: 'https://new.com/',
      useRegex: false,
    })
  })

  it('generates regex mapping with pathPattern', () => {
    const result = generateStorageMappings('https://s3.old.com/', 'https://s3.new.com/', {
      useRegex: true,
      pathPattern: '(.*)',
    })
    expect(result).toEqual({
      oldUrl: 'https://s3\\.old\\.com/(.*)',
      newUrl: 'https://s3.new.com/$1',
      useRegex: true,
    })
  })

  it('escapes special regex characters in oldBaseUrl', () => {
    const result = generateStorageMappings(
      'https://s3.us-east-1.amazonaws.com/',
      'https://new.com/',
      { useRegex: true, pathPattern: '(.*)' }
    )
    expect(result.oldUrl).toBe('https://s3\\.us-east-1\\.amazonaws\\.com/(.*)')
  })

  it('uses defaults when options not provided', () => {
    const result = generateStorageMappings('/uploads/', 'https://cdn.com/')
    expect(result.useRegex).toBe(false)
    expect(result.oldUrl).toBe('/uploads/')
    expect(result.newUrl).toBe('https://cdn.com/')
  })

  it('ignores pathPattern when useRegex is false', () => {
    const result = generateStorageMappings('https://old.com/', 'https://new.com/', {
      useRegex: false,
      pathPattern: '(.*)',
    })
    expect(result.useRegex).toBe(false)
    expect(result.oldUrl).toBe('https://old.com/')
  })
})

describe('generateStorageSwitchMappings', () => {
  const config = {
    localBaseUrl: '/uploads/',
    s3BaseUrl: 'https://s3.example.com/wiki/',
    externalBaseUrl: 'https://cdn.example.com/',
  }

  it('returns empty array when switching to same storage', () => {
    const result = generateStorageSwitchMappings('local', 'local', config)
    expect(result).toEqual([])
  })

  it('returns mapping when switching from local to s3', () => {
    const result = generateStorageSwitchMappings('local', 's3', config)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      oldUrl: '/uploads/',
      newUrl: 'https://s3.example.com/wiki/',
      useRegex: false,
    })
  })

  it('returns mapping when switching from s3 to external', () => {
    const result = generateStorageSwitchMappings('s3', 'external', config)
    expect(result[0].oldUrl).toBe('https://s3.example.com/wiki/')
    expect(result[0].newUrl).toBe('https://cdn.example.com/')
  })

  it('returns empty array when fromUrl is missing', () => {
    const result = generateStorageSwitchMappings('s3', 'external', { localBaseUrl: '/uploads/' })
    expect(result).toEqual([])
  })

  it('returns empty array when toUrl is missing', () => {
    const result = generateStorageSwitchMappings('local', 's3', { localBaseUrl: '/uploads/' })
    expect(result).toEqual([])
  })

  it('handles switch from external to local', () => {
    const result = generateStorageSwitchMappings('external', 'local', config)
    expect(result).toHaveLength(1)
    expect(result[0].oldUrl).toBe('https://cdn.example.com/')
    expect(result[0].newUrl).toBe('/uploads/')
  })
})

describe('analyzeLinkDistribution', () => {
  it('identifies local links (/uploads/)', () => {
    const content = '![img](/uploads/image.png)'
    const result = analyzeLinkDistribution(content)
    expect(result.localLinks).toEqual(['/uploads/image.png'])
    expect(result.externalLinks).toEqual([])
    expect(result.s3Links).toEqual([])
  })

  it('identifies local links (./)', () => {
    const content = '[doc](./readme.md)'
    const result = analyzeLinkDistribution(content)
    expect(result.localLinks).toEqual(['./readme.md'])
  })

  it('identifies local links (../)', () => {
    const content = '[parent](../index.html)'
    const result = analyzeLinkDistribution(content)
    expect(result.localLinks).toEqual(['../index.html'])
  })

  it('identifies S3 links (s3.)', () => {
    const content = '![img](https://s3.example.com/bucket/img.png)'
    const result = analyzeLinkDistribution(content)
    expect(result.s3Links).toEqual(['https://s3.example.com/bucket/img.png'])
    expect(result.externalLinks).toEqual([])
  })

  it('identifies S3 links (amazonaws.com)', () => {
    const content = '![img](https://mybucket.s3.us-east-1.amazonaws.com/file.png)'
    const result = analyzeLinkDistribution(content)
    expect(result.s3Links).toContain('https://mybucket.s3.us-east-1.amazonaws.com/file.png')
  })

  it('identifies external links (http/https)', () => {
    const content = '[site](https://example.com)'
    const result = analyzeLinkDistribution(content)
    expect(result.externalLinks).toEqual(['https://example.com'])
    expect(result.localLinks).toEqual([])
    expect(result.s3Links).toEqual([])
  })

  it('classifies unknown links', () => {
    const content = '[link](ftp://server/file)'
    const result = analyzeLinkDistribution(content)
    expect(result.unknownLinks).toEqual(['ftp://server/file'])
  })

  it('handles mixed link types', () => {
    const content = `
![local](/uploads/img.png)
![s3](https://s3.amazonaws.com/bucket/img.png)
[external](https://example.com)
[weird](mailto:user@example.com)
    `
    const result = analyzeLinkDistribution(content)
    expect(result.localLinks).toContain('/uploads/img.png')
    expect(result.s3Links).toContain('https://s3.amazonaws.com/bucket/img.png')
    expect(result.externalLinks).toContain('https://example.com')
    expect(result.unknownLinks).toContain('mailto:user@example.com')
  })

  it('deduplicates links within categories', () => {
    const content = `
![img1](/uploads/dup.png)
![img2](/uploads/dup.png)
    `
    const result = analyzeLinkDistribution(content)
    expect(result.localLinks).toEqual(['/uploads/dup.png'])
  })

  it('handles content without links', () => {
    const result = analyzeLinkDistribution('No links here.')
    expect(result.localLinks).toEqual([])
    expect(result.externalLinks).toEqual([])
    expect(result.s3Links).toEqual([])
    expect(result.unknownLinks).toEqual([])
  })

  it('analyzes links from HTML tags', () => {
    const content = '<img src="/uploads/html-img.png" /><a href="https://example.com">Link</a>'
    const result = analyzeLinkDistribution(content)
    expect(result.localLinks).toContain('/uploads/html-img.png')
    expect(result.externalLinks).toContain('https://example.com')
  })
})
