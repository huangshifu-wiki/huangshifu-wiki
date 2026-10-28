import fs from 'fs'
import path from 'path'

interface SensitiveWordNode {
  isEnd: boolean
  children: Map<string, SensitiveWordNode>
}

let rootNode: SensitiveWordNode | null = null
let initPromise: Promise<void> | null = null

function createNode(): SensitiveWordNode {
  return {
    isEnd: false,
    children: new Map(),
  }
}

async function doInit(): Promise<void> {
  const filePath = path.join(process.cwd(), 'public', 'sensitive-words', 'words.txt')

  const content = await fs.promises.readFile(filePath, 'utf-8')
  const words = content
    .split('\n')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)

  rootNode = createNode()

  for (const word of words) {
    if (!word) continue
    let current = rootNode
    for (const char of word) {
      if (!current.children.has(char)) {
        current.children.set(char, createNode())
      }
      current = current.children.get(char)!
    }
    current.isEnd = true
  }

  console.log(`[SensitiveWord] Loaded ${words.length} sensitive words`)
}

export async function ensureSensitiveWords(): Promise<void> {
  if (rootNode !== null) return

  if (initPromise) return initPromise

  initPromise = doInit().catch((err) => {
    console.error('[SensitiveWord] Init failed, will retry next call:', err)
    initPromise = null
    throw err
  })

  return initPromise
}

export async function initSensitiveWords(): Promise<void> {
  if (rootNode !== null) return

  try {
    await doInit()
  } catch (err) {
    console.error('[SensitiveWord] Init failed (backward compat):', err)
  }
}

export function containsSensitive(text: string): string[] {
  if (!rootNode) {
    console.warn('[SensitiveWord] Not initialized, attempting lazy init...')
    return []
  }

  const found: string[] = []
  const normalizedText = text.toLowerCase()

  for (let i = 0; i < normalizedText.length; i++) {
    const result = searchFromPosition(normalizedText, i)
    if (result) {
      found.push(result)
    }
  }

  return [...new Set(found)]
}

function searchFromPosition(text: string, startPos: number): string | null {
  let current = rootNode!
  let matchEnd = -1

  for (let i = startPos; i < text.length; i++) {
    const char = text[i]
    const nextNode = current.children.get(char)

    if (!nextNode) {
      break
    }

    current = nextNode
    if (current.isEnd) {
      matchEnd = i
    }
  }

  if (matchEnd >= startPos) {
    return text.slice(startPos, matchEnd + 1)
  }

  return null
}

export function isSensitiveWord(keyword: string): boolean {
  if (!rootNode) return false

  const normalized = keyword.toLowerCase()
  let current = rootNode
  let isEnd = true

  for (const char of normalized) {
    if (!current.children.has(char)) {
      isEnd = false
      break
    }
    current = current.children.get(char)!
  }

  return isEnd && current.isEnd
}
