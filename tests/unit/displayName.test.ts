import { describe, expect, it } from 'vitest'
import {
  normalizeDisplayNameFallback,
  validateUserDisplayName,
} from '../../src/server/utils/display-name'

describe('display-name', () => {
  it('normalizes mention-reserved characters in fallback names', () => {
    expect(normalizeDisplayNameFallback(' Alice[1] <wx> ')).toBe('Alice_1_wx_')
  })

  it('rejects new display names with mention terminators', async () => {
    await expect(validateUserDisplayName('Alice[1]')).resolves.toMatchObject({
      ok: false,
      status: 400,
      error: '昵称不能包含提及保留字符',
    })
  })

  it('allows unchanged legacy display names with mention terminators', async () => {
    await expect(
      validateUserDisplayName('Alice[1]', { currentDisplayName: 'Alice[1]' })
    ).resolves.toEqual({
      ok: true,
      displayName: 'Alice[1]',
    })
  })
})
