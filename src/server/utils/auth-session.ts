import crypto from 'crypto'

export function createSessionVersion(passwordHash: string) {
  return crypto.createHash('sha256').update(passwordHash).digest('base64url').slice(0, 16)
}
