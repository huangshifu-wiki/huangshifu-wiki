export function normalizeWikiTitleKey(title: string) {
  return title.trim()
}

const WIKI_TITLE_CONFLICT_MESSAGE = '该标题的百科已存在，请修改标题或编辑已有页面'

export function buildLegacyDuplicateWikiTitleKey(title: string, slug: string) {
  return `${normalizeWikiTitleKey(title)} [${slug}]`
}

function targetIncludesField(target: unknown, field: 'slug' | 'titleKey') {
  if (Array.isArray(target)) {
    return target.some((value) => value === field || value === `"${field}"`)
  }

  if (typeof target === 'string') {
    return target === field || target.includes(field)
  }

  return false
}

function getErrorProperty(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || !(key in value)) return undefined
  return Reflect.get(value, key)
}

export function getWikiUniqueConflictMessage(error: unknown) {
  if (getErrorProperty(error, 'code') !== 'P2002') {
    return null
  }

  // pg adapter 将约束放在 cause 中；target 仍是 Prisma 公开错误接口的一部分。
  const meta = getErrorProperty(error, 'meta')
  const adapterError = getErrorProperty(meta, 'driverAdapterError')
  const constraint = getErrorProperty(getErrorProperty(adapterError, 'cause'), 'constraint')
  const target =
    getErrorProperty(constraint, 'fields') ??
    getErrorProperty(constraint, 'index') ??
    getErrorProperty(meta, 'target')
  if (targetIncludesField(target, 'titleKey')) {
    return WIKI_TITLE_CONFLICT_MESSAGE
  }

  if (targetIncludesField(target, 'slug')) {
    return '该页面标识已存在，请修改标题后重试'
  }

  return '百科页面已存在，请修改标题或页面标识后重试'
}
