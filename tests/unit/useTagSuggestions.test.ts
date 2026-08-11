// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiGet } from '../../src/lib/apiClient'
import { useTagSuggestions, type TagSuggestionResource } from '../../src/hooks/useTagSuggestions'

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
}))

const mockedApiGet = vi.mocked(apiGet)

const endpointByResource: Record<TagSuggestionResource, string> = {
  wiki: '/api/wiki/tags',
  post: '/api/posts/tags',
  gallery: '/api/galleries/tags',
  event: '/api/events/tags',
  music: '/api/music/tags',
}

describe('useTagSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(Object.entries(endpointByResource) as Array<[TagSuggestionResource, string]>)(
    'requests the fixed endpoint for %s',
    async (resource, endpoint) => {
      mockedApiGet.mockResolvedValueOnce({ tags: ['现场'] })
      const { result } = renderHook(() => useTagSuggestions(resource))

      await waitFor(() => expect(result.current).toEqual(['现场']))
      expect(mockedApiGet).toHaveBeenCalledWith(endpoint)
    }
  )

  it('falls back to an empty suggestion list when the request fails', async () => {
    mockedApiGet.mockRejectedValueOnce(new Error('network failed'))
    const { result } = renderHook(() => useTagSuggestions('wiki'))

    await waitFor(() => expect(mockedApiGet).toHaveBeenCalledWith('/api/wiki/tags'))
    expect(result.current).toEqual([])
  })

  it('skips the request while disabled', () => {
    const { result } = renderHook(() => useTagSuggestions('music', false))

    expect(result.current).toEqual([])
    expect(mockedApiGet).not.toHaveBeenCalled()
  })
})
