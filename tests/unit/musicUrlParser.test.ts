import { describe, expect, it } from 'vitest'

import { buildPlatformResourceUrl, parseMusicUrl } from '../../src/server/music/musicUrlParser'

describe('parseMusicUrl', () => {
  it('parses netease song url and normalizes it', () => {
    const parsed = parseMusicUrl('https://music.163.com/#/song?id=12345')
    expect(parsed).toEqual({
      platform: 'netease',
      type: 'song',
      id: '12345',
      normalizedUrl: 'https://music.163.com/#/song?id=12345',
    })
  })

  it('supports url without protocol', () => {
    const parsed = parseMusicUrl('y.qq.com/n/ryqq/songdetail/abcDEF_9')
    expect(parsed).toEqual({
      platform: 'tencent',
      type: 'song',
      id: 'abcDEF_9',
      normalizedUrl: 'https://y.qq.com/n/ryqq/songDetail/abcDEF_9',
    })
  })

  it('returns null for unsupported url', () => {
    expect(parseMusicUrl('https://example.com/some/other/path')).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(parseMusicUrl('   ')).toBeNull()
  })

  it('parses kuwo play_detail url as song', () => {
    expect(parseMusicUrl('https://www.kuwo.cn/play_detail/520126')).toEqual({
      platform: 'kuwo',
      type: 'song',
      id: '520126',
      normalizedUrl: 'https://www.kuwo.cn/play_detail/520126',
    })
  })

  it('keeps kuwo song_detail url normalized to song', () => {
    expect(parseMusicUrl('https://www.kuwo.cn/song_detail/520126')).toEqual({
      platform: 'kuwo',
      type: 'song',
      id: '520126',
      normalizedUrl: 'https://www.kuwo.cn/play_detail/520126',
    })
  })

  it('parses kuwo playlist_detail url as playlist', () => {
    expect(parseMusicUrl('https://www.kuwo.cn/playlist_detail/1045573069')).toEqual({
      platform: 'kuwo',
      type: 'playlist',
      id: '1045573069',
      normalizedUrl: 'https://www.kuwo.cn/playlist_detail/1045573069',
    })
  })
})

describe('buildPlatformResourceUrl', () => {
  it('builds kuwo playlist url', () => {
    expect(buildPlatformResourceUrl('kuwo', 'playlist', 'xYz_123')).toBe(
      'https://www.kuwo.cn/playlist_detail/xYz_123'
    )
  })

  it('builds kuwo song url with current play_detail path', () => {
    expect(buildPlatformResourceUrl('kuwo', 'song', '520126')).toBe(
      'https://www.kuwo.cn/play_detail/520126'
    )
  })

  it('builds baidu song url with 91q domain', () => {
    expect(buildPlatformResourceUrl('baidu', 'song', '133277411')).toBe(
      'https://music.91q.com/#/song/133277411'
    )
  })

  it('encodes id safely', () => {
    expect(buildPlatformResourceUrl('netease', 'album', 'id with space')).toBe(
      'https://music.163.com/#/album?id=id%20with%20space'
    )
  })
})
