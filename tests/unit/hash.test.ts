import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import * as hashModule from '../../src/server/utils/hash'

describe('hash utils', () => {
  describe('calculateFileMD5', () => {
    let tmpFile: string

    beforeEach(() => {
      tmpFile = path.join(
        os.tmpdir(),
        `hash-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
      )
    })

    afterEach(() => {
      try {
        fs.unlinkSync(tmpFile)
      } catch {
        /* noop */
      }
    })

    it('rejects with error for non-existent file', async () => {
      await expect(hashModule.calculateFileMD5('/nonexistent/path/file.txt')).rejects.toThrow()
    })
  })
})
