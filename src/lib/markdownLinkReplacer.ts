/**
 * Markdown 资源链接替换工具
 *
 * 功能：
 * - 扫描 Markdown 内容中的所有资源链接（图片、文件等）
 * - 根据映射规则替换链接地址
 * - 支持批量处理 Wiki 页面内容
 * - 保留原始格式，仅替换链接
 */

export interface LinkMapping {
  /** 原始链接地址（支持部分匹配） */
  oldUrl: string
  /** 新链接地址 */
  newUrl: string
  /** 是否使用正则匹配（默认 false 为字符串包含匹配） */
  useRegex?: boolean
}

export interface ReplaceResult {
  /** 替换后的内容 */
  content: string
  /** 是否发生了替换 */
  replaced: boolean
  /** 替换的链接数量 */
  replaceCount: number
  /** 替换详情 */
  replacements: Array<{
    oldUrl: string
    newUrl: string
    type: 'image' | 'link' | 'reference'
  }>
}

export interface ScanResult {
  /** 发现的图片链接 */
  images: string[]
  /** 发现的普通链接 */
  links: string[]
  /** 发现的引用式链接 */
  references: Array<{ id: string; url: string }>
}

/**
 * 扫描 Markdown 内容中的所有资源链接
 */
export function scanMarkdownLinks(content: string): ScanResult {
  const images: string[] = []
  const links: string[] = []
  const references: Array<{ id: string; url: string }> = []

  // 匹配图片链接 ![alt](url) 或 ![alt](url "title")
  const imageRegex = /!\[([^\]]*)\]\(([^)"\s]+)(?:\s+"[^"]*")?\)/g
  let match
  while ((match = imageRegex.exec(content)) !== null) {
    images.push(match[2])
  }

  // 匹配普通链接 [text](url) 或 [text](url "title")
  const linkRegex = /\[([^\]]+)\]\(([^)"\s]+)(?:\s+"[^"]*")?\)/g
  while ((match = linkRegex.exec(content)) !== null) {
    // 排除图片链接（前面没有!）
    const startIndex = match.index
    if (startIndex === 0 || content[startIndex - 1] !== '!') {
      links.push(match[2])
    }
  }

  // 匹配引用式链接 [text][id] 和 [id]: url
  const refDefRegex = /^\[([^\]]+)\]:\s*(.+)$/gm
  while ((match = refDefRegex.exec(content)) !== null) {
    references.push({ id: match[1], url: match[2].trim() })
  }

  // 匹配 HTML img 标签 <img src="url" />
  const htmlImgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
  while ((match = htmlImgRegex.exec(content)) !== null) {
    images.push(match[1])
  }

  // 匹配 HTML a 标签 <a href="url">
  const htmlLinkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi
  while ((match = htmlLinkRegex.exec(content)) !== null) {
    links.push(match[1])
  }

  // 去重
  return {
    images: [...new Set(images)],
    links: [...new Set(links)],
    references,
  }
}

/**
 * 替换 Markdown 内容中的资源链接
 */
export function replaceMarkdownLinks(content: string, mappings: LinkMapping[]): ReplaceResult {
  let newContent = content
  const replacements: Array<{
    oldUrl: string
    newUrl: string
    type: 'image' | 'link' | 'reference'
  }> = []
  let replaceCount = 0

  for (const mapping of mappings) {
    const { oldUrl, newUrl, useRegex = false } = mapping

    if (useRegex) {
      try {
        const regex = new RegExp(oldUrl, 'g')
        const matches = newContent.match(regex)
        if (matches) {
          newContent = newContent.replace(regex, newUrl)
          replaceCount += matches.length
          matches.forEach(() => {
            replacements.push({ oldUrl, newUrl, type: 'link' })
          })
        }
      } catch (e) {
        console.error(`Invalid regex pattern: ${oldUrl}`)
      }
    } else {
      // 字符串包含匹配，但需要确保是完整的 URL
      // 处理图片链接 ![alt](oldUrl)
      const imageRegex = new RegExp(
        `(!\\[[^\\]]*\\]\\()${escapeRegex(oldUrl)}(\\s*["'][^"']*["'])?\\)`,
        'g'
      )
      let match
      while ((match = imageRegex.exec(content)) !== null) {
        const fullMatch = match[0]
        const newFullMatch = fullMatch.replace(oldUrl, newUrl)
        newContent = newContent.replace(fullMatch, newFullMatch)
        replaceCount++
        replacements.push({ oldUrl, newUrl, type: 'image' })
      }

      // 处理普通链接 [text](oldUrl)
      const linkRegex = new RegExp(
        `(\\[[^\\]]+\\]\\()${escapeRegex(oldUrl)}(\\s*["'][^"']*["'])?\\)`,
        'g'
      )
      while ((match = linkRegex.exec(content)) !== null) {
        // 确保不是图片链接
        const startIndex = match.index
        if (startIndex === 0 || content[startIndex - 1] !== '!') {
          const fullMatch = match[0]
          const newFullMatch = fullMatch.replace(oldUrl, newUrl)
          newContent = newContent.replace(fullMatch, newFullMatch)
          replaceCount++
          replacements.push({ oldUrl, newUrl, type: 'link' })
        }
      }

      // 处理引用式链接 [id]: oldUrl
      const refRegex = new RegExp(`^(\\[[^\\]]+\\]:\\s*)${escapeRegex(oldUrl)}`, 'gm')
      while ((match = refRegex.exec(content)) !== null) {
        const fullMatch = match[0]
        const newFullMatch = fullMatch.replace(oldUrl, newUrl)
        newContent = newContent.replace(fullMatch, newFullMatch)
        replaceCount++
        replacements.push({ oldUrl, newUrl, type: 'reference' })
      }

      // 处理 HTML img 标签
      const htmlImgRegex = new RegExp(`(<img[^>]+src=["'])${escapeRegex(oldUrl)}(["'][^>]*>)`, 'gi')
      while ((match = htmlImgRegex.exec(content)) !== null) {
        const fullMatch = match[0]
        const newFullMatch = fullMatch.replace(oldUrl, newUrl)
        newContent = newContent.replace(fullMatch, newFullMatch)
        replaceCount++
        replacements.push({ oldUrl, newUrl, type: 'image' })
      }

      // 处理 HTML a 标签
      const htmlLinkRegex = new RegExp(`(<a[^>]+href=["'])${escapeRegex(oldUrl)}(["'][^>]*>)`, 'gi')
      while ((match = htmlLinkRegex.exec(content)) !== null) {
        const fullMatch = match[0]
        const newFullMatch = fullMatch.replace(oldUrl, newUrl)
        newContent = newContent.replace(fullMatch, newFullMatch)
        replaceCount++
        replacements.push({ oldUrl, newUrl, type: 'link' })
      }
    }
  }

  return {
    content: newContent,
    replaced: replaceCount > 0,
    replaceCount,
    replacements,
  }
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 根据存储策略生成链接映射
 *
 * 示例：
 * - 从 local 切换到 s3：生成 { oldUrl: '/uploads/xxx.jpg', newUrl: 'https://s3.example.com/xxx.jpg' }
 * - 从 s3 切换到 external：生成 { oldUrl: 'https://s3.example.com/', newUrl: 'https://external.com/' }
 */
export function generateStorageMappings(
  oldBaseUrl: string,
  newBaseUrl: string,
  options: {
    /** 是否使用正则匹配（用于域名切换） */
    useRegex?: boolean
    /** 文件路径模式 */
    pathPattern?: string
  } = {}
): LinkMapping {
  const { useRegex = false, pathPattern } = options

  if (useRegex && pathPattern) {
    return {
      oldUrl: `${escapeRegex(oldBaseUrl)}${pathPattern}`,
      newUrl: `${newBaseUrl}$1`,
      useRegex: true,
    }
  }

  return {
    oldUrl: oldBaseUrl,
    newUrl: newBaseUrl,
    useRegex: false,
  }
}

/**
 * 批量生成存储源切换的映射规则
 */
export function generateStorageSwitchMappings(
  fromStorage: 'local' | 's3' | 'external',
  toStorage: 'local' | 's3' | 'external',
  config: {
    localBaseUrl?: string
    s3BaseUrl?: string
    externalBaseUrl?: string
  }
): LinkMapping[] {
  const mappings: LinkMapping[] = []
  const { localBaseUrl = '/uploads/', s3BaseUrl = '', externalBaseUrl = '' } = config

  const storageUrls = {
    local: localBaseUrl,
    s3: s3BaseUrl,
    external: externalBaseUrl,
  }

  const fromUrl = storageUrls[fromStorage]
  const toUrl = storageUrls[toStorage]

  if (!fromUrl || !toUrl || fromUrl === toUrl) {
    return mappings
  }

  // 生成从源存储到目标存储的映射
  mappings.push({
    oldUrl: fromUrl,
    newUrl: toUrl,
    useRegex: false,
  })

  return mappings
}

/**
 * 分析 Markdown 内容中的链接分布
 */
export function analyzeLinkDistribution(content: string): {
  localLinks: string[]
  externalLinks: string[]
  s3Links: string[]
  unknownLinks: string[]
} {
  const scanResult = scanMarkdownLinks(content)
  const allLinks = [...scanResult.images, ...scanResult.links]

  const localLinks: string[] = []
  const externalLinks: string[] = []
  const s3Links: string[] = []
  const unknownLinks: string[] = []

  for (const link of allLinks) {
    if (link.startsWith('/uploads/') || link.startsWith('./') || link.startsWith('../')) {
      localLinks.push(link)
    } else if (link.includes('s3.') || link.includes('amazonaws.com')) {
      s3Links.push(link)
    } else if (link.startsWith('http://') || link.startsWith('https://')) {
      externalLinks.push(link)
    } else {
      unknownLinks.push(link)
    }
  }

  return {
    localLinks: [...new Set(localLinks)],
    externalLinks: [...new Set(externalLinks)],
    s3Links: [...new Set(s3Links)],
    unknownLinks: [...new Set(unknownLinks)],
  }
}
