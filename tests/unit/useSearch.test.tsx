// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiGet } from '../../src/lib/apiClient'
import { useTraditionalSearch } from '../../src/hooks/useSearch'

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
  apiUpload: vi.fn(),
}))

const apiGetMock = vi.mocked(apiGet)

const emptySearchResponse = {
  wiki: [],
  posts: [],
  galleries: [],
  music: [],
  albums: [],
  lyrics: [],
  searchMeta: {
    mode: 'keyword',
    query: '歌词',
    degraded: false,
    keywordResultCount: 0,
    vectorResultCount: 0,
    textVectorResultCount: 0,
  },
}

describe('useTraditionalSearch lyrics category', () => {
  beforeEach(() => {
    apiGetMock.mockReset()
    apiGetMock.mockResolvedValue(emptySearchResponse)
  })

  it('all 类别关闭详情时仍请求歌词分类，不附带 detail 参数', async () => {
    const { result } = renderHook(() => useTraditionalSearch())

    await act(async () => {
      await result.current.search(
        '歌词',
        {
          contentType: 'all',
          selectedTags: [],
          dateRange: { start: '', end: '' },
          semanticImageSearch: false,
        },
        { mode: 'keyword', includeDetail: false }
      )
    })

    expect(apiGetMock).toHaveBeenCalledWith('/api/search', {
      q: '歌词',
      type: 'all',
      mode: 'keyword',
    })
  })

  it('单独歌词类别不因详情开关改变请求语义', async () => {
    const { result } = renderHook(() => useTraditionalSearch())

    await act(async () => {
      await result.current.search(
        '歌词',
        {
          contentType: 'lyrics',
          selectedTags: [],
          dateRange: { start: '', end: '' },
          semanticImageSearch: false,
        },
        { mode: 'keyword', includeDetail: false }
      )
    })

    expect(apiGetMock).toHaveBeenCalledWith('/api/search', {
      q: '歌词',
      type: 'lyrics',
      mode: 'keyword',
    })
  })
})
