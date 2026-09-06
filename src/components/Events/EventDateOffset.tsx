import { clsx } from 'clsx'

interface EventDateOffsetProps {
  dayOffset: number | null
  compact?: boolean
}

// 未来活动的天数偏移徽标：今天=+0，过去或无时间不显示
const EventDateOffset = ({ dayOffset, compact = false }: EventDateOffsetProps) => {
  if (dayOffset === null || dayOffset < 0) return null

  return (
    <span
      className={clsx(
        'shrink-0 font-semibold tabular-nums',
        compact ? 'text-[0.6875rem]' : 'text-xs',
        'theme-text-success'
      )}
    >
      +{dayOffset}
    </span>
  )
}

export { EventDateOffset }
export type { EventDateOffsetProps }
