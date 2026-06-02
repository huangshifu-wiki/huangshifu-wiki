type CharacterCountProps = {
  current: number
  max: number
  className?: string
}

export function CharacterCount({ current, max, className = '' }: CharacterCountProps) {
  return (
    <span className={`shrink-0 text-xs text-text-muted ${className}`}>
      {current} / {max} 字符
    </span>
  )
}
