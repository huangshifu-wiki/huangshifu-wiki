import React from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, X } from '@/src/components/icons'
import { clsx } from 'clsx'
import { IconButton, buttonVariants, controlVariants } from '@/src/components/ui'

/** @deprecated 请改用 Input 或 controlVariants。 */
export const bookInputClass = controlVariants('px-4 py-3 text-base')

/** @deprecated 请改用 Input size 样式或 controlVariants。 */
export const bookCompactInputClass = controlVariants()

/** @deprecated 请改用 Button variant="secondary"。 */
export const bookSecondaryButtonClass = buttonVariants({ variant: 'secondary' })

/** @deprecated 请改用 Button variant="secondary" size="sm"。 */
export const bookSmallButtonClass = buttonVariants({ variant: 'secondary', size: 'sm' })

/** @deprecated 请改用 IconButton。 */
export const bookIconButtonClass = buttonVariants({
  variant: 'secondary',
  className: 'h-10 w-10 p-0 text-text-muted',
})

export const bookPanelClass =
  'rounded border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)]'

type BookEditorShellProps = React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode
  containerClassName?: string
  embedded?: boolean
}

export const BookEditorShell = ({
  children,
  className,
  containerClassName,
  embedded = false,
  ...props
}: BookEditorShellProps) => (
  <div
    {...props}
    className={clsx(
      embedded
        ? 'text-[var(--color-text-antique)]'
        : 'mobile-page-shell antique-detail text-[var(--color-text-antique)]',
      className
    )}
  >
    <div className={clsx(embedded ? 'w-full' : 'mobile-page-container', containerClassName)}>
      {children}
    </div>
  </div>
)

type BookEditorHeaderProps = {
  title: React.ReactNode
  description?: React.ReactNode
  backTo?: string
  backLabel?: React.ReactNode
  onClose?: () => void
  closeLabel?: string
  actions?: React.ReactNode
  className?: string
}

export const BookEditorHeader = ({
  title,
  description,
  backTo,
  backLabel,
  onClose,
  closeLabel = '关闭',
  actions,
  className,
}: BookEditorHeaderProps) => (
  <header
    className={clsx(
      'mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-[var(--book-ink-line)] pb-8',
      className
    )}
  >
    <div className="min-w-0">
      {backTo && backLabel ? (
        <Link
          to={backTo}
          className="mb-5 inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-brand-gold"
        >
          <ArrowLeft size={16} />
          {backLabel}
        </Link>
      ) : null}
      <h1 className="mobile-page-title">{title}</h1>
      {description ? (
        <p className="mt-3 max-w-3xl text-sm leading-relaxed tracking-[0.03em] text-text-muted">
          {description}
        </p>
      ) : null}
    </div>
    <div className="flex shrink-0 items-center gap-2">
      {actions}
      {onClose ? (
        <IconButton type="button" onClick={onClose} variant="secondary" aria-label={closeLabel}>
          <X size={22} />
        </IconButton>
      ) : null}
    </div>
  </header>
)

type BookEditorSectionProps = {
  title?: React.ReactNode
  eyebrow?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  contentClassName?: string
}

export const BookEditorSection = ({
  title,
  eyebrow,
  actions,
  children,
  className,
  contentClassName,
}: BookEditorSectionProps) => (
  <section className={clsx('border-t border-[var(--book-ink-line)] pt-7', className)}>
    {(title || eyebrow || actions) && (
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? (
            <div className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
              {eyebrow}
            </div>
          ) : null}
          {title ? (
            <h2 className="text-[1.125rem] font-semibold tracking-[0.05em] text-brand-gold">
              {title}
            </h2>
          ) : null}
        </div>
        {actions}
      </div>
    )}
    <div className={contentClassName}>{children}</div>
  </section>
)

type BookFormFieldProps = {
  label: React.ReactNode
  htmlFor?: string
  required?: boolean
  counter?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export const BookFormField = ({
  label,
  htmlFor,
  required,
  counter,
  children,
  className,
}: BookFormFieldProps) => (
  <div className={clsx('space-y-2', className)}>
    <div className="flex min-h-5 items-center justify-between gap-3">
      <label
        htmlFor={htmlFor}
        className="text-xs font-bold uppercase tracking-widest text-text-muted"
      >
        {label} {required ? <span className="theme-text-error">*</span> : null}
      </label>
      {counter}
    </div>
    {children}
  </div>
)

type BookEditorActionsProps = {
  children: React.ReactNode
  leading?: React.ReactNode
  className?: string
}

export const BookEditorActions = ({ children, leading, className }: BookEditorActionsProps) => (
  <div
    className={clsx(
      'flex flex-col gap-3 border-t border-[var(--book-ink-line)] pt-6 sm:flex-row sm:items-center sm:justify-between',
      className
    )}
  >
    {leading}
    <div className="flex w-full flex-wrap justify-end gap-3 sm:ml-auto sm:w-auto">{children}</div>
  </div>
)

type BookDangerZoneProps = {
  id?: string
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
}

export const BookDangerZone = ({ id, title, description, children }: BookDangerZoneProps) => (
  <section className="mt-4 flex justify-start text-left">
    <div
      id={id}
      className="max-w-[520px] rounded border border-[color-mix(in_srgb,var(--color-error)_35%,var(--book-ink-line))] bg-[color-mix(in_srgb,var(--color-error)_5%,var(--book-panel-bg))] p-5"
    >
      <h2 className="text-base font-bold tracking-[0.08em] text-danger">{title}</h2>
      {description ? <p className="mt-2 text-sm text-text-muted">{description}</p> : null}
      {children}
    </div>
  </section>
)

export const BookEmptyState = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-8 border-y border-[var(--book-ink-line)] py-16 text-center text-[0.9375rem] italic tracking-[0.08em] text-text-muted">
    {children}
  </div>
)
