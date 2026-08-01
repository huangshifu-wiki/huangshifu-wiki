import React from 'react'
import { clsx } from 'clsx'

interface CoverPlaceholderProps {
  icon?: React.ReactNode
  label?: string
  className?: string
  /** 背景类，默认 bg-surface-alt；调用点按主题覆盖（如首页 home token） */
  bgClassName?: string
  iconClassName?: string
  labelClassName?: string
}

export const CoverPlaceholder = ({
  icon,
  label,
  className,
  bgClassName = 'bg-surface-alt',
  iconClassName,
  labelClassName,
}: CoverPlaceholderProps) => (
  <div
    className={clsx(
      'flex h-full w-full flex-col items-center justify-center gap-1.5 px-1 text-center',
      bgClassName,
      className
    )}
  >
    {icon !== undefined && (
      <span className={clsx('text-brand-gold/60', iconClassName)} aria-hidden="true">
        {icon}
      </span>
    )}
    {label !== undefined && (
      <span className={clsx('text-xs leading-tight text-text-muted', labelClassName)}>{label}</span>
    )}
  </div>
)
