import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { Check } from '@/src/components/icons'
import React, { createContext, useContext, useId } from 'react'
import { Button } from './actions'
import { cn } from './utils'

type FieldContextValue = {
  controlId: string
  describedBy?: string
  invalid: boolean
  required: boolean
}

const FieldContext = createContext<FieldContextValue | null>(null)

export interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode
  description?: React.ReactNode
  error?: React.ReactNode
  required?: boolean
  controlId?: string
}

export const Field = React.forwardRef<HTMLDivElement, FieldProps>(
  (
    {
      label,
      description,
      error,
      required = false,
      controlId: controlIdProp,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const generatedId = useId()
    const controlId = controlIdProp ?? `field-${generatedId}`
    const descriptionId = description ? `${controlId}-description` : undefined
    const errorId = error ? `${controlId}-error` : undefined
    const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined

    return (
      <FieldContext.Provider value={{ controlId, describedBy, invalid: Boolean(error), required }}>
        <div ref={ref} className={cn('space-y-2', className)} {...props}>
          <label htmlFor={controlId} className="block text-sm font-medium text-text-primary">
            {label}
            {required && (
              <span className="ml-1 text-[var(--color-error)]" aria-hidden="true">
                *
              </span>
            )}
          </label>
          {children}
          {description && (
            <p id={descriptionId} className="text-xs leading-relaxed text-text-muted">
              {description}
            </p>
          )}
          {error && (
            <p id={errorId} className="text-xs text-[var(--color-error)]" role="alert">
              {error}
            </p>
          )}
        </div>
      </FieldContext.Provider>
    )
  }
)
Field.displayName = 'Field'

export const controlVariants = (className?: string) =>
  cn(
    'w-full rounded border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] px-3 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-brand-gold focus:shadow-[var(--book-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50 read-only:bg-surface-alt',
    className
  )

const useFieldProps = (
  id?: string,
  describedBy?: string,
  invalid?: React.AriaAttributes['aria-invalid'],
  required?: boolean
) => {
  const field = useContext(FieldContext)
  return {
    id: id ?? field?.controlId,
    'aria-describedby': describedBy ?? field?.describedBy,
    'aria-invalid': invalid ?? (field?.invalid || undefined),
    required: required ?? field?.required,
  }
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(
  (
    { className, id, 'aria-describedby': describedBy, 'aria-invalid': invalid, required, ...props },
    ref
  ) => (
    <input
      ref={ref}
      className={controlVariants(className)}
      {...useFieldProps(id, describedBy, invalid, required)}
      {...props}
    />
  )
)
Input.displayName = 'Input'

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(
  (
    { className, id, 'aria-describedby': describedBy, 'aria-invalid': invalid, required, ...props },
    ref
  ) => (
    <textarea
      ref={ref}
      className={controlVariants(cn('min-h-28 resize-y', className))}
      {...useFieldProps(id, describedBy, invalid, required)}
      {...props}
    />
  )
)
Textarea.displayName = 'Textarea'

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(
  (
    { className, id, 'aria-describedby': describedBy, 'aria-invalid': invalid, required, ...props },
    ref
  ) => (
    <select
      ref={ref}
      className={controlVariants(cn('appearance-none', className))}
      {...useFieldProps(id, describedBy, invalid, required)}
      {...props}
    />
  )
)
Select.displayName = 'Select'

export interface CheckboxProps extends Omit<
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>,
  'children'
> {
  label?: React.ReactNode
}

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(({ className, label, id: idProp, ...props }, ref) => {
  const generatedId = useId()
  const id = idProp ?? `checkbox-${generatedId}`
  const control = (
    <CheckboxPrimitive.Root
      ref={ref}
      id={id}
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-theme-accent)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-brand-gold data-[state=checked]:bg-[var(--color-theme-accent)] data-[state=checked]:text-[var(--color-theme-accent-contrast)]',
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="h-3.5 w-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )

  return label === undefined ? (
    control
  ) : (
    <label
      htmlFor={id}
      className="inline-flex cursor-pointer items-center gap-2 text-sm text-text-primary"
    >
      {control}
      {label}
    </label>
  )
})
Checkbox.displayName = 'Checkbox'

export const RadioGroup = RadioGroupPrimitive.Root

export interface SegmentedControlOption {
  value: string
  label: React.ReactNode
}

export interface SegmentedControlProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'onChange'
> {
  value: string
  options: readonly SegmentedControlOption[]
  onValueChange: (value: string) => void
}

export const SegmentedControl = React.forwardRef<HTMLDivElement, SegmentedControlProps>(
  ({ value, options, onValueChange, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex min-w-0 w-full rounded border border-border bg-surface p-1', className)}
      role="group"
      {...props}
    >
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={value === option.value ? 'primary' : 'ghost'}
          className="min-w-0 flex-1 whitespace-nowrap"
          aria-pressed={value === option.value}
          onClick={() => onValueChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
)
SegmentedControl.displayName = 'SegmentedControl'

export interface RadioGroupItemProps extends React.ComponentPropsWithoutRef<
  typeof RadioGroupPrimitive.Item
> {
  label: React.ReactNode
}

export const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  RadioGroupItemProps
>(({ className, label, id: idProp, ...props }, ref) => {
  const generatedId = useId()
  const id = idProp ?? `radio-${generatedId}`
  return (
    <label
      htmlFor={id}
      className="inline-flex cursor-pointer items-center gap-2 text-sm text-text-primary"
    >
      <RadioGroupPrimitive.Item
        ref={ref}
        id={id}
        className={cn(
          'flex h-5 w-5 items-center justify-center rounded-full border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-theme-accent)] disabled:opacity-50',
          className
        )}
        {...props}
      >
        <RadioGroupPrimitive.Indicator className="h-2.5 w-2.5 rounded-full bg-[var(--color-theme-accent)]" />
      </RadioGroupPrimitive.Item>
      {label}
    </label>
  )
})
RadioGroupItem.displayName = 'RadioGroupItem'

export interface SwitchProps extends Omit<
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>,
  'children'
> {
  label?: React.ReactNode
}

export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, SwitchProps>(
  ({ className, label, id: idProp, ...props }, ref) => {
    const generatedId = useId()
    const id = idProp ?? `switch-${generatedId}`
    const control = (
      <SwitchPrimitive.Root
        ref={ref}
        id={id}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full border border-[var(--book-ink-line)] bg-[var(--color-theme-surface-alt)] transition-colors data-[state=checked]:border-brand-gold data-[state=checked]:bg-brand-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-theme-accent)] disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb className="block h-4 w-4 translate-x-1 rounded-full bg-[var(--color-theme-accent-contrast)] shadow-[var(--shadow-brand-soft)] transition-transform data-[state=checked]:translate-x-6" />
      </SwitchPrimitive.Root>
    )

    return label === undefined ? (
      control
    ) : (
      <label
        htmlFor={id}
        className="inline-flex cursor-pointer items-center gap-3 text-sm text-text-primary"
      >
        {control}
        {label}
      </label>
    )
  }
)
Switch.displayName = 'Switch'
