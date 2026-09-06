import { describe, expect, it } from 'vitest'
import { decryptBuffer, encryptBuffer } from '../../src/server/utils/backup'

describe('backup crypto', () => {
  it('should round-trip encrypted content with the same password', () => {
    const payload = Buffer.from('-- PostgreSQL database dump\nSELECT 1;', 'utf-8')
    const encrypted = encryptBuffer(payload, 'secret-password')

    expect(encrypted[0]).toBe(0x01)
    expect(decryptBuffer(encrypted, 'secret-password').equals(payload)).toBe(true)
  })

  it('should produce different ciphertexts for the same payload', () => {
    const payload = Buffer.from('SELECT 1;', 'utf-8')
    const first = encryptBuffer(payload, 'secret-password')
    const second = encryptBuffer(payload, 'secret-password')

    expect(first.equals(second)).toBe(false)
  })

  it('should fail to decrypt with a wrong password', () => {
    const encrypted = encryptBuffer(Buffer.from('SELECT 1;', 'utf-8'), 'secret-password')

    expect(() => decryptBuffer(encrypted, 'wrong-password')).toThrow(/Failed to decrypt backup/)
  })

  it('should reject buffers with an unsupported format version', () => {
    const encrypted = encryptBuffer(Buffer.from('SELECT 1;', 'utf-8'), 'secret-password')
    encrypted[0] = 0x02

    expect(() => decryptBuffer(encrypted, 'secret-password')).toThrow(/不支持的备份加密格式/)
  })

  it('should reject buffers that are too short', () => {
    expect(() => decryptBuffer(Buffer.alloc(10, 1), 'secret-password')).toThrow(
      /Invalid encrypted buffer: too short/
    )
  })
})
