// 权限校验 & 可见性查询条件构建

import type { ContentStatus, ApiUser } from '../types'
import { isAdminRole } from '../middleware/auth'

const VIEWABLE_STATUSES: ReadonlySet<ContentStatus> = new Set(['published'])
const EDITABLE_STATUSES: ReadonlySet<ContentStatus> = new Set(['draft', 'pending', 'published'])

export function canViewWikiPage(
  page: { status: string; lastEditorUid: string; deletedAt?: Date | null },
  authUser?: ApiUser
): boolean {
  if (page.deletedAt) return false
  if (page.status === 'published') return true
  if (!authUser) return false
  if (isAdminRole(authUser.role)) {
    if (page.status === 'rejected' || page.status === 'archived') return true
    return EDITABLE_STATUSES.has(page.status as ContentStatus)
  }
  if (page.status === 'rejected' || page.status === 'archived') return false
  return page.lastEditorUid === authUser.uid && EDITABLE_STATUSES.has(page.status as ContentStatus)
}

export function canViewPost(
  post: { status: ContentStatus; authorUid: string; deletedAt?: Date | null },
  authUser?: ApiUser
) {
  if (post.deletedAt) return false
  if (post.status === 'published') return true
  if (!authUser) return false
  if (isAdminRole(authUser.role)) return true
  return post.authorUid === authUser.uid
}

export function canViewGallery(
  gallery: {
    status?: ContentStatus | string | null
    published?: boolean
    authorUid: string
    deletedAt?: Date | null
  },
  authUser?: ApiUser
) {
  if (gallery.deletedAt) return false
  if (gallery.status === 'published' || (!gallery.status && gallery.published)) return true
  if (!authUser) return false
  if (isAdminRole(authUser.role)) return true
  return gallery.authorUid === authUser.uid
}
export function canViewTicketListing(
  listing: { status: ContentStatus | string; authorUid: string; deletedAt?: Date | null },
  authUser?: ApiUser
): boolean {
  if (listing.deletedAt) return false
  if (listing.status === 'published') return true
  if (!authUser) return false
  if (isAdminRole(authUser.role)) return true
  return listing.authorUid === authUser.uid
}

export function canManageGallery(gallery: { authorUid: string }, authUser?: ApiUser) {
  if (!authUser) return false
  if (isAdminRole(authUser.role)) return true
  return gallery.authorUid === authUser.uid
}

export function buildWikiVisibilityWhere(authUser?: ApiUser) {
  if (!authUser) {
    return { status: 'published' as ContentStatus, deletedAt: null }
  }
  if (isAdminRole(authUser.role)) {
    return { deletedAt: null }
  }
  return {
    deletedAt: null,
    OR: [{ status: 'published' as ContentStatus }, { lastEditorUid: authUser.uid }],
  }
}

export function buildPostVisibilityWhere(authUser?: ApiUser) {
  if (!authUser) {
    return { status: 'published' as ContentStatus, deletedAt: null }
  }
  if (isAdminRole(authUser.role)) {
    return { deletedAt: null }
  }
  return {
    deletedAt: null,
    OR: [{ status: 'published' as ContentStatus }, { authorUid: authUser.uid }],
  }
}

export function buildGalleryVisibilityWhere(authUser?: ApiUser) {
  if (!authUser) {
    return { status: 'published' as ContentStatus, deletedAt: null }
  }
  if (isAdminRole(authUser.role)) {
    return { deletedAt: null }
  }
  return {
    deletedAt: null,
    OR: [{ status: 'published' as ContentStatus }, { authorUid: authUser.uid }],
  }
}
