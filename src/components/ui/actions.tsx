import * as SlotPrimitive from '@radix-ui/react-slot'
import { Loader2 } from '@/src/components/icons'
import React from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { cn } from './utils'

export type ButtonVariant =
  'primary' | 'secondary' | 'ghost' | 'danger' | 'warning' | 'success' | 'info'

export type ButtonSize = 'sm' | 'md' | 'lg'
export type ButtonAppearance = 'action' | 'plain'

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'theme-button-primary border-transparent',
  secondary:
    'border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] text-text-secondary hover:border-brand-gold/50 hover:text-brand-gold',
  ghost: 'border-transparent text-text-secondary hover:bg-surface-alt hover:text-brand-gold',
  danger: 'theme-button-danger border-transparent',
  warning: 'theme-button-warning border-transparent',
  success: 'theme-button-success border-transparent',
  info: 'theme-button-info border-transparent',
}

const softVariantClasses: Record<ButtonVariant, string> = {
  primary: variantClasses.primary,
  secondary: 'btn-secondary-bg text-text-secondary border-transparent',
  ghost: variantClasses.ghost,
  danger: 'btn-danger-bg text-error border-transparent',
  warning: 'btn-warning-bg text-warning border-transparent',
  success: 'btn-success-bg text-success border-transparent',
  info: 'btn-info-bg text-info border-transparent',
}

const SOFT_VARIANTS: ReadonlySet<ButtonVariant> = new Set([
  'secondary',
  'danger',
  'warning',
  'success',
  'info',
])

// 外观和语义只改变视觉，不改变同一 size 的几何尺寸。
const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-8 px-2.5 py-[5px] text-xs leading-5',
  md: 'min-h-9 px-3.5 py-[7px] text-sm leading-5',
  lg: 'min-h-11 px-[18px] py-2.5 text-sm leading-5',
}

export const buttonVariants = ({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  soft = false,
  appearance = variant === 'ghost' ? 'plain' : 'action',
  className,
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  soft?: boolean
  appearance?: ButtonAppearance
  className?: string
} = {}) =>
  cn(
    'ui-button inline-flex select-none items-center justify-center border transition-all',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
    'disabled:pointer-events-none disabled:opacity-50',
    appearance === 'action'
      ? 'ui-action gap-1.5 rounded-none font-normal tracking-[0.12em] duration-350'
      : 'gap-2 rounded font-medium duration-200',
    appearance === 'action' && variant === 'primary'
      ? 'ui-action-fill'
      : appearance === 'action' && !soft && variant === 'secondary'
        ? 'ui-action-outline'
        : soft
          ? softVariantClasses[variant]
          : variantClasses[variant],
    sizeClasses[size],
    soft &&
      SOFT_VARIANTS.has(variant) &&
      (appearance === 'action'
        ? 'border-[color-mix(in_srgb,currentColor_20%,transparent)]'
        : 'gap-1.5 rounded-lg'),
    fullWidth && 'w-full',
    className
  )

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  loadingText?: React.ReactNode
  fullWidth?: boolean
  soft?: boolean
  appearance?: ButtonAppearance
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      asChild = false,
      variant = 'primary',
      size = 'md',
      loading = false,
      loadingText,
      fullWidth = false,
      soft = false,
      appearance,
      leftIcon,
      rightIcon,
      className,
      children,
      disabled,
      type = 'button',
      ...props
    },
    ref
  ) => {
    const Component = asChild ? SlotPrimitive.Slot : 'button'
    return (
      <Component
        ref={ref}
        type={asChild ? undefined : type}
        className={buttonVariants({ variant, size, fullWidth, soft, appearance, className })}
        disabled={asChild ? undefined : disabled || loading}
        aria-disabled={disabled || loading || undefined}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : leftIcon}
            {loading && loadingText !== undefined ? loadingText : children}
            {!loading && rightIcon}
          </>
        )}
      </Component>
    )
  }
)
Button.displayName = 'Button'

export type LinkButtonProps = LinkProps &
  Pick<
    ButtonProps,
    'variant' | 'size' | 'fullWidth' | 'soft' | 'appearance' | 'leftIcon' | 'rightIcon'
  >

export const LinkButton = React.forwardRef<HTMLAnchorElement, LinkButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      fullWidth = false,
      soft = false,
      appearance,
      leftIcon,
      rightIcon,
      className,
      children,
      ...props
    },
    ref
  ) => (
    <Link
      ref={ref}
      className={buttonVariants({ variant, size, fullWidth, soft, appearance, className })}
      data-pressable
      {...props}
    >
      {leftIcon}
      {children}
      {rightIcon}
    </Link>
  )
)
LinkButton.displayName = 'LinkButton'

export interface IconButtonProps extends Omit<
  ButtonProps,
  'leftIcon' | 'rightIcon' | 'appearance'
> {
  'aria-label': string
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ size = 'md', className, children, ...props }, ref) => (
    <Button
      ref={ref}
      size={size}
      className={cn(
        size === 'sm' && 'h-8 w-8 min-h-0 p-0',
        size === 'md' && 'h-9 w-9 min-h-0 p-0',
        size === 'lg' && 'h-11 w-11 min-h-0 p-0',
        className
      )}
      {...props}
      appearance="plain"
    >
      {children}
    </Button>
  )
)
IconButton.displayName = 'IconButton'
