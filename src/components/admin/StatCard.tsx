import { Link } from 'react-router-dom'
import { Panel } from '@/src/components/ui'
import type { LucideIcon } from '@/src/components/icons'
import { clsx } from 'clsx'

export interface StatCardProps {
  label: string
  value: number | string
  icon?: LucideIcon
  to?: string
  className?: string
}

export function StatCard({ label, value, icon: Icon, to, className }: StatCardProps) {
  const card = (
    <Panel
      className={clsx(
        'flex flex-col gap-2 p-4',
        to && 'transition-shadow group-hover:shadow-[var(--book-panel-shadow-hover)]',
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-text-secondary">{label}</span>
        {Icon ? <Icon size={16} className="shrink-0 text-text-muted" aria-hidden /> : null}
      </div>
      <span className="text-2xl font-semibold tabular-nums text-text-primary">
        {typeof value === 'number' ? value.toLocaleString('zh-CN') : value}
      </span>
    </Panel>
  )

  if (!to) return card

  return (
    <Link
      to={to}
      className="group block rounded outline-none focus-visible:ring-2 focus-visible:ring-[var(--book-focus-ring)]"
    >
      {card}
    </Link>
  )
}
