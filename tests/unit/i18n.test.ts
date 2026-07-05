import { describe, it, expect } from 'vitest'
import { getI18n } from '../../src/lib/i18n'

describe('getI18n', () => {
  describe('locale retrieval', () => {
    it('returns t function', () => {
      const { t } = getI18n()
      expect(typeof t).toBe('function')
    })

    it('always returns default locale', () => {
      const locale = getI18n()
      expect(locale.t('nav.music')).toBe('音乐')
    })
  })

  describe('nested value retrieval', () => {
    it('retrieves section values', () => {
      const { t } = getI18n()
      expect(t('forum.title')).toBe('论坛')
    })

    it('retrieves nested values using dot notation', () => {
      const { t } = getI18n()
      expect(t('nav.music')).toBe('音乐')
    })

    it('retrieves deeply nested values', () => {
      const { t } = getI18n()
      expect(t('music.unit.song')).toBe('首歌曲')
    })

    it('returns the key itself if not found', () => {
      const { t } = getI18n()
      expect(t('non.existent.key')).toBe('non.existent.key')
    })
  })

  describe('parameter replacement', () => {
    it('replaces single parameter', () => {
      const { t } = getI18n()
      expect(t('gallery.imageCount', { count: 5 })).toBe('5 张图片')
    })

    it('replaces parameter with zero', () => {
      const { t } = getI18n()
      expect(t('gallery.imageCount', { count: 0 })).toBe('0 张图片')
    })

    it('replaces parameter with string value', () => {
      const { t } = getI18n()
      expect(t('gallery.imageCount', { count: '10' })).toBe('10 张图片')
    })

    it('keeps original placeholder for unknown parameter', () => {
      const { t } = getI18n()
      expect(t('gallery.imageCount', { unknown: 5 })).toBe('{{count}} 张图片')
    })

    it('handles missing params object gracefully', () => {
      const { t } = getI18n()
      expect(t('gallery.imageCount')).toBe('{{count}} 张图片')
    })
  })
})
