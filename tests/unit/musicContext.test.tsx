// @vitest-environment jsdom
import React from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MusicProvider, useMusic } from '../../src/context/MusicContext'

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MusicProvider>{children}</MusicProvider>
)

describe('MusicProvider playback queue', () => {
  it('filters unplayable songs from playlist state', () => {
    const { result } = renderHook(() => useMusic(), { wrapper })

    act(() => {
      result.current.setPlaylist([
        {
          docId: 'unplayable-1',
          title: '不可播放',
          artists: [],
          album: '',
          cover: '',
          audioUrl: '',
          sources: [],
          playable: false,
        },
        {
          docId: 'playable-1',
          title: '可播放',
          artists: [],
          album: '',
          cover: '',
          audioUrl: '/uploads/song.mp3',
        },
      ])
    })

    expect(result.current.playlist.map((song) => song.docId)).toEqual(['playable-1'])
  })

  it('skips unplayable songs when navigating album tracks', () => {
    const { result } = renderHook(() => useMusic(), { wrapper })

    act(() => {
      result.current.playAlbumTracks(
        'album-1',
        '专辑',
        [
          {
            docId: 'playable-1',
            title: '可播放 1',
            artists: [],
            album: '',
            cover: '',
            audioUrl: '/uploads/1.mp3',
          },
          {
            docId: 'unplayable-1',
            title: '不可播放',
            artists: [],
            album: '',
            cover: '',
            audioUrl: '',
            sources: [],
            playable: false,
          },
          {
            docId: 'playable-2',
            title: '可播放 2',
            artists: [],
            album: '',
            cover: '',
            audioUrl: '',
            sources: [
              {
                id: 'source-1',
                resourceType: 'song',
                platform: 'netease',
                sourceId: '123',
                isPrimary: true,
              },
            ],
          },
        ],
        0
      )
    })

    expect(result.current.currentSong?.docId).toBe('playable-1')

    act(() => {
      result.current.playNext()
    })

    expect(result.current.currentSong?.docId).toBe('playable-2')

    act(() => {
      result.current.playPrevious()
    })

    expect(result.current.currentSong?.docId).toBe('playable-1')
  })
})
