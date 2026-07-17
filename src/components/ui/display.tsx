import { Loader2 } from '@/src/components/icons'
import React, { useId } from 'react'
import { cn } from './utils'

export const Panel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] p-5 shadow-[var(--book-panel-shadow)]',
        className
      )}
      {...props}
    />
  )
)
Panel.displayName = 'Panel'

type BadgeVariant = 'neutral' | 'primary' | 'danger' | 'warning' | 'success'
const badgeClasses: Record<BadgeVariant, string> = {
  neutral: 'border-[var(--book-ink-line)] bg-surface-alt text-text-secondary',
  primary: 'border-brand-gold/30 bg-[var(--color-theme-accent-soft)] text-brand-gold',
  danger: 'border-[var(--color-error)]/30 btn-danger-bg text-[var(--color-error)]',
  warning: 'border-[var(--color-warning)]/30 btn-warning-bg text-[var(--color-warning)]',
  success: 'border-[var(--color-success)]/30 btn-success-bg text-[var(--color-success)]',
}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ variant = 'neutral', className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium',
        badgeClasses[variant],
        className
      )}
      {...props}
    />
  )
)
Badge.displayName = 'Badge'

export const Separator = React.forwardRef<HTMLHRElement, React.HTMLAttributes<HTMLHRElement>>(
  ({ className, ...props }, ref) => (
    <hr
      ref={ref}
      className={cn('border-0 border-t border-[var(--book-ink-line)]', className)}
      {...props}
    />
  )
)
Separator.displayName = 'Separator'

export const Spinner = ({
  className,
  label = '加载中',
}: {
  className?: string
  label?: string
}) => (
  <span role="status" className="inline-flex items-center">
    <Loader2 className={cn('h-5 w-5 animate-spin', className)} aria-hidden="true" />
    <span className="sr-only">{label}</span>
  </span>
)

export const Skeleton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn('animate-pulse rounded bg-surface-alt', className)}
      {...props}
    />
  )
)
Skeleton.displayName = 'Skeleton'

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
}

export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ icon, title, description, action, className, ...props }, ref) => (
    <div ref={ref} className={cn('py-12 text-center', className)} {...props}>
      {icon && <div className="mx-auto mb-3 flex justify-center text-text-muted">{icon}</div>}
      <h3 className="font-[var(--book-title-font)] text-xl tracking-[0.08em] text-text-primary">
        {title}
      </h3>
      {description && (
        <p className="mx-auto mt-2 max-w-md text-sm text-text-muted">{description}</p>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  )
)
EmptyState.displayName = 'EmptyState'

export interface SettingsSectionProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title: React.ReactNode
  icon?: React.ReactNode
  headingId?: string
}

export const SettingsSection = React.forwardRef<HTMLElement, SettingsSectionProps>(
  ({ title, icon, headingId: headingIdProp, className, children, ...props }, ref) => {
    const generatedId = useId()
    const headingId = headingIdProp ?? `settings-section-${generatedId}`

    return (
      <section
        ref={ref}
        className={cn('min-w-0 space-y-6', className)}
        aria-labelledby={headingId}
        {...props}
      >
        <div className="flex min-w-0 items-center gap-2 border-b border-border pb-3">
          {icon && <span className="shrink-0 text-brand-gold">{icon}</span>}
          <h2 id={headingId} className="min-w-0 text-base font-semibold text-text-primary">
            {title}
          </h2>
        </div>
        {children}
      </section>
    )
  }
)
SettingsSection.displayName = 'SettingsSection'

export interface SettingRowProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode
  description?: React.ReactNode
  control: React.ReactNode
  labelFor?: string
  stackOnMobile?: boolean
}

export const SettingRow = React.forwardRef<HTMLDivElement, SettingRowProps>(
  ({ label, description, control, labelFor, stackOnMobile = false, className, ...props }, ref) => {
    const labelContent = (
      <>
        <span className="block break-words text-sm font-medium text-text-primary">{label}</span>
        {description && (
          <span className="mt-1 block break-words text-xs leading-relaxed text-text-muted">
            {description}
          </span>
        )}
      </>
    )

    return (
      <div
        ref={ref}
        className={cn(
          'flex min-w-0 max-w-3xl items-center justify-between gap-4 border-t border-border pt-6',
          stackOnMobile &&
            'flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4',
          className
        )}
        {...props}
      >
        {labelFor ? (
          <label htmlFor={labelFor} className="min-w-0">
            {labelContent}
          </label>
        ) : (
          <div className="min-w-0">{labelContent}</div>
        )}
        <div className={cn('shrink-0', stackOnMobile && 'w-full sm:w-auto')}>{control}</div>
      </div>
    )
  }
)
SettingRow.displayName = 'SettingRow'
