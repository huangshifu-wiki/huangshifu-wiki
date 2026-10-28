export const resolveLocationTagInputEnterSelectionIndex = ({
  showDropdown,
  suggestionsLength,
  selectedIndex,
}: {
  showDropdown: boolean
  suggestionsLength: number
  selectedIndex: number
}): number | null => {
  if (!showDropdown || suggestionsLength <= 0 || selectedIndex < 0) {
    return null
  }

  return Math.min(selectedIndex, suggestionsLength - 1)
}
