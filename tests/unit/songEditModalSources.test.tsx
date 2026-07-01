// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import {
  buildSourcesPatchFromPlatformSourceIds,
  type PlatformSourceIds,
} from '../../src/components/SongEditModal'
import type { MusicExternalSource } from '../../src/types/entities'

const source = (
  platform: MusicExternalSource['platform'],
  sourceId: string,
  overrides: Partial<MusicExternalSource> = {}
): MusicExternalSource => ({
  id: `${platform}-${sourceId}`,
  resourceType: 'song',
  platform,
  sourceId,
  sourceUrl: `https://example.com/${platform}/${sourceId}`,
  isPrimary: false,
  ...overrides,
})

describe('buildSourcesPatchFromPlatformSourceIds', () => {
  it('does not submit sources when platform IDs are unchanged', () => {
    const existingSources = [
      source('netease', '123', { isPrimary: true }),
      source('tencent', 'abc'),
    ]
    const sourceIds: PlatformSourceIds = {
      netease: '123',
      tencent: 'abc',
      kugou: '',
      baidu: '',
      kuwo: '',
    }

    expect(buildSourcesPatchFromPlatformSourceIds(sourceIds, existingSources)).toBeUndefined()
  })

  it('preserves source URLs and primary source for unchanged platform sources', () => {
    const existingSources = [
      source('netease', '123', {
        sourceUrl: 'https://music.163.com/song?id=123',
        isPrimary: true,
      }),
      source('tencent', 'abc', {
        sourceUrl: 'https://y.qq.com/n/ryqq/songDetail/abc',
      }),
    ]

    expect(
      buildSourcesPatchFromPlatformSourceIds(
        {
          netease: '123',
          tencent: 'def',
          kugou: '',
          baidu: '',
          kuwo: '',
        },
        existingSources
      )
    ).toEqual([
      {
        resourceType: 'song',
        platform: 'netease',
        sourceId: '123',
        sourceUrl: 'https://music.163.com/song?id=123',
        isPrimary: true,
      },
      {
        resourceType: 'song',
        platform: 'tencent',
        sourceId: 'def',
        sourceUrl: null,
        isPrimary: false,
      },
    ])
  })

  it('moves primary source to the first remaining source when the old primary is removed', () => {
    const existingSources = [
      source('netease', '123', { isPrimary: true }),
      source('tencent', 'abc'),
    ]

    expect(
      buildSourcesPatchFromPlatformSourceIds(
        {
          netease: '',
          tencent: 'abc',
          kugou: '',
          baidu: '',
          kuwo: '',
        },
        existingSources
      )
    ).toEqual([
      {
        resourceType: 'song',
        platform: 'tencent',
        sourceId: 'abc',
        sourceUrl: 'https://example.com/tencent/abc',
        isPrimary: true,
      },
    ])
  })
})
