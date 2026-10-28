import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// Mock fs and path - must be defined before imports
const mockReadFile = vi.fn()
const mockJoin = vi.fn()

vi.mock('fs', () => ({
  default: {
    promises: {
      readFile: (...args: any[]) => mockReadFile(...args),
    },
  },
}))

vi.mock('path', () => ({
  default: {
    join: (...args: any[]) => mockJoin(...args),
  },
}))

// Import after mocking - need to use dynamic import to reset module state
async function importSensitiveWordFilter() {
  // Reset modules to get fresh state
  vi.resetModules()
  const module = await import('../../src/lib/sensitiveWordFilter')
  return module
}

describe('sensitiveWordFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockJoin.mockReturnValue('/mock/path/words.txt')
  })

  afterEach(() => {
    vi.resetModules()
  })

  describe('initSensitiveWords', () => {
    it('initializes with words from file', async () => {
      mockReadFile.mockResolvedValue('敏感词1\n敏感词2\n敏感词3\n')
      const { initSensitiveWords } = await importSensitiveWordFilter()

      await initSensitiveWords()

      expect(mockJoin).toHaveBeenCalledWith(process.cwd(), 'public', 'sensitive-words', 'words.txt')
      expect(mockReadFile).toHaveBeenCalledWith('/mock/path/words.txt', 'utf-8')
    }, 15000)

    it('handles empty file', async () => {
      mockReadFile.mockResolvedValue('')
      const { initSensitiveWords } = await importSensitiveWordFilter()

      await expect(initSensitiveWords()).resolves.not.toThrow()
    })

    it('handles file with whitespace', async () => {
      mockReadFile.mockResolvedValue('  敏感词1  \n\n  敏感词2  \n  ')
      const { initSensitiveWords } = await importSensitiveWordFilter()

      await initSensitiveWords()

      expect(mockReadFile).toHaveBeenCalled()
    })

    it('handles file read error gracefully', async () => {
      mockReadFile.mockRejectedValue(new Error('File not found'))
      const { initSensitiveWords } = await importSensitiveWordFilter()

      await expect(initSensitiveWords()).resolves.not.toThrow()
    })

    it('only initializes once', async () => {
      mockReadFile.mockResolvedValue('敏感词')
      const { initSensitiveWords } = await importSensitiveWordFilter()

      await initSensitiveWords()
      await initSensitiveWords()
      await initSensitiveWords()

      expect(mockReadFile).toHaveBeenCalledTimes(1)
    })
  })

  describe('containsSensitive', () => {
    it('finds sensitive words in text', async () => {
      mockReadFile.mockResolvedValue('敏感词\n测试词\n违禁内容\n')
      const { initSensitiveWords, containsSensitive } = await importSensitiveWordFilter()
      await initSensitiveWords()

      const result = containsSensitive('这是一个包含敏感词的文本')
      expect(result).toContain('敏感词')
    })

    it('finds multiple sensitive words', async () => {
      mockReadFile.mockResolvedValue('敏感词\n测试词\n违禁内容\n')
      const { initSensitiveWords, containsSensitive } = await importSensitiveWordFilter()
      await initSensitiveWords()

      const result = containsSensitive('这里有敏感词和测试词')
      expect(result).toContain('敏感词')
      expect(result).toContain('测试词')
    })

    it('returns unique results only', async () => {
      mockReadFile.mockResolvedValue('敏感词\n')
      const { initSensitiveWords, containsSensitive } = await importSensitiveWordFilter()
      await initSensitiveWords()

      const result = containsSensitive('敏感词敏感词敏感词')
      expect(result).toEqual(['敏感词'])
    })

    it('returns empty array when no sensitive words found', async () => {
      mockReadFile.mockResolvedValue('敏感词\n')
      const { initSensitiveWords, containsSensitive } = await importSensitiveWordFilter()
      await initSensitiveWords()

      const result = containsSensitive('这是一个正常的文本')
      expect(result).toEqual([])
    })

    it('handles empty string', async () => {
      mockReadFile.mockResolvedValue('敏感词\n')
      const { initSensitiveWords, containsSensitive } = await importSensitiveWordFilter()
      await initSensitiveWords()

      const result = containsSensitive('')
      expect(result).toEqual([])
    })

    it('handles multi-character sensitive words', async () => {
      mockReadFile.mockResolvedValue('违禁内容\n')
      const { initSensitiveWords, containsSensitive } = await importSensitiveWordFilter()
      await initSensitiveWords()

      const result = containsSensitive('这是违禁内容测试')
      expect(result).toContain('违禁内容')
    })

    it('finds overlapping matches', async () => {
      mockReadFile.mockResolvedValue('敏感词\n测试词\n')
      const { initSensitiveWords, containsSensitive } = await importSensitiveWordFilter()
      await initSensitiveWords()

      const result = containsSensitive('敏感词测试词')
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('isSensitiveWord', () => {
    it('returns true for exact sensitive word', async () => {
      mockReadFile.mockResolvedValue('敏感词\n测试词\n')
      const { initSensitiveWords, isSensitiveWord } = await importSensitiveWordFilter()
      await initSensitiveWords()

      expect(isSensitiveWord('敏感词')).toBe(true)
    })

    it('returns false for partial match', async () => {
      mockReadFile.mockResolvedValue('敏感词\n')
      const { initSensitiveWords, isSensitiveWord } = await importSensitiveWordFilter()
      await initSensitiveWords()

      expect(isSensitiveWord('敏感')).toBe(false)
    })

    it('returns false for non-sensitive word', async () => {
      mockReadFile.mockResolvedValue('敏感词\n')
      const { initSensitiveWords, isSensitiveWord } = await importSensitiveWordFilter()
      await initSensitiveWords()

      expect(isSensitiveWord('正常词汇')).toBe(false)
    })

    it('handles empty string', async () => {
      mockReadFile.mockResolvedValue('敏感词\n')
      const { initSensitiveWords, isSensitiveWord } = await importSensitiveWordFilter()
      await initSensitiveWords()

      expect(isSensitiveWord('')).toBe(false)
    })

    it('handles special characters', async () => {
      mockReadFile.mockResolvedValue('敏感词\n')
      const { initSensitiveWords, isSensitiveWord } = await importSensitiveWordFilter()
      await initSensitiveWords()

      expect(isSensitiveWord('敏感词!')).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('handles long text efficiently', async () => {
      mockReadFile.mockResolvedValue('测试\n')
      const { initSensitiveWords, containsSensitive } = await importSensitiveWordFilter()
      await initSensitiveWords()

      const longText = '正常文本'.repeat(1000) + '测试' + '正常文本'.repeat(1000)
      const result = containsSensitive(longText)
      expect(result).toContain('测试')
    })

    it('handles text with newlines', async () => {
      mockReadFile.mockResolvedValue('敏感\n')
      const { initSensitiveWords, containsSensitive } = await importSensitiveWordFilter()
      await initSensitiveWords()

      const result = containsSensitive('第一行\n敏感\n第三行')
      expect(result).toContain('敏感')
    })
  })
})
