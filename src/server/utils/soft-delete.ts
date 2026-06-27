import type { AuthenticatedRequest } from '../types'
import { parseBoolean, firstString } from './parsers'

export const SOFT_DELETE_TABS = [
  'wiki',
  'posts',
  'galleries',
  'users',
  'music',
  'albums',
  'sections',
  'announcements',
  'image-maps',
] as const

export type SoftDeleteTab = (typeof SOFT_DELETE_TABS)[number]

export function isSoftDeleteTab(value: string): value is SoftDeleteTab {
  return SOFT_DELETE_TABS.includes(value as SoftDeleteTab)
}

export function includeDeletedFromQuery(query: AuthenticatedRequest['query']) {
  return parseBoolean(firstString(query.includeDeleted), false)
}

export function deletedAtFilter(includeDeleted: boolean): { deletedAt?: null } {
  return includeDeleted ? {} : { deletedAt: null }
}

export function softDeleteData(deletedBy: string) {
  return {
    deletedAt: new Date(),
    deletedBy,
  }
}

export const restoreDeleteData = {
  deletedAt: null,
  deletedBy: null,
} as const

export const SELF_DELETE_REASON = '自行删除'

export function normalizeDeleteReason(input: unknown) {
  return typeof input === 'string' ? input.trim() : ''
}

export function resolveDeleteReason(input: unknown, isSelfDelete: boolean) {
  if (isSelfDelete) return SELF_DELETE_REASON
  return normalizeDeleteReason(input)
}
