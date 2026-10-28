import { normalizeStringListInput } from './musicCredits'

export type ContentStatus = 'draft' | 'pending' | 'published' | 'rejected'

export const getStatusClassName = (status?: ContentStatus): string => {
  if (status === 'published') return 'theme-status-success'
  if (status === 'pending') return 'theme-status-warning'
  if (status === 'rejected') return 'theme-status-error'
  return 'bg-surface-alt text-text-muted'
}

// 与后端 normalizeStringListInput 同源：同一分隔符集合（含中文标点）拆分，trim + 去空 + 去重
export const splitTagsInput = (value: string): string[] => normalizeStringListInput(value)

export const getStatusText = (status?: ContentStatus): string => {
  if (status === 'pending') return '待审核'
  if (status === 'rejected') return '已驳回'
  if (status === 'draft') return '草稿'
  return '已发布'
}
