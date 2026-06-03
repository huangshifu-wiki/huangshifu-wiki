import { useUserPreferences } from '../context/UserPreferencesContext'

type CharacterCountProps = {
  current: number
  max: number
  className?: string
}

export function CharacterCount({ current, max, className = '' }: CharacterCountProps) {
  const { preferences } = useUserPreferences()

  if (!preferences.showCharacterCount) {
    return null
  }

  return (
    <span className={`shrink-0 text-xs text-text-muted ${className}`}>
      {current} / {max} 字符
    </span>
  )
}
