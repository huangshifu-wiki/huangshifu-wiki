import { formatTime as formatDuration } from './formatUtils'

export type LyricType = 'plain' | 'line' | 'word'

export interface LyricWord {
  rawStartMs: number
  durationMs: number
  text: string
}

export interface LRCLine {
  time: number
  text: string
  words?: LyricWord[]
}

export interface LRCMetadata {
  title?: string
  artist?: string
  album?: string
  lyricist?: string
  composer?: string
  arranger?: string
}

export interface LRCData {
  lines: LRCLine[]
  metadata: LRCMetadata
}

export interface LyricsData extends LRCData {
  type: LyricType
  plainText: string
}

const TIME_TAG_SOURCE = String.raw`\[(\d{2}):(\d{2})(?:[:.](\d{2,3}))?\]`
const TIME_TAG_REGEX = new RegExp(TIME_TAG_SOURCE)
const WORD_TAG_REGEX = /<(\d+),(\d+)(?:,\d+)?>/g
const METADATA_TAG_REGEX =
  /^\[(ti|ar|al|by|lyricist|mu|composer|re|offset|la|ve|km|man|rev|con|phs):([^\]]*)\]/

function parseTime(tag: string): number | null {
  const match = tag.match(TIME_TAG_REGEX)
  if (!match) return null

  const [, minutes, seconds, fraction] = match
  const fractionSeconds = fraction
    ? Number.parseInt(fraction, 10) / (fraction.length === 3 ? 1000 : 100)
    : 0

  return Number.parseInt(minutes, 10) * 60 + Number.parseInt(seconds, 10) + fractionSeconds
}

function parseMetadataTag(line: string): { key: string; value: string } | null {
  const match = line.match(METADATA_TAG_REGEX)
  if (!match) return null
  return { key: match[1], value: match[2].trim() }
}

function assignMetadata(metadata: LRCMetadata, key: string, value: string): void {
  switch (key) {
    case 'ti':
      metadata.title = value
      break
    case 'ar':
      metadata.artist = value
      break
    case 'al':
      metadata.album = value
      break
    case 'by':
    case 'lyricist':
      metadata.lyricist = value
      break
    case 'mu':
    case 'composer':
      metadata.composer = value
      break
    case 're':
      metadata.arranger = value
      break
  }
}

function parseWordLine(rawText: string): { text: string; words?: LyricWord[] } {
  const matches = Array.from(rawText.matchAll(WORD_TAG_REGEX))
  if (matches.length === 0) return { text: rawText.trim() }

  const words = matches.map((match, index) => {
    const nextMatch = matches[index + 1]
    const textEnd = nextMatch?.index ?? rawText.length
    return {
      rawStartMs: Number.parseInt(match[1], 10),
      durationMs: Number.parseInt(match[2], 10),
      text: rawText.slice((match.index ?? 0) + match[0].length, textEnd),
    }
  })
  const prefix = rawText.slice(0, matches[0].index ?? 0)

  return { text: `${prefix}${words.map((word) => word.text).join('')}`.trim(), words }
}

export function parseLyrics(lyric: string): LyricsData {
  const parsedLines: LRCLine[] = []
  const metadata: LRCMetadata = {}
  let hasTimedLine = false
  let hasWordLine = false

  for (const rawLine of lyric.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const metadataTag = parseMetadataTag(line)
    if (metadataTag) {
      assignMetadata(metadata, metadataTag.key, metadataTag.value)
      continue
    }

    const timeMatch = line.match(TIME_TAG_REGEX)
    if (!timeMatch) {
      parsedLines.push({ time: -1, text: line })
      continue
    }

    hasTimedLine = true
    const time = parseTime(timeMatch[0])
    if (time === null) continue

    const parsedText = parseWordLine(line.replace(TIME_TAG_REGEX, ''))
    if (!parsedText.text) continue
    if (parsedText.words) hasWordLine = true
    parsedLines.push({ time, ...parsedText })
  }

  parsedLines.sort((a, b) => a.time - b.time)
  const type: LyricType = hasWordLine ? 'word' : hasTimedLine ? 'line' : 'plain'

  return {
    type,
    lines: parsedLines,
    metadata,
    plainText: parsedLines.map((line) => line.text).join('\n'),
  }
}

export function parseLRC(lrc: string): LRCData {
  const { lines, metadata } = parseLyrics(lrc)
  return { lines, metadata }
}

export function formatTime(seconds: number): string {
  return formatDuration(seconds).padStart(5, '0')
}

export function isLRCFormat(lrc: string): boolean {
  return TIME_TAG_REGEX.test(lrc)
}
