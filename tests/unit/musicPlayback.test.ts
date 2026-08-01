import { describe, expect, it } from 'vitest'
import { isPlayableSong } from '../../src/lib/musicPlayback'

describe('isPlayableSong playableOverride', () => {
  it('disabled 时即使有 audioUrl 也判定不可播放', () => {
    expect(
      isPlayableSong({
        audioUrl: 'https://example.com/a.mp3',
        playableOverride: 'disabled',
      })
    ).toBe(false)
  })

  it('enabled 且存在音源时判定可播放，忽略 playable:false', () => {
    expect(
      isPlayableSong({
        sources: [{ platform: 'netease', sourceId: '1' }],
        playable: false,
        playableOverride: 'enabled',
      })
    ).toBe(true)
  })

  it('enabled 但没有任何音源时仍判定不可播放', () => {
    expect(
      isPlayableSong({
        audioUrl: '',
        sources: [],
        playableOverride: 'enabled',
      })
    ).toBe(false)
  })

  it('无 override 时保持原有判定逻辑', () => {
    expect(isPlayableSong({ playable: false, audioUrl: '' })).toBe(false)
    expect(isPlayableSong({ audioUrl: 'https://example.com/a.mp3' })).toBe(true)
    expect(isPlayableSong({ playable: true, sources: [] })).toBe(false)
  })
})
