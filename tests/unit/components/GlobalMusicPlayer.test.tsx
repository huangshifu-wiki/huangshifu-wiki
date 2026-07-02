// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GlobalMusicPlayer } from '../../../src/components/GlobalMusicPlayer'

const { mockApiGet, mockMusicState } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockMusicState: {
    currentSong: {
      docId: 'song-1',
      title: '测试歌曲',
      artists: ['黄诗扶'],
      album: '测试专辑',
      cover: '',
      audioUrl: '',
    },
    isPlaying: true,
    setCurrentSong: vi.fn(),
    setIsPlaying: vi.fn(),
    playNext: vi.fn(),
    playPrevious: vi.fn(),
    seekTo: vi.fn(),
    setVolume: vi.fn(),
    toggleMute: vi.fn(),
    setDuration: vi.fn(),
  },
}))

vi.mock('../../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
}))

vi.mock('../../../src/context/MusicContext', () => ({
  useMusic: () => ({
    currentSong: mockMusicState.currentSong,
    setCurrentSong: mockMusicState.setCurrentSong,
    isPlaying: mockMusicState.isPlaying,
    setIsPlaying: mockMusicState.setIsPlaying,
    playNext: mockMusicState.playNext,
    playPrevious: mockMusicState.playPrevious,
    currentTime: 0,
    duration: 0,
    volume: 1,
    isMuted: false,
    seekTo: mockMusicState.seekTo,
    setVolume: mockMusicState.setVolume,
    toggleMute: mockMusicState.toggleMute,
    setDuration: mockMusicState.setDuration,
  }),
}))

describe('GlobalMusicPlayer playback', () => {
  let playMock: ReturnType<typeof vi.fn>
  let pauseMock: ReturnType<typeof vi.fn>
  const originalPlay = HTMLMediaElement.prototype.play
  const originalPause = HTMLMediaElement.prototype.pause

  beforeEach(() => {
    vi.clearAllMocks()
    mockMusicState.currentSong = {
      docId: 'song-1',
      title: '测试歌曲',
      artists: ['黄诗扶'],
      album: '测试专辑',
      cover: '',
      audioUrl: '',
    }
    mockMusicState.isPlaying = true
    mockApiGet.mockResolvedValue({
      playUrl: 'https://music.163.com/song/media/outer/url?id=1340543218.mp3',
      playable: true,
    })
    playMock = vi.fn(() => Promise.resolve())
    pauseMock = vi.fn()
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: playMock,
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      value: pauseMock,
    })
  })

  afterEach(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: originalPlay,
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      value: originalPause,
    })
  })

  it('starts playback as soon as a resolved URL is available', async () => {
    render(<GlobalMusicPlayer />)

    await waitFor(() => {
      expect(playMock).toHaveBeenCalled()
    })
    expect(mockMusicState.setIsPlaying).not.toHaveBeenCalledWith(false)
  })

  it('does not stop playback while waiting for a play URL', async () => {
    let resolvePlayUrl: (value: { playUrl: string; playable: boolean }) => void = () => {}
    mockApiGet.mockReturnValue(
      new Promise((resolve) => {
        resolvePlayUrl = resolve
      })
    )

    render(<GlobalMusicPlayer />)

    expect(mockMusicState.setIsPlaying).not.toHaveBeenCalledWith(false)
    expect(playMock).not.toHaveBeenCalled()

    await act(async () => {
      resolvePlayUrl({
        playUrl: 'https://music.163.com/song/media/outer/url?id=1340543218.mp3',
        playable: true,
      })
    })

    await waitFor(() => {
      expect(playMock).toHaveBeenCalled()
    })
  })

  it('stops playback when audio.play rejects', async () => {
    playMock.mockRejectedValueOnce(new Error('blocked'))

    render(<GlobalMusicPlayer />)

    await waitFor(() => {
      expect(mockMusicState.setIsPlaying).toHaveBeenCalledWith(false)
    })
    expect(screen.getByText('播放启动失败，请再次点击播放')).toBeInTheDocument()
  })

  it('ignores a stale audio.play rejection after the play URL changes', async () => {
    let rejectFirstPlay: (error: Error) => void = () => {}
    playMock
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectFirstPlay = reject
        })
      )
      .mockResolvedValue(Promise.resolve())

    mockMusicState.currentSong = {
      docId: 'song-1',
      title: '第一首',
      artists: ['黄诗扶'],
      album: '测试专辑',
      cover: '',
      audioUrl: '',
    }
    mockApiGet.mockResolvedValueOnce({
      playUrl: 'https://music.163.com/song/media/outer/url?id=1.mp3',
      playable: true,
    })
    const { rerender } = render(<GlobalMusicPlayer />)

    await waitFor(() => {
      expect(playMock).toHaveBeenCalledTimes(1)
    })

    mockMusicState.currentSong = {
      docId: 'song-2',
      title: '第二首',
      artists: ['黄诗扶'],
      album: '测试专辑',
      cover: '',
      audioUrl: '',
    }
    mockApiGet.mockResolvedValueOnce({
      playUrl: 'https://music.163.com/song/media/outer/url?id=2.mp3',
      playable: true,
    })
    rerender(<GlobalMusicPlayer />)

    await waitFor(() => {
      expect(playMock).toHaveBeenCalledTimes(2)
    })

    await act(async () => {
      rejectFirstPlay(new Error('stale'))
    })

    expect(mockMusicState.setIsPlaying).not.toHaveBeenCalledWith(false)
    expect(screen.queryByText('播放启动失败，请再次点击播放')).not.toBeInTheDocument()
  })
})
