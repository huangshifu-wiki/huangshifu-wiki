import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSong = vi.hoisted(() => vi.fn())
const mockFormat = vi.hoisted(() => vi.fn())

vi.mock('@meting/core', () => {
  class MockMeting {
    format(value: boolean) {
      mockFormat(value)
      return this
    }

    song(...args: unknown[]) {
      return mockSong(...args)
    }
  }

  return { default: MockMeting }
})

import { getMusicTrackMetadata } from '../../src/server/music/metingService'

describe('getMusicTrackMetadata', () => {
  beforeEach(() => {
    mockSong.mockReset()
    mockFormat.mockClear()
  })

  it('解析网易云歌曲的发行日期和毫秒时长', async () => {
    mockSong.mockResolvedValue(
      JSON.stringify({
        songs: [{ dt: 277350, publishTime: 1532966400000 }],
      })
    )

    await expect(getMusicTrackMetadata('netease', '1297802566')).resolves.toEqual({
      releaseDate: '2018-07-31',
      durationMs: 277350,
    })
    expect(mockFormat).toHaveBeenCalledWith(false)
    expect(mockSong).toHaveBeenCalledWith('1297802566')
  })

  it('解析 QQ 歌曲的秒时长和专辑发行日期', async () => {
    mockSong.mockResolvedValue(
      JSON.stringify({
        data: [{ interval: 277, album: { time_public: '2018-07-31' } }],
      })
    )

    await expect(getMusicTrackMetadata('tencent', '004KdkFG3Zuqsy')).resolves.toEqual({
      releaseDate: '2018-07-31',
      durationMs: 277000,
    })
  })

  it('解析酷狗歌曲的秒时长', async () => {
    mockSong.mockResolvedValue(JSON.stringify({ timeLength: 277 }))

    await expect(getMusicTrackMetadata('kugou', 'hash')).resolves.toEqual({
      releaseDate: null,
      durationMs: 277000,
    })
  })

  it('对不支持、非法响应和平台错误返回空元数据', async () => {
    mockSong.mockResolvedValueOnce(JSON.stringify({ data: [{ interval: '' }] }))
    await expect(getMusicTrackMetadata('baidu', 'song')).resolves.toEqual({
      releaseDate: null,
      durationMs: null,
    })
    expect(mockSong).not.toHaveBeenCalled()

    mockSong.mockResolvedValueOnce(JSON.stringify({ timeLength: '   ' }))
    await expect(getMusicTrackMetadata('kugou', 'song')).resolves.toEqual({
      releaseDate: null,
      durationMs: null,
    })

    mockSong.mockRejectedValueOnce(new Error('provider unavailable'))
    await expect(getMusicTrackMetadata('netease', 'song')).resolves.toEqual({
      releaseDate: null,
      durationMs: null,
    })
  })
})
