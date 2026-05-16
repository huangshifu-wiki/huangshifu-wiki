import { describe, it, expect } from 'vitest'
import { validateSqlContent } from '../../src/server/utils/backup'

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
})
