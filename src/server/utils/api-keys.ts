import { createHash, randomBytes } from 'node:crypto'
import type { ApiKeyResponse, ApiKeyResponseInput } from '../types'

export const API_KEY_PREFIX = 'hsf_api_'
export const API_KEY_PATTERN = /^hsf_api_[A-Za-z0-9_-]{43}$/
const API_KEY_RANDOM_BYTES = 32
const API_KEY_DISPLAY_PREFIX_LENGTH = 16

export function createApiKeyMaterial() {
  const token = `${API_KEY_PREFIX}${randomBytes(API_KEY_RANDOM_BYTES).toString('base64url')}`
  return {
    token,
    tokenHash: hashApiKeyToken(token),
    prefix: token.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH),
  }
}

export function hashApiKeyToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function toApiKeyResponse(record: ApiKeyResponseInput): ApiKeyResponse {
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
  }
}
