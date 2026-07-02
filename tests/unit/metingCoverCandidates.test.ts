import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveCoverUrl, resolveCoverUrlCandidates } from '../../src/server/music/metingService'

describe('meting cover candidates', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('generates high-to-low Tencent cover size fallbacks', async () => {
    const candidates = await resolveCoverUrlCandidates(
      'tencent',
      '003xiWP90VUMNk',
      'https://example.com/fallback.jpg'
    )

    expect(candidates).toEqual([
      'https://y.gtimg.cn/music/photo_new/T002R3543x3543M000003xiWP90VUMNk.jpg?max_age=2592000',
      'https://y.gtimg.cn/music/photo_new/T002R3000x3000M000003xiWP90VUMNk.jpg?max_age=2592000',
      'https://y.gtimg.cn/music/photo_new/T002R1500x1500M000003xiWP90VUMNk.jpg?max_age=2592000',
      'https://y.gtimg.cn/music/photo_new/T002R1000x1000M000003xiWP90VUMNk.jpg?max_age=2592000',
      'https://y.gtimg.cn/music/photo_new/T002R800x800M000003xiWP90VUMNk.jpg?max_age=2592000',
      'https://y.gtimg.cn/music/photo_new/T002R500x500M000003xiWP90VUMNk.jpg?max_age=2592000',
      'https://y.gtimg.cn/music/photo_new/T002R300x300M000003xiWP90VUMNk.jpg?max_age=2592000',
      'https://example.com/fallback.jpg',
    ])
  })

  it('returns the first reachable Tencent cover candidate for regular cover resolution', async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      const ok = url.includes('T002R1500x1500')
      return new Response(init?.method === 'GET' ? '' : null, { status: ok ? 200 : 404 })
    })
    global.fetch = fetchMock as typeof fetch

    const coverUrl = await resolveCoverUrl(
      'tencent',
      '003xiWP90VUMNk',
      'https://example.com/fallback.jpg'
    )

    expect(coverUrl).toBe(
      'https://y.gtimg.cn/music/photo_new/T002R1500x1500M000003xiWP90VUMNk.jpg?max_age=2592000'
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://y.gtimg.cn/music/photo_new/T002R3543x3543M000003xiWP90VUMNk.jpg?max_age=2592000',
      expect.objectContaining({ method: 'HEAD' })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://y.gtimg.cn/music/photo_new/T002R1500x1500M000003xiWP90VUMNk.jpg?max_age=2592000',
      expect.objectContaining({ method: 'HEAD' })
    )
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url).includes('T002R3543x3543') && init?.method === 'GET'
      )
    ).toBe(false)
  })

  it('falls back without throwing when Tencent cover probing finds no reachable URL', async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch

    const coverUrl = await resolveCoverUrl(
      'tencent',
      '003xiWP90VUMNk',
      'https://example.com/fallback.jpg'
    )

    expect(coverUrl).toBe(
      'https://y.gtimg.cn/music/photo_new/T002R3543x3543M000003xiWP90VUMNk.jpg?max_age=2592000'
    )
  })
})
