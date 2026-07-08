import { format } from 'date-fns'

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

const padDatePart = (value: number) => String(value).padStart(2, '0')

export const toDateValue = (value: string | null | undefined): Date | null => {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export const toLocalDateInputValue = (value = new Date()): string =>
  [value.getFullYear(), padDatePart(value.getMonth() + 1), padDatePart(value.getDate())].join('-')

export const toDateOnlyValue = (value: string | null | undefined): Date | null => {
  if (!value) return null
  const match = DATE_ONLY_PATTERN.exec(value)
  if (!match) return toDateValue(value)

  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const parsed = new Date(year, month - 1, day)

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() + 1 !== month ||
    parsed.getDate() !== day
  ) {
    return null
  }

  return parsed
}

export const formatDate = (value: string | null | undefined, pattern: string): string => {
  const parsed = toDateValue(value)
  return parsed ? format(parsed, pattern) : '刚刚'
}

export const formatDateOnly = (
  value: string | null | undefined,
  pattern = 'yyyy-MM-dd',
  fallback = '刚刚'
): string => {
  const parsed = toDateOnlyValue(value)
  return parsed ? format(parsed, pattern) : fallback
}

export const formatDateTime = (value: string | null | undefined, fallback = '刚刚'): string => {
  const parsed = toDateValue(value)
  return parsed ? format(parsed, 'yyyy-MM-dd HH:mm') : fallback
}
