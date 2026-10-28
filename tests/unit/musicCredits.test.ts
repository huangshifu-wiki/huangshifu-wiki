import { describe, expect, it } from 'vitest'

import { extractMusicCreditsFromLyric } from '../../src/lib/musicCredits'

describe('extractMusicCreditsFromLyric', () => {
  it('提取带时间标签的中文制作署名并忽略无结构化角色', () => {
    const lyric = `[00:00.000] 作词 : 梨衿
[00:01.000] 作曲 : Soda纯白
[00:02.000] 编曲 : Soda纯白
[00:03.000] 吉他 : litterzy
[00:04.000] 和声 : 黄诗扶 HBY
[00:05.000] 后期 : Mr_曾经
[00:06.000] 演唱 : 李常超 (Lao乾妈)
[00:25.991]光 是谁燃烛照亮`

    expect(extractMusicCreditsFromLyric(lyric)).toEqual({
      lyricists: ['梨衿'],
      composers: ['Soda纯白'],
      arrangers: ['Soda纯白'],
      vocals: ['李常超 (Lao乾妈)'],
    })
  })

  it('支持英文标签、多人分隔和重复去重', () => {
    const lyric = `lyrics: 梨衿 / 梨衿
composed by: Soda纯白, 另一位
arranged by: Soda纯白; 另一位
performed by: 李常超
正文歌词`

    expect(extractMusicCreditsFromLyric(lyric)).toEqual({
      lyricists: ['梨衿'],
      composers: ['Soda纯白', '另一位'],
      arrangers: ['Soda纯白', '另一位'],
      vocals: ['李常超'],
    })
  })

  it('遇到正文后不再采集伪署名', () => {
    const lyric = `作词: 梨衿
这是正文
作曲: 不应采集`

    expect(extractMusicCreditsFromLyric(lyric)).toEqual({
      lyricists: ['梨衿'],
      composers: [],
      arrangers: [],
      vocals: [],
    })
  })

  it('忽略超过十五秒的时间标签署名和空歌词', () => {
    expect(extractMusicCreditsFromLyric('[00:16]作词: 梨衿\n[00:17]作曲: Soda纯白')).toEqual({
      lyricists: [],
      composers: [],
      arrangers: [],
      vocals: [],
    })
    expect(extractMusicCreditsFromLyric('')).toEqual({
      lyricists: [],
      composers: [],
      arrangers: [],
      vocals: [],
    })
  })
})
