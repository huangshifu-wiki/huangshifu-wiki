export interface MentionTarget {
  uid: string
  publicId: string
  displayName: string
  photoURL?: string | null
}

export interface MentionSegment {
  type: 'text' | 'mention'
  text: string
  target?: MentionTarget | null
}

const MENTION_MAX_LENGTH = 50
const WORD_CHARS = /[\p{L}\p{N}_]/u
const MENTION_TERMINATORS = new Set([
  ' ',
  '\n',
  '\r',
  '\t',
  '<',
  '>',
  '[',
  ']',
  '(',
  ')',
  '{',
  '}',
  '`',
  '"',
  "'",
  '“',
  '”',
  '‘',
  '’',
])
const TRAILING_PUNCTUATION = /[,.!?;:，。！？；：、]+$/u
const SEPARATOR_PUNCTUATION = /[,!?;:，。！？；：、]/gu
const SEPARATOR_PUNCTUATION_CHARS = new Set([
  ',',
  '!',
  '?',
  ';',
  ':',
  '，',
  '。',
  '！',
  '？',
  '；',
  '：',
  '、',
])

interface Range {
  start: number
  end: number
}

export interface MentionNameCandidate {
  name: string
  end: number
}

interface MentionMatch {
  start: number
  end: number
  name: string
  candidates: MentionNameCandidate[]
}

function isWordChar(value: string | undefined) {
  return Boolean(value && WORD_CHARS.test(value))
}

function isMentionBoundary(value: string | undefined) {
  return !value || (!isWordChar(value) && value !== '.' && value !== '-' && value !== '/')
}

function isTerminator(value: string | undefined) {
  return !value || MENTION_TERMINATORS.has(value)
}

function isSeparatorBeforeMention(input: string, index: number) {
  const value = input[index]
  return Boolean(value && SEPARATOR_PUNCTUATION_CHARS.has(value) && input[index + 1] === '@')
}

function buildMentionNameCandidates(name: string, nameStart: number) {
  const candidates: MentionNameCandidate[] = []
  const seen = new Set<string>()

  const addCandidate = (candidate: string) => {
    if (!candidate || candidate.length > MENTION_MAX_LENGTH) return
    const key = candidate.toLowerCase()
    if (!seen.has(key)) {
      candidates.push({ name: candidate, end: nameStart + candidate.length })
      seen.add(key)
    }
  }

  const addWithTrailingPunctuationFallbacks = (value: string) => {
    let candidate = value

    while (candidate) {
      addCandidate(candidate)

      const next = candidate.replace(TRAILING_PUNCTUATION, '')
      if (next === candidate) break
      candidate = next
    }
  }

  addWithTrailingPunctuationFallbacks(name)

  for (const match of name.matchAll(SEPARATOR_PUNCTUATION)) {
    const index = match.index ?? -1
    if (index <= 0) continue
    addWithTrailingPunctuationFallbacks(name.slice(0, index))
  }

  return candidates
}

function findUnescapedClosing(input: string, start: number, closeChar: string) {
  for (let index = start; index < input.length; index += 1) {
    if (input[index] === '\n') return -1
    if (input[index] !== closeChar) continue

    let slashCount = 0
    for (let cursor = index - 1; cursor >= 0 && input[cursor] === '\\'; cursor -= 1) {
      slashCount += 1
    }
    if (slashCount % 2 === 0) return index
  }

  return -1
}

function normalizeReferenceLabel(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function collectReferenceLabels(input: string) {
  const labels = new Set<string>()
  for (const match of input.matchAll(/^\s{0,3}\[([^\]\n]+)\]:[^\n]*/gmu)) {
    labels.add(normalizeReferenceLabel(match[1]))
  }
  return labels
}

function collectMarkdownLinkRanges(input: string, referenceLabels: Set<string>) {
  const ranges: Range[] = []

  for (let index = 0; index < input.length; index += 1) {
    const isImage = input[index] === '!' && input[index + 1] === '['
    const isLink = input[index] === '['
    if (!isImage && !isLink) continue

    const start = index
    const labelStart = index + (isImage ? 2 : 1)
    const labelEnd = findUnescapedClosing(input, labelStart, ']')
    if (labelEnd < 0) continue

    const destinationStart = labelEnd + 1
    if (input[destinationStart] === '(') {
      const destinationEnd = findUnescapedClosing(input, destinationStart + 1, ')')
      if (destinationEnd < 0) continue
      ranges.push({ start, end: destinationEnd + 1 })
      index = destinationEnd
      continue
    }

    if (input[destinationStart] === '[') {
      const referenceEnd = findUnescapedClosing(input, destinationStart + 1, ']')
      if (referenceEnd < 0) continue
      ranges.push({ start, end: referenceEnd + 1 })
      index = referenceEnd
      continue
    }

    if (referenceLabels.has(normalizeReferenceLabel(input.slice(labelStart, labelEnd)))) {
      ranges.push({ start, end: labelEnd + 1 })
      index = labelEnd
    }
  }

  return ranges
}

function collectRegexRanges(input: string, pattern: RegExp) {
  const ranges: Range[] = []
  for (const match of input.matchAll(pattern)) {
    const start = match.index ?? 0
    ranges.push({ start, end: start + match[0].length })
  }
  return ranges
}

function collectEmailRanges(input: string) {
  const ranges: Range[] = []
  const pattern = /(^|[^\p{L}\p{N}_])[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/gmu

  for (const match of input.matchAll(pattern)) {
    const start = (match.index ?? 0) + match[1].length
    ranges.push({ start, end: (match.index ?? 0) + match[0].length })
  }

  return ranges
}

function collectMentionIgnoredRanges(input: string) {
  const ranges: Range[] = []
  const referenceLabels = collectReferenceLabels(input)

  let inFence = false
  let fenceStart = 0
  let fenceMarker = ''
  let lineStart = 0
  for (const match of input.matchAll(/[^\n]*(?:\n|$)/g)) {
    const line = match[0]
    if (!line && lineStart >= input.length) break

    const trimmed = line.trimStart()
    const marker = trimmed.startsWith('```') ? '```' : trimmed.startsWith('~~~') ? '~~~' : ''
    if (marker) {
      if (!inFence) {
        inFence = true
        fenceStart = lineStart
        fenceMarker = marker
      } else if (marker === fenceMarker) {
        ranges.push({ start: fenceStart, end: lineStart + line.length })
        inFence = false
        fenceMarker = ''
      }
    }

    lineStart += line.length
  }
  if (inFence) ranges.push({ start: fenceStart, end: input.length })

  const inlinePattern = /`[^`\n]*`/g
  for (const match of input.matchAll(inlinePattern)) {
    ranges.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length })
  }

  ranges.push(...collectMarkdownLinkRanges(input, referenceLabels))
  ranges.push(...collectRegexRanges(input, /^\s{0,3}\[[^\]\n]+\]:[^\n]*/gmu))
  ranges.push(
    ...collectRegexRanges(
      input,
      /<(?:(?:https?:\/\/|mailto:)[^>\s]+|[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+)>/giu
    )
  )
  ranges.push(...collectRegexRanges(input, /\b(?:https?:\/\/|www\.)[^\s<>()`"'“”‘’]+/giu))
  ranges.push(...collectEmailRanges(input))

  return ranges
}

function isInsideRanges(index: number, ranges: Range[]) {
  return ranges.some((range) => index >= range.start && index < range.end)
}

function findMentionMatches(input: string) {
  const ranges = collectMentionIgnoredRanges(input)
  const matches: MentionMatch[] = []

  for (let index = 0; index < input.length; index += 1) {
    if (input[index] !== '@') continue
    if (isInsideRanges(index, ranges)) continue
    if (!isMentionBoundary(input[index - 1])) continue

    let end = index + 1
    while (
      end < input.length &&
      !isTerminator(input[end]) &&
      !isSeparatorBeforeMention(input, end)
    ) {
      end += 1
    }

    const name = input.slice(index + 1, end).trim()
    if (!name) continue
    const candidates = buildMentionNameCandidates(name, index + 1)
    if (!candidates.length) continue
    matches.push({
      start: index,
      end,
      name,
      candidates,
    })
    index = end - 1
  }

  return matches
}

export function extractMentionMatches(input: string) {
  return findMentionMatches(input || '').map((match) => ({
    start: match.start,
    end: match.end,
    name: match.name,
    candidates: match.candidates,
  }))
}

export function extractMentionNames(input: string) {
  const names = new Map<string, string>()
  for (const match of findMentionMatches(input || '')) {
    for (const candidate of match.candidates) {
      const key = candidate.name.toLowerCase()
      if (!names.has(key)) names.set(key, candidate.name)
    }
  }
  return [...names.values()]
}

function resolveMentionMatch(match: MentionMatch, targetByName: Map<string, MentionTarget | null>) {
  for (const candidate of match.candidates) {
    const key = candidate.name.toLowerCase()
    if (!targetByName.has(key)) continue

    return {
      candidate,
      target: targetByName.get(key) ?? null,
    }
  }

  return {
    candidate: { name: match.name, end: match.end },
    target: null,
  }
}

export function splitMentionText(input: string, targets: MentionTarget[] = []): MentionSegment[] {
  const targetByName = new Map<string, MentionTarget | null>()
  const duplicateNames = new Set<string>()

  for (const target of targets) {
    const key = target.displayName.toLowerCase()
    if (targetByName.has(key)) {
      duplicateNames.add(key)
      targetByName.set(key, null)
    } else {
      targetByName.set(key, target)
    }
  }

  for (const name of duplicateNames) {
    targetByName.set(name, null)
  }

  const matches = findMentionMatches(input || '')
  if (!matches.length) return [{ type: 'text', text: input || '' }]

  const segments: MentionSegment[] = []
  let cursor = 0
  for (const match of matches) {
    if (match.start > cursor) {
      segments.push({ type: 'text', text: input.slice(cursor, match.start) })
    }
    const resolved = resolveMentionMatch(match, targetByName)
    segments.push({
      type: 'mention',
      text: input.slice(match.start, resolved.candidate.end),
      target: resolved.target,
    })
    cursor = resolved.candidate.end
  }

  if (cursor < input.length) {
    segments.push({ type: 'text', text: input.slice(cursor) })
  }

  return segments
}
