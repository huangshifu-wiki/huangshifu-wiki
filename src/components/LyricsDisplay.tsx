import React, { useMemo } from 'react';
import { clsx } from 'clsx';
import { parseLRC, isLRCFormat, LRCLine } from '../lib/lrcParser';

interface LyricsDisplayProps {
  lyric: string;
  currentTime?: number;
}

export const LyricsDisplay = ({ lyric, currentTime }: LyricsDisplayProps) => {
  const { lines, metadata } = useMemo(() => {
    if (lyric && isLRCFormat(lyric)) {
      return parseLRC(lyric);
    }
    return {
      lines: lyric
        ? lyric.split('\n').map((text, i) => ({ time: i * 3, text: text.trim() } as LRCLine))
        : [],
      metadata: {}
    };
  }, [lyric]);

  const currentLineIndex = useMemo(() => {
    if (currentTime === undefined) return -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].time >= 0 && currentTime >= lines[i].time) {
        return i;
      }
    }
    return -1;
  }, [currentTime, lines]);

  if (lines.length === 0) {
    return <p className="text-sm text-[#9e968e] italic">暂无歌词</p>;
  }

  const hasMetadata = metadata.lyricist || metadata.composer || metadata.arranger;

  return (
    <div>
      {hasMetadata && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[#9e968e] mb-4">
          {metadata.lyricist && (
            <span>作词：<span className="text-[#6b6560]">{metadata.lyricist}</span></span>
          )}
          {metadata.composer && (
            <span>作曲：<span className="text-[#6b6560]">{metadata.composer}</span></span>
          )}
          {metadata.arranger && (
            <span>编曲：<span className="text-[#6b6560]">{metadata.arranger}</span></span>
          )}
        </div>
      )}

      <div className="text-[#6b6560]">
        {lines.map((line, index) => (
          <p
            key={`${line.time}-${index}`}
            className={clsx(
              'transition-all duration-300',
              currentLineIndex === index
                ? 'text-[#c8951e] font-semibold'
                : currentLineIndex > index
                ? 'text-[#9e968e]'
                : ''
            )}
          >
            {line.text || '\u00A0'}
          </p>
        ))}
      </div>
    </div>
  );
};
