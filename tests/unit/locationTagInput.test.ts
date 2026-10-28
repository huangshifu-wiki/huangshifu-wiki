import { describe, expect, it } from 'vitest'
import { resolveLocationTagInputEnterSelectionIndex } from '../../src/lib/locationTagInput'

describe('resolveLocationTagInputEnterSelectionIndex', () => {
  it('ignores enter when the dropdown is closed', () => {
    expect(
      resolveLocationTagInputEnterSelectionIndex({
        showDropdown: false,
        suggestionsLength: 3,
        selectedIndex: 1,
      })
    ).toBeNull()
  })

  it('ignores enter when no suggestion is highlighted', () => {
    expect(
      resolveLocationTagInputEnterSelectionIndex({
        showDropdown: true,
        suggestionsLength: 3,
        selectedIndex: -1,
      })
    ).toBeNull()
  })

  it('returns the highlighted suggestion index', () => {
    expect(
      resolveLocationTagInputEnterSelectionIndex({
        showDropdown: true,
        suggestionsLength: 3,
        selectedIndex: 1,
      })
    ).toBe(1)
  })

  it('clamps the selection index to available suggestions', () => {
    expect(
      resolveLocationTagInputEnterSelectionIndex({
        showDropdown: true,
        suggestionsLength: 2,
        selectedIndex: 5,
      })
    ).toBe(1)
  })
})
