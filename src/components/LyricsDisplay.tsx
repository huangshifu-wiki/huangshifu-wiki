import React, { useMemo } from 'react'
import { clsx } from 'clsx'
import { parseLyrics } from '../lib/lrcParser'

interface LyricsDisplayProps {
  lyric: string
  currentTime?: number
}

export const LyricsDisplay = ({ lyric, currentTime }: LyricsDisplayProps) => {
  const { type, lines, metadata } = useMemo(() => parseLyrics(lyric), [lyric])

  const currentLineIndex = useMemo(() => {
    if (currentTime === undefined || type === 'plain') return -1
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].time >= 0 && currentTime >= lines[i].time) {
        return i
      }
    }
    return -1
  }, [currentTime, lines, type])

  if (lines.length === 0) {
    return <p className="text-[0.875rem] text-text-muted italic tracking-[0.08em]">暂无歌词</p>
  }

  const hasMetadata = metadata.lyricist || metadata.composer || metadata.arranger

  return (
    <div>
      {hasMetadata && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[0.8125rem] text-text-muted mb-5 pb-4 border-b border-[var(--book-ink-line)]">
          {metadata.lyricist && (
            <span>
              作词：<span className="text-text-secondary">{metadata.lyricist}</span>
            </span>
          )}
          {metadata.composer && (
            <span>
              作曲：<span className="text-text-secondary">{metadata.composer}</span>
            </span>
          )}
          {metadata.arranger && (
            <span>
              编曲：<span className="text-text-secondary">{metadata.arranger}</span>
            </span>
          )}
        </div>
      )}

      <div className="text-text-secondary">
        {lines.map((line, index) => (
          <p
            key={`${line.time}-${index}`}
            className={clsx(
              'transition-all duration-300 leading-[2]',
              currentLineIndex === index
                ? 'text-brand-gold font-semibold'
                : currentLineIndex > index
                  ? 'text-text-muted'
                  : ''
            )}
          >
            {line.text || '\u00A0'}
          </p>
        ))}
      </div>
    </div>
  )
}
