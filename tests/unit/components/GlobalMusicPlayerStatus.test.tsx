// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GlobalMusicPlayer } from '../../../src/components/GlobalMusicPlayer'
import { MusicProvider, useMusic } from '../../../src/context/MusicContext'

const songs = ['第一首', '第二首'].map((title) => ({
  title,
  artists: ['歌手'],
  album: '',
  cover: '',
  audioUrl: 'https://example.com/audio.mp3',
}))

function Harness() {
  const { setCurrentSong } = useMusic()
  return (
    <>
      <button onClick={() => setCurrentSong(songs[0])}>选择第一首</button>
      <button onClick={() => setCurrentSong(songs[1])}>选择第二首</button>
      <GlobalMusicPlayer />
    </>
  )
}

function setup() {
  const result = render(
    <MusicProvider>
      <Harness />
    </MusicProvider>
  )
  fireEvent.click(screen.getByText('选择第一首'))
  return { ...result, audio: () => result.container.querySelector('audio')! }
}

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('全局播放器状态', () => {
  it('播放请求只在 playing 事件后显示播放，暂停立即生效', () => {
    const { audio } = setup()
    expect(screen.getByText('待播放')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '播放' }))
    expect(screen.getByText('加载中...')).toBeInTheDocument()
    fireEvent.playing(audio())
    expect(screen.getByText('正在播放')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    fireEvent.canPlay(audio())
    expect(screen.getByText('已暂停')).toBeInTheDocument()
  })

  it('区分首次加载与播放后的缓冲，并等待 playing 恢复', () => {
    const { audio } = setup()
    fireEvent.click(screen.getByRole('button', { name: '播放' }))
    fireEvent.waiting(audio())
    expect(screen.getByText('加载中...')).toBeInTheDocument()
    fireEvent.playing(audio())
    fireEvent.waiting(audio())
    expect(screen.getByText('缓冲中...')).toBeInTheDocument()
    fireEvent.canPlay(audio())
    expect(screen.getByText('缓冲中...')).toBeInTheDocument()
    fireEvent.playing(audio())
    expect(screen.getByText('正在播放')).toBeInTheDocument()
  })

  it.each([
    { readyState: 3, paused: false, seeking: false, status: '正在播放' },
    { readyState: 2, paused: false, seeking: false, status: '缓冲中...' },
    { readyState: 3, paused: true, seeking: false, status: '缓冲中...' },
    { readyState: 3, paused: false, seeking: true, status: '缓冲中...' },
  ])('跳转完成后根据媒体状态显示 $status', ({ readyState, paused, seeking, status }) => {
    const { audio } = setup()
    fireEvent.click(screen.getByRole('button', { name: '播放' }))
    fireEvent.playing(audio())
    fireEvent.seeking(audio())
    expect(screen.getByText('缓冲中...')).toBeInTheDocument()
    Object.defineProperties(audio(), {
      readyState: { configurable: true, value: readyState },
      paused: { configurable: true, value: paused },
      seeking: { configurable: true, value: seeking },
    })
    fireEvent.seeked(audio())
    expect(screen.getByText(status)).toBeInTheDocument()
  })

  it.each(['media', 'play'] as const)('显示 %s 失败并停止播放意图', async (failure) => {
    if (failure === 'play')
      vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new Error('blocked'))
    const { audio } = setup()
    fireEvent.click(screen.getByRole('button', { name: '播放' }))
    if (failure === 'media') fireEvent.error(audio())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      failure === 'media' ? '音频加载失败，请检查网络连接' : '播放启动失败，请再次点击播放'
    )
    expect(screen.getByRole('button', { name: '播放' })).toBeInTheDocument()
    expect(screen.queryByText('缓冲中...')).not.toBeInTheDocument()
  })

  it('相同音源的歌曲切换后不会继承缓冲状态', async () => {
    const { audio } = setup()
    fireEvent.click(screen.getByRole('button', { name: '播放' }))
    fireEvent.playing(audio())
    fireEvent.waiting(audio())
    const previous = audio()
    fireEvent.click(screen.getByText('选择第二首'))
    await waitFor(() => expect(screen.getByText('加载中...')).toBeInTheDocument())
    fireEvent.playing(previous)
    expect(screen.getByText('加载中...')).toBeInTheDocument()
    fireEvent.playing(audio())
    expect(screen.getByText('正在播放')).toBeInTheDocument()
  })
})
