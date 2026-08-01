// @vitest-environment jsdom
import React, { useEffect } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GlobalMusicPlayer } from '../../../src/components/GlobalMusicPlayer'
import { MusicProvider, useMusic } from '../../../src/context/MusicContext'
import { apiGet } from '../../../src/lib/apiClient'

vi.mock('../../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
}))

vi.mock('../../../src/components/SmartImage', () => {
  const MockSmartImage = ({
    src,
    alt,
    className,
    fallback,
  }: {
    src?: string | null
    alt?: string
    className?: string
    fallback?: React.ReactNode
  }) => {
    const [hasError, setHasError] = React.useState(!src)

    if (hasError) {
      return <div className={className}>{fallback}</div>
    }

    return (
      <img
        src={src}
        alt={alt}
        className={className}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        onError={() => setHasError(true)}
      />
    )
  }

  return { SmartImage: MockSmartImage }
})

const mockedApiGet = vi.mocked(apiGet)

type TestSong = {
  docId?: string
  title: string
  artists: string[]
  album: string
  cover: string
  coverThumbnail?: string
  audioUrl: string
  playUrl?: string
  playable?: boolean
}

const Harness = ({ song }: { song: TestSong }) => {
  const { setCurrentSong } = useMusic()

  useEffect(() => {
    setCurrentSong(song)
  }, [song, setCurrentSong])

  return <GlobalMusicPlayer />
}

describe('GlobalMusicPlayer cover display', () => {
  it('renders the 无封面 fallback when the current song has no cover', () => {
    mockedApiGet.mockResolvedValue({ playUrl: 'https://example.com/a.mp3' } as never)

    render(
      <MusicProvider>
        <Harness
          song={{
            docId: 's1',
            title: '无封面歌',
            artists: ['歌手A'],
            album: '',
            cover: '',
            coverThumbnail: '',
            audioUrl: 'https://example.com/a.mp3',
            playUrl: '',
          }}
        />
      </MusicProvider>
    )

    expect(screen.getByText('无封面')).toBeInTheDocument()
    expect(screen.queryByAltText('无封面歌 封面')).not.toBeInTheDocument()
  })

  it('renders the cover image when the current song has a cover', async () => {
    mockedApiGet.mockResolvedValue({ playUrl: 'https://example.com/a.mp3' } as never)

    render(
      <MusicProvider>
        <Harness
          song={{
            docId: 's2',
            title: '有封面歌',
            artists: ['歌手B'],
            album: '',
            cover: 'https://example.com/cover.jpg',
            audioUrl: 'https://example.com/a.mp3',
            playUrl: '',
          }}
        />
      </MusicProvider>
    )

    const image = await screen.findByAltText('有封面歌 封面')
    expect(image).toHaveAttribute('src', 'https://example.com/cover.jpg')
  })
})
