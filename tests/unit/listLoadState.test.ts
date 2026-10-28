import { describe, expect, it, vi } from 'vitest'

import { getListLoadState } from '../../src/lib/listLoadState'

describe('getListLoadState', () => {
  it('普通列表空数据加载中时标记为初始加载', () => {
    const retry = vi.fn()
    const state = getListLoadState({
      items: [],
      loading: true,
      error: null,
      retry,
      incremental: null,
    })

    expect(state.isInitialLoading).toBe(true)
    expect(state.isRefreshing).toBe(false)
    expect(state.error).toBeNull()
    expect(state.loadMoreError).toBeNull()
    expect(state.retry).toBe(retry)
  })

  it('普通列表已有数据刷新时保留内容状态', () => {
    const items = [{ id: 'item-1' }]
    const state = getListLoadState({
      items,
      loading: true,
      error: null,
      retry: vi.fn(),
      incremental: null,
    })

    expect(state.items).toBe(items)
    expect(state.isInitialLoading).toBe(false)
    expect(state.isRefreshing).toBe(true)
  })

  it('增量初始错误使用初始错误和增量重试', () => {
    const retry = vi.fn()
    const initialError = new Error('initial')
    const state = getListLoadState({
      items: [],
      loading: false,
      error: new Error('unused'),
      retry: vi.fn(),
      incremental: {
        isInitialLoading: false,
        error: initialError,
        initialError,
        retry,
      },
    })

    expect(state.error).toBe(initialError)
    expect(state.loadMoreError).toBeNull()
    expect(state.retry).toBe(retry)
  })

  it('增量追加错误不提升为列表错误', () => {
    const loadMoreError = new Error('more')
    const state = getListLoadState({
      items: [{ id: 'item-1' }],
      loading: false,
      error: loadMoreError,
      retry: vi.fn(),
      incremental: {
        isInitialLoading: false,
        error: loadMoreError,
        initialError: null,
        retry: vi.fn(),
      },
    })

    expect(state.error).toBeNull()
    expect(state.loadMoreError).toBe(loadMoreError)
  })
})
