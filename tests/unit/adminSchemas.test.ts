import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import {
  backupCreateSchema,
  backupNoteSchema,
  backupRestoreSchema,
} from '../../src/server/schemas/admin.schema'
import { CONTENT_LIMITS } from '../../src/lib/contentLimits'

describe('admin backup schemas', () => {
  it('should strip unknown fields from backup create requests', () => {
    expect(
      backupCreateSchema.parse({
        note: '发布前备份',
        unexpected: 'ignored',
      })
    ).toEqual({ note: '发布前备份' })
  })

  it('should treat missing backup create body as an empty object', () => {
    expect(backupCreateSchema.parse(undefined)).toEqual({})
  })

  it('should strip unknown fields from backup note updates', () => {
    expect(
      backupNoteSchema.parse({
        note: '',
        unexpected: 'ignored',
      })
    ).toEqual({ note: '' })
  })

  it('should reject backup notes over the configured limit', () => {
    expect(() =>
      backupNoteSchema.parse({
        note: 'a'.repeat(CONTENT_LIMITS.admin.backupNote + 1),
      })
    ).toThrow(ZodError)
  })

  it('should accept restore requests with confirm only', () => {
    expect(backupRestoreSchema.parse({ confirm: true })).toEqual({ confirm: true })
    expect(backupRestoreSchema.parse({ confirm: 'true' })).toEqual({ confirm: true })
  })

  it('should accept restore requests with an optional decrypt password', () => {
    expect(backupRestoreSchema.parse({ confirm: true, password: 'old-secret' })).toEqual({
      confirm: true,
      password: 'old-secret',
    })
  })

  it('should reject restore requests without confirm', () => {
    expect(() => backupRestoreSchema.parse({ password: 'old-secret' })).toThrow(ZodError)
  })
})
