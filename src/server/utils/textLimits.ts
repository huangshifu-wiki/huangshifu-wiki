import type { Response } from 'express'
import { z } from 'zod'

export function limitedString(label: string, max: number) {
  return z.string().max(max, `${label}不能超过${max}个字符`)
}

export function optionalLimitedString(label: string, max: number) {
  return limitedString(label, max).optional()
}

export function nullableLimitedString(label: string, max: number) {
  return limitedString(label, max).nullable().optional()
}

export function limitedStringArray(label: string, itemMax: number, arrayMax: number) {
  return z
    .array(limitedString(label, itemMax))
    .max(arrayMax, `${label}最多${arrayMax}个`)
    .optional()
}

export function ensureTextLimit(
  res: Response,
  value: unknown,
  label: string,
  max: number
): value is string {
  if (typeof value === 'string' && value.length > max) {
    res.status(400).json({ error: `${label}不能超过${max}个字符` })
    return false
  }
  return true
}
