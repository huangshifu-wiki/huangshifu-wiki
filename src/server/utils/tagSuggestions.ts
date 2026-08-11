import type { ApiUser } from '../types'
import {
  buildGalleryVisibilityWhere,
  buildPostVisibilityWhere,
  buildWikiVisibilityWhere,
} from './authorization'
import { prisma } from './config'
import { normalizeStringListInput } from '../../lib/musicCredits'

type TagSuggestionResource = 'wiki' | 'post' | 'gallery'

type TagRow = {
  tags: unknown
}

const normalizeTagSuggestions = (rows: TagRow[]) => {
  const uniqueTags = new Set<string>()

  for (const row of rows) {
    for (const tag of normalizeStringListInput(Array.isArray(row.tags) ? row.tags : [])) {
      uniqueTags.add(tag)
    }
  }

  return [...uniqueTags].sort((left, right) => left.localeCompare(right, 'zh-CN'))
}

export async function fetchVisibleTagSuggestions(
  resource: TagSuggestionResource,
  authUser?: ApiUser
): Promise<string[]> {
  let rows: TagRow[]

  if (resource === 'wiki') {
    rows = await prisma.wikiPage.findMany({
      where: buildWikiVisibilityWhere(authUser),
      select: { tags: true },
    })
  } else if (resource === 'post') {
    rows = await prisma.post.findMany({
      where: buildPostVisibilityWhere(authUser),
      select: { tags: true },
    })
  } else {
    rows = await prisma.gallery.findMany({
      where: buildGalleryVisibilityWhere(authUser),
      select: { tags: true },
    })
  }

  return normalizeTagSuggestions(rows)
}
