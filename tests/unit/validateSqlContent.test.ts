import { afterEach, describe, it, expect } from 'vitest'
import {
  parseBackupMetadata,
  sanitizeFilename,
  serializeBackupMetadata,
  formatPostgresClientMissingError,
  formatBackupTimestamp,
  getPostgresClientExecutable,
  isPostgresClientMissingError,
  validateSqlContent,
} from '../../src/server/utils/backup'

const originalPgDumpPath = process.env.PG_DUMP_PATH
const originalPsqlPath = process.env.PSQL_PATH

function restoreEnvValue(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}

afterEach(() => {
  restoreEnvValue('PG_DUMP_PATH', originalPgDumpPath)
  restoreEnvValue('PSQL_PATH', originalPsqlPath)
})

describe('validateSqlContent', () => {
  it('should allow valid pg_dump output statements', () => {
    const sql = `
CREATE TABLE "User" ("id" TEXT NOT NULL, "email" TEXT NOT NULL);
INSERT INTO "User" ("id", "email") VALUES ('1', 'test@test.com');
ALTER TABLE "User" ADD COLUMN "name" TEXT;
SET statement_timeout = 0;
SELECT pg_catalog.setval('public.user_id_seq', 1, false);
COMMENT ON TABLE "User" IS 'users table';
CREATE INDEX "User_email_idx" ON "User"("email");
CREATE SEQUENCE "user_id_seq";
ALTER SEQUENCE "user_id_seq" OWNED BY "User"."id";
CREATE FUNCTION "trigger_function"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;
`
    const result = validateSqlContent(sql)
    expect(result.valid).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('should reject DROP statements', () => {
    const sql = `DROP TABLE "User";`
    const result = validateSqlContent(sql)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('DROP')
  })

  it('should reject DELETE statements', () => {
    const sql = `DELETE FROM "User" WHERE id = '1';`
    const result = validateSqlContent(sql)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('DELETE')
  })

  it('should reject TRUNCATE statements', () => {
    const sql = `TRUNCATE TABLE "User";`
    const result = validateSqlContent(sql)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('TRUNCATE')
  })

  it('should reject GRANT statements', () => {
    const sql = `GRANT ALL ON "User" TO public;`
    const result = validateSqlContent(sql)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('GRANT')
  })

  it('should reject REVOKE statements', () => {
    const sql = `REVOKE ALL ON "User" FROM public;`
    const result = validateSqlContent(sql)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('REVOKE')
  })

  it('should reject COPY statements', () => {
    const sql = `COPY "User" TO '/tmp/dump.csv';`
    const result = validateSqlContent(sql)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('COPY')
  })

  it('should reject EXECUTE statements', () => {
    const sql = `EXECUTE some_prepared_stmt('arg');`
    const result = validateSqlContent(sql)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('EXECUTE')
  })

  it('should reject DO anonymous code blocks', () => {
    const sql = `DO $$ BEGIN DROP TABLE "User"; END $$;`
    const result = validateSqlContent(sql)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('DO')
  })

  it('should be case-insensitive', () => {
    const sql = `drop table "User";`
    const result = validateSqlContent(sql)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('DROP')
  })

  it('should reject unrecognized statement types', () => {
    const sql = `VACUUM "User";`
    const result = validateSqlContent(sql)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('VACUUM')
  })

  it('should handle empty content', () => {
    const result = validateSqlContent('')
    expect(result.valid).toBe(true)
  })

  it('should handle content with only whitespace and semicolons', () => {
    const result = validateSqlContent('  ;  ;  ')
    expect(result.valid).toBe(true)
  })

  it('should validate each statement independently', () => {
    const sql = `CREATE TABLE "User" ("id" TEXT); DROP TABLE "Post";`
    const result = validateSqlContent(sql)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('DROP')
  })

  it('should allow SELECT SETVAL statements', () => {
    const sql = `SELECT pg_catalog.setval('public.user_id_seq', 1, false);`
    const result = validateSqlContent(sql)
    expect(result.valid).toBe(true)
  })

  it('should allow CREATE FUNCTION with dollar-quoted body', () => {
    const sql = `CREATE FUNCTION trigger_set_timestamp() RETURNS trigger AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;`
    const result = validateSqlContent(sql)
    expect(result.valid).toBe(true)
  })

  it('should use default PostgreSQL client executable names', () => {
    delete process.env.PG_DUMP_PATH
    delete process.env.PSQL_PATH

    expect(getPostgresClientExecutable('pg_dump')).toBe('pg_dump')
    expect(getPostgresClientExecutable('psql')).toBe('psql')
  })

  it('should allow PostgreSQL client executable paths to be configured', () => {
    process.env.PG_DUMP_PATH = '/usr/lib/postgresql/16/bin/pg_dump'
    process.env.PSQL_PATH = '/usr/lib/postgresql/16/bin/psql'

    expect(getPostgresClientExecutable('pg_dump')).toBe('/usr/lib/postgresql/16/bin/pg_dump')
    expect(getPostgresClientExecutable('psql')).toBe('/usr/lib/postgresql/16/bin/psql')
  })

  it('should detect missing PostgreSQL client executable errors', () => {
    const error = Object.assign(new Error('spawn pg_dump ENOENT'), {
      code: 'ENOENT',
      syscall: 'spawn pg_dump',
    })

    expect(isPostgresClientMissingError(error)).toBe(true)
    expect(formatPostgresClientMissingError('pg_dump')).toContain('PG_DUMP_PATH')
  })

  it('should not treat file ENOENT errors as missing PostgreSQL clients', () => {
    const error = Object.assign(new Error('ENOENT: no such file or directory'), {
      code: 'ENOENT',
      syscall: 'open',
    })

    expect(isPostgresClientMissingError(error)).toBe(false)
  })

  it('should format backup timestamps using the current filename-safe format', () => {
    expect(formatBackupTimestamp(new Date('2026-06-28T10:11:12.345Z'))).toBe(
      '2026-06-28_10-11-12-345'
    )
  })

  it('should accept current and legacy backup filenames only', () => {
    expect(sanitizeFilename('backup_2026-06-28_10-11-12.zip')).toBe(true)
    expect(sanitizeFilename('backup_2026-06-28_10-11-12-345.zip')).toBe(true)
    expect(sanitizeFilename('backup_2026-06-28T10-11-12-345Z.zip')).toBe(true)
    expect(sanitizeFilename('../backup_2026-06-28_10-11-12.zip')).toBe(false)
    expect(sanitizeFilename('backup_2026-06-28_10-11-12.sql')).toBe(false)
  })

  it('should round-trip backup archive metadata', () => {
    const serialized = serializeBackupMetadata({
      format: 'huangshifu-wiki-backup',
      version: 2,
      encrypted: true,
      encryption: 'aes-256-gcm',
    })

    expect(parseBackupMetadata(serialized)).toEqual({
      format: 'huangshifu-wiki-backup',
      version: 2,
      encrypted: true,
      encryption: 'aes-256-gcm',
    })
    expect(parseBackupMetadata(Buffer.from('not json'))).toBeNull()
  })
})
