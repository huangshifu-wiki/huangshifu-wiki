import { describe, expect, it } from 'vitest'

import { VIEW_MODE_CONFIG, VIEW_MODE_LABELS } from '../../src/lib/viewModes'
import { ViewMode } from '../../src/types/userPreferences'

describe('viewModes', () => {
  describe('VIEW_MODE_CONFIG', () => {
    it('provides config for large view mode', () => {
      expect(VIEW_MODE_CONFIG.large).toEqual({
        gridCols: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
        cardHeight: 'h-[300px] sm:h-[360px]',
        gap: 'gap-4 sm:gap-6',
      })
    })

    it('provides config for medium view mode', () => {
      expect(VIEW_MODE_CONFIG.medium).toEqual({
        gridCols: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
        cardHeight: 'h-[220px] sm:h-[280px]',
        gap: 'gap-3 sm:gap-4',
      })
    })

    it('provides config for small view mode', () => {
      expect(VIEW_MODE_CONFIG.small).toEqual({
        gridCols: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6',
        cardHeight: 'h-[180px] sm:h-[200px]',
        gap: 'gap-3',
      })
    })

    it('provides config for list view mode', () => {
      expect(VIEW_MODE_CONFIG.list).toEqual({
        gridCols: 'grid-cols-1',
        cardHeight: 'h-auto',
        gap: 'gap-2',
      })
    })
  })

  describe('VIEW_MODE_LABELS', () => {
    it('provides Chinese labels for all view modes', () => {
      expect(VIEW_MODE_LABELS.large).toBe('舒适')
      expect(VIEW_MODE_LABELS.medium).toBe('标准')
      expect(VIEW_MODE_LABELS.small).toBe('紧凑')
      expect(VIEW_MODE_LABELS.list).toBe('列表')
    })

    it('has labels for all supported ViewMode types', () => {
      const modes: ViewMode[] = ['large', 'medium', 'small', 'list']

      for (const mode of modes) {
        expect(VIEW_MODE_LABELS[mode]).toBeDefined()
        expect(typeof VIEW_MODE_LABELS[mode]).toBe('string')
      }
    })
  })
})
