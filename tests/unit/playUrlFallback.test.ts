import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'path'
import os from 'os'

const mockResolveAudioUrl = vi.hoisted(() => vi.fn())

vi.mock('../../src/server/utils/config', () => ({
  prisma: {},
  PLAY_URL_CACHE_TTL_MS: 600000,
  DEFAULT_MUSIC_PLATFORMS: ['netease', 'tencent', 'kugou', 'baidu', 'kuwo'],
  uploadsDir: path.join(os.tmpdir(), 'huangshifu-play-url-fallback-test-uploads'),
}))

vi.mock('../../src/server/utils/remoteImageAsset', () => ({
  localizeImageUrlAsMediaAsset: vi.fn(),
}))

vi.mock('../../src/server/services/variantGenerator', () => ({
  variantGenerator: { enqueue: vi.fn() },
}))

vi.mock('../../src/server/vector/textEmbeddingSync', () => ({
  enqueueMusicTextEmbeddingsDeferred: vi.fn(),
}))

vi.mock('../../src/server/music/metingService', () => ({
  getMusicResourcePreview: vi.fn(),
  resolveAudioUrl: mockResolveAudioUrl,
  resolveLyric: vi.fn(),
  resolveCoverUrl: vi.fn(),
}))

import { resolveMusicPlayUrl } from '../../src/server/utils/music'

const NET_EASE_SONG = {
  docId: 'doc-netease-1',
  audioUrl: '',
  externalSources: [{ platform: 'netease' as const, sourceId: '2156506573', isPrimary: true }],
}

describe('resolveMusicPlayUrl 网易云外链回退', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('网易云解析失败时回退到外链，由浏览器直连', async () => {
    mockResolveAudioUrl.mockResolvedValue('')

    const result = await resolveMusicPlayUrl(NET_EASE_SONG)

    expect(result.playable).toBe(true)
    expect(result.playUrl).toBe('https://music.163.com/song/media/outer/url?id=2156506573.mp3')
    expect(result.cached).toBe(false)
    expect(result).toHaveProperty('fallback', true)
    expect(result.platform).toBe('netease')
    expect(result.mode).toBe('outer')
  })

  it('网易云解析成功时返回 CDN 直链', async () => {
    mockResolveAudioUrl.mockResolvedValue('https://m801.music.126.net/example.mp3')

    const result = await resolveMusicPlayUrl(NET_EASE_SONG)

    expect(result.playUrl).toBe('https://m801.music.126.net/example.mp3')
    expect(result.playable).toBe(true)
    expect(result).not.toHaveProperty('fallback')
    expect(result.mode).toBe('resolved')
  })

  it('没有可用平台时返回不可播放', async () => {
    const result = await resolveMusicPlayUrl({
      docId: 'doc-none',
      audioUrl: '',
      externalSources: [],
    })

    expect(result.playable).toBe(false)
    expect(result.playUrl).toBe('')
    expect(result.mode).toBe('none')
  })
})
