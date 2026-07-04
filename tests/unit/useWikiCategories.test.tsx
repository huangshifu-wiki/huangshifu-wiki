// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WikiCategoryItem } from '../../src/types/entities'

const mockApiGet = vi.hoisted(() => vi.fn())

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
}))

const mockCategories: WikiCategoryItem[] = [
  {
    id: 'biography',
    name: '人物介绍',
    description: '',
    order: 10,
    requiresAdminEdit: false,
  },
  {
    id: 'music',
    name: '音乐作品',
    description: '',
    order: 20,
    requiresAdminEdit: true,
  },
]

async function importHook() {
  const mod = await import('../../src/hooks/useWikiCategories')
  return mod.useWikiCategories
}

describe('useWikiCategories', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('caches successful category responses for labels and edit checks', async () => {
    mockApiGet.mockResolvedValueOnce({ categories: mockCategories })
    const useWikiCategories = await importHook()

    const { result, unmount } = renderHook(() => useWikiCategories())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
      expect(result.current.categories).toEqual(mockCategories)
    })

    expect(result.current.getCategoryLabel('music')).toBe('音乐作品')
    expect(result.current.canEditCategory('music', false)).toBe(false)
    expect(result.current.canEditCategory('music', true)).toBe(true)
    unmount()

    mockApiGet.mockRejectedValueOnce(new Error('network failed'))
    const { result: cachedResult } = renderHook(() => useWikiCategories())

    expect(cachedResult.current.loading).toBe(false)
    expect(cachedResult.current.categories).toEqual(mockCategories)
    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledTimes(2)
    })
    expect(cachedResult.current.categories).toEqual(mockCategories)
  })

  it('does not cache an empty list when the first category request fails', async () => {
    mockApiGet.mockRejectedValueOnce(new Error('network failed'))
    const useWikiCategories = await importHook()

    const { result, unmount } = renderHook(() => useWikiCategories())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.categories).toEqual([])
    unmount()

    mockApiGet.mockResolvedValueOnce({ categories: mockCategories })
    const { result: retryResult } = renderHook(() => useWikiCategories())

    expect(retryResult.current.loading).toBe(true)
    await waitFor(() => {
      expect(retryResult.current.loading).toBe(false)
      expect(retryResult.current.categories).toEqual(mockCategories)
    })
    expect(mockApiGet).toHaveBeenCalledTimes(2)
  })
})
