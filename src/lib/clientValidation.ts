import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './passwordRules'

export type ClientValidationError = {
  field: string
  message: string
}

const error = (field: string, message: string): ClientValidationError => ({ field, message })

export function validateRequiredText(
  value: unknown,
  field: string,
  label: string
): ClientValidationError | null {
  return typeof value === 'string' && value.trim() ? null : error(field, `${label}不能为空`)
}

export function validateMaxLength(
  value: unknown,
  field: string,
  label: string,
  maxLength: number
): ClientValidationError | null {
  if (typeof value !== 'string' || value.length <= maxLength) return null
  return error(field, `${label}不能超过${maxLength}个字符`)
}

export function validateTags(
  tags: readonly string[],
  field: string,
  label: string,
  maxCount: number,
  maxItemLength: number
): ClientValidationError | null {
  if (tags.length > maxCount) return error(field, `${label}最多${maxCount}个`)
  if (tags.some((tag) => tag.length > maxItemLength)) {
    return error(field, `${label}单项长度不能超过${maxItemLength}个字符`)
  }
  return null
}

export function validateEmail(
  value: unknown,
  field: string,
  label: string
): ClientValidationError | null {
  const requiredError = validateRequiredText(value, field, label)
  if (requiredError) return requiredError
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value as string).trim())) {
    return error(field, '邮箱格式无效')
  }
  return null
}

export function validatePassword(
  value: unknown,
  field: string,
  label: string
): ClientValidationError | null {
  if (typeof value !== 'string' || !value) return error(field, `${label}不能为空`)
  if (value.length < PASSWORD_MIN_LENGTH) {
    return error(field, `${label}至少${PASSWORD_MIN_LENGTH}个字符`)
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return error(field, `${label}最多${PASSWORD_MAX_LENGTH}个字符`)
  }
  return null
}

export function validateUrl(
  value: unknown,
  field: string,
  label: string,
  maxLength?: number
): ClientValidationError | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') return error(field, `${label}必须是有效 URL`)
  const normalized = value.trim()
  if (maxLength !== undefined && normalized.length > maxLength) {
    return error(field, `${label}不能超过${maxLength}个字符`)
  }
  try {
    const url = new URL(normalized)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid protocol')
  } catch {
    return error(field, `${label}必须是有效的 http/https URL`)
  }
  return null
}
