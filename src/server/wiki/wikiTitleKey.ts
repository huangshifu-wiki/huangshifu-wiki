export function normalizeWikiTitleKey(title: string) {
  return title.trim()
}

const WIKI_TITLE_CONFLICT_MESSAGE = '该标题的百科已存在，请修改标题或编辑已有页面'

export function buildLegacyDuplicateWikiTitleKey(title: string, slug: string) {
  return `${normalizeWikiTitleKey(title)} [${slug}]`
}

function targetIncludesField(target: unknown, field: 'slug' | 'titleKey') {
  if (Array.isArray(target)) {
    return target.includes(field)
  }

  if (typeof target === 'string') {
    return target === field || target.includes(field)
  }

  return false
}

export function getWikiUniqueConflictMessage(error: unknown) {
  const maybePrismaError = error as {
    code?: string
    meta?: { target?: unknown }
  }

  if (maybePrismaError.code !== 'P2002') {
    return null
  }

  const target = maybePrismaError.meta?.target
  if (targetIncludesField(target, 'titleKey')) {
    return WIKI_TITLE_CONFLICT_MESSAGE
  }

  if (targetIncludesField(target, 'slug')) {
    return '该页面标识已存在，请修改标题后重试'
  }

  return '百科页面已存在，请修改标题或页面标识后重试'
}
