import { Prisma } from '@prisma/client'
import { PROFILE_DISPLAY_NAME_MAX_LENGTH } from '../../lib/contentLimits'
import { prisma } from './config'

type DisplayNameValidationSuccess = {
  ok: true
  displayName: string
}

type DisplayNameValidationFailure = {
  ok: false
  status: 400 | 409
  error: string
}

export type DisplayNameValidationResult =
  | DisplayNameValidationSuccess
  | DisplayNameValidationFailure

const DISPLAY_NAME_WHITESPACE = /\s/u
const DISPLAY_NAME_RESERVED_MENTION_CHARS = /[<>\[\]()`{}"'“”‘’]/u
const DISPLAY_NAME_FALLBACK_UNSAFE_CHARS = /[\s<>\[\]()`{}"'“”‘’]+/gu

export function normalizeDisplayNameFallback(value: string) {
  const normalized = value.trim().replace(DISPLAY_NAME_FALLBACK_UNSAFE_CHARS, '_')
  return (normalized || '匿名用户').slice(0, PROFILE_DISPLAY_NAME_MAX_LENGTH)
}

function withDisplayNameSuffix(base: string, sequence: number) {
  if (sequence === 1) return base

  const suffix = `_${sequence}`
  return `${base.slice(0, PROFILE_DISPLAY_NAME_MAX_LENGTH - suffix.length)}${suffix}`
}

async function activeDisplayNameExists(displayName: string) {
  const existing = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      status: 'active',
      displayName: { equals: displayName, mode: 'insensitive' as Prisma.QueryMode },
    },
    select: { uid: true },
  })

  return Boolean(existing)
}

export async function buildUniqueDisplayNameFallback(base: string) {
  const normalizedBase = normalizeDisplayNameFallback(base)

  for (let sequence = 1; sequence <= 100; sequence += 1) {
    const candidate = withDisplayNameSuffix(normalizedBase, sequence)
    if (!(await activeDisplayNameExists(candidate))) {
      return candidate
    }
  }

  let sequence = 101
  while (true) {
    const candidate = withDisplayNameSuffix(normalizedBase, sequence)
    if (!(await activeDisplayNameExists(candidate))) {
      return candidate
    }
    sequence += 1
  }
}

export async function validateUserDisplayName(
  value: unknown,
  options: {
    currentUid?: string
    currentDisplayName?: string | null
    label?: string
  } = {}
): Promise<DisplayNameValidationResult> {
  const label = options.label || '昵称'
  if (typeof value !== 'string') {
    return { ok: false, status: 400, error: `${label}必须是字符串` }
  }

  const displayName = value.trim()
  if (!displayName) {
    return { ok: false, status: 400, error: `${label}不能为空` }
  }
  if (displayName.length > PROFILE_DISPLAY_NAME_MAX_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `${label}不能超过${PROFILE_DISPLAY_NAME_MAX_LENGTH}个字符`,
    }
  }
  if (DISPLAY_NAME_WHITESPACE.test(displayName)) {
    return { ok: false, status: 400, error: `${label}不能包含空白字符` }
  }

  if (options.currentDisplayName !== undefined && displayName === options.currentDisplayName) {
    return { ok: true, displayName }
  }

  if (DISPLAY_NAME_RESERVED_MENTION_CHARS.test(displayName)) {
    return { ok: false, status: 400, error: `${label}不能包含提及保留字符` }
  }

  const existing = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      status: 'active',
      displayName: { equals: displayName, mode: 'insensitive' as Prisma.QueryMode },
      ...(options.currentUid ? { uid: { not: options.currentUid } } : {}),
    },
    select: { uid: true },
  })
  if (existing) {
    return { ok: false, status: 409, error: `该${label}已被使用` }
  }

  return { ok: true, displayName }
}
