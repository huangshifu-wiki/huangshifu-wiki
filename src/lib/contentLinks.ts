import { CONTENT_LIMITS } from './contentLimits'
import { validateUrl, type ClientValidationError } from './clientValidation'
import type { ContentLink } from '../types/entities'

// 站内链接允许的顶级路由，需与 src/App.tsx 的路由表同步（排除 /admin、/settings、/login 等）
const INTERNAL_LINK_ROOTS = [
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
] as const

// 只接受单个前导斜杠，挡掉 //evil.com 和 /\evil.com 这类协议相对写法
const internalPathPattern = /^\/(?!\/|\\)[^\s]*$/

const decodePath = (path: string) => {
  try {
    return decodeURIComponent(path)
  } catch {
    // 畸形百分号编码，交给调用方按不匹配处理
    return null
  }
}

export function isInternalLinkPath(value: string) {
  if (!internalPathPattern.test(value)) return false

  let url: URL
  try {
    // 借 URL 解析暴露真实目标：.. 和 %2e%2e 这类点段会被折叠，反斜杠会被当成分隔符
    url = new URL(value, 'http://internal.invalid')
  } catch {
    return false
  }

  // 非 ASCII 的百分号编码（中文 slug）只是同一目标的另一种写法，解码后再比对；
  // 解码仍不相等就说明作者写的路径和浏览器实际去的路径不是同一个，拒绝
  const writtenPath = decodePath(value.split(/[?#]/)[0])
  if (writtenPath === null || writtenPath !== decodePath(url.pathname)) return false

  const [root] = url.pathname.slice(1).split('/')
  return (INTERNAL_LINK_ROOTS as readonly string[]).includes(root)
}

// 丢掉名称和地址都为空的行，其余去掉首尾空白后提交
export function normalizeContentLinks(links: ContentLink[]): ContentLink[] {
  return links
    .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
    .filter((link) => link.label && link.url)
}

/**
 * 校验一组链接，返回第一个错误；空行不报错，由 normalizeContentLinks 丢弃。
 * 站内路径与协议白名单和服务端 createContentLinkListSchema 共用本模块判定，避免两边漂移。
 */
export function validateContentLinks(
  links: ContentLink[],
  {
    field: fieldOption,
    label,
    labelLimit,
    maxItems,
    allowInternalPath,
  }: {
    field?: string
    label: string
    labelLimit: number
    maxItems: number
    allowInternalPath?: boolean
  }
): ClientValidationError | null {
  const field = fieldOption ?? label
  const error = (message: string): ClientValidationError => ({ field, message })
  const filledLinks = links
    .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
    .filter((link) => link.label || link.url)

  if (filledLinks.length > maxItems) {
    return error(`${label}最多${maxItems}条`)
  }

  for (const { label: linkLabel, url } of filledLinks) {
    if (!linkLabel) return error(`${label}名称不能为空`)
    if (!url) return error(`${label}地址不能为空`)
    if (linkLabel.length > labelLimit) return error(`${label}名称不能超过${labelLimit}个字符`)
    if (allowInternalPath && isInternalLinkPath(url)) continue
    // 看着像站内路径但没落在内容路由上，单独提示，免得被当成只收站外地址
    if (allowInternalPath && url.startsWith('/')) {
      return error(`${label}站内路径需指向内容页，例如 /gallery/1024`)
    }
    const urlError = validateUrl(url, field, `${label}地址`, CONTENT_LIMITS.url)
    if (urlError) return urlError
  }

  return null
}
