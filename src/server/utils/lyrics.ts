import type { MusicPlatform } from '../types'
import { parseMusicPlatform } from './parsers'
import { parseLyrics, type LyricType } from '../../lib/lrcParser'

const LYRIC_TYPES: Record<LyricType, true> = { plain: true, line: true, word: true }

interface LyricStorageData {
  lyric: string | null
  lyricType: LyricType | null
  lyricPlain: string | null
  lyricSource: MusicPlatform | null
}

interface LyricStorageInput {
  lyric: unknown
  lyricPlain?: unknown
  lyricType?: unknown
  lyricSource?: unknown
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function isMusicPlatform(value: string | null): value is MusicPlatform {
  return parseMusicPlatform(value) !== null
}

function isLyricType(value: string | null): value is LyricType {
  return value !== null && Object.hasOwn(LYRIC_TYPES, value)
}

export function normalizeLyricStorage(input: LyricStorageInput): {
  data: LyricStorageData
  errors: string[]
} {
  const errors: string[] = []
  const suppliedType = nonEmptyString(input.lyricType)
  const suppliedSource = nonEmptyString(input.lyricSource)

  if (
    input.lyricType !== undefined &&
    input.lyricType !== null &&
    (typeof input.lyricType !== 'string' || Boolean(input.lyricType.trim())) &&
    suppliedType !== 'none' &&
    !isLyricType(suppliedType)
  ) {
    errors.push('歌词类型只能是 plain、line、word 或 none')
  }
  if (
    input.lyricSource !== undefined &&
    input.lyricSource !== null &&
    (typeof input.lyricSource !== 'string' || Boolean(input.lyricSource.trim())) &&
    !isMusicPlatform(suppliedSource)
  ) {
    errors.push('歌词来源必须是 netease、tencent、kugou、baidu 或 kuwo')
  }

  if (suppliedType === 'none') {
    return {
      data: { lyric: null, lyricType: null, lyricPlain: null, lyricSource: null },
      errors,
    }
  }

  const suppliedPlain = nonEmptyString(input.lyricPlain)
  const lyric = nonEmptyString(input.lyric) ?? suppliedPlain
  if (!lyric) {
    return {
      data: { lyric: null, lyricType: null, lyricPlain: null, lyricSource: null },
      errors,
    }
  }

  const validSuppliedType = isLyricType(suppliedType) ? suppliedType : null
  const parsed = validSuppliedType && suppliedPlain ? null : parseLyrics(lyric)
  const lyricSource = isMusicPlatform(suppliedSource) ? suppliedSource : null

  return {
    data: {
      lyric,
      lyricType: validSuppliedType ?? parsed?.type ?? 'plain',
      lyricPlain: suppliedPlain ?? (parsed?.plainText || null),
      lyricSource,
    },
    errors,
  }
}
