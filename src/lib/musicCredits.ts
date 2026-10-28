const CREDIT_SEPARATORS = /[,，、/／;；|｜]+/

export function normalizeStringListInput(input: unknown): string[] {
  const values = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(CREDIT_SEPARATORS)
      : []
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const value of values) {
    if (typeof value !== 'string') continue
    const item = value.trim()
    if (!item || seen.has(item)) continue
    seen.add(item)
    normalized.push(item)
  }

  return normalized
}

export interface MusicImportCredits {
  lyricists: string[]
  composers: string[]
  arrangers: string[]
  vocals: string[]
}

export function resolveImportedVocals(
  vocals: unknown,
  artists: unknown,
  isInstrumental: boolean
): string[] {
  const normalizedVocals = normalizeStringListInput(vocals)
  if (normalizedVocals.length || isInstrumental) return normalizedVocals
  return normalizeStringListInput(artists)
}
const CREDIT_LINE_PATTERN = /^(.*?)\s*[:：]\s*(.+?)\s*$/
const TIMED_LINE_PREFIX = /^\[(\d{2}):(\d{2})(?:[:.](\d{2,3}))?\]\s*/
const SUPPORTED_CREDIT_LABELS: Record<string, keyof MusicImportCredits> = {
  作词: 'lyricists',
  词: 'lyricists',
  lyricist: 'lyricists',
  lyricists: 'lyricists',
  lyrics: 'lyricists',
  'written by': 'lyricists',
  作曲: 'composers',
  曲: 'composers',
  composer: 'composers',
  composers: 'composers',
  music: 'composers',
  'composed by': 'composers',
  编曲: 'arrangers',
  arranger: 'arrangers',
  arrangers: 'arrangers',
  arrangement: 'arrangers',
  'arranged by': 'arrangers',
  演唱: 'vocals',
  原唱: 'vocals',
  vocal: 'vocals',
  vocals: 'vocals',
  singer: 'vocals',
  singers: 'vocals',
  'performed by': 'vocals',
  'vocals by': 'vocals',
}
const IGNORED_CREDIT_LABELS: Record<string, true> = {
  制作: true,
  制作人: true,
  producer: true,
  producers: true,
  和声: true,
  和声编唱: true,
  'backing vocal': true,
  'backing vocals': true,
  吉他: true,
  guitar: true,
  二胡: true,
  erhu: true,
  后期: true,
  混音: true,
  母带: true,
  调教: true,
  策划: true,
  统筹: true,
  出品: true,
}

function normalizeCreditLabel(label: string) {
  return label.trim().toLowerCase().replace(/\s+/g, ' ')
}

function parseCreditLine(line: string) {
  const match = line.match(CREDIT_LINE_PATTERN)
  if (!match) return null
  return {
    label: normalizeCreditLabel(match[1]),
    value: match[2].trim(),
  }
}

function parseTimedLinePrefix(line: string) {
  const match = line.match(TIMED_LINE_PREFIX)
  if (!match) return { seconds: null, content: line }
  const fraction = match[3] ? Number.parseInt(match[3], 10) / 10 ** match[3].length : 0
  return {
    seconds: Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10) + fraction,
    content: line.slice(match[0].length).trim(),
  }
}

export function extractMusicCreditsFromLyric(lyric: string): MusicImportCredits {
  const credits: MusicImportCredits = {
    lyricists: [],
    composers: [],
    arrangers: [],
    vocals: [],
  }

  for (const rawLine of lyric.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const { seconds, content } = parseTimedLinePrefix(line)
    if (seconds !== null && seconds > 15) break

    const parsed = parseCreditLine(content)
    if (!parsed) break

    const field = SUPPORTED_CREDIT_LABELS[parsed.label]
    if (field) {
      credits[field].push(...normalizeStringListInput(parsed.value))
      continue
    }

    if (IGNORED_CREDIT_LABELS[parsed.label]) continue
    break
  }

  return {
    lyricists: normalizeStringListInput(credits.lyricists),
    composers: normalizeStringListInput(credits.composers),
    arrangers: normalizeStringListInput(credits.arrangers),
    vocals: normalizeStringListInput(credits.vocals),
  }
}

export function formatMusicCredits(input: unknown, fallback = ''): string {
  const credits = normalizeStringListInput(input)
  return credits.length ? credits.join(' / ') : fallback
}

export function firstMusicCredit(input: unknown, fallback = ''): string {
  return normalizeStringListInput(input)[0] || fallback
}
