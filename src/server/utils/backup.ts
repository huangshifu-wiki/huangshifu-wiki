// 备份加密/解密/清理/文件安全工具

import crypto, { timingSafeEqual } from 'crypto'
import fs from 'fs'
import path from 'path'
import { backupsDir, BACKUP_PASSWORD, BACKUP_RETAIN_COUNT } from './config'

export const BACKUP_METADATA_ENTRY = 'backup-meta.json'

export interface BackupArchiveMetadata {
  format: 'huangshifu-wiki-backup'
  version: 2
  encrypted: boolean
  encryption?: 'aes-256-gcm'
}

interface BackupNoteMetadata {
  version: 1
  note: string
  updatedAt: string
}

// ─── 解析与验证 ─────────────────────────────────────────────────────

type PostgresClientTool = 'pg_dump' | 'psql'

const POSTGRES_CLIENT_ENV: Record<PostgresClientTool, string> = {
  pg_dump: 'PG_DUMP_PATH',
  psql: 'PSQL_PATH',
}

export function getPostgresClientExecutable(tool: PostgresClientTool): string {
  const configuredPath = process.env[POSTGRES_CLIENT_ENV[tool]]?.trim()
  return configuredPath || tool
}

export function isPostgresClientMissingError(error: unknown): boolean {
  const errnoError = error as NodeJS.ErrnoException
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    errnoError.code === 'ENOENT' &&
    typeof errnoError.syscall === 'string' &&
    errnoError.syscall.startsWith('spawn')
  )
}

export function formatPostgresClientMissingError(tool: PostgresClientTool): string {
  const envName = POSTGRES_CLIENT_ENV[tool]
  return `服务器缺少 PostgreSQL 客户端工具 ${tool}，请安装 postgresql-client 或通过 ${envName} 配置可执行文件路径`
}

export function parseDatabaseUrl(
  url: string
): { host: string; port: string; user: string; password: string; database: string } | null {
  try {
    const parsed = new URL(url)
    return {
      host: parsed.hostname,
      port: parsed.port || '5432',
      user: parsed.username,
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.slice(1),
    }
  } catch {
    return null
  }
}

export function verifyBackupPassword(password: string): boolean {
  if (!BACKUP_PASSWORD) return false
  if (password.length !== BACKUP_PASSWORD.length) return false
  return timingSafeEqual(Buffer.from(password), Buffer.from(BACKUP_PASSWORD))
}

export function formatBackupTimestamp(date = new Date()): string {
  return date.toISOString().slice(0, 23).replace('T', '_').replace(/[:.]/g, '-')
}

export function sanitizeFilename(name: string): boolean {
  const currentFormat = /^backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d{3})?\.zip$/
  const legacyIsoFormat = /^backup_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.zip$/
  return currentFormat.test(name) || legacyIsoFormat.test(name)
}

function getBackupNoteMetadataPath(filename: string): string {
  if (!sanitizeFilename(filename)) {
    throw new Error('Invalid backup filename')
  }

  return path.join(backupsDir, `${filename}.meta.json`)
}

export function normalizeBackupNote(note: string): string {
  return note.replace(/\r\n?/g, '\n').trim()
}

export async function readBackupNote(filename: string): Promise<string> {
  try {
    const content = await fs.promises.readFile(getBackupNoteMetadataPath(filename), 'utf-8')
    const parsed = JSON.parse(content) as Partial<BackupNoteMetadata>

    if (parsed.version !== 1 || typeof parsed.note !== 'string') {
      return ''
    }

    return parsed.note
  } catch (error) {
    const errnoError = error as NodeJS.ErrnoException
    if (errnoError.code !== 'ENOENT') {
      console.warn(`Failed to read backup note metadata for ${filename}:`, error)
    }
    return ''
  }
}

export async function writeBackupNote(filename: string, note: string): Promise<string> {
  const normalizedNote = normalizeBackupNote(note)
  const metadataPath = getBackupNoteMetadataPath(filename)

  if (!normalizedNote) {
    await fs.promises.unlink(metadataPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error
      }
    })
    return ''
  }

  const metadata: BackupNoteMetadata = {
    version: 1,
    note: normalizedNote,
    updatedAt: new Date().toISOString(),
  }

  await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8')
  return normalizedNote
}

export async function deleteBackupNote(filename: string): Promise<void> {
  await fs.promises
    .unlink(getBackupNoteMetadataPath(filename))
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error
      }
    })
}

export function serializeBackupMetadata(metadata: BackupArchiveMetadata): Buffer {
  return Buffer.from(JSON.stringify(metadata, null, 2), 'utf-8')
}

export function parseBackupMetadata(content: Buffer | undefined): BackupArchiveMetadata | null {
  if (!content) return null

  try {
    const parsed = JSON.parse(content.toString('utf-8')) as Partial<BackupArchiveMetadata>
    if (parsed.format !== 'huangshifu-wiki-backup' || parsed.version !== 2) {
      return null
    }

    return {
      format: parsed.format,
      version: parsed.version,
      encrypted: parsed.encrypted === true,
      encryption: parsed.encryption,
    }
  } catch {
    return null
  }
}

const SQL_ALLOWED_PREFIXES = [
  'CREATE TABLE',
  'INSERT INTO',
  'ALTER TABLE',
  'SET',
  'SELECT',
  'COMMENT',
  'CREATE INDEX',
  'CREATE SEQUENCE',
  'ALTER SEQUENCE',
  'SELECT SETVAL',
  'CREATE FUNCTION',
]

const SQL_REJECTED_PREFIXES = [
  'DROP',
  'DELETE',
  'TRUNCATE',
  'GRANT',
  'REVOKE',
  'COPY',
  'EXECUTE',
  'DO',
]

export function validateSqlContent(sqlContent: string): { valid: boolean; reason?: string } {
  const stripped = sqlContent.replace(/\$\$[\s\S]*?\$\$/g, '$$')

  const statements = stripped
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  for (const stmt of statements) {
    const firstLine = stmt.split('\n')[0].trim()
    const upper = firstLine.toUpperCase()

    const isRejected = SQL_REJECTED_PREFIXES.some((prefix) => upper.startsWith(prefix))
    if (isRejected) {
      const keyword = SQL_REJECTED_PREFIXES.find((prefix) => upper.startsWith(prefix))!
      return { valid: false, reason: `SQL 语句包含不允许的操作: ${keyword}` }
    }

    const isAllowed = SQL_ALLOWED_PREFIXES.some((prefix) => upper.startsWith(prefix))
    if (!isAllowed) {
      const keyword = upper.split(/\s+/)[0] || upper
      return { valid: false, reason: `SQL 语句包含未识别的操作: ${keyword}` }
    }
  }

  return { valid: true }
}

// ─── 格式化 ─────────────────────────────────────────────────────────

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// ─── 备份清理 ───────────────────────────────────────────────────────

export async function cleanupOldBackups(skipFiles?: string[]): Promise<void> {
  try {
    const backupFilenames = (await fs.promises.readdir(backupsDir)).filter(
      (f) => f.startsWith('backup_') && f.endsWith('.zip')
    )
    const files = (
      await Promise.all(
        backupFilenames.map(async (f) => {
          const filePath = path.join(backupsDir, f)
          const stat = await fs.promises.stat(filePath)
          return { name: f, mtime: stat.mtime.getTime() }
        })
      )
    ).sort((a, b) => b.mtime - a.mtime)

    if (files.length > BACKUP_RETAIN_COUNT) {
      const toDelete = files.slice(BACKUP_RETAIN_COUNT).filter((f) => !skipFiles?.includes(f.name))
      for (const file of toDelete) {
        await fs.promises.unlink(path.join(backupsDir, file.name))
        if (sanitizeFilename(file.name)) {
          await deleteBackupNote(file.name)
        }
        console.log(`Cleaned up old backup: ${file.name}`)
      }
    }
  } catch (error) {
    console.error('Cleanup old backups error:', error)
  }
}

// ─── 加密 / 解密 ────────────────────────────────────────────────────

export function encryptBuffer(buffer: Buffer, password: string): Buffer {
  const version = Buffer.from([0x01])
  const salt = crypto.randomBytes(32)
  const key = crypto.scryptSync(password, salt, 32)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([version, salt, iv, encrypted, authTag])
}

export function decryptBuffer(buffer: Buffer, password: string): Buffer {
  if (buffer.length < 49) {
    throw new Error('Invalid encrypted buffer: too short')
  }

  const versionByte = buffer[0]

  try {
    if (versionByte === 0x01) {
      const salt = buffer.subarray(1, 33)
      const iv = buffer.subarray(33, 45)
      const encryptedEnd = buffer.length - 16
      const encrypted = buffer.subarray(45, encryptedEnd)
      const authTag = buffer.subarray(encryptedEnd)
      const key = crypto.scryptSync(password, salt, 32)
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(authTag)
      return Buffer.concat([decipher.update(encrypted), decipher.final()])
    }

    console.warn(
      '[Backup] ⚠️ Decrypting legacy format (AES-256-CBC). Please re-encrypt with new format.'
    )
    const iv = buffer.subarray(0, 16)
    const encrypted = buffer.subarray(16)
    const key = crypto.scryptSync(password, 'huangshifu-backup-salt', 32)
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
    return Buffer.concat([decipher.update(encrypted), decipher.final()])
  } catch (error) {
    throw new Error(
      `Failed to decrypt backup: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

// ─── Embedding Payload（原始位置靠近 embedding 区域）─────────────────

export function toEmbeddingPayload(payload: unknown): {
  galleryId: string
  galleryImageId: string
  imageUrl: string
  imageName: string
} | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const record = payload as Record<string, unknown>
  const galleryId = typeof record.galleryId === 'string' ? record.galleryId : ''
  const galleryImageId = typeof record.galleryImageId === 'string' ? record.galleryImageId : ''
  if (!galleryId || !galleryImageId) {
    return null
  }

  return {
    galleryId,
    galleryImageId,
    imageUrl: typeof record.imageUrl === 'string' ? record.imageUrl : '',
    imageName: typeof record.imageName === 'string' ? record.imageName : '',
  }
}
