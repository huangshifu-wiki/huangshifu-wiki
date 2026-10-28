import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { randomId } from '../../src/lib/randomId'

describe('randomId', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockCrypto: any

  beforeEach(() => {
    mockCrypto = globalThis.crypto
  })

  afterEach(() => {
    globalThis.crypto = mockCrypto
  })

  it('generates a valid UUID when crypto.randomUUID is available', () => {
    const mockUuid = '550e8400-e29b-41d4-a716-446655440000'
    vi.stubGlobal('crypto', {
      randomUUID: () => mockUuid,
    })

    const id = randomId()

    expect(id).toBe(mockUuid)
  })

  it('falls back to getRandomValues when randomUUID is not available', () => {
    const mockBytes = new Uint8Array(16)
    mockBytes.fill(0)

    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => {
        arr.set(mockBytes)
        return arr
      },
    })

    const id = randomId()

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('generates unique IDs', () => {
    const ids = new Set<string>()

    for (let i = 0; i < 100; i++) {
      ids.add(randomId())
    }

    expect(ids.size).toBe(100)
  })

  it('falls back to timestamp-based ID when no crypto methods available', () => {
    vi.stubGlobal('crypto', {})

    const id = randomId()

    expect(id).toContain('-')
  })

  it('returns valid ID format from fallback', () => {
    vi.stubGlobal('crypto', {})

    const id = randomId()

    expect(id).toContain('-')
  })
})
