import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import * as uploadPath from '../../src/server/uploadPath'

describe('uploadPath', () => {
  const testDir = path.join(os.tmpdir(), `upload-test-${Date.now()}`)

  beforeEach(() => {
    vi.restoreAllMocks()
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true })
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    try {
      fs.rmSync(testDir, { recursive: true, force: true })
    } catch {
      /* noop */
    }
  })

  describe('createUploadStorageInfo', () => {
    it('creates storage info with correct structure', () => {
      const info = uploadPath.createUploadStorageInfo(testDir, 'wiki', 'photo.jpg')
      expect(info).toHaveProperty('storageKey')
      expect(info).toHaveProperty('absoluteDir')
      expect(info).toHaveProperty('fileName')
      expect(info.fileName).toMatch(/\.jpg$/)
      expect(info.absoluteDir).toContain(path.join('wiki'))
    })

    it('normalizes namespace with special characters', () => {
      const info = uploadPath.createUploadStorageInfo(testDir, 'wiki/../etc', 'f.txt')
      expect(info.storageKey).not.toContain('..')
    })

    it('uses custom date when provided', () => {
      const date = new Date(2025, 0, 15)
      const info = uploadPath.createUploadStorageInfo(testDir, 'test', 'img.png', date)
      expect(info.storageKey).toContain('2025/01')
    })

    it('creates directory on disk', () => {
      uploadPath.createUploadStorageInfo(testDir, 'gallery', 'pic.png')
      expect(fs.existsSync(path.join(testDir, 'gallery'))).toBe(true)
    })
  })

  describe('buildUploadPublicUrl', () => {
    it('builds URL with /uploads/ prefix', () => {
      const url = uploadPath.buildUploadPublicUrl('wiki/2025/06/photo.jpg')
      expect(url).toBe('/uploads/wiki/2025/06/photo.jpg')
    })

    it('encodes URI components', () => {
      const url = uploadPath.buildUploadPublicUrl('wiki/my file/photo.jpg')
      expect(url).toContain('my%20file')
    })

    it('strips leading slashes from storageKey', () => {
      const url = uploadPath.buildUploadPublicUrl('/wiki/test.png')
      expect(url).toBe('/uploads/wiki/test.png')
    })

    it('normalizes backslashes to forward slashes', () => {
      const url = uploadPath.buildUploadPublicUrl('wiki\\2025\\test.png')
      expect(url).toContain('/')
    })
  })

  describe('resolveUploadPathByStorageKey', () => {
    it('resolves storage key to absolute path within uploads dir', () => {
      const resolved = uploadPath.resolveUploadPathByStorageKey('wiki/photo.jpg', testDir)
      expect(resolved).toContain(testDir)
      expect(resolved).toContain('wiki')
    })

    it('returns null for path traversal attempts', () => {
      const result = uploadPath.resolveUploadPathByStorageKey('../../etc/passwd', testDir)
      expect(result).toBeNull()
    })
  })

  describe('extractStorageKeyFromUploadUrl', () => {
    it('extracts key from relative /uploads/ URL', () => {
      const key = uploadPath.extractStorageKeyFromUploadUrl('/uploads/wiki/photo.jpg')
      expect(key).toBe('wiki/photo.jpg')
    })

    it('extracts key from full URL', () => {
      const key = uploadPath.extractStorageKeyFromUploadUrl(
        'https://example.com/uploads/wiki/photo.jpg'
      )
      expect(key).toBe('wiki/photo.jpg')
    })

    it('decodes URI encoded components', () => {
      const key = uploadPath.extractStorageKeyFromUploadUrl('/uploads/wiki/my%20photo.jpg')
      expect(key).toBe('wiki/my photo.jpg')
    })

    it('returns null for non-uploads URL', () => {
      const key = uploadPath.extractStorageKeyFromUploadUrl('/api/something')
      expect(key).toBeNull()
    })

    it('returns null for empty input', () => {
      expect(uploadPath.extractStorageKeyFromUploadUrl('')).toBeNull()
    })
  })

  describe('safeDeleteUploadFileByStorageKey', () => {
    it('returns false for invalid (traversal) storage keys', () => {
      const result = uploadPath.safeDeleteUploadFileByStorageKey('../../etc/passwd', testDir)
      expect(result).toBe(false)
    })

    it('returns true even when file does not exist', () => {
      const result = uploadPath.safeDeleteUploadFileByStorageKey('nonexistent/file.txt', testDir)
      expect(result).toBe(true)
    })
  })

  describe('getStorageKeyFromFilePath', () => {
    it('converts absolute file path to relative storage key', () => {
      const filePath = path.join(testDir, 'wiki', '2025', '06', 'photo.jpg')
      const key = uploadPath.getStorageKeyFromFilePath(filePath, testDir)
      expect(key).toBe('wiki/2025/06/photo.jpg')
    })

    it('returns null for paths outside uploads dir', () => {
      const key = uploadPath.getStorageKeyFromFilePath('/etc/passwd', testDir)
      expect(key).toBeNull()
    })

    it('uses forward slashes in output', () => {
      const filePath = path.join(testDir, 'wiki', 'photo.jpg')
      const key = uploadPath.getStorageKeyFromFilePath(filePath, testDir)
      expect(key).not.toContain('\\')
    })
  })
})
